const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')

const load = file => stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))
// Images in R2 are read through getObject; `objects` stands in for the bucket.
const objects = new Map(), objectReads = []
const getObject = async key => { objectReads.push(key); return objects.get(key) || null }
const cache = new Function('getObject', load('lib/services/uploadCache.ts') + ';return {cachedUpload,rememberUpload,loadUpload,clearUploadCache}')(getObject)

class FakeResponse {
  constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.headers = init.headers || {} }
  static json(body, init = {}) { return new FakeResponse(body, init) }
}
const handlers = loadUpload => new Function('NextResponse', 'uuidv4', 'corsify', 'getBaseUrl', 'MAX_IMAGE_SIZE', 'compactImage', 'loadUpload', 'saveUpload', 'requireUploadRoom', 'console',
  load('lib/handlers/uploadHandlers.ts') + ';return {handleGetUpload}')(FakeResponse, () => 'id', x => x, () => '', 6e6, async (b, t) => ({ bytes: b, contentType: t }), loadUpload, async () => {}, async () => {}, { error() {} })
const { handleGetUpload } = handlers(cache.loadUpload)

function fakeDb(docs) {
  const reads = []
  return {
    reads,
    collection: () => ({
      findOne: async (query, options) => {
        reads.push({ query, projection: options?.projection })
        const doc = docs[query.id]
        if (!doc) return null
        return doc.key ? { contentType: doc.contentType, key: doc.key } : { contentType: doc.contentType, bytes: { value: () => doc.bytes } }
      },
    }),
  }
}
const request = headers => ({ headers: { get: name => headers[name.toLowerCase()] ?? null } })

beforeEach(() => { cache.clearUploadCache(); objects.clear(); objectReads.length = 0 })

test('an image is read from MongoDB once, then served from memory, reading only its bytes, type and key', async () => {
  const db = fakeDb({ a: { contentType: 'image/webp', bytes: Buffer.from('pixels') } })
  const first = await handleGetUpload(db, 'a', request({}))
  const second = await handleGetUpload(db, 'a', request({}))
  assert.equal(first.status, 200)
  assert.equal(String(second.body), 'pixels')
  assert.equal(second.headers['Content-Type'], 'image/webp')
  assert.equal(db.reads.length, 1)
  assert.deepEqual(db.reads[0].projection, { _id: 0, bytes: 1, contentType: 1, key: 1 })
  assert.equal(objectReads.length, 0, 'an image whose record holds its bytes never reaches R2')
})

test('an image stored in R2 is read by its key once, then served from memory', async () => {
  objects.set('uploads/b', { bytes: Buffer.from('from-r2'), contentType: 'application/octet-stream' })
  const db = fakeDb({ b: { contentType: 'image/png', key: 'uploads/b' } })
  const first = await handleGetUpload(db, 'b', request({}))
  const second = await handleGetUpload(db, 'b', request({}))
  assert.equal(String(first.body), 'from-r2')
  assert.equal(first.headers['Content-Type'], 'image/png', "the record's type wins over R2's")
  assert.equal(String(second.body), 'from-r2')
  assert.deepEqual(objectReads, ['uploads/b'])
  assert.equal(db.reads.length, 1)
})

test('a browser revalidation is answered with 304 without touching storage, and the CDN may keep images for a year', async () => {
  const db = fakeDb({ a: { contentType: 'image/png', bytes: Buffer.from('x') } })
  const ok = await handleGetUpload(db, 'a', request({}))
  assert.equal(ok.headers.ETag, 'W/"a"')
  assert.match(ok.headers['Cache-Control'], /immutable/)
  assert.match(ok.headers['Cache-Control'], /\bs-maxage=31536000\b/)
  assert.match(ok.headers['Cache-Control'], /\bmax-age=31536000\b/)
  assert.equal(ok.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(ok.headers['Content-Security-Policy'], 'sandbox')
  const revalidated = await handleGetUpload(db, 'a', request({ 'if-none-match': 'W/"other", W/"a"' }))
  assert.equal(revalidated.status, 304)
  assert.equal(revalidated.body, null)
  assert.equal(db.reads.length, 1)
})

test('a missing image is a 404 and is not cached; a record whose R2 object is gone is missing too', async () => {
  const db = fakeDb({ lost: { contentType: 'image/png', key: 'uploads/lost' } })
  assert.equal((await handleGetUpload(db, 'gone', request({}))).status, 404)
  assert.equal((await handleGetUpload(db, 'gone', request({}))).status, 404)
  assert.equal(db.reads.length, 2)
  assert.equal((await handleGetUpload(db, 'lost', request({}))).status, 404)
})

test('storage that cannot be reached answers 503 with no cache headers, so nothing keeps the failure', async () => {
  const failing = handlers(async () => { throw Object.assign(new Error('Image storage could not read uploads/a: HTTP 500'), { status: 503 }) })
  const response = await failing.handleGetUpload(fakeDb({}), 'a', request({}))
  assert.equal(response.status, 503)
  assert.match(response.body.error, /could not be loaded right now/)
  assert.equal(response.headers['Cache-Control'], undefined)
})

test('the cache stays under its memory budget, dropping the least recently used image first', () => {
  const mb = n => Buffer.alloc(n * 1024 * 1024)
  for (let i = 0; i < 13; i++) cache.rememberUpload(`img${i}`, { bytes: mb(8), contentType: 'image/png' })
  // 13 x 8 MB exceeds the 96 MB budget: the oldest entry goes, recent ones stay.
  assert.equal(cache.cachedUpload('img0'), undefined)
  assert.ok(cache.cachedUpload('img12'))
  cache.rememberUpload('huge', { bytes: mb(9), contentType: 'image/png' })
  assert.equal(cache.cachedUpload('huge'), undefined, 'single images over 8 MB are not cached')
})
