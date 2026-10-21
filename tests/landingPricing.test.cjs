const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')

const load = file => stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))

const plans = new Function(load('lib/billing/plans.ts') +
  ';return { PLANS, PLAN_IDS, PAID_PLAN_IDS, TRIAL, CREDIT_PACK, NEWSLETTER_DISCOUNT, SLIDES_PER_POST, CONTACT, approxPosts, formatBytes, formatPrice, isComingSoon, pricingRows }')()

const PRICING_EXPORTS = 'freeMonths, yearlySavingLabel, monthlyEquivalent, priceParts, priceText, planHighlights, planCta, pricingFaqAnswer, creditFaqAnswer, pricingIntro, creditPackNote, trialNote, newsletterTitle, newsletterBlurb, newsletterConsent, newsletterOutcome'

/** components/landing/pricingText.js with plans.ts injected; `overrides` swaps in other plan numbers. */
function loadPricing(overrides = {}) {
  const deps = { ...plans, ...overrides }
  const names = Object.keys(deps)
  return new Function(...names, load('components/landing/pricingText.js') + `;return { ${PRICING_EXPORTS} }`)(...names.map(name => deps[name]))
}

const text = loadPricing()
const { PLANS } = plans

test('yearly prices show the yearly total and what it is per month', () => {
  assert.equal(text.monthlyEquivalent(190), '$15.83')
  assert.equal(text.monthlyEquivalent(490), '$40.83')
  assert.equal(text.monthlyEquivalent(120), '$10')
  assert.equal(text.priceText(PLANS.pro, 'year'), '$349.90 a year (≈ $29.16/month)')
  assert.equal(text.priceText(PLANS.business, 'year'), '$799.90 a year (≈ $66.66/month)')
  assert.equal(text.priceText(PLANS.pro, 'month'), '$34.99 a month')
  assert.equal(text.priceText(PLANS.free, 'year'), '$0')
  assert.deepEqual(text.priceParts(PLANS.business, 'month'), { amount: '$79.99', unit: 'a month', detail: 'Billed monthly' })
})

test('the yearly switch says how many months are free', () => {
  assert.equal(text.freeMonths(PLANS.pro), 2)
  assert.equal(text.freeMonths(PLANS.business), 2)
  assert.equal(text.freeMonths(PLANS.free), 0)
  assert.equal(text.yearlySavingLabel(), '2 months free')
  const noSaving = { ...PLANS, pro: { ...PLANS.pro, price: { month: 10, year: 120 } } }
  assert.equal(loadPricing({ PLANS: noSaving }).yearlySavingLabel(), '')
})

test('plan cards list the lines that differ between plans', () => {
  const free = text.planHighlights(PLANS.free)
  assert.deepEqual(free.map(line => line.text), [
    '1 brand', '30 credits a month (≈ 7 posts)', 'Standard AI images', 'Up to 20 of your own images', 'No schedule calendar or reminders',
    'Batkle’s designs; browse the ones members make', 'Facebook and Instagram ads',
  ])
  assert.deepEqual(free.map(line => line.included), [true, true, true, true, false, true, false])
  // Text reminders are "Coming soon", so the cards promise no number of texts.
  assert.deepEqual(text.planHighlights(PLANS.pro).map(line => line.text), [
    '2 brands', '150 credits a month (≈ 37 posts)', 'High-quality AI images', '2 GB for your own images',
    'Schedule calendar and email reminders', 'Create and share your own designs', 'Facebook and Instagram ads',
  ])
  assert.equal(text.planHighlights(PLANS.pro)[6].included, false, 'ads are part of Business')
  const business = text.planHighlights(PLANS.business)
  assert.equal(business[3].text, '10 GB for your own images')
  assert.equal(business[4].text, 'Schedule calendar and email reminders')
  assert.ok(business.every(line => line.included))

  const textsLive = loadPricing({ isComingSoon: () => false })
  assert.equal(textsLive.planHighlights(PLANS.pro)[4].text, 'Schedule calendar, email reminders and 30 text reminders a month')
  assert.equal(textsLive.planHighlights(PLANS.business)[4].text, 'Schedule calendar, email reminders and 100 text reminders a month')
})

test('Free starts the app; paid plans open the plan settings with the plan and period chosen', () => {
  assert.deepEqual(text.planCta(PLANS.free, 'year', '/app'), { href: '/app', label: 'Start free', note: 'Upgrade whenever you like.' })
  const pro = text.planCta(PLANS.pro, 'year', '/app')
  assert.equal(pro.href, '/app/settings?plan=pro&interval=year#plan')
  assert.equal(pro.label, 'Start 7-day free trial')
  assert.equal(pro.note, 'Card required. Cancel anytime before the trial ends.')
  assert.equal(text.planCta(PLANS.business, 'month', '/app').href, '/app/settings?plan=business&interval=month#plan')
  assert.equal(text.planCta(PLANS.business, 'nonsense', '/app').href, '/app/settings?plan=business&interval=month#plan')
  assert.equal(text.planCta({ ...PLANS.pro, trialDays: 0 }, 'month', '/app').label, 'Choose Pro')
})

test('the FAQ answers use the numbers in plans.ts', () => {
  assert.equal(text.pricingFaqAnswer(),
    'Start on the free plan: 1 brand and 30 credits a month, no card needed. Pro is $34.99 a month and Business $79.99 a month, ' +
    'each with a 7-day free trial, and paying yearly gets you 2 months free. Credits are images: a single post costs 1 credit, ' +
    'a carousel 1 per slide. See the plans above for everything each one includes.')
  assert.match(text.creditFaqAnswer(), /^One credit makes one image\./)
  assert.match(text.creditFaqAnswer(), /a 4-slide carousel uses 4/)
  assert.match(text.creditFaqAnswer(), /Extra credits are 100 for \$10, never expire/)

  const changed = loadPricing({
    PLANS: { ...PLANS, free: { ...PLANS.free, brands: 2, credits: 40 }, pro: { ...PLANS.pro, price: { month: 25, year: 250 } } },
    TRIAL: { ...plans.TRIAL, days: 14 },
    CREDIT_PACK: { ...plans.CREDIT_PACK, credits: 200, price: 15 },
  })
  assert.match(changed.pricingFaqAnswer(), /2 brands and 40 credits/)
  assert.match(changed.pricingFaqAnswer(), /Pro is \$25 a month/)
  assert.match(changed.pricingFaqAnswer(), /14-day free trial/)
  assert.match(changed.creditFaqAnswer(), /200 for \$15/)
})

test('the intro, notes and newsletter copy come from plans.ts', () => {
  assert.equal(text.pricingIntro(), 'Start free and upgrade when you need more. Pro and Business start with a 7-day free trial.')
  assert.deepEqual(text.creditPackNote(), { title: 'Extra credits.', text: '100 for $10, on any plan, and they never expire.' })
  assert.match(text.trialNote().text, /^Once per account, with 50 credits during the 7 days\./)
  assert.match(loadPricing({ isComingSoon: () => false }).trialNote().text, /^Once per account, with 50 credits and 5 text reminders during the 7 days\./)
  assert.equal(text.newsletterTitle(), '20% off your first payment')
  assert.equal(text.newsletterConsent(), 'Email me product news and a 20% discount code. Unsubscribe anytime.')
  const tenPercent = loadPricing({ NEWSLETTER_DISCOUNT: { percent: 10 } })
  assert.equal(tenPercent.newsletterTitle(), '10% off your first payment')
  assert.match(tenPercent.newsletterBlurb(), /10% off/)
})

test('the newsletter form only reports success the server confirmed', () => {
  assert.deepEqual(text.newsletterOutcome(200, { ok: true, message: 'Check your inbox for your code.' }), { ok: true, message: 'Check your inbox for your code.' })
  assert.equal(text.newsletterOutcome(200, { ok: true }).ok, true)
  assert.equal(text.newsletterOutcome(200, {}).ok, false)
  assert.equal(text.newsletterOutcome(200, null).ok, false)
  assert.equal(text.newsletterOutcome(500, { ok: true }).ok, false)
  assert.deepEqual(text.newsletterOutcome(400, { error: 'Enter a valid email address.' }), { ok: false, message: 'Enter a valid email address.' })
  assert.equal(text.newsletterOutcome(429, null).message, 'Too many tries. Please wait a minute and try again.')
  assert.equal(text.newsletterOutcome(503, { error: '' }).message, "The newsletter isn't available right now. Please try again later.")
  assert.equal(text.newsletterOutcome(502, null).message, 'Something went wrong. Please try again.')
})

test('the landing page has no pricing placeholders left', () => {
  const page = fs.readFileSync('components/landing/LandingPage.jsx', 'utf8')
  for (const placeholder of ['[ADD YOUR PRICING ANSWER', '[PLAN NAME]', '[PRICE]', '[FEATURE', '[Add your real plans']) {
    assert.ok(!page.includes(placeholder), `${placeholder} is still on the page`)
  }
  assert.match(page, /id="pricing"/)
  assert.match(page, /q: 'What is a credit\?'/)
})

test('the pricing components parse as JSX', t => {
  let parser
  try { parser = require('next/dist/compiled/babel/parser') } catch { return t.skip('no babel parser in node_modules') }
  for (const file of ['LandingPage.jsx', 'PricingPlans.jsx', 'NewsletterForm.jsx', 'pricingText.js']) {
    assert.doesNotThrow(() => parser.parse(fs.readFileSync(`components/landing/${file}`, 'utf8'), { sourceType: 'module', plugins: ['jsx'] }), file)
  }
})
