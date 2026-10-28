const { test } = require('node:test')
const assert = require('node:assert/strict')
const sharp = require('sharp')
const { memoryDb, loadStorage, loadUploadHandlers } = require('./uploadTestHelpers.cjs')

/** The upload, gallery and delete handlers, wired to the real storage code. */
const handlers = (storage = loadStorage()) => loadUploadHandlers({ storage })

let photo
async function image() {
  photo ||= 'data:image/png;base64,' + (await sharp({ create: { width: 400, height: 400, channels: 3, background: '#3a7' } }).png().toBuffer()).toString('base64')
  return photo
}
const request = { headers: { get: () => null } }
const brandDb = (seed = {}) => memoryDb({ flows: [{ id: 'k', ownerId: 'user_1' }], ...seed })
const upload = {
  editor: async (h, db, userId) => h.handleUploadImage(db, { data: await image() }, request, userId),
  post: async (h, db, userId) => h.handleUploadPostImage(db, { data: await image(), filename: 'shop.png', brand_id: 'brand_k' }, userId),
}
const own = (db, userId) => db.rows('uploads').filter(row => row.ownerId === userId && row.userUpload === true)

test('no plan limits how many of the person\'s own images are stored: editor images and post photos are kept and marked as theirs', async () => {
  const h = handlers(), db = brandDb()
  for (let i = 0; i < 15; i++) assert.equal((await upload.editor(h, db, 'user_1')).status, 200)
  for (let i = 0; i < 15; i++) assert.equal((await upload.post(h, db, 'user_1')).status, 200)
  assert.equal(own(db, 'user_1').length, 30, 'more than the 20 images Free used to hold')
  assert.ok(own(db, 'user_1').every(row => row.size > 0))
  // Post photos also store a thumbnail: the person's, but not one of their images.
  const thumbs = db.rows('uploads').filter(row => row.ownerId === 'user_1' && row.userUpload === false)
  assert.equal(thumbs.length, 15)
  assert.ok(thumbs.every(row => row.contentType === 'image/jpeg' && row.size > 0))
  assert.equal(db.rows('assets').length, 15, 'only post photos get an entry; nothing reaches the gallery')
  assert.ok(db.rows('assets').every(asset => asset.source === 'post_upload'))
})

test('deleting a post photo marks it removed but keeps its bytes for posts that use it; a photo a post uses is kept', async () => {
  const h = handlers(), db = brandDb()
  const photo = await upload.post(h, db, 'user_1')
  const reserved = await upload.post(h, db, 'user_1')
  db.rows('assets').find(a => a.id === reserved.body.id).reserved_for = 'idea-1'

  assert.equal((await h.handleDeletePostImage(db, photo.body.id, 'brand_k')).body.deleted, true)
  for (const id of [photo.body.url, photo.body.thumbnail_url].map(url => url.split('/').pop())) {
    const row = db.rows('uploads').find(r => r.id === id)
    assert.equal(row.userUpload, false)
    assert.ok(row.removedAt instanceof Date)
    assert.ok(row.bytes, 'the bytes stay')
  }
  assert.equal((await h.handleDeletePostImage(db, reserved.body.id, 'brand_k')).body.deleted, false, 'a photo a post uses is kept')
  assert.equal(db.rows('uploads').find(r => r.id === reserved.body.url.split('/').pop()).userUpload, true)
})

test('deleting a gallery cutout never touches its shared upload, and images nobody uploaded belong to nobody', async () => {
  const storage = loadStorage(), h = handlers(storage), db = brandDb()
  await storage.uploadStore.saveUpload(db, { id: 'image-hash', bytes: Buffer.from('ai'), contentType: 'image/png' }, { ifAbsent: true })
  db.rows('assets').push({ id: 'generated-a', brand_id: 'brand_k', source: 'ai_generated', url: 'https://batkle.test/api/uploads/image-hash', subject: { url: '/api/uploads/subject-a' } })
  await h.handleDeleteAsset(db, 'generated-a')
  assert.equal(db.rows('assets').length, 0)
  assert.equal(db.rows('uploads').find(r => r.id === 'image-hash').removedAt, undefined)
  // The Design Library editor uploads without an account: stored, owned by nobody.
  assert.equal((await upload.editor(h, db, undefined)).status, 200)
  assert.equal(db.rows('uploads').filter(row => row.ownerId).length, 0)
})

test('the gallery lists the brand\'s good AI cutouts only: no photos, no failed or cut-off cutouts, no other brand\'s', async () => {
  const h = handlers()
  const cutout = (id, subject, extra = {}) => ({ id, brand_id: 'brand_k', source: 'ai_generated', status: 'ready', url: `/api/uploads/${id}`, subject, created_at: new Date(2026, 9, Number(id.slice(-1))), ...extra })
  const db = brandDb({ assets: [
    cutout('good-1', { url: '/api/uploads/s1', cropEdges: { left: false, right: false, top: false, bottom: true } }),
    cutout('good-2', { url: '/api/uploads/s2' }),
    cutout('not-cut-out-3', undefined),
    cutout('cut-left-4', { url: '/api/uploads/s4', cropEdges: { left: true, right: false, top: false, bottom: false } }),
    cutout('cut-top-5', { url: '/api/uploads/s5', cropEdges: { top: true } }),
    cutout('other-brand-6', { url: '/api/uploads/s6' }, { brand_id: 'brand_x' }),
    { id: 'upload', brand_id: 'brand_k', url: '/api/uploads/old', status: 'ready' },
    { id: 'website', brand_id: 'brand_k', source: 'website', url: '/api/uploads/site', status: 'ready' },
    { id: 'post-photo', brand_id: 'brand_k', source: 'post_upload', url: '/api/uploads/post', status: 'ready' },
  ] })
  const listed = await h.handleListAssets(db, 'brand_k')
  assert.deepEqual(listed.body.map(asset => asset.id), ['good-2', 'good-1'], 'newest first; a subject cut at the bottom is fine')
  assert.ok(listed.body.every(asset => asset._id === undefined))
  assert.equal((await h.handleListAssets(db, '')).status, 400)
})

test('with R2 on, a post photo and its thumbnail go to R2 and the records still carry owner, flag and size', async () => {
  const storage = loadStorage({ r2: true }), h = handlers(storage), db = brandDb()
  const asset = await upload.post(h, db, 'user_1')
  const [original, thumb] = [asset.body.url, asset.body.thumbnail_url].map(url => db.rows('uploads').find(r => r.id === url.split('/').pop()))
  assert.deepEqual([original.storage, original.ownerId, original.userUpload, original.bytes], ['r2', 'user_1', true, undefined])
  assert.deepEqual([thumb.storage, thumb.ownerId, thumb.userUpload], ['r2', 'user_1', false])
  assert.equal(storage.bucket.objects.get(original.key).bytes.length, original.size)
})

test('the editor stores images only', async () => {
  const h = handlers(), db = brandDb()
  const page = await h.handleUploadImage(db, { data: 'data:text/html;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64') }, request, 'user_1')
  assert.equal(page.status, 415)
  assert.equal(db.rows('uploads').length, 0)
})
