// Launch security guards: the renderer downloads only public images, request limits count per bucket and window,
// the app's API sends no CORS headers, and no other site may frame Batkle.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { registerHooks, stripTypeScriptTypes } = require('node:module')

registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context) } catch (error) {
      if (specifier.startsWith('.') && !/\.[cm]?js$/.test(specifier)) return next(`${specifier}.js`, context)
      throw error
    }
  },
})
process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000'
const { assertPublicImageUrl, privateAddress } = require('../lib/renderCanvas.js')
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
const load = file => stripTypeScriptTypes(read(file).replace(/^import .*$/gm, '').replace(/^export /gm, ''))

test('internal, private and reserved addresses are never downloaded', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(privateAddress(address), true, address)
  }
  for (const address of ['8.8.8.8', '151.101.1.69', '172.32.0.1', '2606:4700::1111']) assert.equal(privateAddress(address), false, address)
})

test('the renderer refuses image addresses inside the server’s network, odd ports and credentials, and allows Batkle and public hosts', async () => {
  const dns = { 'images.example.com': '93.184.216.34', 'sneaky.example.com': '169.254.169.254', 'internal.example.com': '10.0.0.5' }
  const lookupHost = async host => (dns[host] ? [{ address: dns[host], family: 4 }] : [])
  const refused = ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1:8080/x.png', 'http://[::1]/x.png', 'http://sneaky.example.com/x.png',
    'http://internal.example.com/x.png', 'https://images.example.com:8443/x.png', 'https://user:pw@images.example.com/x.png', 'ftp://images.example.com/x.png',
    'http://unknown.example.com/x.png', 'http://localhost:6379/']
  for (const url of refused) await assert.rejects(assertPublicImageUrl(url, { lookupHost }), undefined, url)
  await assertPublicImageUrl('https://images.example.com/photo.jpg', { lookupHost })
  // Batkle's own uploads, on localhost while developing.
  await assertPublicImageUrl('http://localhost:3000/api/uploads/abc', { lookupHost })
})

function counters() {
  const docs = new Map()
  return {
    docs,
    collection: () => ({
      createIndex: async () => 'ok',
      findOneAndUpdate: async (filter, update) => {
        const doc = docs.get(filter._id) || { _id: filter._id, ...update.$setOnInsert, count: 0 }
        doc.count += update.$inc.count
        docs.set(filter._id, doc)
        return { ...doc }
      },
    }),
  }
}

test('request limits count per bucket and window, and a limit that cannot be read never blocks', async () => {
  const rate = new Function('console', load('lib/rateLimit.ts') + ';return { overLimit, overAiLimit, clientIp, AI_LIMITS }')({ warn() {} })
  const db = counters()
  const now = new Date('2026-11-07T10:00:00Z')
  const results = []
  for (let i = 0; i < 4; i++) results.push(await rate.overLimit(db, 'track:1.2.3.4', 3, 60_000, now))
  assert.deepEqual(results, [false, false, false, true])
  assert.equal(await rate.overLimit(db, 'track:5.6.7.8', 3, 60_000, now), false, 'another address has its own count')
  assert.equal(await rate.overLimit(db, 'track:1.2.3.4', 3, 60_000, new Date(now.getTime() + 61_000)), false, 'a new window starts again')
  const [counter] = db.docs.values()
  assert.ok(counter.expiresAt > now, 'counters expire after their window')
  const broken = { collection: () => ({ createIndex: async () => 'ok', findOneAndUpdate: async () => { throw Error('down') } }) }
  assert.equal(await rate.overLimit(broken, 'x', 0, 60_000, now), false)

  const ai = counters()
  const [burst] = rate.AI_LIMITS
  for (let i = 0; i < burst.limit; i++) assert.equal(await rate.overAiLimit(ai, 'user_1', now), false)
  assert.equal(await rate.overAiLimit(ai, 'user_1', now), true)
  assert.equal(await rate.overAiLimit(ai, 'user_2', now), false)
  assert.equal(rate.clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } })), '203.0.113.9')
})

test('the app’s API sends no CORS headers and no other site may frame Batkle', () => {
  const { corsify } = new Function(load('lib/services/middleware.ts') + ';return { corsify }')()
  const response = corsify(new Response('{}'))
  assert.equal(response.headers.get('access-control-allow-origin'), null)
  const config = read('next.config.js')
  assert.doesNotMatch(config, /ALLOWALL|frame-ancestors \*|Access-Control-Allow-Origin/)
  assert.match(config, /frame-ancestors 'self'/)
  assert.match(read('lib/developer/api.ts'), /'Access-Control-Allow-Origin': '\*'/, 'the developer API keeps its own')
})

test('AI routes without credits are limited per account, and the public visit counter per address and per day', () => {
  const router = read('app/api/[[...path]]/route.js')
  for (const route of ['/generate-content-ideas', '/generate-copywriting', '/plan-post', '/extract-business-info', '/brand-posts']) assert.match(router, new RegExp(`'${route}'`))
  assert.match(router, /overAiLimit\(db, userId\)/)
  assert.match(router, /export const maxDuration = 300/)
  assert.match(read('app/api/ads/[[...path]]/route.js'), /overAiLimit\(db, userId\)/)
  const track = read('app/api/track/route.js')
  assert.match(track, /overLimit\(db, `track:\$\{clientIp\(request\)\}`/)
  assert.match(track, /overLimit\(db, 'track:all'/)
  assert.match(read('lib/analytics/visits.ts'), /expireAfterSeconds: VISIT_RETENTION_DAYS \* 86400/)
})
