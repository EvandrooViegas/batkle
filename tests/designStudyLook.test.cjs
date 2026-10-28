const { test } = require('node:test')
const assert = require('node:assert/strict')
const { types, study, compose, resolve } = require('./globalDesigns.test.cjs')

const W = 1080, H = 1350
// A study like the PRUMO reference: a black-and-white photo fills the canvas, the headline sits on a yellow panel and
// the supporting copy on a yellow card; the logo sits top-right.
const familyWith = (grammar = {}, imagery = { mode: 'background', usage: 'Full-bleed monochrome photography.' }, prose = {}) => study.reconcileStudy(types.familySchema.parse({
  id: 'monochrome-block', schemaVersion: 1, version: 1, name: 'Monochrome Block', description: 'd', tags: [], width: W, height: H,
  typography: { headingFallback: 'Archivo Black', bodyFallback: 'Inter' }, referenceStyle: { primary: '#000000', secondary: '#ffffff', accent: '#f2b705', background: '#1a1a1a', textPrimary: '#000000' },
  referenceImages: [{ id: 'r1', url: '/api/uploads/ref-1', name: 'r1.jpg', width: 1088, height: 1344 }], analysis: '', variants: [],
  study: { personality: 'p', composition: 'c', spaceDensity: 's', typography: 't', colorContrast: 'cc', colorRoles: {}, imagery, decorative: 'd', hierarchy: 'h', logoPlacement: 'Top-right.', distinctive: [], familyRules: [], variantRules: [], avoid: [], ...prose,
    grammar: { compositions: ['statement', 'split', 'list'], headline: { scale: 'oversized', weight: 'black', case: 'uppercase', frame: 'solid' }, emphasis: 'none', alignment: ['left'], anchors: ['bottom'], surfaces: ['dark'],
      imagery: { scale: 'dominant', positions: ['full'], overlay: 'solid', frequency: 'every', tone: 'monochrome' }, branding: { logo: 'top-right', slideNumber: 'none', handle: 'none' },
      containers: { style: 'card', radius: 'small', fill: 'accent', use: ['callout'] },
      references: [{ composition: 'split', align: 'left', anchor: 'bottom', image: true, imagePos: 'full', callout: true, frame: true }], ...grammar } },
}))
const brand = { name: 'PRUMO', designTokens: { primary: '#000000', secondary: '#ffffff', accent: '#f2b705', background: '#1a1a1a', textPrimary: '#000000' } }
const slide = (family, copy, index = 0, total = 1, overrides = {}) => {
  const deck = { format: total > 1 ? 'carousel' : 'single', slides: Array.from({ length: total }, (_, i) => i === index ? copy : { headline: `Slide ${i + 1}` }) }
  const plan = { ...compose.planSlides(family, deck)[index], ...overrides }
  return { plan, canvas: compose.composeSlide(family, brand, copy, plan, index, total, { image: '/api/uploads/photo', imageSize: { width: 1600, height: 1066 } }) }
}

test('a reference whose photo fills the canvas is image-led, even when the model called it a split', () => {
  const g = study.familyGrammar(familyWith())
  assert.equal(g.references[0].composition, 'image-led')
  assert.ok(g.compositions.includes('image-led'), 'the arrangement the reference shows is allowed')
  const { plan, canvas } = slide(familyWith(), { headline: 'Estamos a recrutar', body: 'Pedreiro profissional, com experiência em alvenarias.' })
  assert.equal(plan.composition, 'image-led')
  const photo = canvas.nodes.find(n => n.designRole === 'image')
  assert.deepEqual([photo.x, photo.y, photo.width, photo.height], [0, 0, W, H], 'the photo fills the canvas, not one side')
})

test('copy set on solid panels keeps the photograph undarkened, and the headline panel covers only what its lines need', () => {
  // A slide that follows the reference (a cover follows it in two posts out of three): headline panel and body card.
  const following = { composition: 'image-led', imagePos: 'full', callout: true, frame: true, variant: 'classic' }
  const { canvas } = slide(familyWith(), { headline: 'Estamos a recrutar', body: 'Pedreiro profissional, com experiência em alvenarias.' }, 0, 1, following)
  const roles = canvas.nodes.map(n => n.designRole)
  assert.ok(!roles.includes('overlay'), 'no dark layer over the photo')
  const panel = canvas.nodes.find(n => n.designRole === 'headline-frame'), card = canvas.nodes.find(n => n.designRole === 'callout-card')
  const headline = canvas.nodes.find(n => n.designRole === 'headline'), body = canvas.nodes.find(n => n.designRole === 'body')
  assert.equal(panel.fill, '#f2b705')
  // "RECRUTAR" sets the headline's size and nearly fills the width; short lines leave photo beside the panel.
  const short = slide(familyWith(), { headline: 'Obra nova', body: 'Pedreiro profissional.' }, 0, 1, following).canvas.nodes.find(n => n.designRole === 'headline-frame')
  assert.ok(short.width < (W - 2 * Math.round(W * .08)) * .8 && short.x === Math.round(W * .08), `a short headline's panel hugs its lines (${short.width}px)`)
  assert.ok(headline.x >= panel.x && headline.x + headline.width <= panel.x + panel.width && headline.y + headline.height <= panel.y + panel.height, 'the headline sits inside its panel')
  assert.ok(body.y >= card.y && body.y + body.height <= card.y + card.height, 'the body sits on its card')
  assert.equal(resolve.lightness(headline.color) < .1, true, 'dark letters on the yellow panel')
  // Loose copy on the photo (an eyebrow) gets a light shade, not the solid overlay.
  const eyebrowed = slide(familyWith(), { headline: 'Estamos a recrutar', body: 'Pedreiro profissional.', eyebrow: 'Vaga aberta' }, 0, 1, following).canvas
  const shade = eyebrowed.nodes.find(n => n.designRole === 'overlay')
  assert.ok(shade && shade.stops[0].alpha === 0, 'a shade that fades in toward the copy')
})

test('a solid corner block never sits in the corner the logo or brand name uses', () => {
  const decorations = [{ kind: 'cornerBlock', placement: 'corner', scale: 'small', opacity: 100, color: 'foreground', frequency: 'every' }]
  const text = familyWith({ decorations, compositions: ['statement'], references: [] }, { mode: 'none' })
  // Left-aligned copy at the bottom leaves only the top-right corner, where the brand name is: no block at all.
  const bottom = slide(text, { headline: 'Estamos a recrutar' }).canvas
  assert.ok(!bottom.nodes.some(n => n.designRole === 'decoration' && n.x > W / 2 && n.y < H / 2), 'nothing drawn over the brand name')
  assert.ok(bottom.nodes.some(n => n.designRole === 'brand-name'))
  // Centred copy leaves the bottom-right corner free as well: the block goes there.
  const centred = slide(familyWith({ decorations, compositions: ['statement'], references: [], anchors: ['center'] }, { mode: 'none' }), { headline: 'Estamos a recrutar' }).canvas
  const block = centred.nodes.find(n => n.designRole === 'decoration')
  assert.ok(block && block.x + block.width === W && block.y + block.height === H, 'in the free bottom-right corner')
})

test('a band never covers the card that holds the body', () => {
  const family = familyWith()
  for (let i = 0; i < 12; i++) {
    const { plan, canvas } = slide(family, { headline: `Pronto quando estiver ${i}`, body: 'Transforme a ideia na sua próxima ação.', cta: 'Guarde esta publicação' }, 3, 4)
    const card = canvas.nodes.find(n => n.designRole === 'callout-card')
    if (card) assert.ok(!canvas.nodes.some(n => n.designRole === 'band'), `slide ${i}: ${plan.variant} keeps no band over the card`)
  }
})

test('the line estimate never runs narrower than Archivo Black’s real capitals', () => {
  // Measured in the post renderer at 128 px with -4 px tracking: "COMPOUND" is 804 px wide, "YOUR NEXT" 810 px.
  assert.equal(resolve.countLines('COMPOUND', 128, 804, 'Archivo Black', -4), 2)
  assert.equal(resolve.countLines('YOUR NEXT', 128, 810, 'Archivo Black', -4), 2)
})

// The PRUMO study's own words about its panels.
const LAYERED = { decorative: 'Geometric layering of solid and outlined rectangles. The use of a ghost block (outline only) behind the main block adds depth.', colorRoles: { decoration: 'Secondary accent blocks with thin outlines' } }

test('a study that describes outlined, layered panels draws them, even when saved before the grammar had them', () => {
  assert.deepEqual({ ...study.familyGrammar(familyWith({}, undefined, LAYERED)).panel }, { outline: true, offset: 'block' })
  assert.deepEqual({ ...study.familyGrammar(familyWith({}, undefined, { decorative: 'A ghost block, outline only, sits behind the main block.' })).panel }, { outline: false, offset: 'outline' })
  assert.deepEqual({ ...study.familyGrammar(familyWith({}, undefined, { decorative: 'Clean flat colour.' })).panel }, { outline: false, offset: 'none' })
  assert.equal(study.familyGrammar(familyWith({ headline: { frame: 'none' } }, undefined, LAYERED)).panel, undefined, 'only a filled headline panel has them')
  assert.deepEqual({ ...study.familyGrammar(familyWith({ panel: { outline: false, offset: 'none' } }, undefined, LAYERED)).panel }, { outline: false, offset: 'none' }, 'a setting chosen in the editor wins over the words')
})

test('the offset block sits behind the panel and the card, the panel and card carry the line, and the CTA stays clear', () => {
  const following = { composition: 'image-led', imagePos: 'full', callout: true, frame: true, variant: 'classic' }
  const family = familyWith({}, undefined, LAYERED)
  const { canvas } = slide(family, { headline: 'Estamos a recrutar', body: 'Pedreiro profissional, com experiência.' }, 0, 1, following)
  const roles = canvas.nodes.map(n => n.designRole)
  const block = canvas.nodes.find(n => n.designRole === 'panel-offset'), panel = canvas.nodes.find(n => n.designRole === 'headline-frame'), card = canvas.nodes.find(n => n.designRole === 'callout-card')
  assert.ok(block && roles.indexOf('panel-offset') < roles.indexOf('callout-card') && roles.indexOf('panel-offset') < roles.indexOf('headline-frame'), roles.join(' '))
  assert.ok(block.x > panel.x && block.y > panel.y && block.fill === panel.fill, 'down and to the right, in the panel colour')
  assert.ok(block.x + block.width <= W, 'inside the canvas')
  assert.ok(panel.stroke && card.stroke, 'the panel and the card carry the thin line')
  for (let i = 0; i < 8; i++) {
    const { canvas: closing } = slide(family, { headline: `Pronto quando estiver ${i}`, body: 'Transforme a ideia.', cta: 'Guarde esta publicação' }, 0, 1, { ...following, closing: true })
    const offset = closing.nodes.find(n => n.designRole === 'panel-offset')
    const cta = closing.nodes.filter(n => /^(cta|cta-rule)$/.test(n.designRole))
    const overlaps = n => n.x < offset.x + offset.width && n.x + n.width > offset.x && n.y < offset.y + offset.height && n.y + n.height > offset.y
    if (offset) assert.ok(!cta.some(overlaps), `slide ${i}: nothing of the CTA sits on the block`)
  }
})
