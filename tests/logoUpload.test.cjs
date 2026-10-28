const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')

// downloadLogo reads logos uploaded to Batkle (/api/uploads/<id>, relative or on any host) from storage.
const source = fs.readFileSync(require('node:path').join(__dirname, '../lib/services/logoBackground.ts'), 'utf8')
  .replace(/^import .*$/gm, '').replace(/export /g, '')
const uploads = { 'logo-1.png': { bytes: Buffer.from('logo bytes'), contentType: 'image/png' } }
const fetched = []
const service = vm.runInNewContext(stripTypeScriptTypes(source) + '\n({downloadLogo})', {
  Buffer, URL, AbortSignal,
  sharp: () => { throw new Error('sharp is not needed here') },
  isIP: require('node:net').isIP,
  lookup: async () => [{ address: '127.0.0.1' }],
  connectToMongo: async () => ({}),
  loadUpload: async (db, id) => uploads[id] || null,
  fetch: async url => { fetched.push(String(url)); throw new Error('no network in tests') },
})

test('an uploaded logo is read from storage, by relative or absolute address', async () => {
  assert.equal(String(await service.downloadLogo('/api/uploads/logo-1.png')), 'logo bytes')
  assert.equal(String(await service.downloadLogo('https://batkle.example/api/uploads/logo-1.png')), 'logo bytes')
  assert.equal(String(await service.downloadLogo('http://localhost:3000/api/uploads/logo-1.png')), 'logo bytes')
  assert.deepEqual(fetched, [])
})

test('a missing upload fails clearly, and other addresses still go through the public-address check', async () => {
  await assert.rejects(service.downloadLogo('/api/uploads/missing.png'), /upload is missing/)
  await assert.rejects(service.downloadLogo('/logo.png'), /Invalid URL/)
  // An address that only looks like an upload elsewhere, with no such upload here, is fetched as a normal URL: refused, as local.
  await assert.rejects(service.downloadLogo('http://localhost:3000/api/uploads/other.png'), /Non-public logo URL/)
  await assert.rejects(service.downloadLogo('/api/uploads/logo-1.png', 4), /Image too large/)
})
