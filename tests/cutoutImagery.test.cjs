const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { load, seeds, types, generation, study, compose } = require('./globalDesigns.test.cjs')

const STUDY = { personality: 'p', composition: 'c', spaceDensity: 's', typography: 't', colorContrast: 'cc', colorRoles: {}, decorative: 'd', hierarchy: 'h', logoPlacement: 'Small top-left anchor', distinctive: [], familyRules: [], variantRules: [], avoid: [] }
// Shaped like the published "Deep Forest" study: the mode says fullBleed, the prose describes a cutout.
const FOREST_IMAGERY = { mode: 'fullBleed', usage: 'Large photographic cutout that runs off the bottom and side edges, overlapping the text zone', placement: 'bottom, full width', cropBehavior: 'full-bleed, runs off canvas edges', frequency: 'some' }
const family = (imagery, grammarImagery = {}) => study.reconcileStudy(types.familySchema.parse({
  id: 'forest', schemaVersion: 1, version: 1, name: 'Forest', description: 'Dark field with a large subject.', tags: [], width: 1080, height: 1350,
  typography: { headingFallback: 'Inter', bodyFallback: 'Inter' }, referenceStyle: { primary: '#123b26', secondary: '#0b2a1a', accent: '#b6f23a', background: '#0b2a1a', textPrimary: '#ffffff' },
  referenceImages: [{ id: 'r1', url: '/api/uploads/ref-1', name: 'r1.png', width: 1080, height: 1350 }], analysis: '', variants: [],
  study: { ...STUDY, imagery, grammar: { compositions: ['statement', 'stacked', 'image-led', 'list', 'closing'], headline: { scale: 'large', weight: 'black' }, alignment: ['left'], anchors: ['top'], surfaces: ['dark'],
    imagery: { scale: 'dominant', positions: ['bottom', 'full'], shape: 'rect', overlap: 'text', dominance: 'dominates', overlay: 'none', frequency: 'every', tone: 'color', ...grammarImagery } } },
}))
const brand = { id: 'kachica', name: 'KACHICA', designTokens: { primary: '#a62800', accent: '#a62800', background: '#ffffff', textPrimary: '#111827' }, fonts: ['Oswald', 'Space Grotesk'] }
const copy = { format: 'carousel', slides: [
  { headline: 'Ainda faz tudo à mão?', body: 'A automação liberta horas todos os dias.', design: { composition: 'image-led', image: { subject: 'hand holding a smartphone' } } },
  { headline: 'Menos tarefas repetidas', body: 'Agendamentos e lembretes correm sozinhos.', design: { composition: 'stacked', image: { subject: 'laptop with an open calendar' } } },
  { headline: 'Fale connosco', body: 'Veja a diferença no primeiro mês.', cta: 'Fale connosco', design: { composition: 'closing', image: null } },
] }

test('cutout studies are recognised from their imagery prose even when the mode label says fullBleed or mixed', () => {
  const of = (imagery, grammar) => study.familyCutouts({ study: { imagery, ...(grammar ? { grammar: { imagery: grammar } } : {}) }, variants: [] })
  assert.equal(of(FOREST_IMAGERY), 'always')
  assert.equal(of({ mode: 'mixed', usage: 'When present, it consists of high-contrast, monochrome or desaturated cutouts of subjects (like hands).' }), 'always')
  assert.equal(of({ mode: 'mixed', usage: 'Background photos on covers; isolated product cutouts on content slides.' }), 'some')
  assert.equal(of({ mode: 'cutout' }), 'always')
  assert.equal(of({ mode: 'background', usage: 'Every slide is a full-bleed photograph.' }), 'never')
  assert.equal(of({ mode: 'contained', usage: 'Framed photos only, never cutouts.' }), 'never')
  assert.equal(of({ mode: 'none', usage: 'Typography with cutout shapes.' }), 'never')
  assert.equal(of(FOREST_IMAGERY, { cutout: 'never' }), 'never', 'a stated grammar value wins over the prose')
  assert.equal(family(FOREST_IMAGERY).study.grammar.imagery.cutout, 'always', 'reconciling a study states the inferred value so the editor shows it')
})

test('cutout slides ask for a transparent PNG subject, never a photograph, and photo slides may fall back to a cutout', () => {
  const forest = family(FOREST_IMAGERY)
  const slots = generation.globalLayoutPlan(forest, 'global-forest', copy).slots
  const pictured = slots.filter(s => s.needs_visual)
  assert.ok(pictured.length >= 2)
  for (const slot of pictured) {
    assert.equal(slot.treatment, 'isolated_subject'); assert.equal(slot.imageMode, 'cutout'); assert.equal(slot.cutoutFallback, false)
    assert.match(slot.brief, /Transparent PNG cutout/); assert.match(slot.brief, /no background/)
    assert.ok(slot.frame.height < 1350, 'a cutout never fills the canvas behind the copy')
  }
  assert.match(pictured[0].brief, /cut off by the bottom edge/, 'a grounded subject may rise from the bottom edge')
  const photo = study.reconcileStudy(seeds[2])
  const photoSlots = generation.globalLayoutPlan(photo, 'global-photo', { format: 'single', headline: 'Escape the routine', supportingText: 'Go somewhere quiet.' }).slots
  assert.equal(photoSlots[0].treatment, 'environmental'); assert.equal(photoSlots[0].cutoutFallback, true)
})

test('a cutout keeps its proportions, stands on the lower edge and never sits under the copy', () => {
  const forest = family(FOREST_IMAGERY)
  const layout = generation.globalLayoutPlan(forest, 'global-forest', copy)
  const resolved = { slots: layout.slots.map(s => ({ slot_id: s.slot_id, treatment: s.treatment, resolvedAsset: s.needs_visual ? { url: `/api/uploads/gen-${s.slot_id}`, width: 1024, height: 1536, subject: { url: `/api/uploads/cut-${s.slot_id}`, width: 600, height: 900 } } : null })) }
  const post = generation.renderGlobalPost(forest, brand, copy, resolved, { id: 'global-forest' }, crypto.randomUUID)
  for (const [i, page] of post.pages.entries()) {
    const image = page.nodes.find(n => n.designRole === 'image')
    if (!layout.slots[i].needs_visual) { assert.equal(image, undefined); continue }
    assert.equal(image.src, `/api/uploads/cut-${layout.slots[i].slot_id}`, 'the trimmed transparent derivative is used')
    assert.equal(image.objectFit, 'contain'); assert.equal(image.mask, undefined)
    assert.ok(Math.abs(image.width / image.height - 600 / 900) < .01, 'the node hugs the subject')
    assert.equal(image.y + image.height, 1350, 'stands on the bottom edge')
    assert.equal(page.nodes.some(n => n.designRole === 'overlay'), false, 'no photo overlay behind a cutout')
    for (const text of page.nodes.filter(n => n.type === 'text' && ['headline', 'body'].includes(n.designRole))) assert.ok(text.y + text.height <= image.y + 1, `${text.designRole} stays above the subject`)
  }
})

test('a photo slot filled with a generated cutout is composed as a cutout, and a slide without any image keeps its typography', () => {
  const photo = study.reconcileStudy(seeds[2])
  const single = { format: 'single', headline: 'Escape the routine', supportingText: 'Go somewhere quiet.' }
  const fallback = generation.renderGlobalPost(photo, brand, single, { slots: [{ slot_id: 'single_main', treatment: 'isolated_subject', source: 'ai_generated', resolvedAsset: { url: '/api/uploads/gen', subject: { url: '/api/uploads/cut', width: 500, height: 700 } } }] }, { id: 'global-photo' }, crypto.randomUUID)
  const image = fallback.nodes.find(n => n.designRole === 'image')
  assert.equal(image.src, '/api/uploads/cut'); assert.equal(image.objectFit, 'contain')
  assert.ok(image.width < 1080 && image.y + image.height === 1350)
  const missing = generation.renderGlobalPost(photo, brand, single, { slots: [{ slot_id: 'single_main', resolvedAsset: null, warning: 'quota' }] }, { id: 'global-photo' }, crypto.randomUUID)
  assert.equal(missing.nodes.some(n => n.type === 'image' && n.designRole === 'image'), false)
  assert.ok(missing.nodes.some(n => n.designRole === 'headline'))
  assert.match(missing.validation.warnings.join(' '), /no fitting image was available \(quota\)/)
})

const photoHelpers = load('lib/services/postImages.ts', ['loadPostImages', 'postImageIds', 'uploadPlanningBlock', 'assignUploads', 'ideaForCopy'], { hydrateBrandFamilies: async () => [], familyImagery: study.familyImagery })
function planner(writeCopy, planAssets) {
  return load('lib/handlers/postPlanHandler.ts', ['handlePlanPost', 'designPlanningPrompt', 'sanitizeDesignPlan', 'galleryCutouts', 'cutoutLabel'], {
    NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) }, corsify: r => r,
    loadGenerationBrandContext: async (_db, body) => ({ id: 'kachica', name: 'KACHICA', ...body.brandContext }),
    chooseBrandFamily: async (_db, b) => b.family ? { family: b.family, design: { id: 'global-' + b.family.id } } : null,
    studyForPlanning: study.studyForPlanning, familyGrammar: study.familyGrammar, familyImagery: study.familyImagery, familyCutouts: study.familyCutouts, familyPhotoLed: study.familyPhotoLed,
    writeCopy, copyErrorResponse: error => ({ body: { error: error.message }, status: error.status || 500 }), planAssets,
    ...photoHelpers, listItems: compose.listItems,
  })
}
const GALLERY = [{ ref: 'g1', id: 'generated-phone', description: 'hand holding a smartphone' }, { ref: 'g2', id: 'generated-laptop', description: 'laptop with an open calendar' }]

test('the copy plan describes isolated subjects and may reuse one fitting gallery cutout per post', () => {
  const forest = family(FOREST_IMAGERY)
  const { designPlanningPrompt, sanitizeDesignPlan } = planner()
  const prompt = designPlanningPrompt(forest, GALLERY)
  assert.match(prompt, /transparent cutout/); assert.match(prompt, /BRAND GALLERY CUTOUTS/); assert.match(prompt, /g1 = "hand holding a smartphone"/)
  assert.match(prompt, /Prefer new subjects made for this post/)
  const framed = family({ mode: 'contained', usage: 'Photographs inside frames beside the copy.' }, { positions: ['bottom'] })
  const photoPrompt = designPlanningPrompt(framed)
  assert.doesNotMatch(photoPrompt, /GALLERY|"reuse"/, 'no gallery block without saved cutouts')
  assert.match(photoPrompt, /ONE isolated subject/); assert.match(photoPrompt, /English stock search/)
  assert.match(designPlanningPrompt(study.reconcileStudy(seeds[2])), /full-bleed photograph behind the copy/, 'a photo-led study asks for photographic scenes')
  const plan = sanitizeDesignPlan(forest, { format: 'carousel', slides: [
    { headline: 'One', design: { composition: 'image-led', image: { reuse: 'g1' } } },
    { headline: 'Two', design: { composition: 'stacked', image: { subject: 'a hand with a phone', reuse: 'g1' } } },
    { headline: 'Three', design: { composition: 'image-led', image: { subject: 'a desk lamp', reuse: 'g9' } } },
    { headline: 'Four', design: { composition: 'stacked', image: { subject: 'saved copy', reuse: 'generated-laptop' } } },
  ] }, GALLERY)
  const images = plan.slides.map(s => s.design.image)
  assert.deepEqual(images[0], { subject: 'hand holding a smartphone', queries: [], reuse: 'generated-phone' })
  assert.equal(images[1].reuse, undefined, 'the same cutout is not reused twice in one post')
  assert.equal(images[2].reuse, undefined, 'unknown refs are dropped')
  assert.equal(images[3].reuse, undefined, 'new images are preferred: at most one reuse per post')
  const replanned = sanitizeDesignPlan(forest, { format: 'single', headline: 'Saved', design: { composition: 'image-led', image: { subject: 'saved copy', reuse: 'generated-laptop' } } }, GALLERY)
  assert.equal(replanned.design.image.reuse, 'generated-laptop', 're-planning saved copy keeps a real gallery id')
})

test('planning loads the brand cutouts once and threads the chosen reuse into the asset plan', async () => {
  const forest = family(FOREST_IMAGERY)
  const queries = []
  const db = { collection: name => ({ find: query => { queries.push([name, query]); return { sort: () => ({ limit: () => ({ toArray: async () => [{ id: 'generated-phone', subject_description: 'hand holding a smartphone' }] }) }) } } }) }
  let prompt = '', planned
  const { handlePlanPost } = planner(async (_brand, _idea, design) => { prompt = design.prompt; return { copy: { format: 'single', headline: 'Ainda faz tudo à mão?', design: { composition: 'image-led', image: { reuse: 'g1' } } } } }, async (_db, input) => { planned = input.copy; return { slots: [] } })
  const result = await handlePlanPost(db, { brandContext: { family: forest }, idea: { topic: 'Automação' } })
  assert.equal(result.status, 200)
  assert.deepEqual(queries, [['assets', { brand_id: 'brand_kachica', source: 'ai_generated', status: 'ready', treatment: 'isolated_subject' }]])
  assert.match(prompt, /g1 = "hand holding a smartphone"/)
  assert.equal(planned.design.image.reuse, 'generated-phone')
  const before = queries.length
  await planner(async () => ({ copy: { format: 'single', headline: 'Escape', design: { composition: 'statement', image: null } } }), async () => ({ slots: [] })).handlePlanPost(db, { brandContext: { family: study.reconcileStudy(seeds[2]) }, idea: { topic: 'x' } })
  assert.equal(queries.length, before + 1, 'photo studies read the gallery too, since most of their images are cutouts')
  await planner(async () => ({ copy: { format: 'single', headline: 'Só texto', design: { composition: 'statement', image: null } } }), async () => ({ slots: [] })).handlePlanPost(db, { brandContext: { family: study.reconcileStudy(seeds[1]) }, idea: { topic: 'x' } })
  assert.equal(queries.length, before + 1, 'a study without imagery never reads the gallery')
})

test('saved cutouts are offered by subject: instruction-like descriptions and duplicates are skipped', async () => {
  // Real descriptions saved by the older pipeline for one brand.
  const saved = [
    'professional typing at a desktop workstation in three-quarter view',
    'Choose one concrete visual subject that directly explains this slide: Diagnóstico detalhado das necessidades. Prefer the actual object',
    'Object-only: a rolled blueprint with a hard hat and tape measure, no people, no hands, no table or workbench',
    'professional typing at a desktop workstation in three-quarter view',
    'Carrossel de 4 slides: 1) número de desperdício de orçamento em destaque',
  ].map((subject_description, i) => ({ id: `generated-${i}`, subject_description }))
  const db = { collection: () => ({ find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => saved }) }) }) }) }
  const { galleryCutouts } = planner()
  assert.deepEqual(await galleryCutouts(db, 'kachica'), [
    { ref: 'g1', id: 'generated-0', description: 'professional typing at a desktop workstation in three-quarter view' },
    { ref: 'g2', id: 'generated-2', description: 'a rolled blueprint with a hard hat and tape measure' },
  ])
  assert.deepEqual(await galleryCutouts(null, 'kachica'), [])
})

test('a brand logo replaces the website link and always reads on its surface', () => {
  const forest = family(FOREST_IMAGERY)
  const single = { format: 'single', headline: 'Métricas que importam', supportingText: 'Veja o que medir.' }
  const variants = { source: '/api/uploads/logo', inkLightness: .95, originalTransparent: 'orig', whiteTransparent: 'white', blackTransparent: 'black' }
  const page = (b, surfaces) => {
    const f = { ...forest, study: { ...forest.study, grammar: { ...forest.study.grammar, surfaces, branding: { logo: 'top-left', slideNumber: 'none', handle: 'top-right' } } } }
    return generation.renderGlobalPost(f, b, single, { slots: [{ slot_id: 'single_main', treatment: 'isolated_subject', resolvedAsset: { url: '/g', subject: { url: '/c', width: 500, height: 700 } } }] }, { id: 'global-forest' }, crypto.randomUUID)
  }
  const withLogo = { ...brand, logo: '/api/uploads/logo', logoVariants: variants, website: 'https://kachica.pt' }
  const light = page(withLogo, ['light'])
  assert.equal(light.nodes.some(n => n.designRole === 'handle'), false, 'no website link when the logo is shown')
  assert.equal(light.nodes.find(n => n.designRole === 'logo').src, 'black', 'a white logo becomes its dark silhouette on a light slide')
  assert.equal(page(withLogo, ['dark']).nodes.find(n => n.designRole === 'logo').src, 'orig', 'the original artwork is kept where it reads')
  const red = { ...withLogo, logoVariants: { ...variants, inkLightness: .08 } }
  assert.equal(page(red, ['light']).nodes.find(n => n.designRole === 'logo').src, 'orig')
  assert.equal(page(red, ['dark']).nodes.find(n => n.designRole === 'logo').src, 'white')
  // Without a logo the website link stays; a study with no logo position puts the logo where the link was.
  const noLogo = page({ ...brand, website: 'https://kachica.pt' }, ['light'])
  assert.ok(noLogo.nodes.some(n => n.designRole === 'handle') && noLogo.nodes.some(n => n.designRole === 'brand-name'))
  const f = { ...forest, study: { ...forest.study, grammar: { ...forest.study.grammar, surfaces: ['light'], branding: { logo: 'none', slideNumber: 'none', handle: 'top-right' } } } }
  const moved = generation.renderGlobalPost(f, withLogo, single, { slots: [{ slot_id: 'single_main', treatment: 'isolated_subject', resolvedAsset: { url: '/g', subject: { url: '/c', width: 500, height: 700 } } }] }, { id: 'global-forest' }, crypto.randomUUID)
  const logo = moved.nodes.find(n => n.designRole === 'logo')
  assert.ok(logo && logo.x > 540 && !moved.nodes.some(n => n.designRole === 'handle'), 'the logo takes the website link position')
})

test('a slide shows only its own CTA: the post-level CTA is not pushed onto the last slide', () => {
  const photo = study.reconcileStudy(seeds[1])
  const carousel = { format: 'carousel', cta: 'Saiba mais', slides: [{ headline: 'Primeiro ponto claro' }, { headline: 'Segundo ponto claro' }, { headline: 'Conclusão simples', body: 'O essencial em uma frase.' }] }
  const post = generation.renderGlobalPost(photo, brand, carousel, { slots: [] }, { id: 'global-x' }, crypto.randomUUID)
  assert.equal(post.pages.some(p => p.nodes.some(n => n.designRole === 'cta')), false)
  const withCta = { ...carousel, slides: carousel.slides.map((s, i) => i === 2 ? { ...s, cta: 'Guarde este post' } : s) }
  const last = generation.renderGlobalPost(photo, brand, withCta, { slots: [] }, { id: 'global-x' }, crypto.randomUUID).pages.at(-1)
  assert.equal(last.nodes.find(n => n.designRole === 'cta').text.replace(' →', ''), 'Guarde este post')
})

test('the logo is sized by its mark and lines up with the copy; CTAs are text, and texts in shapes sit centred', () => {
  const textOnly = study.reconcileStudy(seeds[1])
  const g = textOnly.study.grammar
  const f = { ...textOnly, study: { ...textOnly.study, grammar: { ...g, cta: 'pill', branding: { logo: 'top-left', slideNumber: 'top-right', handle: 'none' }, list: { marker: 'number', shape: 'circle', fill: 'solid', color: 'accent' } } } }
  const square = { ...brand, logo: '/api/uploads/logo', logoVariants: { source: '/api/uploads/logo', inkLightness: .5, imageAspect: 1, bounds: { x: 0, y: 0, width: 1, height: 1 }, originalTransparent: 'orig', whiteTransparent: 'white', blackTransparent: 'black' } }
  const carousel = { format: 'carousel', slides: [{ headline: 'Comércio eletrónico em Angola', body: 'Uma plataforma local.' }, { headline: 'Três razões', body: '1. Pagamentos locais\n2. Suporte presencial\n3. Dados no país' }, { headline: 'Comece hoje', body: 'Crie a sua loja.', cta: 'Guarde este post' }] }
  const post = generation.renderGlobalPost(f, square, carousel, { slots: [] }, { id: 'global-x' }, crypto.randomUUID)
  for (const page of post.pages) {
    const logo = page.nodes.find(n => n.designRole === 'logo'), headline = page.nodes.find(n => n.designRole === 'headline')
    // A side-bar variant moves the copy right of its accent bar; the bar is then the copy's edge.
    const bar = page.nodes.find(n => n.designRole === 'sidebar')
    assert.equal(logo.x, bar ? bar.x : headline.x, 'the mark starts on the copy edge')
    assert.ok(logo.height >= 80 && logo.width === logo.height, `a square mark is about 8% of the width tall (${logo.height})`)
    assert.ok(logo.y + logo.height < headline.y, 'the larger logo row still clears the copy')
    const number = page.nodes.find(n => n.designRole === 'slide-number')
    assert.ok(Math.abs((number.y + number.height / 2) - (logo.y + logo.height / 2)) <= 2, 'branding items share one centre line')
  }
  const last = post.pages.at(-1).nodes
  assert.equal(last.some(n => /cta-(button|underline)/.test(n.designRole)), false, 'no button shape behind a CTA')
  const cta = last.find(n => n.designRole === 'cta')
  assert.equal(cta.text, 'Guarde este post'); assert.ok(cta.height <= cta.fontSize * 1.15 + 3, 'one line, boxed to the line')
  const list = post.pages[1].nodes
  for (const glyph of list.filter(n => n.designRole === 'marker-glyph')) {
    const marker = list.find(n => n.designRole === 'marker' && n.x === glyph.x && Math.abs(n.y - glyph.y) < n.height)
    assert.ok(Math.abs((glyph.y + glyph.height / 2) - (marker.y + marker.height / 2)) <= 1, 'number centred in its circle')
    assert.ok(glyph.height < marker.height)
  }
})

test('one logo per slide, always in a corner (never a tile inside the copy), and wordmarks are sized by area', () => {
  const textOnly = study.reconcileStudy(seeds[1])
  const f = { ...textOnly, study: { ...textOnly.study, grammar: { ...textOnly.study.grammar, badge: 'logo', branding: { logo: 'top-left', slideNumber: 'none', handle: 'top-right' } } } }
  const variants = aspect => ({ source: '/api/uploads/logo', inkLightness: .5, imageAspect: aspect, bounds: { x: 0, y: 0, width: 1, height: 1 }, originalTransparent: 'orig', whiteTransparent: 'white', blackTransparent: 'black' })
  const carousel = { format: 'carousel', slides: [{ headline: 'Transformamos dados em crescimento', body: 'A nossa metodologia em 4 etapas.' }, { headline: 'Etapa um', body: 'Diagnóstico.' }] }
  const render = aspect => generation.renderGlobalPost(f, { ...brand, logo: '/api/uploads/logo', logoVariants: variants(aspect), website: 'https://kachica.pt' }, carousel, { slots: [] }, { id: 'global-x' }, crypto.randomUUID)
  const logos = page => page.nodes.filter(n => n.designRole === 'logo' || n.designRole === 'badge-logo')
  // A 4:1 wordmark: no tile, one logo per slide, about 4% of the width tall and 16% wide.
  const wordmark = render(4.22)
  for (const page of wordmark.pages) assert.equal(logos(page).length, 1)
  assert.equal(wordmark.pages[0].nodes.some(n => n.designRole === 'badge'), false)
  const word = logos(wordmark.pages[0])[0]
  assert.ok(word.height <= 45 && word.width <= 190, `wordmark ${word.width}×${word.height}`)
  // A square mark in a study that recorded a logo tile: still only the corner logo, on every slide.
  const square = render(1.2)
  for (const page of square.pages) {
    assert.deepEqual(logos(page).map(n => n.designRole), ['logo'])
    assert.equal(page.nodes.some(n => /^badge/.test(n.designRole || '')), false)
  }
  // A centred logo position moves to a corner.
  const centred = { ...f, study: { ...f.study, grammar: { ...f.study.grammar, branding: { logo: 'top-center', slideNumber: 'none', handle: 'none' } } } }
  const centredLogo = generation.renderGlobalPost(centred, { ...brand, logo: '/api/uploads/logo', logoVariants: variants(1.2) }, carousel, { slots: [] }, { id: 'global-x' }, crypto.randomUUID).pages[0].nodes.find(n => n.designRole === 'logo')
  assert.ok(centredLogo.x < 200 && centredLogo.y < 200, 'top-left, not top-centre')
  // A list slide whose plan carries the tile flag still shows the corner logo, because lists never draw the tile.
  const listPlan = { ...f, study: { ...f.study, grammar: { ...f.study.grammar, references: [{ composition: 'statement', align: 'left', anchor: 'top', image: false, imagePos: 'bottom', callout: false, badge: true }, { composition: 'list', align: 'left', anchor: 'top', image: false, imagePos: 'bottom', callout: false, badge: true }] } } }
  const listed = generation.renderGlobalPost(listPlan, { ...brand, logo: '/api/uploads/logo', logoVariants: variants(1.2) }, { format: 'carousel', slides: [{ headline: 'Capa clara' }, { headline: 'Três razões', body: '1. Um\n2. Dois\n3. Três' }] }, { slots: [] }, { id: 'global-x' }, crypto.randomUUID)
  for (const page of listed.pages) assert.equal(logos(page).length, 1, page.globalComposition)
  assert.equal(square.pages.some(p => p.nodes.some(n => n.designRole === 'handle')), false, 'still no website link')
})

test('AI cutouts are preferred: about one image in five is a stock photo, cutout-only studies never use stock, photo-led studies keep photos', () => {
  const photo = family({ mode: 'contained', usage: 'Photographs inside frames beside the copy.' }, { positions: ['bottom'] })
  const slides = Array.from({ length: 200 }, (_, i) => ({ headline: `Ideia número ${i} para o negócio`, body: 'Texto curto.' }))
  const modes = slides.map(s => generation.globalLayoutPlan(photo, 'global-x', { format: 'single', ...s }).slots[0]).filter(s => s.needs_visual)
  const stock = modes.filter(s => s.treatment === 'environmental').length / modes.length
  assert.ok(stock > .1 && stock < .3, `stock share ${stock}`)
  assert.ok(modes.filter(s => s.imageMode === 'cutout').every(s => s.frame.height < 1350), 'cutouts take the lower band, never the full frame')
  const forest = family(FOREST_IMAGERY)
  const forestSlots = slides.slice(0, 50).map(s => generation.globalLayoutPlan(forest, 'global-x', { format: 'single', ...s }).slots[0]).filter(s => s.needs_visual)
  assert.ok(forestSlots.length && forestSlots.every(s => s.treatment === 'isolated_subject'))
  // A study built on full-bleed photographs behind the copy keeps photographs: a cutout cannot recreate that look.
  const background = study.reconcileStudy(seeds[2])
  const backgroundSlots = slides.slice(0, 30).map(s => generation.globalLayoutPlan(background, 'global-x', { format: 'single', ...s }).slots[0]).filter(s => s.needs_visual)
  assert.ok(backgroundSlots.length && backgroundSlots.every(s => s.treatment === 'environmental' && s.background))
})

test('an enumeration written as a sentence becomes a designed list with its lead line', () => {
  const { listParts } = load('lib/designs/global/compose.ts', ['listParts'], { familyGrammar: study.familyGrammar, familyImagery: study.familyImagery, familyCutouts: study.familyCutouts, resolveBrandTokens: () => ({}), countLines: () => 1, clean: s => String(s ?? ''), lightness: () => 0, on: () => '#fff', hex: () => true })
  assert.deepEqual(listParts({ body: 'Descubra cada fase: Descoberta, Estratégia, Implementação e Optimização' }), { lead: 'Descubra cada fase', items: ['Descoberta', 'Estratégia', 'Implementação', 'Optimização'] })
  assert.deepEqual(listParts({ body: 'Três passos:\n1. Diagnóstico\n2. Plano\n3. Execução' }), { lead: 'Três passos:', items: ['Diagnóstico', 'Plano', 'Execução'] })
  assert.deepEqual(listParts({ body: 'A Ikarus Pay é a plataforma local: segura, simples e adaptada ao mercado angolano de hoje, com suporte presencial em todo o país.' }).items.length, 0, 'long clauses stay prose')
  assert.deepEqual(listParts({ body: 'Uma frase normal, sem lista.' }).items, [])
  // The slide from the screenshot: the cover becomes a list with a lead, in the study's list style.
  const textOnly = study.reconcileStudy(seeds[1])
  const cover = { headline: 'A nossa metodologia em 4 passos', body: 'Descubra cada fase: Descoberta, Estratégia, Implementação e Optimização', design: { composition: 'statement' } }
  const post = generation.renderGlobalPost(textOnly, brand, { format: 'single', ...cover }, { slots: [] }, { id: 'global-x' }, crypto.randomUUID)
  assert.equal(post.nodes.filter(n => n.designRole === 'item').length, 4)
  assert.ok(post.nodes.some(n => n.designRole === 'body' && n.text === 'Descubra cada fase'), 'the lead stays as the intro line')
})

test('single-weight display fonts are set at their real weight, so the browser never fakes a wider bold', () => {
  const textOnly = study.reconcileStudy(seeds[1])
  const f = { ...textOnly, study: { ...textOnly.study, grammar: { ...textOnly.study.grammar, headline: { ...textOnly.study.grammar.headline, weight: 'black' } } } }
  const prumo = { id: 'prumo', name: 'PRUMO', fonts: ['Anton', 'Impact', 'Roboto'], designTokens: { primary: '#f9e183', background: '#ffffff', textPrimary: '#000000' } }
  const post = generation.renderGlobalPost(f, prumo, { format: 'single', headline: 'Pronto para elevar a sua equipa?', supportingText: 'Contacte-nos e agende a próxima sessão de formação BIM.', cta: 'Envie-nos uma mensagem' }, { slots: [] }, { id: 'global-x' }, crypto.randomUUID)
  const headline = post.nodes.find(n => n.designRole === 'headline'), body = post.nodes.find(n => n.designRole === 'body')
  assert.equal(headline.fontFamily, 'Anton'); assert.equal(headline.fontWeight, 400)
  assert.ok(body.y >= headline.y + headline.height, 'the body starts below the headline')
})

test('study previews show a sample photo or cutout instead of an empty placeholder', () => {
  const { previewSlide } = require('./globalDesigns.test.cjs').compose
  const photoStudy = study.reconcileStudy(seeds[2]), cutoutStudy = family(FOREST_IMAGERY)
  const images = f => [0, 1, 2, 3].map(i => previewSlide(f, {}, i)).flatMap(p => p.nodes.filter(n => n.type === 'image' && n.designRole === 'image'))
  const photos = images(photoStudy), cutouts = images(cutoutStudy)
  assert.ok(photos.length && cutouts.length)
  assert.ok([...photos, ...cutouts].every(n => n.src.startsWith('/samples/')))
  assert.ok(cutouts.every(n => n.src === '/samples/cutout.png' && Math.abs(n.width / n.height - 637 / 543) < .01))
  assert.equal([0, 1, 2, 3].some(i => [photoStudy, cutoutStudy].some(f => previewSlide(f, {}, i).nodes.some(n => n.designRole === 'image-placeholder'))), false)
})

test('a text slide that leaves a large empty band gets an AI cutout there, never over the copy', () => {
  const forest = family(FOREST_IMAGERY, { frequency: 'rare' })
  const subject = { subject: 'engineer holding a tablet', queries: ['engineer tablet'] }
  const list = { headline: 'Relatórios periódicos', body: '1. Gráficos de progresso\n2. Cronograma 4D\n3. Indicadores de qualidade' }
  const deck = slides => ({ format: 'carousel', slides })
  const layout = generation.globalLayoutPlan(forest, 'global-x', deck([{ headline: 'Capa', design: { composition: 'statement', image: null } }, { ...list, design: { composition: 'list', image: subject } }]), brand)
  const slot = layout.slots[1]
  assert.equal(slot.plan.fill, true); assert.equal(slot.needs_visual, true); assert.equal(slot.treatment, 'isolated_subject')
  assert.match(slot.brief, /complements the copy/)
  // Without a planned subject there is nothing meaningful to generate, so the space stays empty.
  assert.equal(generation.globalLayoutPlan(forest, 'global-x', deck([{ headline: 'Capa' }, list]), brand).slots[1].needs_visual, false)
  const copy = deck([{ headline: 'Capa', design: { composition: 'statement', image: null } }, { ...list, design: { composition: 'list', image: subject } }])
  const resolved = { slots: layout.slots.map(s => ({ slot_id: s.slot_id, treatment: s.treatment, resolvedAsset: s.needs_visual ? { url: '/gen', subject: { url: '/cut', width: 500, height: 600 } } : null })) }
  const page = generation.renderGlobalPost(forest, brand, copy, resolved, { id: 'global-x' }, crypto.randomUUID).pages[1]
  const image = page.nodes.find(n => n.designRole === 'image'), lastCopy = Math.max(...page.nodes.filter(n => ['headline', 'item', 'marker'].includes(n.designRole)).map(n => n.y + n.height))
  assert.equal(image.src, '/cut'); assert.ok(image.y >= lastCopy, 'below the copy'); assert.equal(image.y + image.height, 1350, 'standing on the bottom edge')
  assert.equal(page.globalComposition, 'list', 'the slide keeps its composition')
  // If the cutout could not be made, the slide is simply its text layout, with no warning.
  const missing = generation.renderGlobalPost(forest, brand, copy, { slots: [] }, { id: 'global-x' }, crypto.randomUUID)
  assert.equal(missing.pages[1].globalComposition, 'list'); assert.equal(missing.pages[1].nodes.some(n => n.designRole === 'image'), false)
  assert.equal(missing.validation.warnings.some(w => /Slide 2/.test(w)), false)
  // A typography-only study never gets fill images.
  const textOnly = study.reconcileStudy(seeds[1])
  assert.equal(generation.globalLayoutPlan(textOnly, 'global-x', deck([{ headline: 'Capa' }, { ...list, design: { composition: 'list', image: subject } }]), brand).slots[1].needs_visual, false)
})

test('every post carries the brand, and list numbers line up with the first line of their item', () => {
  const textOnly = study.reconcileStudy(seeds[1])
  const bare = { ...textOnly, study: { ...textOnly.study, grammar: { ...textOnly.study.grammar, alignment: ['left'], branding: { logo: 'none', slideNumber: 'none', handle: 'none' } } } }
  const withLogo = { ...brand, logo: '/api/uploads/logo', logoVariants: { source: '/api/uploads/logo', inkLightness: .5, imageAspect: 3, bounds: { x: 0, y: 0, width: 1, height: 1 }, originalTransparent: 'orig', whiteTransparent: 'white', blackTransparent: 'black' } }
  const list = { format: 'single', headline: 'Resultados sustentáveis', body: '1. Redução de resíduos até 30%\n2. Eficiência energética melhorada 20%\n3. Otimização de materiais 15%' }
  const post = generation.renderGlobalPost(bare, withLogo, list, { slots: [] }, { id: 'global-x' }, crypto.randomUUID)
  const logo = post.nodes.find(n => n.designRole === 'logo')
  assert.ok(logo && logo.x === post.nodes.find(n => n.designRole === 'headline').x && logo.y < 200, 'logo top-left, on the copy edge')
  assert.ok(generation.renderGlobalPost(bare, brand, list, { slots: [] }, { id: 'global-x' }, crypto.randomUUID).nodes.some(n => n.designRole === 'brand-name'), 'a brand without a logo shows its name')
  const glyphs = post.nodes.filter(n => n.designRole === 'marker-glyph'), items = post.nodes.filter(n => n.designRole === 'item')
  assert.equal(glyphs.length, 3)
  glyphs.forEach((glyph, i) => {
    const firstLine = items[i].fontSize * items[i].lineHeight
    assert.ok(Math.abs((glyph.y + glyph.height / 2) - (items[i].y + firstLine / 2)) <= 3, `number ${i + 1} sits on its item's first line`)
  })
})

test('a studied headline box frames the headline (outline or filled panel), and a preview never shows two brand marks', () => {
  const textOnly = study.reconcileStudy(seeds[1])
  const boxed = frame => ({ ...textOnly, study: { ...textOnly.study, grammar: { ...textOnly.study.grammar, headline: { ...textOnly.study.grammar.headline, frame }, badge: 'logo' } } })
  const copy = { format: 'single', headline: 'Sumol+Compal', supportingText: 'Obras de reabilitação a decorrer.' }
  const outlined = generation.renderGlobalPost(boxed('outline'), brand, copy, { slots: [] }, { id: 'global-x' }, crypto.randomUUID).nodes
  const frameNode = outlined.find(n => n.designRole === 'headline-frame'), headline = outlined.find(n => n.designRole === 'headline')
  assert.ok(frameNode && frameNode.stroke && frameNode.fill === '#00000000', 'an outlined box')
  assert.ok(headline.x > frameNode.x && headline.y > frameNode.y && headline.x + headline.width < frameNode.x + frameNode.width && headline.y + headline.height < frameNode.y + frameNode.height, 'the headline sits inside its box')
  const body = outlined.find(n => n.designRole === 'body')
  assert.ok(body.y >= frameNode.y + frameNode.height, 'the copy below starts after the box')
  const solid = generation.renderGlobalPost(boxed('solid'), brand, copy, { slots: [] }, { id: 'global-x' }, crypto.randomUUID).nodes
  assert.ok(solid.find(n => n.designRole === 'headline-frame').fill !== '#00000000' && !solid.find(n => n.designRole === 'headline').fillType, 'a filled panel with solid lettering')
  // A brand without a logo in a study with a badge: the preview shows the initial tile OR the name, never both.
  const { previewSlide } = require('./globalDesigns.test.cjs').compose
  for (let i = 0; i < 4; i++) {
    const nodes = previewSlide(boxed('none'), { name: 'Your brand' }, i).nodes
    assert.ok(!(nodes.some(n => n.designRole === 'badge-mark') && nodes.some(n => n.designRole === 'brand-name')), `sample ${i + 1} has one brand mark`)
  }
})
