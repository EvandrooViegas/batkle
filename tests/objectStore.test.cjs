const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadStorage, fakeR2, R2_ENV } = require('./uploadTestHelpers.cjs')

test('a put is one signed PUT to the bucket, with the type and bytes given and the secret never sent', async () => {
  const { objectStore, bucket } = loadStorage({ r2: true })
  assert.equal(objectStore.r2Configured(), true)
  await objectStore.putObject('uploads/abc-123', Buffer.from('pixels'), 'image/png')
  assert.equal(bucket.requests.length, 1)
  const [request] = bucket.requests
  assert.equal(request.method, 'PUT')
  assert.equal(request.url, 'https://acct123.r2.cloudflarestorage.com/batkle-images/uploads/abc-123')
  assert.match(request.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]*\bhost\b[a-z0-9;-]*, Signature=[0-9a-f]{64}$/)
  assert.match(request.headers['x-amz-date'], /^\d{8}T\d{6}Z$/)
  assert.equal(request.headers['x-amz-content-sha256'], 'UNSIGNED-PAYLOAD')
  assert.equal(request.headers['content-type'], 'image/png')
  assert.ok(!JSON.stringify(request).includes(R2_ENV.R2_SECRET_ACCESS_KEY))
  assert.equal(String(bucket.objects.get('uploads/abc-123').bytes), 'pixels')
})

test('a get returns the bytes and type, and a missing key is null', async () => {
  const { objectStore, bucket } = loadStorage({ r2: true })
  bucket.objects.set('renders/r1.zip', { bytes: Buffer.from('zip bytes'), contentType: 'application/zip' })
  const found = await objectStore.getObject('renders/r1.zip')
  assert.equal(String(found.bytes), 'zip bytes')
  assert.ok(Buffer.isBuffer(found.bytes))
  assert.equal(found.contentType, 'application/zip')
  assert.equal(bucket.requests[0].method, 'GET')
  assert.equal(await objectStore.getObject('uploads/nothing-here'), null)
})

test('a delete removes the object, and deleting one that is gone is fine', async () => {
  const { objectStore, bucket } = loadStorage({ r2: true })
  await objectStore.putObject('uploads/x', Buffer.from('x'), 'image/png')
  await objectStore.deleteObject('uploads/x')
  assert.equal(bucket.objects.has('uploads/x'), false)
  assert.equal(bucket.requests[1].method, 'DELETE')
  const missing = fakeR2({ failures: [{ status: 404, code: 'NoSuchKey' }] })
  await loadStorage({ r2: true, bucket: missing }).objectStore.deleteObject('uploads/x')
})

test('a 5xx answer or a network error is tried once more, and succeeds the second time', async () => {
  const flaky = fakeR2({ failures: [503] })
  const storage = loadStorage({ r2: true, bucket: flaky })
  await storage.objectStore.putObject('uploads/a', Buffer.from('a'), 'image/png')
  assert.deepEqual(flaky.requests.map(r => r.method), ['PUT', 'PUT'])
  assert.equal(String(flaky.objects.get('uploads/a').bytes), 'a', 'the retry sends the bytes again')
  assert.match(storage.warnings[0], /PUT uploads\/a: HTTP 503; trying once more/)

  const offline = fakeR2({ failures: [new TypeError('fetch failed')] })
  offline.objects.set('uploads/b', { bytes: Buffer.from('b'), contentType: 'image/webp' })
  assert.equal(String((await loadStorage({ r2: true, bucket: offline }).objectStore.getObject('uploads/b')).bytes), 'b')
  assert.equal(offline.requests.length, 2)
})

test('a second failure, or a refusal, is a clear error with status 503; refusals are not retried', async () => {
  const down = fakeR2({ failures: [500, 502] })
  await assert.rejects(loadStorage({ r2: true, bucket: down }).objectStore.putObject('uploads/c', Buffer.from('c'), 'image/png'),
    error => error.status === 503 && /^Image storage could not save uploads\/c: HTTP 502 InternalError$/.test(error.message))
  assert.equal(down.requests.length, 2)

  const denied = fakeR2({ failures: [{ status: 403, code: 'AccessDenied' }] })
  await assert.rejects(loadStorage({ r2: true, bucket: denied }).objectStore.getObject('uploads/d'), /could not read uploads\/d: HTTP 403 AccessDenied/)
  assert.equal(denied.requests.length, 1)

  const unplugged = fakeR2({ failures: [new TypeError('fetch failed'), new TypeError('fetch failed')] })
  await assert.rejects(loadStorage({ r2: true, bucket: unplugged }).objectStore.deleteObject('uploads/e'), /could not delete uploads\/e: fetch failed/)
})

test('each attempt has a time limit', async () => {
  const storage = loadStorage({ r2: true })
  let calls = 0
  const hang = request => { calls++; return new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason))) }
  storage.objectStore.configureObjectStore({ fetch: hang, timeoutMs: 25 })
  await assert.rejects(storage.objectStore.getObject('uploads/slow'), /could not read uploads\/slow: timed out after 25 ms/)
  assert.equal(calls, 2)
})

test('without all four settings R2 is off, and using it says so without any request', async () => {
  for (const missing of Object.keys(R2_ENV)) {
    const env = { ...R2_ENV, [missing]: ' ' }
    const storage = loadStorage({ env })
    assert.equal(storage.objectStore.r2Configured(), false, missing)
  }
  const off = loadStorage()
  await assert.rejects(off.objectStore.putObject('uploads/f', Buffer.from('f'), 'image/png'), error => error.status === 503 && /R2 is not configured/.test(error.message))
  assert.equal(off.bucket.requests.length, 0)
})
