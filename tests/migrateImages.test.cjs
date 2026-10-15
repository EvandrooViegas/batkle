const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Binary } = require('mongodb')
const { memoryDb, fakeR2, loadStorage, R2_ENV } = require('./uploadTestHelpers.cjs')
const { parseArgs, r2Store, imageStats, migrate } = require('../scripts/migrate-images-to-r2.cjs')

const seed = () => memoryDb({
  uploads: [
    { _id: 1, id: 'photo-1', contentType: 'image/jpeg', bytes: new Binary(Buffer.from('jpeg bytes')) },
    { _id: 2, id: 'image-abc', contentType: 'image/webp', bytes: new Binary(Buffer.from('webp')), ownerId: 'user_1', userUpload: true, size: 4 },
    { _id: 3, id: 'new-one', contentType: 'image/png', storage: 'r2', key: 'uploads/new-one', size: 3 },
  ],
  renders: [
    { _id: 1, id: 'r-single', type: 'single', png: new Binary(Buffer.from('png!')) },
    { _id: 2, id: 'r-carousel', type: 'carousel', zip: new Binary(Buffer.from('zip file')) },
  ],
})
const quiet = () => {}

test('a dry run is the default and only counts', async () => {
  assert.equal(parseArgs([]).mode, 'dry-run')
  assert.equal(parseArgs(['--copy']).mode, 'copy')
  assert.equal(parseArgs(['--delete-from-mongo', '--batch=5', '--only=renders']).batch, 5)
  assert.throws(() => parseArgs(['--delete']), /Unknown option --delete/)
  const db = seed()
  const stats = await imageStats(db)
  assert.deepEqual(stats.uploads, { toCopy: { count: 2, bytes: 14 }, copiedStillInMongo: { count: 0, bytes: 0 }, onlyInR2: 1 })
  assert.deepEqual(stats.renders, { toCopy: { count: 2, bytes: 12 }, copiedStillInMongo: { count: 0, bytes: 0 }, onlyInR2: 0 })
  assert.equal(db.rows('uploads')[0].storage, undefined)
})

test('--copy uploads each image to its key, checks the size, records the key, keeps the bytes, and resumes', async () => {
  const bucket = fakeR2(), store = r2Store(R2_ENV, bucket.fetch), db = seed()
  const summary = await migrate({ db, store, mode: 'copy', batch: 1, log: quiet })
  assert.deepEqual(summary, { copied: 4, verified: 0, removed: 0, failed: 0, skipped: 0 })
  assert.deepEqual([...bucket.objects.keys()].sort(), ['renders/r-carousel.zip', 'renders/r-single.png', 'uploads/image-abc', 'uploads/photo-1'])
  assert.equal(bucket.objects.get('uploads/photo-1').contentType, 'image/jpeg')
  assert.equal(bucket.objects.get('renders/r-carousel.zip').contentType, 'application/zip')
  assert.ok(bucket.requests.some(r => r.method === 'HEAD'), 'every copy is checked')
  const photo = db.rows('uploads')[0]
  assert.deepEqual([photo.storage, photo.key, photo.size], ['r2', 'uploads/photo-1', 10])
  assert.ok(photo.bytes, 'copying keeps the bytes in MongoDB')
  assert.equal(db.rows('renders')[1].key, 'renders/r-carousel.zip')
  assert.deepEqual((await imageStats(db)).uploads.copiedStillInMongo, { count: 2, bytes: 14 })

  const puts = bucket.requests.filter(r => r.method === 'PUT').length
  assert.deepEqual(await migrate({ db, store, mode: 'copy', log: quiet }), { copied: 0, verified: 0, removed: 0, failed: 0, skipped: 0 })
  assert.equal(bucket.requests.filter(r => r.method === 'PUT').length, puts, 'a second run copies nothing again')
})

test('a copy whose size does not match is not recorded, and is tried again next run', async () => {
  const bucket = fakeR2()
  const store = r2Store(R2_ENV, bucket.fetch)
  const truncating = { ...store, put: async (key, bytes, type) => store.put(key, bytes.subarray(0, 2), type) }
  const db = seed(), log = []
  const summary = await migrate({ db, store: truncating, mode: 'copy', names: ['uploads'], log: line => log.push(line) })
  assert.equal(summary.failed, 2)
  assert.equal(summary.copied, 0)
  assert.equal(db.rows('uploads')[0].storage, undefined)
  assert.ok(log.some(line => /R2 holds 2 bytes for uploads\/photo-1, MongoDB 10/.test(line)))
})

test('--delete-from-mongo removes bytes only for images R2 holds, and they still load', async () => {
  const bucket = fakeR2(), store = r2Store(R2_ENV, bucket.fetch), db = seed()
  await migrate({ db, store, mode: 'copy', log: quiet })
  // R2 lost one image, and cannot take it back right now: its bytes must stay.
  bucket.objects.delete('uploads/image-abc')
  const refusing = { ...store, put: async key => { throw new Error(`R2 refused PUT ${key}: HTTP 500`) } }
  const summary = await migrate({ db, store: refusing, mode: 'delete', log: quiet })
  assert.deepEqual(summary, { copied: 0, verified: 3, removed: 3, failed: 1, skipped: 0 })
  assert.equal(db.rows('uploads')[0].bytes, undefined)
  assert.ok(db.rows('uploads')[1].bytes, 'an image missing from R2 keeps its bytes')
  assert.equal(db.rows('renders')[0].png, undefined)
  assert.equal(db.rows('renders')[1].zip, undefined)

  // The app reads the moved images from R2, at the same addresses.
  const storage = loadStorage({ r2: true, bucket })
  storage.uploadCache.clearUploadCache()
  assert.equal(String((await storage.uploadCache.loadUpload(db, 'photo-1')).bytes), 'jpeg bytes')
  assert.equal(String((await storage.uploadStore.loadRender(db, 'r-carousel')).bytes), 'zip file')
  assert.deepEqual(await imageStats(db, ['renders']), { renders: { toCopy: { count: 0, bytes: 0 }, copiedStillInMongo: { count: 0, bytes: 0 }, onlyInR2: 2 } })

  // Once R2 takes it, the next run copies the lost image again before removing its bytes.
  assert.deepEqual(await migrate({ db, store, mode: 'delete', log: quiet }), { copied: 1, verified: 0, removed: 1, failed: 0, skipped: 0 })
  assert.equal(String(bucket.objects.get('uploads/image-abc').bytes), 'webp')
  assert.equal(db.rows('uploads')[1].bytes, undefined)
})

test('without R2 settings the script refuses to copy', () => {
  assert.throws(() => r2Store({}), /Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET/)
})
