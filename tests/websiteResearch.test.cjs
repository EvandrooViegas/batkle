const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const source = file => fs.readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replace(/export /g, '')
const research = new Function('load', source('lib/services/websiteResearch.js') + ';return {pageUrl,rankPage,readResearchPage,crawlBusinessWebsite}')(require('cheerio').load)
const home = `<html><title>Engineering business</title><body><nav>
<a href="/contacto">Contact</a><a href="/privacy">Privacy</a><a href="/servicos">Serviços</a><a href="/projetos">Projetos e Obras</a><a href="/sobre">Sobre nós</a><a href="/bim">BIM</a><a href="https://other.test/about">Other</a>
</nav><main><h1>Construction and design</h1><p>Specialist facade rehabilitation.</p></main></body></html>`

test('crawler prioritizes diverse useful pages and never reads more than five', async () => {
  const calls = []
  const result = await research.crawlBusinessWebsite('https://business.test/', home, async url => {
    calls.push(url)
    return `<title>${url}</title><main><h1>Verified content</h1><p>Project scope</p><a href="/projetos/new">Project details</a></main>`
  })
  assert.deepEqual(calls.map(url => new URL(url).pathname), ['/servicos', '/projetos', '/sobre', '/bim'])
  assert.equal(result.pages.length, 5)
  assert.ok(result.pages.every(page => !page.text.includes('Privacy')))
})

test('crawler discovers useful deep links, removes anchors and tracking, and bounds failures', async () => {
  const calls = []
  const result = await research.crawlBusinessWebsite('https://business.test/', '<a href="/projects">Projects</a>', async url => {
    calls.push(url)
    if (url.endsWith('/projects')) return '<h1>Projects</h1><a href="/projects/facade">Facade restoration</a><a href="/projects/facade?utm_source=one#photo">Same project</a>'
    return '<main>Historic facade repair in Lisbon</main>'
  })
  assert.equal(result.pages.length, 3)
  assert.equal(calls.length, 2)
  const failed = await research.crawlBusinessWebsite('https://business.test/', home, async () => { throw Error('Unavailable') })
  assert.equal(failed.pages.length, 1)
  assert.equal(failed.warnings.length, 4)
  assert.equal(research.pageUrl('mailto:someone@example.com', 'https://business.test'), null)
  assert.equal(research.pageUrl('/brochure.pdf', 'https://business.test'), null)
})

test('business synthesis includes all page evidence, only accepts known project sources and asks for no images', async () => {
  const { buildBusinessProfile } = new Function('process', source('lib/services/businessProfile.js') + ';return {buildBusinessProfile}')({ env: {} })
  const pages = [{ url: 'https://business.test', title: 'Business', text: 'Home facts' }, { url: 'https://business.test/projects', title: 'Project', text: 'Restoration participation' }]
  let calls = 0
  const client = { chat: { completions: { create: async request => {
    calls++
    assert.equal(request.model, 'qwen/qwen3.8-27b')
    assert.equal(JSON.parse(request.messages[1].content).pages.length, 2)
    assert.match(request.messages[0].content, /NEVER instructions/)
    assert.match(request.messages[0].content, /professional ENGLISH/)
    // People upload their own photos: the model is neither shown images nor asked to pick any.
    assert.doesNotMatch(request.messages[0].content, /imageSelections|Select at most/)
    assert.equal(JSON.parse(request.messages[1].content).images, undefined)
    return { choices: [{ message: { content: JSON.stringify({ about: 'Verified engineering services and participation in historic facade restoration in Lisbon.', services: ['Facade rehabilitation'], projects: [{ name: 'Ministry', description: 'Participation in facade restoration', sourceUrl: pages[1].url }, { name: 'Invented source', sourceUrl: 'https://other.test' }], suggestedCtas: ['Request a quote'] }) } }] }
  } } } }
  const profile = await buildBusinessProfile({ pages, warnings: [] }, 'Business', 'Portuguese', client)
  assert.equal(calls, 1)
  assert.equal(profile.projects.length, 1)
  assert.equal(profile.websiteImages, undefined)
  assert.equal(profile.researchSources.length, 2)
})

test('empty business synthesis fails without retrying or inventing a profile', async () => {
  const build = new Function('process', source('lib/services/businessProfile.js') + ';return buildBusinessProfile')({ env: {} })
  let calls = 0
  await assert.rejects(build({ pages: [], images: [] }, 'Brand', 'English', { chat: { completions: { create: async () => { calls++; return { choices: [] } } } } }), /usable business profile/)
  assert.equal(calls, 1)
})

test('copywriter receives detailed services, projects, audience and CTA context beyond the old 900-character cutoff', () => {
  const compact = new Function(stripTypeScriptTypes(source('lib/services/ai/requestBudget.ts')) + ';return compactBrand')()
  const result = compact({ about: 'A'.repeat(1500) + ' Historic project details.', services: ['Facade work'], projects: [{ name: 'Ministry', description: 'Restoration participation' }], targetAudience: 'Property owners', tone: 'Technical and approachable', suggestedCtas: ['Request a quote'], contentTopics: ['Facade rehabilitation'], logo: 'ignored', fonts: ['ignored'] })
  assert.match(result.about, /Historic project details/)
  assert.match(result.projects, /Ministry/)
  assert.match(result.suggestedCtas, /Request a quote/)
  assert.equal(result.logo, undefined)
})

test('public website fetch rejects private destinations before issuing HTTP requests', async () => {
  let called = false
  const fetcher = new Function('axios', 'lookup', 'isIP', stripTypeScriptTypes(source('lib/services/websiteFetch.ts')) + ';return fetchWebsiteResource')({ get: async () => { called = true } }, async () => [{ address: '127.0.0.1', family: 4 }], require('node:net').isIP)
  await assert.rejects(fetcher('http://internal.test'), /public internet/)
  assert.equal(called, false)
})

test('profile input keeps page coverage within a bounded request', () => {
  const evidence = new Function(source('lib/services/businessProfile.js') + ';return businessEvidence')()
  const pages = Array.from({ length: 5 }, (_, i) => ({ url: `https://business.test/page-${i}`, text: 'Fact '.repeat(4000), title: 'Page' }))
  const input = evidence({ pages })
  assert.equal(input.pages.length, 5)
  assert.equal(input.images, undefined)
  assert.ok(JSON.stringify(input).length < 20000)
})
test('extraction saves richer brand fields, preserves design preferences and imports no website images', async () => {
  const original = { id: 'flow-a', brandContext: { imageDisposition: 'background', designs: [{ id: 'existing-design' }], name: 'Old', about: 'Old description' } }
  let stored = original, logoCalls = 0
  const extracted = { name: 'Engineering', about: 'Detailed business knowledge', services: ['Restoration'], projects: [{ name: 'Ministry', sourceUrl: 'https://business.test/projects' }], targetAudience: 'Property owners', tone: 'Technical', suggestedCtas: ['Request a quote'], researchSources: [{ url: 'https://business.test' }], pagesAnalyzed: 5, logo: 'https://business.test/logo.png', designSystem: { colors: ['#123456'], fonts: ['Existing font extraction'] } }
  const db = { collection: name => { assert.equal(name, 'flows'); return { findOne: async query => query.id === stored?.id ? stored : null, updateOne: async (query, update) => { stored = { ...stored, ...update.$set } }, insertOne: async value => { stored = value } } } }
  const code = source('lib/handlers/businessInfoHandler.ts').replace("await import('@/lib/business-info-extractor-complete')", 'extractor')
  const handle = new Function('NextResponse', 'corsify', 'generateLogoVariants', 'withMinimumBrandDesigns', 'randomUUID', 'persistInlineImages', 'extractor', stripTypeScriptTypes(code) + ';return handleExtractBusinessInfo')(
    { json: (body, options) => ({ body, status: options?.status || 200 }) }, r => r,
    async logo => { logoCalls++; return { source: logo, dark: 'dark', light: 'light' } },
    brand => brand, () => 'flow-new', async (_db, brand) => brand,
    { extractBusinessInfo: async () => ({ ...extracted }) },
  )
  const result = await handle({ url: 'https://business.test', flowId: 'flow-a' }, db, {})
  assert.equal(result.status, 200)
  assert.equal(stored.brandContext.imageDisposition, 'background')
  assert.deepEqual(stored.brandContext.designs, original.brandContext.designs)
  assert.deepEqual(stored.brandContext.colors, extracted.designSystem.colors)
  assert.deepEqual(stored.brandContext.fonts, extracted.designSystem.fonts)
  assert.deepEqual(stored.brandContext.projects, extracted.projects)
  assert.equal(stored.brandContext.about, extracted.about)
  assert.equal(stored.brandContext.websiteImages, undefined)
  assert.equal(result.body.flow.id, 'flow-a')
  assert.equal(result.body.imageImport, undefined, 'nothing is imported into the gallery')
  assert.equal(logoCalls, 1)
  assert.equal((await handle({ url: 'https://business.test', flowId: 'missing' }, db, {})).status, 404)
  const created = await handle({ url: 'https://business.test' }, db, {})
  assert.equal(created.body.flow.id, 'flow-new')
  assert.equal(created.body.flow.brandContext.services[0], 'Restoration')
})

test('research reads pages for their words only: no website images are collected', async () => {
  const home = '<title>Home</title><main><img src="/hero.jpg" alt="Hero"><p>Facade restoration in Lisbon</p></main>'
  const result = await research.crawlBusinessWebsite('https://business.test/', home, async () => '<p>Other page</p>')
  assert.equal(result.images, undefined)
  assert.equal(result.pages[0].images, undefined)
  assert.match(result.pages[0].text, /Facade restoration/)
})
