const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { load, seeds, types, generation, study, compose } = require('./globalDesigns.test.cjs')

const validate = load('lib/designs/global/validate.ts', ['validatePost', 'validatePage'])
const noImage = seeds[1], background = seeds[2]
const STUDY = { personality: 'p', composition: 'c', spaceDensity: 's', typography: 't', colorContrast: 'cc', colorRoles: {}, imagery: { mode: 'background', usage: 'Photos fill the canvas.', cropBehavior: 'Edge-to-edge crops.' }, decorative: 'd', hierarchy: 'h', logoPlacement: 'Small top-left anchor', distinctive: [], familyRules: [], variantRules: [], avoid: [] }
const SUPPORTED = new Set(['text', 'shape', 'image', 'gradient'])

const photoHelpers = load('lib/services/postImages.ts', ['loadPostImages', 'postImageIds', 'uploadPlanningBlock', 'assignUploads', 'ideaForCopy'], { hydrateBrandFamilies: async () => [], familyImagery: study.familyImagery })
class DesignLibraryError extends Error { constructor(message, status) { super(message); this.status = status } }
function planner(writeCopy, planAssets, overrides = {}) {
  const nodeRes = { json: (body, init) => ({ body, status: init?.status || 200 }) }
  return load('lib/handlers/postPlanHandler.ts', ['handlePlanPost', 'designPlanningPrompt', 'sanitizeDesignPlan', 'varyCover'], {
    NextResponse: nodeRes, corsify: r => r,
    loadGenerationBrandContext: async (_db, body) => ({ id: 'brand', name: 'Brand', ...body.brandContext }),
    chooseBrandFamily: async (_db, brand) => brand.family ? { family: brand.family, design: { id: 'global-' + brand.family.id } } : null,
    studyForPlanning: study.studyForPlanning, familyGrammar: study.familyGrammar, familyImagery: study.familyImagery, familyCutouts: study.familyCutouts, familyPhotoLed: study.familyPhotoLed,
    writeCopy, copyErrorResponse: (error) => ({ body: { error: error.message }, status: error.status || 500 }), planAssets,
    ...photoHelpers, listItems: compose.listItems, DesignLibraryError,
    ...overrides,
  })
}

test('a design picked in the post settings builds the post, and one removed from the brand since falls back to Auto', async () => {
  const asked = [], planned = [], briefs = []
  const chooseBrandFamily = async (_db, _brand, _content, designId) => {
    asked.push(designId)
    if (designId === 'global-removed') throw new DesignLibraryError('This design is not in the brand’s library.', 404)
    return { family: noImage, design: { id: designId || 'global-auto' } }
  }
  const writeCopy = async (_brand, brief) => {
    briefs.push(brief)
    return { copy: { format: 'single', headline: 'Start strong', supportingText: 'One step at a time.', design: { composition: 'statement', image: null } } }
  }
  const planAssets = async (_db, { designId }) => { planned.push(designId); return { layoutPlan: { imageMode: 'none' }, designId, slots: [] } }
  const { handlePlanPost } = planner(writeCopy, planAssets, { chooseBrandFamily })

  const picked = await handlePlanPost({}, { idea: { topic: 'Habits', format: 'single', designId: 'global-picked' }, brandContext: {} })
  assert.equal(picked.status, 200)
  assert.deepEqual(asked, ['global-picked'])
  assert.equal(planned[0], 'global-picked', 'the post is planned with the picked design')
  assert.equal(briefs[0].designId, undefined, 'the copywriter brief carries no design id')

  asked.length = 0
  const removed = await handlePlanPost({}, { idea: { topic: 'Habits', format: 'single', designId: 'global-removed' }, brandContext: {} })
  assert.equal(removed.status, 200, 'a removed design never fails the post')
  assert.deepEqual(asked, ['global-removed', undefined], 'it is retried on Auto')
  assert.equal(planned[1], 'global-auto')

  const explicit = await handlePlanPost({}, { idea: { topic: 'Habits' }, designId: 'global-removed', brandContext: {} })
  assert.equal(explicit.status, 404, 'a design asked for explicitly (Apply design) still reports that it is missing')
})
const derivedPlan = family => async (_db, { copy }) => {
  const layout = generation.globalLayoutPlan(family, 'global-' + family.id, copy)
  return { layoutPlan: layout, designId: layout.designId, slots: layout.slots.map(s => ({ slot_id: s.slot_id, needs_visual: s.needs_visual, treatment: s.treatment })) }
}

test('TEST A: a no-image study plans no image slots, so no asset search or generation is requested', async () => {
  assert.equal(study.familyImagery(noImage).mode, 'none')
  let copyCalls = 0
  const { handlePlanPost } = planner(async (_brand, _idea, design) => {
    copyCalls++
    assert.ok(!design.prompt.includes('data:image') && !design.prompt.includes('/design-references/'), 'reference images are never resent')
    assert.ok(!/"x":|"width":|variantId/.test(design.prompt), 'planning receives the study, not coordinates or template routes')
    assert.match(design.prompt, /recurringRules/)
    return { copy: { format: 'carousel', slides: [{ headline: 'Start strong', body: 'One step', design: { composition: 'statement', image: { subject: 'a person', queries: ['person'] } } }, { headline: 'Then keep going', body: 'Do it daily.', cta: 'Learn more', design: { composition: 'closing' } }] } }
  }, derivedPlan(noImage))
  const res = await handlePlanPost({}, { idea: { topic: 'Habits', format: 'carousel' }, brandContext: { family: noImage } })
  assert.equal(res.status, 200)
  assert.equal(copyCalls, 1, 'exactly one model call for copy + composition plan')
  assert.equal(res.body.needsVisuals, false)
  assert.equal(res.body.copy.slides[0].design.image, null, 'plan images are removed when the study uses no imagery')
  assert.equal(res.body.imageMode, 'none')
})

test('existing copy is re-planned with zero model calls', async () => {
  const { handlePlanPost } = planner(async () => { throw Error('should not be called') }, derivedPlan(noImage))
  const res = await handlePlanPost({}, { idea: { topic: 'x' }, copy: { format: 'single', headline: 'Hello world', supportingText: 'Body text', cta: 'Go' }, brandContext: { family: noImage } })
  assert.equal(res.status, 200)
})

test('TEST B: a background study requires imagery and keeps full-canvas photographs on every image slide', () => {
  assert.equal(study.familyImagery(background).mode, 'background')
  const plan = headline => generation.globalLayoutPlan(background, 'global-x', { format: 'single', headline, supportingText: 'Go somewhere quiet.', design: { image: { subject: 'quiet mountain lake', queries: ['mountain lake'] } } }).slots[0]
  const slots = Array.from({ length: 30 }, (_, i) => plan(`Escape ${i}`))
  assert.ok(slots.every(s => s.needs_visual && s.treatment === 'environmental' && s.background))
  assert.deepEqual(slots[0].frame, { x: 0, y: 0, width: 1080, height: 1350 })
  assert.deepEqual(slots[0].planned, { subject: 'quiet mountain lake', queries: ['mountain lake'] })
})

test('TEST C: a cutout study uses isolated-subject treatment and the transparent derivative', () => {
  const cutout = study.reconcileStudy({ ...background, study: { ...STUDY, imagery: { mode: 'cutout' } }, variants: background.variants.map(v => ({ ...v, nodes: v.nodes.map(n => n.src === '{{image.primary}}' ? { ...n, x: 540, width: 540, height: 900, y: 450 } : n) })) })
  types.familySchema.parse(cutout)
  assert.equal(cutout.study.imagery.mode, 'cutout')
  const copy = { format: 'single', headline: 'Escape the routine', supportingText: 'Go somewhere quiet.' }
  assert.equal(generation.globalLayoutPlan(cutout, 'global-x', copy).slots[0].treatment, 'isolated_subject')
  const canvas = generation.renderGlobalPost(cutout, { id: 'b' }, copy, { slots: [{ slot_id: 'single_main', resolvedAsset: { url: '/api/uploads/photo', subject: { url: '/api/uploads/cutout' } } }] }, { id: 'global-x' }, crypto.randomUUID)
  const image = canvas.nodes.find(n => n.type === 'image' && n.designRole === 'image')
  assert.equal(image.src, '/api/uploads/cutout'); assert.equal(image.objectFit, 'contain')
})

test('mixed imagery is a study property: some slides carry photos, others stay typographic, with no per-variant routing', () => {
  const mixed = study.reconcileStudy({ ...noImage, study: { ...STUDY, imagery: { mode: 'mixed' }, grammar: { ...study.familyGrammar(noImage), compositions: ['statement', 'stacked', 'split', 'list', 'closing'], imagery: { scale: 'large', positions: ['right', 'bottom'], shape: 'rounded', overlap: 'none', dominance: 'balanced', overlay: 'none', frequency: 'some' } } } })
  types.familySchema.parse(mixed)
  const copy = { format: 'carousel', slides: ['One', 'Two', 'Three', 'Four', 'Five'].map(h => ({ headline: `${h} idea here`, body: 'Supporting copy.' })) }
  const slots = generation.globalLayoutPlan(mixed, 'global-x', copy).slots
  const pattern = slots.map(s => s.needs_visual)
  assert.ok(pattern.includes(true) && pattern.includes(false), `frequency "some" mixes slides: ${pattern}`)
  assert.equal(pattern.at(-1), false, 'the closing beat stays typographic')
  assert.ok(slots.filter(s => s.needs_visual).every(s => ['stacked', 'split'].includes(s.composition)))
})

test('TEST D: one study, three brands: same design language, each brand identity, no reference leakage', () => {
  const family = background
  const brands = [
    { id: 'a', name: 'Brand A', colors: ['#000000', '#222222', '#ffd400'], fonts: ['Anton', 'Inter'], logo: '/api/uploads/logo-a' },
    { id: 'b', name: 'Brand B', designTokens: { primary: '#0a1f44', accent: '#00c2ff', background: '#f4f8ff' }, fonts: ['Poppins', 'Poppins'], logo: '/api/uploads/logo-b' },
    { id: 'c', name: 'Brand C', colors: ['#f5ecd7', '#d62828', '#d62828'], fonts: ['Bebas Neue', 'Arial'] },
  ]
  const copy = { format: 'carousel', slides: [{ headline: 'Reduce project risk', body: 'Five ways BIM helps.' }, { headline: 'Clash detection', body: 'Find conflicts before they reach site.' }, { headline: 'Ready to start?', body: 'Talk to our team.', cta: 'Book a call' }] }
  const resolved = { slots: copy.slides.map((_, i) => ({ slot_id: `slide_${i + 1}`, resolvedAsset: { url: `/api/uploads/photo-${i}` } })) }
  const posts = brands.map(brand => generation.renderGlobalPost(family, brand, copy, resolved, { id: 'global-' + family.id }, crypto.randomUUID))
  const language = p => p.pages.map(page => [page.globalComposition, ...page.nodes.filter(n => n.designRole === 'image' || n.designRole === 'overlay').map(n => [n.x, n.y, n.width, n.height].join())].join('|'))
  assert.deepEqual(language(posts[0]), language(posts[1]), 'same compositions and imagery behaviour for every brand')
  assert.deepEqual(language(posts[1]), language(posts[2]))
  posts.forEach((post, i) => {
    const json = JSON.stringify(post.pages)
    const fonts = new Set(post.pages.flatMap(p => p.nodes.filter(n => n.type === 'text').map(n => n.fontFamily)))
    for (const font of fonts) assert.ok(brands[i].fonts.includes(font), `${font} must be a ${brands[i].name} font`)
    assert.ok(!json.includes(family.typography.headingFallback), 'reference font is never forced on a brand')
    for (const color of Object.values(family.referenceStyle || {})) assert.ok(!json.toLowerCase().includes(String(color).toLowerCase()))
    assert.ok(!json.includes('/design-references/'), 'no reference assets')
    for (const other of brands.filter((_, j) => j !== i)) if (other.logo) assert.ok(!json.includes(other.logo))
    if (brands[i].logo) assert.ok(post.pages.every(p => p.nodes.some(n => n.designRole === 'logo' && n.src === brands[i].logo)), 'logo where the study places branding')
    assert.ok(post.pages.every(p => p.nodes.every(n => SUPPORTED.has(n.type) && n.id)), 'editable Canvas nodes')
    assert.equal(post.validation.passed, true)
  })
  assert.ok(!JSON.stringify(posts[2].pages).includes('/api/uploads/logo'), 'brand without a logo gets no logo')
})

test('composition plan is validated in code: unknown compositions, wrong images and absent headline words are dropped', () => {
  const { sanitizeDesignPlan } = planner(async () => ({}), async () => ({}))
  const plan = sanitizeDesignPlan(noImage, { format: 'single', headline: 'Build better habits', design: { composition: 'made-up', variantId: 'cover', emphasis: ['better', 'missing'], image: { subject: 'x', queries: ['x'] } } })
  assert.deepEqual(plan.design, { image: null })
  assert.deepEqual(plan.emphasis, ['better'])
  const planned = sanitizeDesignPlan(noImage, { format: 'single', headline: 'Build habits', supportingText: 'b', design: { composition: 'stacked' } })
  assert.equal(compose.planSlides(noImage, planned)[0].composition, 'stacked')
})

test('programmatic validation corrects small drift and contrast, and rejects real overflow or unsupported nodes', () => {
  const page = { background: '#ffffff', nodes: [
    { id: 'a', type: 'text', x: -10, y: 20, width: 300, height: 60, fontSize: 10, color: '#fefefe', text: 'x' },
    { id: 'b', type: 'video', x: 0, y: 0, width: 10, height: 10 },
  ] }
  const report = validate.validatePage(page, 1080, 1350)
  assert.equal(page.nodes[0].x, 0); assert.equal(page.nodes[0].fontSize, 14); assert.equal(page.nodes[0].color, '#101010')
  assert.equal(report.passed, false); assert.match(report.errors[0], /unsupported/)
  const overflow = validate.validatePage({ background: '#000000', nodes: [{ id: 'c', type: 'text', x: 900, y: 0, width: 600, height: 50, fontSize: 30, color: '#ffffff' }] }, 1080, 1350)
  assert.equal(overflow.passed, false)
})

test('TEST E: generated posts are normal editable Canvas documents with independent nodes', () => {
  const canvas = generation.renderGlobalPost(noImage, { id: 'b', colors: ['#123456'] }, { format: 'single', headline: 'Make it count', supportingText: 'Small steps add up.', cta: 'Start' }, { slots: [] }, { id: 'global-' + noImage.id }, crypto.randomUUID)
  assert.equal(canvas.type, 'single')
  assert.ok(canvas.nodes.length > 1)
  assert.equal(new Set(canvas.nodes.map(n => n.id)).size, canvas.nodes.length)
  assert.ok(canvas.nodes.every(n => SUPPORTED.has(n.type) && n.designRole))
  assert.ok(!canvas.nodes.some(n => n.type === 'image' && n.width === canvas.width && n.height === canvas.height), 'not a flattened image')
})

// A study shaped like a dark fintech reference: dark field, bright selective accent, oversized background type,
// imagery that may anchor the lower composition. Reference colors are recorded only as preview metadata.
const darkAccent = () => study.reconcileStudy(types.familySchema.parse({
  id: 'dark-accent', schemaVersion: 1, version: 1, name: 'Dark Accent', description: 'Dark field, selective accent.', tags: ['finance'], width: 1080, height: 1350,
  typography: { headingFallback: 'Inter', bodyFallback: 'Inter' }, referenceStyle: { primary: '#123b26', secondary: '#0b2a1a', accent: '#b6f23a', background: '#0b2a1a', textPrimary: '#ffffff' },
  referenceImages: [{ id: 'r1', url: '/api/uploads/ref-1', name: 'r1.png', width: 1080, height: 1350 }, { id: 'r2', url: '/api/uploads/ref-2', name: 'r2.png', width: 1080, height: 1350 }], analysis: '', variants: [],
  study: { ...STUDY, imagery: { mode: 'fullBleed', usage: 'A large image anchors the lower composition on some slides.' }, familyRules: ['Dark dominant surface', 'Accent on one phrase'], variantRules: ['Headline left or centred'], avoid: ['Tiny headline', 'Reference colors'],
    grammar: { compositions: ['statement', 'stacked', 'backdrop-type', 'list', 'closing'], headline: { scale: 'veryLarge', weight: 'black', case: 'uppercase', tracking: 'tight', leading: 'tight' }, body: { scale: 'medium' }, emphasis: 'color', alignment: ['center', 'left'], anchors: ['top', 'center'], margin: 'standard', density: 'balanced', surfaces: ['dark'],
      decorations: [{ kind: 'oversizedType', placement: 'behind', scale: 'oversized', opacity: 10, color: 'surfaceTone', frequency: 'some' }, { kind: 'arc', placement: 'edge', scale: 'oversized', opacity: 18, color: 'accent', frequency: 'every' }],
      imagery: { scale: 'large', positions: ['bottom'], shape: 'rect', overlap: 'edge', dominance: 'balanced', overlay: 'none', frequency: 'some' }, branding: { logo: 'top-left', slideNumber: 'top-right', handle: 'none' }, cta: 'pill' } },
}))

test('ACCEPTANCE: one studied design composes a varied, on-brand, editable carousel and is reusable by another brand', () => {
  const family = darkAccent()
  const copy = { format: 'carousel', slides: [
    { headline: 'And if your problem is not money?', body: 'Most small businesses lose time, not cash.' },
    { headline: 'Where the hours go', body: '1. Manual invoices\n2. Chasing late payments\n3. Reconciling accounts by hand' },
    { headline: 'Automate the boring parts', body: 'Payments, reminders and reconciliation run on their own.' },
    { headline: 'Your numbers, live', body: 'One dashboard for every payment.' },
    { headline: 'Get paid faster', body: 'Start free today.', cta: 'Start free' },
  ] }
  const brands = [
    { id: 'volt', name: 'Volt', designTokens: { primary: '#111111', accent: '#ffd400', background: '#ffffff' }, fonts: ['Anton', 'Inter'], logo: '/api/uploads/logo-volt' },
    { id: 'bloom', name: 'Bloom', designTokens: { primary: '#e8553f', accent: '#e8553f', background: '#fbf3e6', textPrimary: '#2b1d16' }, fonts: ['Playfair Display', 'Lato'] },
  ]
  const layout = generation.globalLayoutPlan(family, 'global-dark-accent', copy)
  // As the resolver returns them: cutout slots get AI-generated transparent PNGs, photo slots get stock photos.
  const resolved = { slots: layout.slots.map(s => ({ slot_id: s.slot_id, treatment: s.treatment, resolvedAsset: s.needs_visual ? { url: `/api/uploads/photo-${s.slot_id}`, source: s.treatment === 'isolated_subject' ? 'ai_generated' : 'pexels' } : null })) }
  const posts = brands.map(brand => generation.renderGlobalPost(family, brand, copy, resolved, { id: 'global-dark-accent' }, crypto.randomUUID))
  for (const [i, post] of posts.entries()) {
    const brand = brands[i], json = JSON.stringify(post.pages).toLowerCase()
    const compositions = post.pages.map(p => p.globalComposition)
    // 1–4: one family, not one template; layouts vary while the recurring language holds.
    assert.ok(new Set(compositions).size >= 3, `layouts vary: ${compositions}`)
    assert.ok(post.pages.some((p, j) => j && JSON.stringify(p.nodes.find(n => n.designRole === 'headline')) !== JSON.stringify(post.pages[0].nodes.find(n => n.designRole === 'headline'))))
    const headlines = post.pages.map(p => p.nodes.find(n => n.designRole === 'headline'))
    assert.equal(new Set(headlines.map(h => `${h.fontFamily}/${h.fontWeight}`)).size, 1, 'headline treatment recurs on every slide')
    const words = h => h.text.replace(/<%kind:[^:]+:([^%]+)%>/g, '$1')
    assert.ok(headlines.every(h => words(h) === words(h).toUpperCase()), 'uppercase headline rule recurs')
    assert.equal(new Set(post.pages.map(p => p.background)).size, 1, 'one dominant surface')
    assert.ok(post.pages.every(p => p.nodes.some(n => n.designRole === 'decoration')), 'decorative language recurs')
    // 5–7: current brand colors, fonts and logo; no reference colors.
    for (const ref of ['#123b26', '#0b2a1a', '#b6f23a']) assert.ok(!json.includes(ref), `reference color ${ref} leaked`)
    assert.ok(lightnessOf(post.pages[0].background) < .06, 'dark role maps to the brand dark')
    assert.ok(json.includes(brand.designTokens.accent.toLowerCase()), 'accent role maps to the brand accent')
    for (const font of new Set(post.pages.flatMap(p => p.nodes.filter(n => n.type === 'text').map(n => n.fontFamily)))) assert.ok(brand.fonts.includes(font))
    if (brand.logo) assert.ok(post.pages.every(p => p.nodes.some(n => n.designRole === 'logo' && n.src === brand.logo && n.x < 540 && n.y < 200)), 'logo top-left as studied')
    else assert.ok(post.pages.every(p => p.nodes.some(n => n.designRole === 'brand-name')))
    // 8: image behaviour follows the study (some slides, anchored to the lower band, never the closing beat).
    const imaged = post.pages.map(p => p.nodes.find(n => n.designRole === 'image'))
    assert.ok(imaged.some(Boolean) && imaged.some(n => !n), 'imagery on some slides only')
    assert.ok(imaged.filter(Boolean).every(n => n.y + n.height === 1350 && n.width === 1080), 'imagery bleeds along the lower edge')
    assert.equal(imaged.at(-1), undefined)
    // 10–12: editable, independent nodes; no flattened design.
    assert.ok(post.pages.every(p => p.nodes.every(n => SUPPORTED.has(n.type) && n.id)))
    assert.ok(post.pages.every(p => p.nodes.filter(n => n.type === 'text').length >= 2))
    assert.ok(!post.pages.some(p => p.nodes.some(n => n.type === 'image' && n.width === 1080 && n.height === 1350)))
    assert.equal(post.validation.passed, true)
    // 13: nothing in the post refers to template routes.
    assert.ok(!json.includes('variantid') && post.pages.every(p => !('globalVariantId' in p)))
  }
  // 14: the same stored study composes both brands identically in structure.
  assert.deepEqual(posts[0].pages.map(p => p.globalComposition), posts[1].pages.map(p => p.globalComposition))
  assert.notEqual(posts[0].pages[0].background, posts[1].pages[0].background)
})

test('a post opens with a different composition than the last post in its design, when the design allows one', async () => {
  const { varyCover } = planner(async () => ({}), async () => ({}))
  const momentum = seeds[0], highlight = seeds[1], photo = seeds[2]
  const single = { headline: 'Cover', body: 'One line.', design: { composition: 'statement', image: null } }
  assert.equal(varyCover(momentum, single, 'statement').design.composition, 'backdrop-type', 'a text cover moves to another text arrangement')
  assert.equal(varyCover(highlight, single, 'statement').design.composition, 'stacked')
  const carousel = { format: 'carousel', slides: [single, { headline: 'Two', design: { composition: 'statement', image: null } }] }
  const varied = varyCover(highlight, carousel, 'statement')
  assert.equal(varied.slides[0].design.composition, 'stacked')
  assert.equal(varied.slides[1].design.composition, 'statement', 'only the cover changes')
  assert.equal(varied.format, 'carousel')
  // Nothing to vary from, or already different: the copywriter's choice stands.
  assert.equal(varyCover(momentum, single, undefined), single)
  assert.equal(varyCover(momentum, single, 'list'), single)
  // A list cover keeps its list, and a cover showing the person's photo keeps its arrangement.
  const list = { headline: 'Steps', items: ['One', 'Two', 'Three'], design: { composition: 'statement', image: null } }
  assert.equal(varyCover(momentum, list, 'statement'), list)
  const upload = { headline: 'Ours', design: { composition: 'image-led', image: { upload: 'photo-1' } } }
  assert.equal(varyCover(photo, upload, 'image-led'), upload)
  // A design with no other cover arrangement keeps it.
  const pictured = { headline: 'Scene', design: { composition: 'image-led', image: { subject: 'a bridge', queries: [] } } }
  assert.equal(varyCover(photo, pictured, 'image-led'), pictured)
})

function lightnessOf(color) {
  const c = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722
}
