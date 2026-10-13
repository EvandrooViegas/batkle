const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { load, types, study, compose, store, resolve, seeds } = require('./globalDesigns.test.cjs')
const validate = load('lib/designs/global/validate.ts', ['validatePost', 'validatePage'])

// Real widths at 100px in em, measured in Chrome (canvas measureText) with the Google Fonts the renderer loads.
const MEASURED = [
  ['Anton', 'TRANSPARÊNCIA, QUALIDADE E RESPONSABILIDADE LEGAL', 20.52],
  ['Anton', 'BUILD WITH LESS RISK EVERY DETAIL CHECKED', 16.53],
  ['Anton', 'Transparência, qualidade e responsabilidade legal', 20.28],
  ['Bebas Neue', 'O ALVARÁ COMPROVA A NOSSA CAPACIDADE EM OBRAS GOVERNAMENTAIS', 21.51],
  ['Bebas Neue', 'Every detail checked before the work starts', 15.03],
  ['Oswald', 'BUILD WITH LESS RISK EVERY DETAIL CHECKED', 18.98],
  ['Inter', 'O ALVARÁ COMPROVA A NOSSA CAPACIDADE EM OBRAS GOVERNAMENTAIS', 38.67],
]

test('the width estimate never undercuts real text, and condensed capitals are no longer measured far too wide', () => {
  for (const [font, text, em] of MEASURED) {
    const real = em * 100
    assert.ok(resolve.countLines(text, 100, real - 1, font) >= 2, `${font}: "${text}" is estimated narrower than it renders`)
    // Anton capitals used to be estimated about 30% wide: four lines reserved for a two-line headline.
    assert.equal(resolve.countLines(text, 100, real * 1.2, font), 1, `${font}: "${text}" is estimated more than 20% wide`)
  }
  // Tight tracking narrows the estimate as it narrows the rendered text.
  const text = 'RESPONSABILIDADE LEGAL', width = 1000
  assert.ok(resolve.countLines(text, 120, width, 'Anton', -4) <= resolve.countLines(text, 120, width, 'Anton', 0))
})

test('unicode hyphens on slides become plain hyphens, so brand fonts without them show no boxes', () => {
  const family = study.reconcileStudy(seeds[1])
  const slide = { headline: 'Bem‑vindo à obra', body: 'Fale‐nos do seu projeto.', cta: 'Contacte‑nos' }
  const plan = compose.planSlides(family, { format: 'single', ...slide })[0]
  const page = compose.composeSlide(family, {}, slide, plan, 0, 1)
  const texts = page.nodes.filter(n => n.type === 'text').map(n => String(n.text))
  assert.ok(texts.some(t => t.includes('Contacte-nos')))
  assert.ok(texts.every(t => !/[‐‑]/.test(t)))
})

const STUDY = { personality: 'p', composition: 'c', spaceDensity: 's', typography: 't', colorContrast: 'cc', colorRoles: {}, decorative: 'd', hierarchy: 'h', logoPlacement: 'Small top-left anchor', distinctive: [], familyRules: [], variantRules: [], avoid: [] }
const studyWith = (imagery, grammarImagery) => study.reconcileStudy(types.familySchema.parse({
  id: 'forest', schemaVersion: 1, version: 1, name: 'Forest', description: 'Dark field with a large subject.', tags: [], width: 1080, height: 1350,
  typography: { headingFallback: 'Inter', bodyFallback: 'Inter' }, referenceStyle: { primary: '#123b26', secondary: '#0b2a1a', accent: '#b6f23a', background: '#0b2a1a', textPrimary: '#ffffff' },
  referenceImages: [{ id: 'r1', url: '/api/uploads/ref-1', name: 'r1.png', width: 1080, height: 1350 }], analysis: '', variants: [],
  study: { ...STUDY, imagery, grammar: { compositions: ['statement', 'image-led', 'closing'], headline: { scale: 'oversized', weight: 'black', case: 'uppercase' }, alignment: ['left'], anchors: ['top'], surfaces: ['dark'],
    imagery: { scale: 'dominant', positions: ['bottom'], shape: 'rect', overlap: 'none', dominance: 'dominates', overlay: 'none', frequency: 'every', tone: 'color', ...grammarImagery } } },
}))
const brand = { id: 'b', name: 'Brand', designTokens: { primary: '#123b26', accent: '#b6f23a', background: '#0b2a1a', textPrimary: '#ffffff' }, fonts: ['Inter', 'Inter'] }
const copy = { format: 'carousel', slides: [
  { headline: 'Porque precisa de um alvará?', body: 'Segurança oficial.', design: { image: { subject: 'permit document' } } },
  { headline: 'Transparência, qualidade e responsabilidade legal', body: 'Controlo rigoroso em cada fase.', design: { image: { subject: 'checklist' } } },
  { headline: 'Fale connosco', body: 'Respondemos hoje.', cta: 'Contacte-nos', design: { image: null } },
] }

test('an image whose subject could not be cut out is framed as a photo, never floated like a grey cutout', () => {
  const { generation } = require('./globalDesigns.test.cjs')
  const family = studyWith({ mode: 'cutout', usage: 'Large cutout subject rising from the bottom edge.' }, { cutout: 'always' })
  const layout = generation.globalLayoutPlan(family, 'global-forest', copy)
  assert.equal(layout.slots[0].imageMode, 'cutout')
  // A fallback provider's opaque studio shot: isolation failed and left the original image.
  const failed = 'Subject isolation failed: No usable foreground silhouette detected; original photo retained'
  const resolved = { slots: layout.slots.map(s => ({ slot_id: s.slot_id, treatment: s.treatment, source: 'ai_generated', warning: s.needs_visual ? failed : null, resolvedAsset: s.needs_visual ? { url: `/studio-${s.slot_id}`, source: 'ai_generated', width: 1024, height: 768 } : null })) }
  const post = generation.renderGlobalPost(family, brand, copy, resolved, { id: 'global-forest' }, crypto.randomUUID)
  const image = post.pages[0].nodes.find(n => n.type === 'image' && n.src === '/studio-slide_1')
  assert.ok(image, 'the image is still shown')
  assert.notEqual(image.objectFit, 'contain', 'framed and cropped like a photograph, not placed whole like a cutout')
  assert.match(post.validation.warnings.join(' '), /Slide 1: the image could not be cut out, so it is shown framed/)
  // A cut-out subject keeps being placed as a cutout.
  const cut = { slots: resolved.slots.map(s => s.resolvedAsset ? { ...s, warning: null, resolvedAsset: { ...s.resolvedAsset, subject: { url: `/cut-${s.slot_id}`, width: 600, height: 800 } } } : s) }
  const cutPost = generation.renderGlobalPost(family, brand, copy, cut, { id: 'global-forest' }, crypto.randomUUID)
  assert.equal(cutPost.pages[0].nodes.find(n => n.type === 'image' && n.src === '/cut-slide_1')?.objectFit, 'contain')
})

/** The study composer, except copy never fits beside an image: the case of a long headline in a large uppercase face. */
function crampedGeneration() {
  const composeSlide = (family, b, content, plan, ...rest) => {
    if (plan.withImage && !plan.fill) throw Object.assign(new Error('The headline copy is too long for this design. Shorten it or split it into another slide.'), { status: 422 })
    return compose.composeSlide(family, b, content, plan, ...rest)
  }
  return load('lib/designs/global/generation.ts', ['globalLayoutPlan', 'renderGlobalPost'], { ...compose, composeSlide, ...store, ...study, ...validate })
}

test('copy that cannot fit beside its image gets the whole slide instead of failing the post', () => {
  const generation = crampedGeneration()
  // Cutouts are the preferred imagery; a study built on full-canvas photographs keeps photographs.
  for (const [kind, family] of [['cutout', studyWith({ mode: 'cutout', usage: 'Large cutout subject rising from the bottom edge.' }, { cutout: 'always' })], ['photo', study.reconcileStudy(seeds[2])]]) {
    const layout = generation.globalLayoutPlan(family, 'global-forest', copy)
    assert.ok(layout.slots[1].needs_visual, `${kind}: the slide was planned with an image`)
    assert.equal(layout.slots[1].imageMode === 'cutout', kind === 'cutout', `${kind}: the slide was planned with a ${kind}`)
    const asset = s => s.imageMode === 'cutout'
      ? { url: `/g-${s.slot_id}`, source: 'ai_generated', width: 1024, height: 1024, subject: { url: `/c-${s.slot_id}`, width: 600, height: 800 } }
      : { url: `/g-${s.slot_id}`, source: 'pexels', width: 1080, height: 1350 }
    const resolved = { slots: layout.slots.map(s => ({ slot_id: s.slot_id, treatment: s.treatment, source: s.needs_visual ? 'found' : 'none', resolvedAsset: s.needs_visual ? asset(s) : null })) }
    const post = generation.renderGlobalPost(family, brand, copy, resolved, { id: 'global-forest' }, crypto.randomUUID)
    const page = post.pages[1]
    const headline = page.nodes.find(n => n.designRole === 'headline')
    assert.equal(headline.text.replace(/<%kind:[^:]+:([^%]+)%>/g, '$1').toUpperCase(), 'TRANSPARÊNCIA, QUALIDADE E RESPONSABILIDADE LEGAL', `${kind}: the copy is complete`)
    const image = page.nodes.find(n => n.type === 'image' && /^\/[gc]-/.test(n.src))
    const note = post.validation.warnings.find(w => w.startsWith('Slide 2: the copy needed more room'))
    assert.ok(note, `${kind}: the change is noted`)
    if (kind === 'photo') {
      assert.equal(image, undefined, 'a photograph needs its frame, so it gives way')
      assert.match(note, /without its image/)
    } else if (image) {
      // The cutout stands in the band the copy leaves free: below every text block.
      const texts = page.nodes.filter(n => n.type === 'text')
      assert.ok(texts.every(t => t.y + t.height <= image.y + 1), 'the cutout never sits under the copy')
      assert.match(note, /made smaller/)
    } else assert.match(note, /without its image/)
  }
})
