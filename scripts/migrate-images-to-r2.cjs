// Moves image bytes out of MongoDB (uploads and renders) into Cloudflare R2, in batches:
//   node scripts/migrate-images-to-r2.cjs                      a dry run: counts and sizes, changes nothing
//   node scripts/migrate-images-to-r2.cjs --copy               copies each image to R2, checks the copy's size, then
//                                                              records its key (the bytes stay in MongoDB too)
//   node scripts/migrate-images-to-r2.cjs --delete-from-mongo  the same, then removes the bytes from MongoDB, only
//                                                              for images whose copy in R2 was just checked
// Options: --batch=<n> images per batch (default 20), --limit=<n> stop after n images, --only=uploads|renders.
// Safe to stop and run again: images already copied are skipped (with --delete-from-mongo they are checked again).
// Reads MONGO_URL, DB_NAME and R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET from .env.local,
// then .env, or from the environment. Image addresses (/api/uploads/<id>, /api/rendered/<id>) never change.
const path = require('node:path')
const { AwsClient } = require('aws4fetch')

const USAGE = 'Usage: node scripts/migrate-images-to-r2.cjs [--dry-run | --copy | --delete-from-mongo] [--batch=20] [--limit=<n>] [--only=uploads|renders]'

// Where each collection keeps its bytes, and the R2 key and type each image gets (as lib/services/uploadStore.ts).
const COLLECTIONS = {
  uploads: { fields: ['bytes'], key: doc => `uploads/${doc.id}`, type: doc => doc.contentType || 'application/octet-stream' },
  renders: { fields: ['zip', 'png'], key: (doc, field) => `renders/${doc.id}.${field}`, type: (doc, field) => (field === 'zip' ? 'application/zip' : 'image/png') },
}

function parseArgs(argv) {
  const args = { mode: 'dry-run', batch: 20, limit: Infinity, only: null, help: false }
  for (const arg of argv) {
    const [name, value] = arg.split('=')
    if (name === '--help' || name === '-h') args.help = true
    else if (name === '--dry-run') args.mode = 'dry-run'
    else if (name === '--copy') args.mode = 'copy'
    else if (name === '--delete-from-mongo') args.mode = 'delete'
    else if (name === '--batch' && Number(value) >= 1) args.batch = Math.floor(Number(value))
    else if (name === '--limit' && Number(value) >= 1) args.limit = Math.floor(Number(value))
    else if (name === '--only' && COLLECTIONS[value]) args.only = value
    else throw new Error(`Unknown option ${arg}.\n${USAGE}`)
  }
  return args
}

const bytesOf = value => (Buffer.isBuffer(value) ? value : typeof value?.value === 'function' ? Buffer.from(value.value()) : Buffer.from(value?.buffer ?? value))
const mb = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** A small R2 client: put, and the stored size of a key (HEAD), each tried three times on network errors and 5xx. */
function r2Store(env = process.env, fetchImpl = fetch) {
  const read = name => env[name]?.trim() || ''
  const [accountId, accessKeyId, secretAccessKey, bucket] = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].map(read)
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) throw new Error('Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET (in .env.local or the environment).')
  const aws = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto', retries: 0 })
  const url = key => `https://${accountId}.r2.cloudflarestorage.com/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`
  async function send(method, key, body, contentType) {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetchImpl(await aws.sign(url(key), { method, body, headers: contentType ? { 'Content-Type': contentType } : {}, signal: AbortSignal.timeout(60000) }))
        if (response.status < 500 || attempt === 3) return response
        await response.arrayBuffer().catch(() => {})
      } catch (error) {
        if (attempt === 3) throw new Error(`R2 ${method} ${key} failed: ${error?.cause?.code || error?.message || error}`)
      }
      await sleep(500 * attempt)
    }
  }
  return {
    bucket,
    async put(key, bytes, contentType) {
      const response = await send('PUT', key, bytes, contentType)
      await response.arrayBuffer().catch(() => {})
      if (!response.ok) throw new Error(`R2 refused PUT ${key}: HTTP ${response.status}`)
    },
    /** The stored size in bytes, or null when the key is missing. */
    async size(key) {
      const response = await send('HEAD', key)
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`R2 refused HEAD ${key}: HTTP ${response.status}`)
      return Number(response.headers.get('content-length'))
    },
  }
}

/** Per collection and field: images still only in MongoDB, images copied but still in MongoDB, and images only in R2. */
async function imageStats(db, names = Object.keys(COLLECTIONS)) {
  const stats = {}
  for (const name of names) {
    const entry = stats[name] = { toCopy: { count: 0, bytes: 0 }, copiedStillInMongo: { count: 0, bytes: 0 }, onlyInR2: 0 }
    for (const field of COLLECTIONS[name].fields) {
      const groups = await db.collection(name).aggregate([
        { $match: { [field]: { $exists: true } } },
        { $group: { _id: { $eq: ['$storage', 'r2'] }, count: { $sum: 1 }, bytes: { $sum: { $binarySize: `$${field}` } } } },
      ]).toArray()
      for (const group of groups) {
        const target = group._id ? entry.copiedStillInMongo : entry.toCopy
        target.count += group.count
        target.bytes += group.bytes
      }
    }
    entry.onlyInR2 = await db.collection(name).countDocuments({ storage: 'r2', ...Object.fromEntries(COLLECTIONS[name].fields.map(field => [field, { $exists: false }])) })
  }
  return stats
}

/**
 * Copies (mode 'copy') or copies and then removes from MongoDB (mode 'delete') every image in `names`, in batches
 * ordered by _id. A copy counts only when R2 reports the same size; anything else is left as it was and reported.
 */
async function migrate({ db, store, mode, batch = 20, limit = Infinity, names = Object.keys(COLLECTIONS), log = console.log }) {
  const summary = { copied: 0, verified: 0, removed: 0, failed: 0, skipped: 0 }
  let seen = 0
  for (const name of names) {
    const spec = COLLECTIONS[name], collection = db.collection(name)
    for (const field of spec.fields) {
      // Removing needs every image still in MongoDB, copied before or not; copying needs only the ones not copied yet.
      const filter = mode === 'delete' ? { [field]: { $exists: true } } : { [field]: { $exists: true }, storage: { $ne: 'r2' } }
      let last = null
      while (seen < limit) {
        const page = await collection.find({ ...filter, ...(last == null ? {} : { _id: { $gt: last } }) }, { projection: { _id: 1, id: 1, contentType: 1, storage: 1, key: 1, [field]: 1 } })
          .sort({ _id: 1 }).limit(Math.min(batch, limit - seen)).toArray()
        if (!page.length) break
        for (const doc of page) {
          last = doc._id
          seen++
          if (!doc.id) { summary.skipped++; log(`  ${name} ${doc._id}: no id, skipped`); continue }
          const bytes = bytesOf(doc[field]), key = doc.storage === 'r2' && doc.key ? doc.key : spec.key(doc, field)
          try {
            // An image copied by an earlier run is checked first, and copied again if R2 lost it.
            let size = doc.storage === 'r2' ? await store.size(key) : null
            const upload = size !== bytes.length
            if (upload) {
              await store.put(key, bytes, spec.type(doc, field))
              size = await store.size(key)
            }
            if (size !== bytes.length) throw new Error(`R2 holds ${size == null ? 'nothing' : `${size} bytes`} for ${key}, MongoDB ${bytes.length}`)
            if (doc.storage !== 'r2') await collection.updateOne({ _id: doc._id }, { $set: { storage: 'r2', key, size: bytes.length } })
            if (upload) summary.copied++
            else summary.verified++
            if (mode === 'delete') {
              await collection.updateOne({ _id: doc._id, storage: 'r2', key }, { $unset: { [field]: '' } })
              summary.removed++
            }
          } catch (error) {
            summary.failed++
            log(`  ${name} ${doc.id}: ${error.message}`)
          }
        }
        log(`${name}.${field}: ${seen} images looked at so far (${summary.copied} copied, ${summary.removed} removed from MongoDB, ${summary.failed} failed)`)
      }
    }
  }
  return summary
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { console.log(USAGE); return }
  // .env.local wins: dotenv never overwrites a variable that is already set.
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
  if (!process.env.MONGO_URL || !process.env.DB_NAME) throw new Error('Set MONGO_URL and DB_NAME (in .env.local or the environment).')
  const store = args.mode === 'dry-run' ? null : r2Store()
  const names = args.only ? [args.only] : Object.keys(COLLECTIONS)

  const { MongoClient } = require('mongodb')
  const client = new MongoClient(process.env.MONGO_URL, { serverSelectionTimeoutMS: 10000 })
  await client.connect()
  try {
    const db = client.db(process.env.DB_NAME)
    if (args.mode === 'dry-run') {
      console.log('Dry run: nothing is changed.')
      let r2 = 'R2 is not set up yet: set the R2_* variables before --copy.'
      try { r2 = `R2 is set up (bucket ${r2Store().bucket}).` } catch {}
      console.log(r2)
      for (const [name, entry] of Object.entries(await imageStats(db, names))) {
        console.log(`${name}: ${entry.toCopy.count} to copy (${mb(entry.toCopy.bytes)}); ${entry.copiedStillInMongo.count} copied but still in MongoDB (${mb(entry.copiedStillInMongo.bytes)}); ${entry.onlyInR2} only in R2.`)
      }
      console.log('Run with --copy to copy them, then --delete-from-mongo to remove the bytes from MongoDB.')
      return
    }
    console.log(`${args.mode === 'delete' ? 'Copying and removing from MongoDB' : 'Copying'} into R2 bucket ${store.bucket}, ${args.batch} at a time.`)
    const summary = await migrate({ db, store, mode: args.mode, batch: args.batch, limit: args.limit, names })
    console.log(`Done: ${summary.copied} copied, ${summary.verified} already in R2 and checked, ${summary.removed} removed from MongoDB, ${summary.failed} failed, ${summary.skipped} skipped.`)
    if (summary.failed) process.exitCode = 1
  } finally {
    await client.close()
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exit(1) })

module.exports = { parseArgs, r2Store, imageStats, migrate, COLLECTIONS }
