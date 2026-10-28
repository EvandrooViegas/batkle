const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

// Reading a brand's website again: what it would change, and the profile with only the chapters the person chose.
const source = fs.readFileSync(require('node:path').join(__dirname, '../lib/client/reread.js'), 'utf8').replace(/^export /gm, '')
const { rereadChanges, applyReread, summary } = new Function(source + ';return { rereadChanges, applyReread, summary }')()

const current = {
  name: 'Acme Studio', about: 'We design kitchens.', services: ['Kitchens — full remodels'], projects: [{ name: 'Casa Azul', description: 'A kitchen I added by hand.' }],
  targetAudience: '', tone: 'Warm and direct.', colors: ['#14131A'], fonts: ['Inter'], logo: '/api/uploads/logo-1.png', language: 'English', designs: [{ id: 'global-a', source: 'global' }],
}
const next = {
  ...current,
  name: 'Acme Studio', about: 'Acme designs and builds kitchens and bathrooms in Lisbon.', services: ['Kitchens — full remodels', 'Bathrooms — wet rooms'],
  projects: [], targetAudience: 'Homeowners in Lisbon.', tone: ' Warm and direct. ', colors: ['#14131A', '#E4572E'], fonts: ['Inter'],
  logo: 'https://acme.example/logo.png', logoVariants: { source: 'https://acme.example/logo.png' }, language: 'unknown',
  website: 'https://acme.example', researchSources: [{ url: 'https://acme.example' }], designs: [],
}

test('only chapters the website really changes are offered, and an empty answer never clears one', () => {
  const changes = rereadChanges(current, next)
  assert.deepEqual(changes.map(c => c.id), ['about', 'services', 'audience', 'logo', 'colours'])
  assert.equal(changes.find(c => c.id === 'audience').added, true, 'a chapter that was empty is marked as new')
  assert.equal(changes.find(c => c.id === 'about').added, false)
  assert.ok(!changes.some(c => c.id === 'projects'), 'no projects on the site: the ones added by hand are not offered for removal')
  assert.ok(!changes.some(c => c.id === 'voice'), 'whitespace is not a change')
  assert.ok(!changes.some(c => c.id === 'language'), '"unknown" is not an answer')
  assert.deepEqual(rereadChanges(current, current), [])
})

test('applying takes only the ticked chapters, plus where the profile came from', () => {
  const merged = applyReread(current, next, ['services', 'logo'])
  assert.deepEqual(merged.services, next.services)
  assert.equal(merged.logo, next.logo)
  assert.deepEqual(merged.logoVariants, next.logoVariants, 'a chapter takes all its fields')
  assert.equal(merged.about, current.about, 'unticked chapters stay as they are')
  assert.deepEqual(merged.colors, current.colors)
  assert.deepEqual(merged.projects, current.projects)
  assert.deepEqual(merged.designs, current.designs, 'designs are never touched')
  assert.equal(merged.website, next.website)
  assert.deepEqual(merged.researchSources, next.researchSources)
  assert.deepEqual(applyReread(current, next, []).about, current.about)
})

test('summaries are short and readable', () => {
  assert.equal(summary('list', ['Kitchens — full remodels', 'Bathrooms — wet rooms', 'Floors', 'Paint']), 'Kitchens, Bathrooms, Floors and 1 more')
  assert.equal(summary('projects', [{ name: 'Casa Azul' }, { description: 'no name' }]), 'Casa Azul, Untitled project')
  assert.equal(summary('text', 'x'.repeat(300)).length, 178)
  assert.equal(summary('list', []), '')
})
