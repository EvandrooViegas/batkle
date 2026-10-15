const { test } = require('node:test')
const assert = require('node:assert/strict')
const sharp = require('sharp')
const { memoryDb, loadStorage, loadBilling, loadUploadHandlers } = require('./uploadTestHelpers.cjs')

// The real plans and billing account code, over the in-memory database.
const billing = loadBilling()

/** The upload and delete handlers, wired to the real storage and billing code. */
const handlers = (storage = loadStorage()) => loadUploadHandlers({ storage, requireUploadRoom: billing.requireUploadRoom })

let photo
async function image() {
  photo ||= 'data:image/png;base64,' + (await sharp({ create: { width: 400, height: 400, channels: 3, background: '#3a7' } }).png().toBuffer()).toString('base64')
  return photo
}
const request = { headers: { get: () => null } }
const brandDb = (seed = {}) => memoryDb({ flows: [{ id: 'k', ownerId: 'user_1' }], ...seed })
const upload = {
  editor: async (h, db, userId) => h.handleUploadImage(db, { data: await image() }, request, userId),
  gallery: async (h, db, userId) => h.handleUploadAsset(db, { data: await image(), filename: 'shop.png', brand_id: 'brand_k' }, request, userId),
  post: async (h, db, userId) => h.handleUploadPostImage(db, { data: await image(), filename: 'shop.png', brand_id: 'brand_k' }, userId),
}
const own = (db, userId) => db.rows('uploads').filter(row => row.ownerId === userId && row.userUpload === true)
const limitReached = error => error.status === 402 && error.code === 'limit_reached'

test('Free holds 20 of the person\'s own images, counted across the editor, the gallery and post photos', async () => {
  const h = handlers(), db = brandDb()
  for (let i = 0; i < 7; i++) assert.equal((await upload.editor(h, db, 'user_1')).status, 200)
  for (let i = 0; i < 7; i++) assert.equal((await upload.gallery(h, db, 'user_1')).status, 200)
  for (let i = 0; i < 6; i++) assert.equal((await upload.post(h, db, 'user_1')).status, 200)
  assert.deepEqual(await billing.uploadUsage(db, 'user_1'), { images: 20, bytes: own(db, 'user_1').reduce((sum, row) => sum + row.size, 0) })
  // Gallery and post photos also store a thumbnail: the person's, but never counted.
  const thumbs = db.rows('uploads').filter(row => row.ownerId === 'user_1' && row.userUpload === false)
  assert.equal(thumbs.length, 13)
  assert.ok(thumbs.every(row => row.contentType === 'image/jpeg' && row.size > 0))

  const stored = db.rows('uploads').length
  for (const path of ['editor', 'gallery', 'post']) {
    await assert.rejects(upload[path](h, db, 'user_1'), error => {
      assert.ok(limitReached(error), path)
      // What the route answers: the billing body with its code and status.
      const body = billing.billingErrorBody(error)
      assert.deepEqual(body, { error: 'Your Free plan holds up to 20 of your own images. Delete some from the Gallery, or upgrade for more space.', code: 'limit_reached', limit: 'uploads', maxImages: 20, images: 20 })
      return true
    })
  }
  assert.equal(db.rows('uploads').length, stored, 'a refused image is never stored')
  assert.equal(db.rows('assets').length, 13, 'and no gallery or post entry is made for it')
})

test('Pro has no image count, only its 2 GB: an image that does not fit is refused with the bytes used', async () => {
  const h = handlers()
  const now = new Date()
  const db = brandDb({
    billingAccounts: [{ id: 'user_1', plan: 'pro', status: 'active', interval: 'month', creditAnchor: now, creditPeriodStart: now, creditsUsed: 0, textsUsed: 0, extraCredits: 0, createdAt: now, updatedAt: now }],
  })
  for (let i = 0; i < 21; i++) assert.equal((await upload.editor(h, db, 'user_1')).status, 200)
  const used = (await billing.uploadUsage(db, 'user_1')).bytes
  const GB = 1024 ** 3
  db.rows('uploads').push({ id: 'big', ownerId: 'user_1', userUpload: true, size: 2 * GB - used - 10, storage: 'r2', key: 'uploads/big' })
  await assert.rejects(upload.gallery(h, db, 'user_1'), error => {
    assert.ok(limitReached(error))
    assert.deepEqual(billing.billingErrorBody(error), { error: "This image doesn't fit: you've used 2 GB of your 2 GB. Delete some images from the Gallery, or upgrade for more space.", code: 'limit_reached', limit: 'uploads', maxBytes: 2 * GB, bytes: 2 * GB - 10 })
    return true
  })
  await assert.rejects(upload.post(h, db, 'user_1'), limitReached)
  await assert.rejects(upload.editor(h, db, 'user_1'), limitReached)
})

test('deleting a gallery image or a post photo gives its space back but keeps its bytes for posts that use it', async () => {
  const h = handlers(), db = brandDb()
  const first = await upload.gallery(h, db, 'user_1')
  const photo = await upload.post(h, db, 'user_1')
  const reserved = await upload.post(h, db, 'user_1')
  db.rows('assets').find(a => a.id === reserved.body.id).reserved_for = 'idea-1'
  for (let i = 0; i < 17; i++) await upload.editor(h, db, 'user_1')
  await assert.rejects(upload.editor(h, db, 'user_1'), limitReached)

  await h.handleDeleteAsset(db, first.body.id)
  const ids = [first.body.url, first.body.thumbnail_url].map(url => url.split('/').pop())
  for (const id of ids) {
    const row = db.rows('uploads').find(r => r.id === id)
    assert.equal(row.userUpload, false)
    assert.ok(row.removedAt instanceof Date)
    assert.ok(row.bytes, 'the bytes stay')
  }
  assert.equal((await billing.uploadUsage(db, 'user_1')).images, 19)
  assert.equal((await upload.editor(h, db, 'user_1')).status, 200)

  assert.equal((await h.handleDeletePostImage(db, photo.body.id, 'brand_k')).body.deleted, true)
  assert.equal(db.rows('uploads').find(r => r.id === photo.body.url.split('/').pop()).userUpload, false)
  assert.equal((await h.handleDeletePostImage(db, reserved.body.id, 'brand_k')).body.deleted, false, 'a photo a post uses is kept')
  assert.equal(db.rows('uploads').find(r => r.id === reserved.body.url.split('/').pop()).userUpload, true, 'and still counts')
  assert.equal((await billing.uploadUsage(db, 'user_1')).images, 19)
})

test('deleting a website or AI image never touches shared uploads, and images nobody uploaded never count', async () => {
  const storage = loadStorage(), h = handlers(storage), db = brandDb()
  await storage.uploadStore.saveUpload(db, { id: 'website_abc_original', bytes: Buffer.from('site'), contentType: 'image/jpeg' }, { ifAbsent: true })
  await storage.uploadStore.saveUpload(db, { id: 'image-hash', bytes: Buffer.from('ai'), contentType: 'image/png' }, { ifAbsent: true })
  db.rows('assets').push({ id: 'website_abc', brand_id: 'brand_k', source: 'website', url: 'https://batkle.test/api/uploads/website_abc_original' })
  await h.handleDeleteAsset(db, 'website_abc')
  assert.equal(db.rows('uploads').find(r => r.id === 'website_abc_original').removedAt, undefined)
  // The Design Library editor uploads without an account: stored, owned by nobody, never checked or counted.
  assert.equal((await upload.editor(h, db, undefined)).status, 200)
  assert.equal(db.rows('billingAccounts').length, 0)
  assert.deepEqual(await billing.uploadUsage(db, 'user_1'), { images: 0, bytes: 0 })
})

test('with R2 on, the person\'s image and its thumbnail go to R2 and the records still carry owner, flag and size', async () => {
  const storage = loadStorage({ r2: true }), h = handlers(storage), db = brandDb()
  const asset = await upload.gallery(h, db, 'user_1')
  const [original, thumb] = [asset.body.url, asset.body.thumbnail_url].map(url => db.rows('uploads').find(r => r.id === url.split('/').pop()))
  assert.deepEqual([original.storage, original.ownerId, original.userUpload, original.bytes], ['r2', 'user_1', true, undefined])
  assert.deepEqual([thumb.storage, thumb.ownerId, thumb.userUpload], ['r2', 'user_1', false])
  assert.equal(storage.bucket.objects.get(original.key).bytes.length, original.size)
  assert.deepEqual(await billing.uploadUsage(db, 'user_1'), { images: 1, bytes: original.size })
})

test('the editor stores images only', async () => {
  const h = handlers(), db = brandDb()
  const page = await h.handleUploadImage(db, { data: 'data:text/html;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64') }, request, 'user_1')
  assert.equal(page.status, 415)
  assert.equal(db.rows('uploads').length, 0)
})
