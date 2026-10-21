const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const external = require('../next.config.js')('phase-production-build').experimental.serverComponentsExternalPackages
const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(dir, entry.name)
  return entry.isDirectory() ? (entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : files(file)) : /\.(jsx?|tsx?)$/.test(entry.name) ? [file] : []
})

// Next renders client components on the server too. There a package kept external is loaded with import(), which
// makes the client module async, and the page's server render fails: "Element type is invalid … got: undefined".
test('client components import no package the server keeps external', () => {
  const offenders = []
  for (const file of [...files('app'), ...files('components')]) {
    const source = fs.readFileSync(file, 'utf8')
    if (!/^\s*['"]use client['"]/.test(source)) continue
    for (const [, spec] of source.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
      if (external.includes(name)) offenders.push(`${file}: ${spec}`)
    }
  }
  assert.deepEqual(offenders, [])
})
