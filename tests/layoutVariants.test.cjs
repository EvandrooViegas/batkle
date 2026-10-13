const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { seeds, study, compose, generation } = require('./globalDesigns.test.cjs')

const [timeline, editorial, escape] = seeds.map(s => study.reconcileStudy(s))
// The photo study turned into one with photographs inside the layout (not behind the copy), so photo variants apply.
const framed = study.reconcileStudy({ ...seeds[2], id: 'framed-test', study: { ...seeds[2].study, imagery: { ...seeds[2].study.imagery, mode: 'contained', usage: 'Photographs inside the layout beside the copy.' }, grammar: { ...seeds[2].study.grammar, compositions: ['statement', 'stacked', 'image-led', 'list', 'closing'], imagery: { ...seeds[2].study.grammar.imagery, positions: ['top', 'bottom'], frequency: 'most', cutout: 'never' } } } })
const brand = { id: 'b', name: 'Brand', colors: ['#14131A', '#FFD84D', '#F6F3EA'], fonts: ['Inter', 'Inter'] }
const W = 1080, H = 1350

const slidesFor = n => Array.from({ length: n }, (_, i) => i === 2
  ? { headline: 'Four steps', body: '1. Plan the visit\n2. Measure the space\n3. Agree the budget\n4. Start the work' }
  : { headline: ['Build with less risk', 'Every detail checked', 'Clear plans, calm sites', 'Ready to talk?', 'Start with a visit', 'Quality you can see', 'One team, one plan'][i % 7], body: 'A short line that explains the point of this slide.', ...(i === n - 1 ? { cta: 'Book a visit' } : {}) })

/** Copy never collides: every text block stays inside the canvas and no two blocks overlap. */
function assertClean(page, label) {
  const texts = page.nodes.filter(n => n.type === 'text' && n.designRole !== 'backdrop-type')
  for (const t of texts) {
    assert.ok(t.x >= -1 && t.y >= -1 && t.x + t.width <= W + 1 && t.y + t.height <= H + 1, `${label}: ${t.designRole} leaves the canvas`)
  }
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j]
    const ix = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), iy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
    assert.ok(!(ix > 2 && iy > 2), `${label}: ${a.designRole} overlaps ${b.designRole}`)
  }
}

test('single posts in one design open with different layouts instead of one repeated cover', () => {
  for (const family of [timeline, editorial, framed]) {
    const covers = new Set(Array.from({ length: 40 }, (_, i) => {
      const plan = compose.planSlides(family, { format: 'single', headline: `Idea number ${i} for the business`, body: 'A short supporting line.' })[0]
      return [plan.composition, plan.variant, plan.photo, plan.anchor].join('/')
    }))
    assert.ok(covers.size >= 4, `${family.name}: only ${covers.size} cover layouts in 40 posts`)
  }
})

test('a carousel varies its layout variants: no slide repeats the previous one', () => {
  for (const family of [timeline, editorial, escape, framed]) {
    const copy = { format: 'carousel', slides: slidesFor(7) }
    const plans = compose.planSlides(family, copy)
    plans.forEach((plan, i) => {
      const previous = plans[i - 1]
      if (previous && plan.variant && previous.variant) assert.notEqual(plan.variant, previous.variant, `${family.name} slide ${i + 1}`)
    })
    const kinds = new Set(plans.map(p => p.listStyle || p.variant))
    assert.ok(kinds.size >= 4, `${family.name}: ${[...kinds]}`)
  }
})

test('a study built on a photograph behind the copy keeps it full bleed', () => {
  for (let i = 0; i < 30; i++) {
    const plan = compose.planSlides(escape, { format: 'single', headline: `Escape ${i}`, body: 'Go somewhere quiet.' })[0]
    assert.ok(!plan.photo || plan.photo === 'bleed', plan.photo)
  }
})

test('every text and list variant composes cleanly in every typography study', () => {
  const copy = { format: 'carousel', slides: slidesFor(5) }
  for (const family of [timeline, editorial]) {
    const plans = compose.planSlides(family, copy)
    for (const variant of ['classic', 'rule', 'quote', 'panel', 'sidebar', 'band']) {
      for (const index of [0, 1, 4]) {
        const plan = { ...plans[index], composition: plans[index].composition === 'list' ? 'statement' : plans[index].composition, variant }
        const page = compose.composeSlide(family, brand, copy.slides[index], plan, index, 5)
        assertClean(page, `${family.name} ${variant} slide ${index + 1}`)
        // A study with branding along the bottom never gets a band (the planner does not offer it there).
        const bottomBranding = Object.values(study.familyGrammar(family).branding).some(pos => String(pos).startsWith('bottom'))
        if (variant === 'band' && !bottomBranding) assert.ok(page.nodes.some(n => n.designRole === 'band'), `${family.name}: band drawn`)
      }
    }
    for (const listStyle of ['rows', 'numerals', 'timeline', 'grid']) {
      const page = compose.composeSlide(family, brand, copy.slides[2], { ...plans[2], composition: 'list', listStyle }, 2, 5)
      assertClean(page, `${family.name} list ${listStyle}`)
      if (listStyle === 'grid') assert.equal(page.nodes.filter(n => n.designRole === 'item-card').length, 4, 'four cells')
      if (listStyle === 'timeline') assert.equal(page.nodes.filter(n => n.designRole === 'timeline').length, 3, 'three connecting lines')
      if (listStyle === 'numerals') assert.ok(page.nodes.some(n => n.designRole === 'marker-glyph' && n.text === '04'))
    }
  }
})

test('photo variants: an inset card or a circle sits clear of the copy and the branding rows', () => {
  const slide = { headline: 'A finished kitchen', body: 'Built in six weeks, on budget.' }
  const base = compose.planSlides(framed, { format: 'single', ...slide })[0]
  for (const photo of ['bleed', 'card', 'circle']) for (const imagePos of ['top', 'bottom', 'full']) {
    const plan = { ...base, composition: 'image-led', withImage: true, cutout: false, photo, imagePos }
    const page = compose.composeSlide(framed, brand, slide, plan, 0, 1, { image: '/api/uploads/photo', imageSize: { width: 1600, height: 1066 } })
    assertClean(page, `${photo}/${imagePos}`)
    const image = page.nodes.find(n => n.designRole === 'image')
    if (photo === 'circle') { assert.equal(image.mask, 'circle'); assert.equal(image.width, image.height) }
    if (photo === 'card') assert.ok(image.borderRadius > 0 && image.x > 0 && image.width < W)
    if (photo !== 'bleed') for (const text of page.nodes.filter(n => n.type === 'text')) {
      const ix = Math.min(image.x + image.width, text.x + text.width) - Math.max(image.x, text.x), iy = Math.min(image.y + image.height, text.y + text.height) - Math.max(image.y, text.y)
      assert.ok(!(ix > 0 && iy > 0), `${photo}/${imagePos}: ${text.designRole} on the photo`)
    }
  }
})

test('real posts in every variant pass validation for several brands', () => {
  const brands = [brand, { id: 'c', name: 'Clara', colors: ['#f5ecd7', '#d62828'], fonts: ['Bebas Neue', 'Arial'] }, { id: 'd', name: 'Deep', designTokens: { primary: '#0a1f44', accent: '#00c2ff', background: '#f4f8ff' }, fonts: ['Poppins', 'Poppins'] }]
  for (const family of [timeline, editorial, framed]) for (const b of brands) for (let k = 0; k < 6; k++) {
    const copy = { format: 'carousel', slides: slidesFor(5).map(s => ({ ...s, headline: `${s.headline} ${k}` })) }
    const resolved = { slots: copy.slides.map((_, i) => ({ slot_id: `slide_${i + 1}`, resolvedAsset: { url: `/api/uploads/photo-${i}`, width: 1600, height: 1066 } })) }
    const post = generation.renderGlobalPost(family, b, copy, resolved, { id: 'global-' + family.id }, crypto.randomUUID)
    assert.ok(post.validation.passed, post.validation.errors.join('; '))
    post.pages.forEach((page, i) => assertClean(page, `${family.name}/${b.name}/${k} slide ${i + 1}`))
  }
})

test('the image choice: off asks for no image, on asks on every non-list slide, auto follows the design', () => {
  const subject = { subject: 'a builder measuring a wall', queries: ['builder measuring'] }
  const copy = choice => ({ format: 'carousel', ...(choice === 'auto' ? {} : { imageChoice: choice }), slides: slidesFor(5).map(s => ({ ...s, design: { image: subject } })) })
  const needs = (family, choice) => generation.globalLayoutPlan(family, 'global-x', copy(choice), brand).slots.map(s => s.needs_visual)
  assert.deepEqual(needs(framed, 'off'), [false, false, false, false, false])
  assert.deepEqual(needs(escape, 'off'), [false, false, false, false, false])
  // Every non-list slide asks for an image; the list slide may only get a cutout in the space below its items.
  const on = needs(framed, 'on'), auto = needs(framed, 'auto')
  assert.ok([0, 1, 3, 4].every(i => on[i]), JSON.stringify(on))
  assert.ok(on.filter(Boolean).length >= auto.filter(Boolean).length)
  assert.ok(compose.planSlides(framed, copy('on')).every((p, i) => i === 2 ? p.composition === 'list' && !p.withImage : p.withImage))
  // A typography-only study adds cutouts where the copy leaves room only when images are requested.
  assert.ok(!needs(timeline, 'auto').some(Boolean))
  assert.ok(needs(timeline, 'on').some(Boolean))
  assert.ok(!needs(timeline, 'off').some(Boolean))
})

test('the person\'s own photo still shows when images are off', () => {
  const copy = { format: 'single', imageChoice: 'off', headline: 'Our latest project', body: 'Finished last week.', design: { image: { subject: '', upload: 'p1' } } }
  assert.equal(compose.planSlides(escape, copy)[0].withImage, true)
})

test('a counted carousel numbers every content slide in order, never just one slide', () => {
  let counted = 0
  for (const family of [timeline, editorial, escape, framed]) for (let k = 0; k < 30; k++) {
    const copy = { format: 'carousel', slides: slidesFor(6).map(s => ({ ...s, headline: `${s.headline} ${k}` })) }
    const numbers = compose.planSlides(family, copy).map(p => p.number)
    const content = numbers.slice(1, -1)
    // All or nothing: either every content slide carries its number, or no slide does.
    if (content.some(Boolean)) {
      counted++
      assert.deepEqual(content, ['01', '02', '03', '04'], `${family.name} post ${k}`)
    } else assert.ok(numbers.every(n => !n))
    assert.equal(numbers[0], undefined, 'the cover is not numbered')
    assert.equal(numbers[numbers.length - 1], undefined, 'the closing slide is not numbered')
  }
  assert.ok(counted > 0, 'some carousels are counted')
})

test('a numbered slide shows its number above the copy, in text and list layouts, without collisions', () => {
  const copy = { format: 'carousel', slides: slidesFor(5) }
  for (const family of [timeline, editorial, framed]) {
    const plans = compose.planSlides(family, copy)
    for (const [index, composition, extra] of [[1, 'statement', { variant: 'classic' }], [1, 'statement', { variant: 'band' }], [2, 'list', { listStyle: 'rows' }], [2, 'list', { listStyle: 'grid' }]]) {
      const page = compose.composeSlide(family, brand, copy.slides[index], { ...plans[index], composition, withImage: false, ...extra, number: '02' }, index, 5)
      assertClean(page, `${family.name} ${composition} ${JSON.stringify(extra)}`)
      const lead = page.nodes.find(n => n.designRole === 'lead'), headline = page.nodes.find(n => n.designRole === 'headline')
      assert.equal(lead?.text, '02')
      assert.ok(lead.y + lead.height <= headline.y, 'the number sits above the headline')
    }
  }
})

test('a short single post never shows a slide number', () => {
  for (let k = 0; k < 40; k++) assert.equal(compose.planSlides(timeline, { format: 'single', headline: `Idea ${k}`, body: 'Short.' })[0].number, undefined)
})
