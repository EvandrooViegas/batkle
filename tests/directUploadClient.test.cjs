const { test } = require('node:test')
const assert = require('node:assert/strict')
const { source } = require('./uploadTestHelpers.cjs')

// FileReader as the browser has it, for Node's File.
class FakeFileReader {
  readAsDataURL(file) {
    file.arrayBuffer().then(buffer => { this.result = `data:${file.type};base64,${Buffer.from(buffer).toString('base64')}`; this.onload() }, error => { this.error = error; this.onerror() })
  }
}
const client = new Function('FileReader', source('lib/client/billing.js') + source('lib/client/directUpload.js') + ';return { uploadFile, readAsDataUrl, DIRECT_MAX_BYTES, FALLBACK_MAX_BYTES }')(FakeFileReader)
const photos = new Function('DIRECT_MAX_BYTES', 'FALLBACK_MAX_BYTES', 'readAsDataUrl', 'uploadFile', source('lib/client/postImages.js') + ';return { uploadPostImage, fallbackPhoto }')

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
/** A fake fetch answering each request with the next of `answers` (a Response, or an Error to throw), recording them. */
function fakeFetch(...answers) {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers, body: init.body })
    const answer = answers.shift()
    if (answer instanceof Error) throw answer
    return answer
  }
  return { fetch, calls }
}
const file = (size = 5, type = 'image/jpeg', name = 'shop.jpg') => new File([Buffer.alloc(size, 7)], name, { type })

test('with direct uploads: sign, PUT the file itself to the signed URL, then send only its id', async () => {
  const { fetch, calls } = fakeFetch(
    json(200, { id: 'up-1', url: 'https://r2.test/incoming/up-1?X-Amz-Signature=abc', headers: { 'Content-Type': 'image/jpeg' } }),
    new Response(null, { status: 200 }),
    json(200, { id: 'asset_1', url: '/api/uploads/x' }),
  )
  const chosen = file(10 * 1024 * 1024)
  const result = await client.uploadFile('/api/assets', chosen, { purpose: 'gallery', fields: { filename: 'shop.jpg', brand_id: 'brand_k', description: '' }, fetch })
  assert.deepEqual(result, { id: 'asset_1', url: '/api/uploads/x' })
  assert.deepEqual(calls.map(c => [c.method, c.url]), [['POST', '/api/uploads/sign'], ['PUT', 'https://r2.test/incoming/up-1?X-Amz-Signature=abc'], ['POST', '/api/assets']])
  assert.deepEqual(JSON.parse(calls[0].body), { contentType: 'image/jpeg', size: 10 * 1024 * 1024, purpose: 'gallery', brand_id: 'brand_k' })
  assert.equal(calls[1].body, chosen, 'the file goes up unchanged, however large')
  assert.deepEqual(calls[1].headers, { 'Content-Type': 'image/jpeg' })
  assert.deepEqual(JSON.parse(calls[2].body), { filename: 'shop.jpg', brand_id: 'brand_k', description: '', upload: 'up-1' })
})

test('without direct uploads (404 { direct: false }), the file goes inside the request as before', async () => {
  const { fetch, calls } = fakeFetch(json(404, { direct: false }), json(200, { url: '/api/uploads/y' }))
  const result = await client.uploadFile('/api/uploads', file(4, 'image/png', 'a.png'), { purpose: 'editor', fetch })
  assert.equal(result.url, '/api/uploads/y')
  assert.equal(calls.length, 2, 'no PUT')
  assert.equal(JSON.parse(calls[0].body).brand_id, undefined)
  assert.deepEqual(JSON.parse(calls[1].body), { data: 'data:image/png;base64,' + Buffer.alloc(4, 7).toString('base64') })
})

test('the fallback refuses files over 3 MB before sending them, and nothing is ever over 25 MB', async () => {
  const fallback = fakeFetch(json(404, { direct: false }))
  await assert.rejects(client.uploadFile('/api/assets', file(client.FALLBACK_MAX_BYTES + 1), { purpose: 'gallery', fetch: fallback.fetch }), /larger than 3 MB/)
  assert.equal(fallback.calls.length, 1)
  const none = fakeFetch()
  await assert.rejects(client.uploadFile('/api/assets', { name: 'huge.jpg', size: client.DIRECT_MAX_BYTES + 1, type: 'image/jpeg' }, { purpose: 'gallery', fetch: none.fetch }), /larger than 25 MB/)
  assert.equal(none.calls.length, 0)
})

test('billing errors keep their code, from signing or from the upload itself', async () => {
  const limit = { error: 'Your Free plan holds up to 20 of your own images.', code: 'limit_reached', limit: 'uploads', maxImages: 20, images: 20 }
  const atSign = fakeFetch(json(402, limit))
  await assert.rejects(client.uploadFile('/api/assets', file(), { purpose: 'gallery', fetch: atSign.fetch }), error => error.status === 402 && error.code === 'limit_reached' && error.billing.maxImages === 20 && error.message === limit.error)
  assert.equal(atSign.calls.length, 1, 'nothing is sent once the plan is full')
  const atUpload = fakeFetch(json(200, { id: 'up-2', url: 'https://r2.test/p', headers: {} }), new Response(null, { status: 200 }), json(402, limit))
  await assert.rejects(client.uploadFile('/api/post-images', file(), { purpose: 'post-image', fetch: atUpload.fetch }), error => error.code === 'limit_reached')
  const other = fakeFetch(json(415, { error: 'Use a JPEG, PNG or WebP photo.' }))
  await assert.rejects(client.uploadFile('/api/post-images', file(), { purpose: 'post-image', fetch: other.fetch }), error => error.code === undefined && error.message === 'Use a JPEG, PNG or WebP photo.')
})

test('a PUT that fails says so and sends nothing more', async () => {
  for (const failure of [new TypeError('Failed to fetch'), new Response('<Error/>', { status: 403 })]) {
    const { fetch, calls } = fakeFetch(json(200, { id: 'up-3', url: 'https://r2.test/q', headers: {} }), failure)
    await assert.rejects(client.uploadFile('/api/uploads', file(), { purpose: 'editor', fetch }), /could not be uploaded\. Please check your connection/)
    assert.equal(calls.length, 2)
  }
})

test('post photos are sent unchanged, and the fallback sends a photo that fits a request as it is', async () => {
  const sent = []
  const { uploadPostImage, fallbackPhoto } = photos(client.DIRECT_MAX_BYTES, client.FALLBACK_MAX_BYTES, client.readAsDataUrl, async (...args) => { sent.push(args); return { id: 'asset_2' } })
  const photo = file(2048, 'image/jpeg', 'phone.jpg')
  assert.deepEqual(await uploadPostImage(photo, 'brand_k'), { id: 'asset_2' })
  const [[endpoint, sentFile, options]] = sent
  assert.equal(endpoint, '/api/post-images')
  assert.equal(sentFile, photo)
  assert.deepEqual([options.purpose, options.fields], ['post-image', { filename: 'phone.jpg', brand_id: 'brand_k' }])
  assert.equal(await fallbackPhoto(photo), 'data:image/jpeg;base64,' + Buffer.alloc(2048, 7).toString('base64'), 'a photo that fits a request is sent as it is')
  await assert.rejects(uploadPostImage(file(10, 'image/gif', 'a.gif'), 'brand_k'), /use a JPEG, PNG or WebP photo/)
  await assert.rejects(uploadPostImage({ name: 'big.jpg', type: 'image/jpeg', size: client.DIRECT_MAX_BYTES + 1 }, 'brand_k'), /too large \(max 25 MB\)/)
})
