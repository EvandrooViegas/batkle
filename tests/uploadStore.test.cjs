const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { Binary } = require('mongodb')
const { source, memoryDb, fakeR2, loadStorage } = require('./uploadTestHelpers.cjs')

const bytes = text => Buffer.from(text)
beforeEach(() => loadStorage().uploadCache.clearUploadCache())

test('with R2, an upload goes to uploads/<id> and MongoDB keeps a record without the bytes', async () => {
  const { uploadStore, uploadCache, bucket } = loadStorage({ r2: true })
  const db = memoryDb()
  const result = await uploadStore.saveUpload(db, { id: 'u1', bytes: bytes('photo'), contentType: 'image/jpeg', ownerId: 'user_1', userUpload: true })
  assert.deepEqual(result, { id: 'u1', size: 5, stored: true })
  assert.equal(String(bucket.objects.get('uploads/u1').bytes), 'photo')
  assert.equal(bucket.objects.get('uploads/u1').contentType, 'image/jpeg')
  const [record] = db.rows('uploads')
  assert.equal(record.bytes, undefined)
  assert.ok(record.createdAt instanceof Date)
  const { createdAt, ...rest } = record
  assert.deepEqual(rest, { id: 'u1', contentType: 'image/jpeg', size: 5, ownerId: 'user_1', userUpload: true, storage: 'r2', key: 'uploads/u1' })

  // Read from R2 once; the second read comes from memory.
  assert.equal(String((await uploadCache.loadUpload(db, 'u1')).bytes), 'photo')
  assert.equal((await uploadCache.loadUpload(db, 'u1')).contentType, 'image/jpeg')
  assert.deepEqual(bucket.requests.map(r => r.method), ['PUT', 'GET'])
})

test('with R2, ifAbsent stores a content-hash image once and never uploads it again', async () => {
  const { uploadStore, bucket } = loadStorage({ r2: true })
  const db = memoryDb()
  await uploadStore.saveUpload(db, { id: 'image-abc', bytes: bytes('first'), contentType: 'image/png', subject: { width: 2 } }, { ifAbsent: true })
  const again = await uploadStore.saveUpload(db, { id: 'image-abc', bytes: bytes('second'), contentType: 'image/png' }, { ifAbsent: true })
  assert.equal(again.stored, false)
  assert.equal(bucket.requests.filter(r => r.method === 'PUT').length, 1)
  assert.equal(db.rows('uploads').length, 1)
  assert.deepEqual(db.rows('uploads')[0].subject, { width: 2 }, 'extra fields are kept on the record')
  assert.equal(String(bucket.objects.get('uploads/image-abc').bytes), 'first')
})

test('without R2, bytes stay in MongoDB as a Binary, with their size, and loadUpload reads them there', async () => {
  const { uploadStore, uploadCache, bucket } = loadStorage()
  const db = memoryDb()
  await uploadStore.saveUpload(db, { id: 'm1', bytes: bytes('inline'), contentType: 'image/webp', ownerId: null, purpose: 'design-reference' })
  const [record] = db.rows('uploads')
  assert.ok(record.bytes instanceof Binary)
  assert.equal(record.size, 6)
  assert.equal(record.storage, 'mongo')
  assert.equal(record.key, undefined)
  assert.equal(record.purpose, 'design-reference')
  assert.equal('ownerId' in record, false, 'an empty owner is not written')
  assert.equal(String((await uploadCache.loadUpload(db, 'm1')).bytes), 'inline')
  assert.equal(bucket.requests.length, 0)

  // ifAbsent is today's $setOnInsert upsert: the first image stays.
  await uploadStore.saveUpload(db, { id: 'image-x', bytes: bytes('one'), contentType: 'image/png' }, { ifAbsent: true })
  await uploadStore.saveUpload(db, { id: 'image-x', bytes: bytes('two'), contentType: 'image/png' }, { ifAbsent: true })
  assert.equal(db.rows('uploads').filter(r => r.id === 'image-x').length, 1)
  assert.equal(String((await uploadCache.loadUpload(db, 'image-x')).bytes), 'one')
})

test('older images keep being read from MongoDB once R2 is on, and a copied image prefers its MongoDB bytes', async () => {
  const { uploadCache, bucket } = loadStorage({ r2: true })
  const db = memoryDb({ uploads: [
    { id: 'legacy', contentType: 'image/png', bytes: new Binary(bytes('old')) },
    { id: 'copied', contentType: 'image/png', bytes: new Binary(bytes('both')), storage: 'r2', key: 'uploads/copied' },
    { id: 'lost', contentType: 'image/png', storage: 'r2', key: 'uploads/lost' },
  ] })
  assert.equal(String((await uploadCache.loadUpload(db, 'legacy')).bytes), 'old')
  assert.equal(String((await uploadCache.loadUpload(db, 'copied')).bytes), 'both')
  assert.equal(bucket.requests.length, 0)
  assert.equal(await uploadCache.loadUpload(db, 'lost'), null, 'a record whose object is missing is a missing image')
  assert.equal(await uploadCache.loadUpload(db, 'nobody'), null)
})

test('an R2 failure fails the save and writes no record, so no post links to a missing image', async () => {
  const { uploadStore } = loadStorage({ r2: true, bucket: fakeR2({ failures: [500, 500] }) })
  const db = memoryDb()
  await assert.rejects(uploadStore.saveUpload(db, { id: 'u2', bytes: bytes('x'), contentType: 'image/png' }), /Image storage could not save uploads\/u2/)
  assert.equal(db.rows('uploads').length, 0)
})

test('deleteUpload removes the record, the R2 object and the cached copy', async () => {
  const { uploadStore, uploadCache, bucket } = loadStorage({ r2: true })
  const db = memoryDb()
  await uploadStore.saveUpload(db, { id: 'gone', bytes: bytes('bye'), contentType: 'image/png' })
  await uploadCache.loadUpload(db, 'gone')
  assert.equal(await uploadStore.deleteUpload(db, 'gone'), true)
  assert.equal(bucket.objects.has('uploads/gone'), false)
  assert.equal(uploadCache.cachedUpload('gone'), undefined)
  assert.equal(await uploadCache.loadUpload(db, 'gone'), null)
  assert.equal(await uploadStore.deleteUpload(db, 'gone'), false)
})

test('renders: a PNG or a carousel ZIP goes to renders/<id>.png|zip with R2, or into the record without it', async () => {
  const r2 = loadStorage({ r2: true })
  const db = memoryDb()
  await r2.uploadStore.saveRender(db, { id: 's1', canvasId: 'c1', type: 'single', png: bytes('png'), approved: false })
  await r2.uploadStore.saveRender(db, { id: 'k1', canvasId: 'c1', type: 'carousel', zip: bytes('zipfile'), pages: [] })
  assert.deepEqual([...r2.bucket.objects.keys()], ['renders/s1.png', 'renders/k1.zip'])
  assert.equal(r2.bucket.objects.get('renders/k1.zip').contentType, 'application/zip')
  const [single, carousel] = db.rows('renders')
  assert.equal(single.png, undefined)
  assert.deepEqual([single.storage, single.key, single.size, single.canvasId], ['r2', 'renders/s1.png', 3, 'c1'])
  assert.equal(carousel.key, 'renders/k1.zip')
  assert.deepEqual(await r2.uploadStore.loadRender(db, 'k1'), { bytes: bytes('zipfile'), contentType: 'application/zip', kind: 'zip' })
  assert.equal((await r2.uploadStore.loadRender(db, 's1')).contentType, 'image/png')
  await r2.uploadStore.deleteRender(db, 's1')
  assert.equal(r2.bucket.objects.has('renders/s1.png'), false)
  assert.equal(await r2.uploadStore.loadRender(db, 's1'), null)

  const mongo = loadStorage()
  const local = memoryDb({ renders: [{ id: 'old', type: 'carousel', zip: new Binary(bytes('legacy zip')) }] })
  await mongo.uploadStore.saveRender(local, { id: 's2', type: 'single', png: bytes('png2') })
  const saved = local.rows('renders')[1]
  assert.ok(saved.png instanceof Binary)
  assert.equal(saved.storage, 'mongo')
  assert.equal(String((await mongo.uploadStore.loadRender(local, 's2')).bytes), 'png2')
  assert.equal((await mongo.uploadStore.loadRender(local, 'old')).kind, 'zip')
  assert.equal(mongo.bucket.requests.length, 0)
})

// The render handlers, with the canvas renderer replaced.
class FakeResponse {
  constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.headers = init.headers || {} }
  static json(body, init = {}) { return new FakeResponse(body, init) }
}
function renderHandlers(storage) {
  let n = 0
  const zip = class { constructor() { this.files = [] } file(name) { this.files.push(name) } async generateAsync() { return Buffer.from(`zip of ${this.files.join(',')}`) } }
  return new Function('NextResponse', 'uuidv4', 'JSZip', 'corsify', 'getBaseUrl', 'renderCanvasToPng', 'deleteRender', 'loadRender', 'saveRender', 'console',
    source('lib/handlers/renderHandlers.ts') + ';return { handleRender, handleGetRendered, handleGetRenders, handleDeleteRender }')(
    FakeResponse, () => `render-${++n}`, zip, x => x, () => 'https://batkle.test', async canvas => Buffer.from(`png of ${canvas.id}`),
    storage.uploadStore.deleteRender, storage.uploadStore.loadRender, storage.uploadStore.saveRender, { error() {} })
}

test('the render handlers save to R2, serve renders the CDN may keep, and never list their bytes or keys', async () => {
  const storage = loadStorage({ r2: true })
  const handlers = renderHandlers(storage)
  const db = memoryDb({ canvases: [{ id: 'c1', ownerId: 'user_1' }, { id: 'c2', ownerId: 'user_1', type: 'carousel', pages: [{ id: 'p1', type: 'content', order: 0 }] }] })
  const single = await handlers.handleRender(db, { canva_id: 'c1' }, {})
  assert.equal(single.body.url, 'https://batkle.test/api/rendered/render-1')
  assert.equal(String(storage.bucket.objects.get('renders/render-1.png').bytes), 'png of c1')
  const carousel = await handlers.handleRender(db, { canva_id: 'c2' }, {})
  assert.equal(carousel.body.url, 'https://batkle.test/api/rendered/render-2.zip')

  const png = await handlers.handleGetRendered(db, 'render-1')
  assert.equal(String(png.body), 'png of c1')
  assert.equal(png.headers['Content-Type'], 'image/png')
  assert.match(png.headers['Cache-Control'], /\bs-maxage=31536000\b/)
  assert.equal(png.headers['Content-Disposition'], undefined)
  const zip = await handlers.handleGetRendered(db, 'render-2')
  assert.equal(zip.headers['Content-Type'], 'application/zip')
  assert.equal(zip.headers['Content-Disposition'], 'attachment; filename="render-render-2.zip"')
  assert.equal((await handlers.handleGetRendered(db, 'nope')).status, 404)

  const listed = await handlers.handleGetRenders(db, 'user_1')
  assert.equal(listed.body.length, 2)
  for (const item of listed.body) for (const field of ['png', 'zip', 'key', 'storage', '_id']) assert.equal(item[field], undefined, field)

  await handlers.handleDeleteRender(db, 'render-1')
  assert.equal(storage.bucket.objects.has('renders/render-1.png'), false)
  assert.equal(db.rows('renders').length, 1)

  storage.bucket.failures.push(500, 500)
  storage.uploadCache.clearUploadCache()
  const failed = await handlers.handleGetRendered(db, 'render-2')
  assert.equal(failed.status, 503)
  assert.equal(failed.headers['Cache-Control'], undefined)
})
