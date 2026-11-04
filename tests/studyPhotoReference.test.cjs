const { test } = require('node:test')
const assert = require('node:assert/strict')
const { seeds, study, compose } = require('./globalDesigns.test.cjs')

const brand = { name: 'KACHICA', colors: ['#3b0d06', '#e8541e', '#f5efe6'], fonts: [] }
const deck = { format: 'carousel', slides: compose.SAMPLE_DECK }

/** A study made from one example whose copy sits on a full-bleed photo, recorded the way a real analysis did. */
function photoStudy(composition, decorations = []) {
  const family = structuredClone(study.reconcileStudy(seeds[2]))
  const grammar = family.study.grammar
  grammar.compositions = ['statement', 'image-led']
  grammar.imagery = { ...grammar.imagery, positions: ['full'], frequency: 'every', cutout: 'never' }
  grammar.references = [{ composition, align: 'left', anchor: 'bottom', image: true, imagePos: 'full', callout: false, badge: true, frame: false }]
  grammar.decorations = decorations
  return family
}

test('an example with its copy on a full-bleed photo keeps the photo, whatever layout the analysis called it', () => {
  for (const recorded of ['statement', 'backdrop-type']) {
    const plans = compose.planSlides(photoStudy(recorded), deck)
    // The list sample stays a list, so its items read; every other sample shows the photo behind the copy.
    for (const [i, plan] of plans.entries()) {
      if (plan.composition === 'list') continue
      assert.equal(plan.composition, 'image-led', `${recorded}: sample ${i + 1}`)
      assert.equal(plan.withImage, true)
      assert.equal(plan.imagePos, 'full')
    }
    const page = compose.previewSlide(photoStudy(recorded), brand, 0)
    assert.ok(page.nodes.some(n => n.type === 'image' && n.src === compose.samplePhoto(photoStudy(recorded), 0).url), `${recorded}: the preview shows the sample photo`)
  }
})

test('stripes are drawn over the photo, away from the copy, fading toward it', () => {
  const stripes = { kind: 'stripes', placement: 'background', scale: 'large', opacity: 60, color: 'accent', frequency: 'every' }
  const page = compose.previewSlide(photoStudy('statement', [stripes]), brand, 0)
  const roles = page.nodes.map(n => n.designRole)
  const bands = page.nodes.filter(n => n.designRole === 'stripes')
  assert.ok(bands.length >= 8, `${bands.length} bands`)
  assert.ok(roles.lastIndexOf('stripes') > roles.indexOf('image') && roles.lastIndexOf('stripes') > roles.lastIndexOf('overlay'), 'over the photo and its shade')
  assert.ok(roles.indexOf('headline') > roles.lastIndexOf('stripes'), 'under the copy')
  // The copy sits at the bottom here, so the bands stay in the upper part and fade as they near it.
  const headline = page.nodes.find(n => n.designRole === 'headline')
  assert.ok(bands.every(b => b.y + b.height <= headline.y + 1), 'never across the headline')
  const alphaOf = fill => parseInt(String(fill).slice(7, 9) || 'ff', 16)
  assert.ok(alphaOf(bands[0].fill) > alphaOf(bands.at(-1).fill), 'fading toward the copy')
  assert.ok(bands.every(b => b.x === 0 && b.width === page.nodes.find(n => n.designRole === 'image').width), 'full width')
  // Between the bands the photo is shaded, so they read as bands of light on a light photo too.
  const colours = bands.map(b => String(b.fill).slice(0, 7).toLowerCase())
  assert.equal(new Set(colours).size, 2, colours.join(' '))
  assert.ok(colours.every((c, i) => i === 0 || c !== colours[i - 1]), 'bands and shade take turns')
  assert.ok(bands.every((b, i) => i === 0 || b.y === bands[i - 1].y + bands[i - 1].height), 'with no gap between them')
})

test('design previews use different sample photos per design and per sample', () => {
  const photoOf = (family, i) => compose.previewSlide(family, brand, i).nodes.find(n => n.designRole === 'image')?.src
  const family = photoStudy('statement')
  const samples = [0, 1, 3].map(i => photoOf(family, i))
  assert.ok(samples.every(src => compose.SAMPLE_IMAGES.photos.some(p => p.url === src)), samples.join(' '))
  assert.equal(new Set(samples).size, samples.length, 'each sample of one design shows another photo')
  // Different designs open on different photos, and a design always shows the same ones.
  const covers = Array.from({ length: 12 }, (_, i) => photoOf({ ...family, id: `family-${i}-x` }, 0))
  assert.ok(new Set(covers).size >= 5, covers.join(' '))
  assert.equal(photoOf(family, 0), photoOf(structuredClone(family), 0))
})
