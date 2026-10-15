const { test } = require('node:test')
const assert = require('node:assert/strict')
const { seeds, study, compose } = require('./globalDesigns.test.cjs')

const families = seeds.map(s => study.reconcileStudy(s))
const brand = { id: 'b', name: 'Brand', colors: ['#14131A', '#FFD84D', '#F6F3EA'], fonts: ['Inter', 'Inter'] }
// The planner proposes a composition for every slide; the last slide here asks for an ordinary one.
const deck = (proposed, extra = {}) => ({ format: 'carousel', ...extra, slides: [
  { headline: 'Why most renovations run late', body: 'Swipe to see the three causes.', cta: '', design: { composition: proposed } },
  { headline: 'Plans change on site', body: 'Decisions made late cost weeks.', cta: '', design: { composition: proposed } },
  { headline: 'Materials arrive late', body: 'Order long-lead items first.', cta: 'Send us a message', design: { composition: proposed } },
  { headline: 'Decide early, build calmly', body: 'A clear plan keeps your renovation on time.', cta: 'Save this post for your next project', design: { composition: proposed } },
] })

test('the last slide of a carousel always takes the closing arrangement when the design has one', () => {
  // Designs that put a photograph on every slide keep it on the last one too (next test).
  for (const family of families.filter(f => study.familyGrammar(f).compositions.includes('closing') && study.familyGrammar(f).imagery.frequency !== 'every')) {
    for (const proposed of study.familyGrammar(family).compositions.filter(c => c !== 'closing' && c !== 'list')) {
      const plans = compose.planSlides(family, deck(proposed))
      const last = plans.at(-1)
      assert.equal(last.closing, true, `${family.id}: the last plan is marked as the closing beat`)
      assert.equal(last.composition, 'closing', `${family.id}: "${proposed}" proposed for the last slide still ends on the closing arrangement`)
      assert.ok(plans.slice(0, -1).every(p => !p.closing && p.composition !== 'closing'), `${family.id}: only the last slide closes`)
    }
  }
})

test('a design with a photograph on every slide, or images asked for on every slide, keeps the last slide as planned', () => {
  const photo = families.find(f => study.familyGrammar(f).imagery.frequency === 'every')
  assert.ok(photo, 'one built-in design puts a photograph on every slide')
  for (const copy of [deck('image-led'), deck('image-led', { imageChoice: 'on' })]) {
    const plans = compose.planSlides(photo, copy)
    assert.equal(plans.at(-1).composition, 'image-led')
    assert.equal(plans.at(-1).closing, true, 'it is still the closing beat, so its call to action leads')
  }
})

test('the closing call to action is the sign-off: larger than on other slides and below the rest of the copy', () => {
  for (const family of families) {
    const copy = deck('statement')
    const plans = compose.planSlides(family, copy)
    const page = index => compose.composeSlide(family, brand, copy.slides[index], plans[index], index, copy.slides.length, plans[index].withImage ? { image: 'https://images.test/photo.jpg', imageSize: { width: 1200, height: 1500 } } : {})
    const cta = p => p.nodes.find(n => n.designRole === 'cta')
    const middle = page(2), closing = page(3)
    assert.ok(cta(closing), `${family.id}: the closing slide shows its call to action`)
    assert.ok(cta(closing).fontSize > cta(middle).fontSize, `${family.id}: the closing call to action is the prominent one`)
    const copyBottom = Math.max(...closing.nodes.filter(n => n.type === 'text' && /headline|body/.test(n.designRole || '')).map(n => n.y + n.height))
    assert.ok(cta(closing).y >= copyBottom, `${family.id}: the call to action comes after the headline and body`)
  }
})
