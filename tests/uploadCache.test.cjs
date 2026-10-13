const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')

const load = file => stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))
const cache = new Function(load('lib/services/uploadCache.ts') + ';return {cachedUpload,rememberUpload,loadUpload,clearUploadCache}')()

class FakeResponse {
  constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.headers = init.headers || {} }
  static json(body, init = {}) { return new FakeResponse(body, init) }
}
const { handleGetUpload } = new Function('NextResponse', 'Binary', 'uuidv4', 'corsify', 'getBaseUrl', 'MAX_IMAGE_SIZE', 'compactImage', 'loadUpload',
  load('lib/handlers/uploadHandlers.ts') + ';return {handleGetUpload}')(FakeResponse, class {}, () => 'id', x => x, () => '', 6e6, async (b, t) => ({ bytes: b, contentType: t }), cache.loadUpload)

function fakeDb(docs) {
  const reads = []
  return {
    reads,
    collection: () => ({
      findOne: async (query, options) => {
        reads.push({ query, projection: options?.projection })
        const doc = docs[query.id]
        return doc ? { contentType: doc.contentType, bytes: { value: () => doc.bytes } } : null
      },
    }),
  }
}
const request = headers => ({ headers: { get: name => headers[name.toLowerCase()] ?? null } })

beforeEach(() => cache.clearUploadCache())

test('an image is read from MongoDB once, then served from memory, reading only its bytes and type', async () => {
  const db = fakeDb({ a: { contentType: 'image/webp', bytes: Buffer.from('pixels') } })
  const first = await handleGetUpload(db, 'a', request({}))
  const second = await handleGetUpload(db, 'a', request({}))
  assert.equal(first.status, 200)
  assert.equal(String(second.body), 'pixels')
  assert.equal(second.headers['Content-Type'], 'image/webp')
  assert.equal(db.reads.length, 1)
  assert.deepEqual(db.reads[0].projection, { _id: 0, bytes: 1, contentType: 1 })
})

test('a browser revalidation is answered with 304 without touching MongoDB', async () => {
  const db = fakeDb({ a: { contentType: 'image/png', bytes: Buffer.from('x') } })
  const ok = await handleGetUpload(db, 'a', request({}))
  assert.equal(ok.headers.ETag, 'W/"a"')
  assert.match(ok.headers['Cache-Control'], /immutable/)
  const revalidated = await handleGetUpload(db, 'a', request({ 'if-none-match': 'W/"other", W/"a"' }))
  assert.equal(revalidated.status, 304)
  assert.equal(revalidated.body, null)
  assert.equal(db.reads.length, 1)
})

test('a missing image is a 404 and is not cached', async () => {
  const db = fakeDb({})
  assert.equal((await handleGetUpload(db, 'gone', request({}))).status, 404)
  assert.equal((await handleGetUpload(db, 'gone', request({}))).status, 404)
  assert.equal(db.reads.length, 2)
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
