const { test } = require('node:test')
const assert = require('node:assert/strict')
const sharp = require('sharp')
const { memoryDb, loadStorage, loadBilling, loadUploadHandlers, R2_ENV } = require('./uploadTestHelpers.cjs')

const billing = loadBilling()
const request = { headers: { get: () => null } }
const GB = 1024 ** 3

/** A brand of user_1, R2 on (a fake bucket), the real plan checks; optionally a Pro plan. */
function setup({ r2 = true, pro = false } = {}) {
  const storage = loadStorage({ r2 })
  const now = new Date()
  const db = memoryDb({
    flows: [{ id: 'k', ownerId: 'user_1' }, { id: 'j', ownerId: 'user_1' }],
    billingAccounts: pro ? [{ id: 'user_1', plan: 'pro', status: 'active', interval: 'month', creditAnchor: now, creditPeriodStart: now, creditsUsed: 0, textsUsed: 0, extraCredits: 0, createdAt: now, updatedAt: now }] : [],
  })
  return { storage, db, bucket: storage.bucket, h: loadUploadHandlers({ storage, requireUploadRoom: billing.requireUploadRoom }) }
}

let jpegBytes
const jpeg = async () => (jpegBytes ||= await sharp({ create: { width: 640, height: 480, channels: 3, background: '#c84' } }).jpeg({ quality: 90 }).toBuffer())

/** Signs as the browser would, then PUTs `bytes` to the presigned URL through the fake bucket. */
async function sendDirect({ h, db, bucket }, { purpose, brand_id = 'brand_k', bytes, contentType = 'image/jpeg', userId = 'user_1' }) {
  const signed = await h.handleSignUpload(db, { contentType, size: bytes.length, purpose, ...(purpose === 'editor' ? {} : { brand_id }) }, userId)
  assert.equal(signed.status, 200, JSON.stringify(signed.body))
  const put = await bucket.fetch(new Request(signed.body.url, { method: 'PUT', headers: signed.body.headers, body: bytes }))
  assert.equal(put.status, 200)
  return signed.body.id
}
const finalize = {
  gallery: (h, db, id, userId = 'user_1', brand_id = 'brand_k') => h.handleUploadAsset(db, { upload: id, filename: 'shop.jpg', brand_id, description: '' }, request, userId),
  'post-image': (h, db, id, userId = 'user_1', brand_id = 'brand_k') => h.handleUploadPostImage(db, { upload: id, filename: 'shop.jpg', brand_id }, userId),
  editor: (h, db, id, userId = 'user_1') => h.handleUploadImage(db, { upload: id }, request, userId),
}
const cleanedUp = ({ db, bucket }, id) => !bucket.objects.has(`incoming/${id}`) && !db.rows('pendingUploads').some(p => p.id === id)

test('without R2, signing answers 404 { direct: false } and the browser keeps sending data URLs', async () => {
  const { h, db } = setup({ r2: false })
  const response = await h.handleSignUpload(db, { contentType: 'image/jpeg', size: 1000, purpose: 'gallery', brand_id: 'brand_k' }, 'user_1')
  assert.equal(response.status, 404)
  assert.deepEqual(response.body, { direct: false })
  assert.equal(db.rows('pendingUploads').length, 0)
})

test('signing needs a session, an image type the purpose takes, a size up to 25 MB and a brand', async () => {
  const { h, db } = setup()
  const sign = (body, userId = 'user_1') => h.handleSignUpload(db, { contentType: 'image/jpeg', size: 1000, purpose: 'gallery', brand_id: 'brand_k', ...body }, userId)
  assert.equal((await sign({}, null)).status, 401)
  assert.equal((await sign({ purpose: 'avatar' })).status, 400)
  assert.equal((await sign({ contentType: 'image/svg+xml' })).status, 415)
  assert.equal((await sign({ contentType: 'text/html', purpose: 'editor' })).status, 415)
  assert.equal((await sign({ contentType: 'image/gif', purpose: 'post-image' })).body.error, 'Use a JPEG, PNG or WebP photo.')
  assert.equal((await sign({ contentType: 'image/avif' })).status, 200, 'the gallery takes AVIF')
  assert.equal((await sign({ size: 0 })).status, 400)
  assert.equal((await sign({ size: '1000' })).status, 400)
  assert.equal((await sign({ size: 25 * 1024 * 1024 })).status, 200)
  assert.equal((await sign({ size: 25 * 1024 * 1024 + 1 })).status, 413)
  assert.equal((await sign({ brand_id: undefined })).status, 400)
  assert.equal((await sign({ purpose: 'editor', brand_id: undefined })).status, 200, 'editor images belong to no brand')
})

test('signing checks the plan first: a full Free allowance is refused with 402 before anything is sent', async () => {
  const { h, db } = setup()
  for (let i = 0; i < 20; i++) db.rows('uploads').push({ id: `u${i}`, ownerId: 'user_1', userUpload: true, size: 10 })
  await assert.rejects(h.handleSignUpload(db, { contentType: 'image/png', size: 10, purpose: 'post-image', brand_id: 'brand_k' }, 'user_1'), error => {
    assert.equal(error.status, 402)
    assert.equal(billing.billingErrorBody(error).code, 'limit_reached')
    return true
  })
  assert.equal(db.rows('pendingUploads').length, 0)
})

test('a signature is a 10-minute presigned PUT for incoming/<id>, covering Content-Type, with a pending record', async () => {
  const { h, db } = setup()
  const before = Date.now()
  const { status, body } = await h.handleSignUpload(db, { contentType: 'image/webp', size: 1234, purpose: 'gallery', brand_id: 'brand_k' }, 'user_1')
  assert.equal(status, 200)
  assert.match(body.id, /^[0-9a-f-]{36}$/)
  const url = new URL(body.url)
  assert.equal(url.origin + url.pathname, `https://acct123.r2.cloudflarestorage.com/batkle-images/incoming/${body.id}`)
  const query = Object.fromEntries(url.searchParams)
  assert.equal(query['X-Amz-Algorithm'], 'AWS4-HMAC-SHA256')
  assert.match(query['X-Amz-Credential'], /^AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request$/)
  assert.match(query['X-Amz-Date'], /^\d{8}T\d{6}Z$/)
  assert.equal(query['X-Amz-Expires'], '600')
  assert.equal(query['X-Amz-SignedHeaders'], 'content-type;host')
  assert.match(query['X-Amz-Signature'], /^[0-9a-f]{64}$/)
  assert.ok(!body.url.includes(R2_ENV.R2_SECRET_ACCESS_KEY))
  assert.deepEqual(body.headers, { 'Content-Type': 'image/webp' })
  const [pending] = db.rows('pendingUploads')
  assert.deepEqual([pending.id, pending.ownerId, pending.purpose, pending.brand_id, pending.contentType, pending.size], [body.id, 'user_1', 'gallery', 'brand_k', 'image/webp', 1234])
  const ttl = pending.expiresAt.getTime() - before
  assert.ok(ttl > 25 * 60 * 1000 && ttl <= 31 * 60 * 1000, `expires in ${ttl} ms`)
})

for (const purpose of ['gallery', 'post-image', 'editor']) {
  test(`a direct ${purpose} upload runs the usual pipeline, stores the original byte for byte, and cleans up`, async () => {
    const ctx = setup(), { h, db, bucket } = ctx
    const bytes = await jpeg()
    const id = await sendDirect(ctx, { purpose, bytes })
    const response = await finalize[purpose](h, db, id)
    assert.equal(response.status, 200, JSON.stringify(response.body))
    const url = response.body.url || response.body.relativeUrl
    const original = db.rows('uploads').find(row => row.id === url.split('/').pop())
    assert.deepEqual([original.storage, original.ownerId, original.userUpload, original.size, original.contentType], ['r2', 'user_1', true, bytes.length, 'image/jpeg'])
    assert.ok(bucket.objects.get(original.key).bytes.equals(bytes), 'a JPEG is never re-encoded')
    if (purpose !== 'editor') {
      assert.equal(db.rows('assets').length, 1)
      assert.ok(db.rows('uploads').some(row => row.userUpload === false && row.ownerId === 'user_1'), 'with its thumbnail')
    }
    assert.ok(cleanedUp(ctx, id), 'the incoming object and the pending record are gone')
    await assert.rejects(finalize[purpose](h, db, id), error => error.status === 404, 'an upload is used once')
  })
}

test('another account\'s upload reads as missing and is left alone', async () => {
  const ctx = setup(), { h, db, bucket } = ctx
  const id = await sendDirect(ctx, { purpose: 'gallery', bytes: await jpeg() })
  await assert.rejects(finalize.gallery(h, db, id, 'user_2'), error => error.status === 404 && /not found/.test(error.message))
  await assert.rejects(h.handleUploadAsset(db, { upload: id, brand_id: 'brand_k' }, request, undefined), error => error.status === 404)
  await assert.rejects(finalize.gallery(h, db, { $ne: null }), error => error.status === 404, 'ids are strings only')
  assert.ok(bucket.objects.has(`incoming/${id}`))
  assert.equal(db.rows('pendingUploads').length, 1)
  assert.equal(db.rows('assets').length, 0)
})

test('expired, wrong purpose, wrong brand, never sent, over 25 MB, or not an image: refused, cleaned up, nothing stored', async () => {
  const cases = [
    ['expired', async ctx => { const id = await sendDirect(ctx, { purpose: 'gallery', bytes: await jpeg() }); ctx.db.rows('pendingUploads')[0].expiresAt = new Date(Date.now() - 1000); return [id, () => finalize.gallery(ctx.h, ctx.db, id)] }, 410],
    ['wrong purpose', async ctx => { const id = await sendDirect(ctx, { purpose: 'gallery', bytes: await jpeg() }); return [id, () => finalize.editor(ctx.h, ctx.db, id)] }, 400],
    ['wrong brand', async ctx => { const id = await sendDirect(ctx, { purpose: 'post-image', bytes: await jpeg() }); return [id, () => finalize['post-image'](ctx.h, ctx.db, id, 'user_1', 'brand_j')] }, 400],
    ['never sent', async ctx => { const signed = await ctx.h.handleSignUpload(ctx.db, { contentType: 'image/jpeg', size: 10, purpose: 'editor' }, 'user_1'); return [signed.body.id, () => finalize.editor(ctx.h, ctx.db, signed.body.id)] }, 400],
    ['over 25 MB', async ctx => { const id = await sendDirect(ctx, { purpose: 'gallery', bytes: await jpeg() }); ctx.bucket.objects.set(`incoming/${id}`, { bytes: Buffer.alloc(25 * 1024 * 1024 + 1), contentType: 'image/jpeg' }); return [id, () => finalize.gallery(ctx.h, ctx.db, id)] }, 413],
    ['not an image', async ctx => { const id = await sendDirect(ctx, { purpose: 'editor', bytes: Buffer.from('<html><script>alert(1)</script></html>') }); return [id, () => finalize.editor(ctx.h, ctx.db, id)] }, 415],
  ]
  for (const [name, prepare, status] of cases) {
    const ctx = setup()
    const [id, run] = await prepare(ctx)
    const gets = () => ctx.bucket.requests.filter(r => r.method === 'GET').length
    await assert.rejects(run(), error => error.status === status, name)
    assert.ok(cleanedUp(ctx, id), `${name}: cleaned up`)
    assert.equal(ctx.db.rows('uploads').length, 0, `${name}: nothing stored`)
    assert.equal(ctx.db.rows('assets').length, 0, `${name}: no gallery entry`)
    if (name === 'over 25 MB') assert.equal(gets(), 0, 'an oversized object is refused from its size alone, never read')
  }
})

test('the real size is checked against the plan again: a file larger than it said is refused with 402', async () => {
  const ctx = setup({ pro: true }), { h, db, bucket } = ctx
  const bytes = await jpeg()
  db.rows('uploads').push({ id: 'big', ownerId: 'user_1', userUpload: true, size: 2 * GB - bytes.length + 100 })
  // It claims 10 bytes when signing, which fits; the file that arrives does not.
  const signed = await h.handleSignUpload(db, { contentType: 'image/jpeg', size: 10, purpose: 'gallery', brand_id: 'brand_k' }, 'user_1')
  await bucket.fetch(new Request(signed.body.url, { method: 'PUT', headers: signed.body.headers, body: bytes }))
  await assert.rejects(finalize.gallery(h, db, signed.body.id), error => {
    assert.equal(error.status, 402)
    assert.deepEqual(Object.keys(billing.billingErrorBody(error)), ['error', 'code', 'limit', 'maxBytes', 'bytes'])
    return true
  })
  assert.ok(cleanedUp(ctx, signed.body.id))
  assert.equal(db.rows('uploads').length, 1)
})

test('the data-URL path still works next to direct uploads', async () => {
  const { h, db } = setup()
  const data = 'data:image/jpeg;base64,' + (await jpeg()).toString('base64')
  assert.equal((await h.handleUploadPostImage(db, { data, filename: 'a.jpg', brand_id: 'brand_k' }, 'user_1')).status, 200)
  assert.equal((await h.handleUploadImage(db, { data }, request, 'user_1')).status, 200)
  assert.equal(db.rows('uploads').filter(row => row.userUpload).length, 2)
})
