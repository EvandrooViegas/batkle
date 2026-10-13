const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const { z } = require('zod')
const crypto = require('node:crypto')

function load(file, names, dependencies = {}) {
  const source = fs.readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replace(/export /g, '')
  return new Function(...Object.keys(dependencies), stripTypeScriptTypes(source, { mode: 'transform' }) + `;return {${names.join(',')}}`)(...Object.values(dependencies))
}
const types = load('lib/designs/global/types.ts', ['familySchema', 'variantSchema', 'referenceSchema', 'studySchema', 'imageryStrategySchema', 'grammarSchema', 'COMPOSITIONS', 'DECORATION_KINDS', 'COLOR_TOKENS', 'COLOR_ROLES', 'SLOT_NAMES'], { z })
const { INITIAL_GLOBAL_FAMILIES: seeds } = load('lib/designs/global/seeds.ts', ['INITIAL_GLOBAL_FAMILIES'])
const resolve = load('lib/designs/global/resolve.ts', ['resolveBrandTokens', 'resolveVariant', 'referencePreviewBrand', 'contentSlots', 'countLines', 'clean', 'lightness', 'on', 'hex', 'SAMPLE_COPY'])
const study = load('lib/designs/global/study.ts', ['variantImageMode', 'familyImagery', 'familyCutouts', 'familyPhotoLed', 'familyGrammar', 'deriveGrammar', 'reconcileStudy', 'studyForPlanning'], { ...types })
const compose = load('lib/designs/global/compose.ts', ['planSlides', 'composeSlide', 'imageFrame', 'brandPalette', 'listItems', 'previewSlide', 'SAMPLE_DECK', 'imageChoiceOf'], { ...resolve, ...study })
const validate = load('lib/designs/global/validate.ts', ['validatePost', 'validatePage'])
const store = load('lib/designs/global/store.ts', ['DesignLibraryError', 'ensureGlobalDesignLibrary', 'getGlobalVersion', 'listGlobalDesigns', 'getGlobalRecord', 'saveGlobalDraft', 'publishGlobalDesign', 'retireGlobalDesign', 'selectBrandFamilies', 'hydrateBrandFamilies'], { INITIAL_GLOBAL_FAMILIES: seeds, ...types, ...study })
const generation = load('lib/designs/global/generation.ts', ['chooseBrandFamily', 'globalLayoutPlan', 'renderGlobalPost'], { ...compose, ...store, ...study, ...validate })
const auth = load('lib/designs/global/admin.ts', ['validAdminKey', 'adminSession', 'isDesignAdmin', 'requireDesignAdmin'], { ...crypto })

function memoryDb() {
  const tables = new Map()
  const get = (object, path) => path.split('.').reduce((v, key) => v?.[key], object)
  const set = (object, path, value) => { const keys = path.split('.'); const last = keys.pop(); let current = object; for (const key of keys) current = current[key] ||= {}; current[last] = structuredClone(value) }
  const matches = (doc, query) => Object.entries(query).every(([key, value]) => value && typeof value === 'object' && '$exists' in value ? (get(doc, key) !== undefined) === value.$exists : JSON.stringify(get(doc, key)) === JSON.stringify(value))
  return { tables, collection(name) {
    if (!tables.has(name)) tables.set(name, [])
    const list = tables.get(name)
    return {
      find: query => ({ toArray: async () => structuredClone(list.filter(doc => matches(doc, query))) }),
      findOne: async query => structuredClone(list.find(doc => matches(doc, query)) || null),
      insertOne: async doc => { if (list.some(d => d._id !== undefined && d._id === doc._id)) throw Object.assign(Error('Duplicate'), { code: 11000 }); list.push(structuredClone(doc)); return {} },
      updateOne: async (query, update, options = {}) => {
        let doc = list.find(doc => matches(doc, query)); const found = !!doc
        if (!doc && options.upsert) { doc = { ...query, ...structuredClone(update.$setOnInsert || {}) }; list.push(doc) }
        if (!doc) return { matchedCount: 0 }
        for (const [key, value] of Object.entries(update.$set || {})) set(doc, key, value)
        for (const [key, value] of Object.entries(update.$inc || {})) set(doc, key, (get(doc, key) || 0) + value)
        return { matchedCount: found ? 1 : 0 }
      },
    }
  } }
}

test('six references form three valid semantic families with no baked reference imagery or text', () => {
  assert.equal(seeds.length, 3)
  for (const family of seeds) {
    types.familySchema.parse(family)
    assert.equal(family.referenceImages.length, 2)
    assert.deepEqual([family.width, family.height], [1080, 1350])
    for (const variant of family.variants) for (const node of variant.nodes) {
      if (node.type === 'image') assert.ok(['{{image.primary}}', '{{brand.logo}}'].includes(node.src))
      if (node.type === 'text') assert.match(node.text, /\{\{[^}]+\}\}/)
    }
  }
  assert.throws(() => types.familySchema.parse({ ...seeds[0], referenceImages: [] }))
  assert.doesNotThrow(() => types.familySchema.parse({ ...seeds[0], referenceImages: seeds[0].referenceImages.slice(0, 1) }))
  assert.throws(() => types.variantSchema.parse({ ...seeds[1].variants[0], nodes: [{ ...seeds[1].variants[0].nodes[0], color: '#E5B52A' }] }))
})

test('reference reconstructions preview in each brand identity without changing their geometry', () => {
  const family = seeds[1], variant = family.variants[0], original = JSON.stringify(family)
  const a = resolve.resolveVariant(family, variant, { colors: ['#e03020', '#ffffff', '#ffcc00'], fonts: ['Oswald', 'Inter'] }, { headline: 'Build better habits', cta: 'Read more' })
  const b = resolve.resolveVariant(family, variant, { colors: ['#123456', '#ffeecc', '#0077aa'], fonts: ['Montserrat', 'Roboto'] }, { headline: 'Build better habits', cta: 'Read more' })
  const headingA = a.nodes.find(n => n.id === 'headline'), headingB = b.nodes.find(n => n.id === 'headline')
  for (const key of ['x', 'y', 'width', 'height']) assert.equal(headingA[key], headingB[key])
  assert.equal(headingA.fontFamily, 'Oswald'); assert.equal(headingB.fontFamily, 'Montserrat')
  assert.notDeepEqual(a.classes, b.classes)
  assert.equal(JSON.stringify(family), original)
})

test('carousels compose varied layouts from one study and produce normal editable Canvas nodes', () => {
  const family = seeds[1], copy = { format: 'carousel', slides: [{ headline: 'A better beginning', body: 'One clear step.' }, { headline: 'Small steps', purpose: 'steps', body: '1. Decide\n2. Begin\n3. Repeat' }, { headline: 'Consistency wins', body: 'Protect one habit every day and let it compound.' }, { headline: 'Start today', body: 'Make the next step count.', cta: 'Learn more' }] }
  const canvas = generation.renderGlobalPost(family, { id: 'brand', name: 'Brand' }, copy, { slots: [] }, { id: 'global-' + family.id }, crypto.randomUUID)
  const compositions = canvas.pages.map(p => p.globalComposition)
  assert.ok(compositions.every(c => study.familyGrammar(family).compositions.includes(c)), 'every composition comes from the study grammar')
  assert.ok(new Set(compositions).size >= 3, `layouts vary: ${compositions}`)
  assert.equal(compositions[1], 'list'); assert.equal(compositions[3], 'closing')
  assert.ok(!canvas.pages.some(p => 'globalVariantId' in p), 'no template route is recorded')
  assert.equal(canvas.height, 1350)
  assert.equal(new Set(canvas.pages.flatMap(p => p.nodes.map(n => n.id))).size, canvas.pages.reduce((n, p) => n + p.nodes.length, 0))
  assert.ok(canvas.pages.every(p => p.nodes.some(n => n.type === 'text' && n.designRole === 'headline')))
  assert.equal(canvas.designSelection.globalFamilyId, family.id)
  assert.equal(canvas.designInput.resolvedPlan.layoutPlan.source, 'global')
})

test('photo slots require resolved assets, preserve crop/overlay, and never use reference screenshots', () => {
  const family = seeds[2], variant = family.variants[0]
  assert.throws(() => resolve.resolveVariant(family, variant, {}, { headline: 'Escape the routine' }), /needs a photograph/)
  const canvas = resolve.resolveVariant(family, variant, {}, { headline: 'Escape the routine' }, 0, '/api/uploads/new-photo')
  const photo = canvas.nodes.find(n => n.id === 'photo')
  assert.equal(photo.src, '/api/uploads/new-photo'); assert.equal(photo.height, 1350)
  assert.ok(canvas.nodes.some(n => n.type === 'gradient'))
  assert.ok(!JSON.stringify(canvas).includes('/design-references/'))
})

test('text overflow fails clearly rather than rearranging the design or deleting copy', () => {
  const portuguese = resolve.resolveVariant(seeds[2], seeds[2].variants[0], {}, { headline: 'Teste simples pode dobrar o desempenho dos anúncios', body: 'Descubra o passo a passo para otimizar seu ROI' }, 0, '/photo.jpg')
  const fitted = portuguese.nodes.find(node => node.id === 'headline')
  assert.equal(fitted.text, 'Teste simples pode dobrar o desempenho dos anúncios')
  assert.ok(fitted.fontSize < seeds[2].variants[0].nodes.find(node => node.id === 'headline').minFontSize)
  assert.ok(fitted.fontSize >= 14)
  assert.throws(() => resolve.resolveVariant(seeds[1], seeds[1].variants[1], {}, { headline: 'Test', body: 'Very long body. '.repeat(400) }), /too long/)
})

test('composed copy shrinks within readable limits and fails clearly instead of cutting text', () => {
  const family = seeds[1]
  const plan = compose.planSlides(family, { format: 'single', headline: 'x' })[0]
  const long = compose.composeSlide(family, {}, { headline: 'Teste simples pode dobrar o desempenho dos anúncios do seu negócio local', body: 'Descubra o passo a passo para otimizar o seu retorno.' }, plan, 0, 1)
  const headline = long.nodes.find(n => n.designRole === 'headline')
  assert.equal(headline.text.replace(/<%kind:[^:]+:([^%]+)%>/g, '$1'), 'Teste simples pode dobrar o desempenho dos anúncios do seu negócio local', 'complete copy, only styled')
  assert.ok(headline.fontSize >= 34)
  assert.throws(() => compose.composeSlide(family, {}, { headline: 'Test', body: 'Very long body. '.repeat(400) }, plan, 0, 1), /too long/)
})

test('publishing is versioned, stale edits conflict, and unpublishing preserves imports', async () => {
  const db = memoryDb()
  await store.ensureGlobalDesignLibrary(db); await store.ensureGlobalDesignLibrary(db)
  assert.equal((await store.listGlobalDesigns(db)).length, 3)
  const first = await store.getGlobalRecord(db, seeds[1].id)
  const saved = await store.saveGlobalDraft(db, { ...first.draft, name: 'Reviewed name' }, first.revision)
  await assert.rejects(store.saveGlobalDraft(db, first.draft, first.revision), /changed/)
  assert.equal((await store.getGlobalVersion(db, first.id, seeds[1].version)).name, seeds[1].name)
  const published = await store.publishGlobalDesign(db, first.id, saved.revision)
  assert.equal((await store.getGlobalVersion(db, first.id, published.publishedVersion)).name, 'Reviewed name')
  await store.retireGlobalDesign(db, first.id, published.revision)
  assert.equal((await store.listGlobalDesigns(db)).length, 2)
  assert.equal((await store.getGlobalVersion(db, first.id, seeds[1].version)).name, seeds[1].name)
})

test('brand selection keeps one or more distinct published families, stores references only, and survives a reload', async () => {
  const db = memoryDb(); await store.ensureGlobalDesignLibrary(db)
  await db.collection('flows').insertOne({ id: 'brand', brandContext: { colors: ['#123456'], designs: [{ id: 'legacy', baseId: 'editorial' }] } })
  // A single selected study is saved, and reading the brand back returns it (the page reload path).
  const single = await store.selectBrandFamilies(db, 'brand', [seeds[0].id, seeds[0].id])
  assert.deepEqual(single.brandContext.designs.filter(d => d.source === 'global').map(d => d.globalFamilyId), [seeds[0].id])
  const reloaded = await db.collection('flows').findOne({ id: 'brand' })
  assert.deepEqual((await store.hydrateBrandFamilies(db, reloaded.brandContext)).map(item => item.family.id), [seeds[0].id])
  const one = await generation.chooseBrandFamily(db, { ...reloaded.brandContext, id: 'brand' }, { headline: 'Hello' })
  assert.equal(one.family.id, seeds[0].id, 'generation uses the one selected design')
  const result = await store.selectBrandFamilies(db, 'brand', seeds.map(f => f.id))
  assert.equal(result.brandContext.designs.length, 4)
  for (const design of result.brandContext.designs.filter(d => d.source === 'global')) { assert.equal(design.globalVersion, seeds[0].version); assert.equal(design.nodes, undefined); assert.equal(design.blueprint, undefined) }
  const selected = await generation.chooseBrandFamily(db, { ...result.brandContext, id: 'brand' }, { headline: 'A new beginning' })
  assert.ok(seeds.some(f => f.id === selected.family.id))
  assert.equal(await generation.chooseBrandFamily(db, { id: 'empty', designs: [] }, {}), null)
  // Clearing the selection returns the brand to its starter designs.
  const cleared = await store.selectBrandFamilies(db, 'brand', [])
  assert.deepEqual(cleared.brandContext.designs.map(d => d.id), ['legacy'])
  assert.equal(await generation.chooseBrandFamily(db, { ...cleared.brandContext, id: 'brand' }, {}), null)
  await assert.rejects(store.selectBrandFamilies(db, 'brand', Array.from({ length: 25 }, (_, i) => `f-${i}`)), /up to 24/)
})

test('admin sessions require the configured key, expire, and reject cross-origin writes', () => {
  const previous = process.env.GLOBAL_DESIGN_ADMIN_KEY
  process.env.GLOBAL_DESIGN_ADMIN_KEY = 'test-only-admin-key'
  try {
    assert.equal(auth.validAdminKey('wrong'), false)
    assert.equal(auth.validAdminKey('test-only-admin-key'), true)
    const cookie = 'kand-design-admin=' + auth.adminSession()
    assert.equal(auth.isDesignAdmin(new Request('http://localhost/api/global-designs', { headers: { cookie } })), true)
    assert.throws(() => auth.requireDesignAdmin(new Request('http://localhost/api/global-designs', { headers: { cookie, origin: 'http://elsewhere.test' } })), /origin/)
    assert.equal(auth.isDesignAdmin(new Request('http://localhost/api/global-designs', { headers: { cookie: 'kand-design-admin=0.fake' } })), false)
  } finally { if (previous === undefined) delete process.env.GLOBAL_DESIGN_ADMIN_KEY; else process.env.GLOBAL_DESIGN_ADMIN_KEY = previous }
})

const STUDY = { personality: 'Calm editorial', composition: 'Headline dominates the upper half', spaceDensity: 'Generous margins', typography: 'Heavy headline, body about a third of its size', colorContrast: 'Light surface with a bright accent highlight on #ffe05b', colorRoles: { background: 'light brand background', foreground: 'dark text', accent: 'bright accent', decoration: 'low-opacity secondary' }, imagery: { mode: 'none', usage: 'Typography only' }, decorative: 'Fine rules', hierarchy: 'Headline, body, CTA', logoPlacement: 'Small anchor top-left', distinctive: ['Highlighted keyword'], familyRules: ['Left aligned text'], variantRules: [], avoid: ['Photography'] }
const resetVisionBudget = () => { delete globalThis[Symbol.for('kand.vision.input-budget.v2')] }
function analyzerWith(handler) {
  resetVisionBudget()
  return load('lib/designs/global/analyze.ts', ['analyzeDesignReferences', 'normalizeReferenceVariant'], {
    ...types, z, ...study,
    Groq: class {}, sharp: () => ({ rotate() { return this }, resize() { return this }, jpeg() { return this }, async toBuffer() { return Buffer.from('image') } }),
    readFile: async () => Buffer.from('reference'), join: require('node:path').join, randomUUID: crypto.randomUUID,
    retrySeconds: () => 1, budgetedCompletion: handler,
    // Pixel measurement needs real images; these tests use a fake sharp, so it is skipped here and tested separately.
    measureReference: async () => null, applyReferenceMetrics: study => study,
  })
}
const studyResponse = (request, overrides = {}) => {
  const count = Number(request.messages[0].content.match(/exactly (\d+) reconstructions/)?.[1] || 0)
  return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ name: 'Golden Editorial', description: 'Measured typography and highlights.', tags: ['editorial'], typography: { headingFallback: 'DM Sans', bodyFallback: 'Inter' }, referenceStyle: { primary: '#ffffff', secondary: '#111111', accent: '#ffe05b', background: '#ffffff', textPrimary: '#111111' }, study: STUDY, variants: Array.from({ length: count }, () => ({ observations: 'Headline at x 108 y 360 width 860 height 640.', ...seeds[1].variants[1], imageMode: 'none', nodes: seeds[1].variants[1].nodes.map(n => ({ ...n, x: String(n.x), fontSize: n.fontSize ? `${n.fontSize}px` : undefined })) })), ...overrides }) } }] }
}

test('design study makes one multimodal call per batch, persists a structured brand-agnostic study and never resends images', async () => {
  const calls = []
  const oldKey = process.env.GROQ_API_KEY
  process.env.GROQ_API_KEY = 'test-only'
  const analyzer = analyzerWith(async (_client, request) => { calls.push(request); return studyResponse(request) })
  try {
    const references = seeds.flatMap(f => f.referenceImages).slice(0, 5)
    const family = await analyzer.analyzeDesignReferences({}, { referenceImages: references })
    assert.equal(family.referenceImages.length, 5); assert.equal(family.variants.length, 5)
    assert.equal(calls.length, 3, 'two references per call fit the default 7000-token limit at ~1,800 tokens per image')
    assert.equal(calls.reduce((n, c) => n + c.messages[1].content.filter(item => item.type === 'image_url').length, 0), 5, 'each reference is sent exactly once')
    assert.match(calls[1].messages[1].content[0].text, /Study so far/)
    assert.equal(family.name, 'Golden Editorial')
    assert.equal(family.study.imagery.mode, 'none')
    assert.ok(family.variants.every(v => v.imageMode === 'none'))
    assert.ok(!JSON.stringify(family.study).includes('#ffe05b'), 'literal reference colors are removed from the study')
    assert.deepEqual(family.variants.map(v => v.id), ['reference-1', 'reference-2', 'reference-3', 'reference-4', 'reference-5'], 'references are kept as reconstructions, not routes')
    assert.ok(family.variants.every(v => !/cover|content/.test(v.id)))
    assert.ok(types.grammarSchema.safeParse(family.study.grammar).success, 'the study stores a complete grammar')
    assert.match(calls[0].messages[0].content, /grammar, not a template/)
    assert.equal(typeof family.variants[0].nodes[0].x, 'number')
  } finally { if (oldKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldKey }
})

test('invalid study output gets one text-only repair without the reference images', async () => {
  const calls = []
  const oldKey = process.env.GROQ_API_KEY
  process.env.GROQ_API_KEY = 'test-only'
  const analyzer = analyzerWith(async (_client, request) => { calls.push(request); return calls.length === 1 ? studyResponse(request, { study: { ...STUDY, imagery: undefined } }) : studyResponse(request) })
  try {
    const family = await analyzer.analyzeDesignReferences({}, { referenceImages: seeds[0].referenceImages })
    assert.equal(calls.length, 2)
    assert.equal(typeof calls[1].messages[1].content, 'string')
    assert.ok(!calls[1].messages[1].content.includes('data:image'))
    assert.ok(!calls[1].messages[1].content.includes('"nodes"'), 'reconstructions are not resent in the repair')
    assert.ok(calls[1].messages[0].content.length + calls[1].messages[1].content.length < calls[0].messages[0].content.length * 1.5, 'the repair is a small request')
    assert.equal(family.study.imagery.mode, 'none')
    assert.equal(family.variants.length, 2, 'reconstructions from the first answer are kept')
  } finally { if (oldKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldKey }
})

// Measured on qwen/qwen3.8-27b: ~1,800 input tokens per image regardless of size; instructions ~4 characters per token.
const IMAGE_TOKENS = 1800
const estimateInput = request => request.messages.reduce((n, m) => n + (typeof m.content === 'string' ? Math.ceil(m.content.length / 3.5) : m.content.reduce((t, item) => t + (item.type === 'text' ? Math.ceil(item.text.length / 3.5) : IMAGE_TOKENS + 12), 0)), 0)
const imagesIn = request => request.messages[1].content.filter(item => item.type === 'image_url').length
const studyAnalyzer = (budgetedCompletion, sides = []) => load('lib/designs/global/analyze.ts', ['analyzeDesignReferences'], {
  ...types, z, ...study, Groq: class {}, readFile: async () => Buffer.from('reference'), join: require('node:path').join, randomUUID: crypto.randomUUID, retrySeconds: () => 1,
  sharp: () => ({ rotate() { return this }, resize(o) { sides.push(o.width); return this }, jpeg() { return this }, async toBuffer() { return Buffer.from('image') } }),
  budgetedCompletion, measureReference: async () => null, applyReferenceMetrics: study => study,
})

test('study requests fit the input-token limit by batching references, and images keep full quality', async () => {
  const calls = [], sides = []
  const oldKey = process.env.GROQ_API_KEY, oldLimit = process.env.GROQ_DESIGN_VISION_INPUT_LIMIT
  process.env.GROQ_API_KEY = 'test-only'; process.env.GROQ_DESIGN_VISION_INPUT_LIMIT = '7000'
  resetVisionBudget()
  const analyzer = studyAnalyzer(async (_client, request) => { calls.push(request); return studyResponse(request) }, sides)
  try {
    const references = seeds.flatMap(f => f.referenceImages).slice(0, 5)
    const family = await analyzer.analyzeDesignReferences({}, { referenceImages: references })
    assert.equal(family.referenceImages.length, 5)
    assert.equal(calls.reduce((n, c) => n + imagesIn(c), 0), 5, 'every reference is studied exactly once')
    assert.ok(calls.every(c => imagesIn(c) <= 2), 'three images would exceed 7000 tokens, so at most two share a request')
    assert.ok(calls.every(c => estimateInput(c) <= 7000 * .95), 'each request fits the limit')
    assert.ok(sides.every(side => side === 1350), 'images are not downscaled: it would cost the same and lose detail')
  } finally {
    resetVisionBudget()
    if (oldKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldKey
    if (oldLimit === undefined) delete process.env.GROQ_DESIGN_VISION_INPUT_LIMIT; else process.env.GROQ_DESIGN_VISION_INPUT_LIMIT = oldLimit
  }
})

test('a "request too large" answer teaches the real limit, retries once with fewer references, and never inflates without bound', async () => {
  const calls = []
  const oldKey = process.env.GROQ_API_KEY
  process.env.GROQ_API_KEY = 'test-only'
  resetVisionBudget()
  const analyzer = studyAnalyzer(async (_client, request) => {
    calls.push(request)
    // The exact rejection reported for qwen/qwen3.8-27b on the on_demand tier.
    if (calls.length === 1) throw Object.assign(new Error('too large'), { status: 413, limitTokens: 7000, requestedTokens: 7850 })
    return { ...studyResponse(request), usage: { prompt_tokens: 3500 } }
  })
  try {
    const family = await analyzer.analyzeDesignReferences({}, { referenceImages: seeds[0].referenceImages })
    assert.ok(family.study)
    assert.ok(imagesIn(calls[1]) < imagesIn(calls[0]), 'the retry carries fewer references')
    // A huge reported size is capped: one reference must still fit afterwards instead of failing every study.
    resetVisionBudget()
    let first = true
    const recovering = studyAnalyzer(async (_client, request) => {
      if (first) { first = false; throw Object.assign(new Error('too large'), { status: 413, limitTokens: 7000, requestedTokens: 60000 }) }
      return studyResponse(request)
    })
    assert.ok((await recovering.analyzeDesignReferences({}, { referenceImages: seeds[0].referenceImages })).study)
    // A second rejection is not retried again.
    const stubborn = studyAnalyzer(async () => { throw Object.assign(new Error('The request is larger than your Groq plan allows'), { status: 413, limitTokens: 7000, requestedTokens: 7100 }) })
    await assert.rejects(stubborn.analyzeDesignReferences({}, { referenceImages: seeds[0].referenceImages }), /larger than your Groq plan allows/)
  } finally { resetVisionBudget(); if (oldKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldKey }
})

test('a single reference becomes a complete study that composes a whole carousel', async () => {
  const calls = []
  const oldKey = process.env.GROQ_API_KEY
  process.env.GROQ_API_KEY = 'test-only'
  const analyzer = analyzerWith(async (_client, request) => { calls.push(request); return studyResponse(request) })
  try {
    const family = await analyzer.analyzeDesignReferences({}, { referenceImages: seeds[0].referenceImages.slice(0, 1) })
    assert.equal(calls.length, 1)
    assert.match(calls[0].messages[0].content, /exactly 1 reconstructions/)
    assert.equal(family.referenceImages.length, 1); assert.equal(family.variants.length, 1)
    const copy = { format: 'carousel', slides: [{ headline: 'Start here', body: 'A short teaser.' }, { headline: 'Why it matters', body: 'Consistency compounds over months.' }, { headline: 'Begin today', body: 'One step is enough.', cta: 'Go' }] }
    const canvas = generation.renderGlobalPost(family, { id: 'b', name: 'Brand' }, copy, { slots: [] }, { id: 'global-' + family.id }, crypto.randomUUID)
    assert.equal(canvas.pages.length, 3)
  } finally { if (oldKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldKey }
})

test('an unusable reconstruction is dropped without discarding the study', async () => {
  const oldKey = process.env.GROQ_API_KEY
  process.env.GROQ_API_KEY = 'test-only'
  const broken = { observations: 'x', name: 'List', role: 'list', background: 'brand.background', nodes: [{ id: 'a', type: 'text', text: '{{step.1}}', x: 900, y: 0, width: 600, height: 40, fontSize: 30, fontFamily: 'brand.bodyFont', color: 'brand.textPrimary' }] }
  const analyzer = analyzerWith(async (_client, request) => { const response = studyResponse(request); const body = JSON.parse(response.choices[0].message.content); body.variants[1] = broken; response.choices[0].message.content = JSON.stringify(body); return response })
  try {
    const family = await analyzer.analyzeDesignReferences({}, { referenceImages: seeds[0].referenceImages })
    assert.deepEqual(family.variants.map(v => v.id), ['reference-1'])
    assert.ok(family.study.grammar)
  } finally { if (oldKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldKey }
})

test('list references reconstructed without headline or CTA slots are bound instead of failing the study', () => {
  const { assignMissingSlots } = load('lib/designs/global/analyze.ts', ['assignMissingSlots'], { ...types, z })
  const style = { type: 'text', fontFamily: 'brand.bodyFont', color: 'brand.textPrimary', height: 40, width: 700, x: 120 }
  const list = { id: 'content-1', name: 'List', role: 'list', background: 'brand.background', nodes: [
    ...[1, 2, 3, 4].map(i => ({ ...style, id: `step-${i}`, text: `{{step.${i}}}`, y: 300 + i * 60, fontSize: 24 })),
    { ...style, id: 'note', text: 'Original reference sentence', y: 700, fontSize: 22, height: 120 },
  ] }
  const slotted = types.variantSchema.parse(assignMissingSlots(list, 'list', 1080, 1350))
  const text = slotted.nodes.map(n => n.text || '').join(' ')
  for (const slot of ['headline', 'body', 'cta', 'step.1', 'step.4']) assert.ok(text.includes(`{{${slot}}}`), slot)
  assert.ok(!text.includes('Original reference sentence'))
  assert.ok(slotted.nodes.every(n => n.y >= 0 && n.y + n.height <= 1350))
  const cover = assignMissingSlots({ ...list, nodes: [{ ...style, id: 'title', text: 'Big words', y: 200, fontSize: 90 }, { ...style, id: 'small', text: 'tiny', y: 400, fontSize: 20 }] }, 'cover', 1080, 1350)
  assert.equal(cover.nodes.find(n => n.id === 'title').text, '{{headline}}')
  assert.equal(cover.nodes.find(n => n.id === 'small').text, 'tiny', 'covers are not forced to carry body or CTA')
})

test('dense reference patterns expand into editable shapes without losing size progression or opacity', () => {
  const { expandReferencePatterns } = load('lib/designs/global/analyze.ts', ['expandReferencePatterns'], { ...types, z })
  const value = { ...seeds[0].variants[0], nodes: [seeds[1].variants[0].nodes.find(n => n.id === 'headline')], patterns: [{ id: 'diamonds', shape: 'rect', x: 10, y: 10, rows: 40, columns: 25, stepX: 40, stepY: 32, size: 16, endSize: 2, rotation: 45, fill: 'brand.secondary', fillAlpha: 18 }] }
  const expanded = types.variantSchema.parse(expandReferencePatterns(value))
  assert.equal(expanded.nodes.length, 1001)
  assert.equal(expanded.nodes[0].width, 16)
  assert.equal(expanded.nodes[999].width, 2)
  assert.equal(expanded.nodes[999].fillAlpha, 18)
  assert.equal(expanded.nodes.at(-1).id, 'headline')
  assert.throws(() => expandReferencePatterns({ ...value, patterns: [{ ...value.patterns[0], rows: 60, columns: 60 }] }), /1600/)
})

module.exports = { load, seeds, resolve, types, store, generation, study, compose }
