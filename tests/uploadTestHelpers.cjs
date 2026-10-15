// Stand-ins for image storage helpers, for tests that load a module with its imports stripped.
const fs = require('node:fs')
const path = require('node:path')
const { stripTypeScriptTypes } = require('node:module')
const { Binary } = require('mongodb')
const { AwsClient } = require('aws4fetch')
const { randomUUID } = require('node:crypto')
const sharp = require('sharp')

/** A source file with its imports and `export` keywords removed, as plain JavaScript. */
const source = file => stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))

/** loadUpload without the in-memory cache: each call reads the fake database. */
async function loadUpload(db, id) {
  const doc = await db.collection('uploads').findOne({ id }, { projection: { _id: 0, bytes: 1, contentType: 1 } })
  if (!doc?.bytes) return null
  const bytes = doc.bytes
  return {
    bytes: Buffer.isBuffer(bytes) ? bytes : typeof bytes.value === 'function' ? Buffer.from(bytes.value()) : Buffer.from(bytes.buffer ?? bytes),
    contentType: doc.contentType || 'image/png',
  }
}

/** compactImage that stores bytes unchanged, so tests keep asserting on their own fixtures. */
async function keepImage(bytes, contentType) {
  return { bytes, contentType }
}

const byteLength = value => Buffer.isBuffer(value) ? value.length : typeof value?.value === 'function' ? value.value().length : value?.length

/**
 * An in-memory stand-in for the MongoDB calls the storage, billing and upload code makes: equality, $in, $nin,
 * $exists, $ne and comparisons in queries; $set, $unset, $inc and $setOnInsert upserts; simple projections; and
 * aggregate with $match and $group.
 */
function memoryDb(seed = {}) {
  const data = {}
  for (const [name, docs] of Object.entries(seed)) data[name] = docs.map(doc => ({ ...doc }))
  const rows = name => (data[name] ||= [])
  const same = (a, b) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b)
  const operator = value => value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value) && Object.keys(value).some(key => key.startsWith('$'))
  const test = (value, condition) => !operator(condition) ? same(value, condition) : Object.entries(condition).every(([op, arg]) => {
    if (op === '$in') return arg.some(item => same(value, item))
    if (op === '$nin') return !arg.some(item => same(value, item))
    if (op === '$exists') return (value !== undefined) === Boolean(arg)
    if (op === '$ne') return !same(value, arg)
    if (op === '$gt') return value > arg
    if (op === '$gte') return value >= arg
    if (op === '$lt') return value < arg
    if (op === '$lte') return value <= arg
    throw new Error(`memoryDb does not support ${op}`)
  })
  const matches = (doc, query = {}) => Object.entries(query).every(([key, condition]) => test(doc[key], condition))
  const project = (doc, projection) => {
    if (!doc) return null
    if (!projection) return { ...doc }
    const included = Object.entries(projection).filter(([key, on]) => on && key !== '_id').map(([key]) => key)
    const copy = included.length ? Object.fromEntries(included.filter(key => key in doc).map(key => [key, doc[key]])) : { ...doc }
    if (included.length && projection._id !== 0 && '_id' in doc) copy._id = doc._id
    for (const [key, on] of Object.entries(projection)) if (!on) delete copy[key]
    return copy
  }
  const apply = (doc, update) => {
    Object.assign(doc, update.$set || {})
    for (const key of Object.keys(update.$unset || {})) delete doc[key]
    for (const [key, step] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + step
  }
  const evaluate = (doc, expr) => {
    if (typeof expr === 'string' && expr.startsWith('$')) return doc[expr.slice(1)]
    if (!operator(expr)) return expr
    const [[op, arg]] = Object.entries(expr)
    if (op === '$ifNull') return evaluate(doc, arg[0]) ?? evaluate(doc, arg[1])
    if (op === '$binarySize') return evaluate(doc, arg) == null ? null : byteLength(evaluate(doc, arg))
    if (op === '$eq') return evaluate(doc, arg[0]) === evaluate(doc, arg[1])
    throw new Error(`memoryDb does not support ${op} in expressions`)
  }
  const aggregate = (docs, pipeline) => {
    for (const stage of pipeline) {
      if (stage.$match) docs = docs.filter(doc => matches(doc, stage.$match))
      else if (stage.$group) {
        const { _id, ...fields } = stage.$group, groups = new Map()
        for (const doc of docs) {
          const id = evaluate(doc, _id), group = groups.get(id) || { _id: id, ...Object.fromEntries(Object.keys(fields).map(key => [key, 0])) }
          for (const [key, accumulator] of Object.entries(fields)) group[key] += Number(evaluate(doc, accumulator.$sum) ?? 0)
          groups.set(id, group)
        }
        docs = [...groups.values()]
      } else throw new Error(`memoryDb does not support the stage ${Object.keys(stage)[0]}`)
    }
    return docs
  }
  const collection = name => ({
    createIndex: async () => {},
    findOne: async (query, options) => project(rows(name).find(doc => matches(doc, query)), options?.projection),
    find: (query, options) => {
      let list = rows(name).filter(doc => matches(doc, query)), limit = Infinity
      const chain = {
        sort: spec => { const [[key, order]] = Object.entries(spec); list = [...list].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * order); return chain },
        limit: n => { limit = n; return chain },
        toArray: async () => list.slice(0, limit).map(doc => project(doc, options?.projection)),
      }
      return chain
    },
    insertOne: async doc => { rows(name).push({ ...doc }); return { acknowledged: true } },
    updateOne: async (query, update, options = {}) => {
      const doc = rows(name).find(row => matches(row, query))
      if (doc) { apply(doc, update); return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 } }
      if (!options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
      const created = Object.fromEntries(Object.entries(query).filter(([, value]) => !operator(value)))
      Object.assign(created, update.$setOnInsert || {})
      apply(created, update)
      rows(name).push(created)
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }
    },
    updateMany: async (query, update) => {
      const hit = rows(name).filter(row => matches(row, query))
      hit.forEach(doc => apply(doc, update))
      return { matchedCount: hit.length, modifiedCount: hit.length }
    },
    deleteOne: async query => {
      const index = rows(name).findIndex(row => matches(row, query))
      if (index >= 0) rows(name).splice(index, 1)
      return { deletedCount: index >= 0 ? 1 : 0 }
    },
    countDocuments: async query => rows(name).filter(doc => matches(doc, query)).length,
    distinct: async (key, query) => [...new Set(rows(name).filter(doc => matches(doc, query)).map(doc => doc[key]))],
    aggregate: pipeline => ({ toArray: async () => aggregate(rows(name), pipeline) }),
  })
  return { data, rows, collection }
}

/**
 * A fake R2 bucket behind fetch: PUT stores, GET and HEAD read, DELETE removes. `failures` are answered first, one
 * per request: a status number, an Error (a network failure) or { status, code }.
 */
function fakeR2({ failures = [] } = {}) {
  const objects = new Map(), requests = []
  const fail = failure => failure instanceof Error ? Promise.reject(failure)
    : new Response(`<?xml version="1.0"?><Error><Code>${failure.code || 'InternalError'}</Code></Error>`, { status: failure.status || failure })
  const fetch = async request => {
    const key = decodeURIComponent(new URL(request.url).pathname.split('/').slice(2).join('/'))
    requests.push({ method: request.method, url: request.url, key, headers: Object.fromEntries(request.headers) })
    if (failures.length) return fail(failures.shift())
    if (request.method === 'PUT') {
      objects.set(key, { bytes: Buffer.from(await request.arrayBuffer()), contentType: request.headers.get('content-type') })
      return new Response(null, { status: 200 })
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      const object = objects.get(key)
      if (!object) return new Response(request.method === 'HEAD' ? null : '<Error><Code>NoSuchKey</Code></Error>', { status: 404 })
      return new Response(request.method === 'HEAD' ? null : object.bytes, { status: 200, headers: { 'content-type': object.contentType || 'application/octet-stream', 'content-length': String(object.bytes.length) } })
    }
    if (request.method === 'DELETE') { objects.delete(key); return new Response(null, { status: 204 }) }
    return new Response(null, { status: 405 })
  }
  return { objects, requests, failures, fetch }
}

const R2_ENV = { R2_ACCOUNT_ID: 'acct123', R2_ACCESS_KEY_ID: 'AKIDEXAMPLE', R2_SECRET_ACCESS_KEY: 'test-secret-key', R2_BUCKET: 'batkle-images' }

/**
 * The real objectStore, uploadCache and uploadStore wired together: with `r2: true` against a fake R2 bucket (the
 * real signing included), otherwise with no R2 settings, so bytes stay in MongoDB.
 */
function loadStorage({ r2 = false, bucket = fakeR2(), env = r2 ? { ...R2_ENV } : {} } = {}) {
  const warnings = []
  const quiet = { log() {}, warn: (...args) => warnings.push(args.join(' ')), error: (...args) => warnings.push(args.join(' ')) }
  const objectStore = new Function('AwsClient', 'process', 'console', source('lib/services/objectStore.ts') + ';return { r2Configured, putObject, getObject, headObject, deleteObject, presignPut, configureObjectStore }')(AwsClient, { env }, quiet)
  objectStore.configureObjectStore({ fetch: bucket.fetch, timeoutMs: 2000 })
  const uploadCache = new Function('getObject', source('lib/services/uploadCache.ts') + ';return { cachedUpload, rememberUpload, forgetUpload, storedBytes, loadUpload, clearUploadCache }')(objectStore.getObject)
  const uploadStore = new Function('randomUUID', 'Binary', 'sharp', 'deleteObject', 'getObject', 'headObject', 'presignPut', 'putObject', 'r2Configured', 'forgetUpload', 'storedBytes', 'console',
    source('lib/services/uploadStore.ts') + ';return { saveUpload, deleteUpload, saveRender, loadRender, deleteRender, uploadKey, renderKey, createPendingUpload, discardPendingUpload, withDirectUpload, incomingKey, UPLOAD_PURPOSES, DIRECT_UPLOAD_MAX_BYTES, DIRECT_UPLOAD_TYPES }')(
    randomUUID, Binary, sharp, objectStore.deleteObject, objectStore.getObject, objectStore.headObject, objectStore.presignPut, objectStore.putObject, objectStore.r2Configured, uploadCache.forgetUpload, uploadCache.storedBytes, quiet)
  return { env, bucket, warnings, objectStore, uploadCache, uploadStore }
}

/** The real saveUpload without R2: bytes go into the fake database as a BSON Binary, as in production without R2. */
const saveUpload = (...args) => loadStorage().uploadStore.saveUpload(...args)

/** The real plans and billing account code (requireUploadRoom, uploadUsage, billingErrorBody), for a memoryDb. */
const loadBilling = () => new Function('randomUUID', source('lib/billing/plans.ts') + source('lib/billing/account.ts') + ';return { requireUploadRoom, uploadUsage, billingErrorBody, PLANS }')(randomUUID)

/** NextResponse as the handlers use it: a body, a status and plain headers. */
class FakeResponse {
  constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.headers = init.headers || {} }
  static json(body, init = {}) { return new FakeResponse(body, init) }
}

/**
 * The three upload handlers (editor, gallery, post photos), the sign handler and the two delete handlers, wired to
 * `storage` (loadStorage) and the given plan check. Vision and description calls are replaced; images are kept as sent.
 */
function loadUploadHandlers({ storage = loadStorage(), requireUploadRoom = async () => {}, compactImage = keepImage } = {}) {
  const store = storage.uploadStore, quiet = { log() {}, warn() {}, error() {} }
  const editor = new Function('NextResponse', 'uuidv4', 'corsify', 'getBaseUrl', 'MAX_IMAGE_SIZE', 'compactImage', 'loadUpload', 'DIRECT_UPLOAD_MAX_BYTES', 'DIRECT_UPLOAD_TYPES', 'UPLOAD_PURPOSES', 'createPendingUpload', 'saveUpload', 'withDirectUpload', 'r2Configured', 'requireUploadRoom', 'console',
    source('lib/handlers/uploadHandlers.ts') + ';return { handleUploadImage, handleSignUpload, handleGetUpload }')(
    FakeResponse, randomUUID, x => x, () => 'https://batkle.test', 6 * 1024 * 1024, compactImage, storage.uploadCache.loadUpload, store.DIRECT_UPLOAD_MAX_BYTES, store.DIRECT_UPLOAD_TYPES, store.UPLOAD_PURPOSES, store.createPendingUpload, store.saveUpload, store.withDirectUpload, storage.objectStore.r2Configured, requireUploadRoom, quiet)
  const gallery = new Function('NextResponse', 'uuidv4', 'sharp', 'corsify', 'getBaseUrl', 'analyseImageBuffer', 'indexAssetDescription', 'compactImage', 'DIRECT_UPLOAD_MAX_BYTES', 'saveUpload', 'withDirectUpload', 'requireUploadRoom', 'console',
    source('lib/handlers/assetHandlers.ts') + ';return { handleUploadAsset, handleDeleteAsset, parseDataUrl, storeImageBytes, newAssetId, releaseUploads }')(
    FakeResponse, randomUUID, sharp, x => x, () => 'https://batkle.test', async () => ({ tags: ['photo'] }), async description => ({ description }), compactImage, store.DIRECT_UPLOAD_MAX_BYTES, store.saveUpload, store.withDirectUpload, requireUploadRoom, quiet)
  const post = new Function('NextResponse', 'sharp', 'corsify', 'parseDataUrl', 'storeImageBytes', 'newAssetId', 'releaseUploads', 'describePostImage', 'POST_IMAGE_SOURCE', 'requireUploadRoom', 'DIRECT_UPLOAD_MAX_BYTES', 'withDirectUpload', 'console',
    source('lib/handlers/postImageHandler.ts') + ';return { handleUploadPostImage, handleDeletePostImage }')(
    FakeResponse, sharp, x => x, gallery.parseDataUrl, gallery.storeImageBytes, gallery.newAssetId, gallery.releaseUploads, async () => ({ description: 'A shop front.', tags: ['shop'] }), 'post_upload', requireUploadRoom, store.DIRECT_UPLOAD_MAX_BYTES, store.withDirectUpload, quiet)
  return { ...editor, ...gallery, ...post }
}

module.exports = { source, loadUpload, keepImage, memoryDb, fakeR2, loadStorage, saveUpload, loadBilling, loadUploadHandlers, FakeResponse, R2_ENV }
