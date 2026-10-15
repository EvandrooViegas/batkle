const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DAY, setup } = require('./stripeTestHelpers.cjs')

const NOW = new Date('2026-10-15T09:00:00Z')
const OK = { status: 200, body: { ok: true, message: 'Check your inbox for your 20% discount code.' } }
const signUp = (t, body, { ip = '203.0.113.7', now = NOW } = {}) => t.stripe.subscribeToNewsletter(t.db, body, { ip, origin: 'https://batkle.test', now })
const subscribers = t => t.db.find('newsletterSubscribers')

test('a sign-up needs a valid email and consent, and stores nothing otherwise', async () => {
  const t = setup()
  // Each from its own address: every attempt counts towards the per-IP limit.
  let n = 0
  const ip = () => ({ ip: `192.0.2.${++n}` })
  for (const email of [undefined, '', 'not-an-email', 'a@b', 'two words@example.com', `${'x'.repeat(250)}@example.com`, 42]) {
    await assert.rejects(signUp(t, { email, consent: true }, ip()), e => e.status === 400 && /valid email/.test(e.message), String(email))
  }
  for (const consent of [undefined, false, 'yes', 1]) {
    await assert.rejects(signUp(t, { email: 'ann@example.com', consent }, ip()), e => e.status === 400 && /Tick the box/.test(e.message), String(consent))
  }
  await assert.rejects(signUp(t, null, ip()), e => e.status === 400)
  assert.equal(subscribers(t).length, 0)
  assert.equal(t.fake.calls.length, 0)
})

test('a new subscriber gets one single-use code for a first payment, by email', async () => {
  const t = setup()
  assert.deepEqual(await signUp(t, { email: '  Ann@Example.COM ', consent: true }), OK)
  const [subscriber] = subscribers(t)
  assert.equal(subscriber.email, 'ann@example.com')
  assert.equal(subscriber.source, 'landing')
  assert.equal(new Date(subscriber.consentAt).getTime(), NOW.getTime())
  assert.match(subscriber.id, /^nl_[0-9a-f]{24}$/)

  // The coupon is made the first time it is needed.
  assert.deepEqual(t.fake.last('coupons.create')[0], { id: 'NEWSLETTER20', percent_off: 20, duration: 'once', name: 'Newsletter: 20% off the first payment' })
  const [params, options] = t.fake.last('promotionCodes.create')
  assert.deepEqual(params, { promotion: { type: 'coupon', coupon: 'NEWSLETTER20' }, max_redemptions: 1, restrictions: { first_time_transaction: true }, metadata: { source: 'newsletter', subscriberId: subscriber.id } })
  assert.equal(options.idempotencyKey, `newsletter-code-${subscriber.id}`)
  assert.equal(subscriber.promotionCode, 'CODE1')

  assert.equal(t.sent.length, 1)
  const [mail] = t.sent
  assert.equal(mail.to, 'ann@example.com')
  assert.match(mail.subject, /20% off/)
  assert.match(mail.html, /CODE1/)
  assert.match(mail.text, /CODE1/)
  assert.match(mail.text, /https:\/\/batkle\.test\/app\/settings#plan/)
  assert.equal(mail.idempotencyKey, `newsletter-${subscriber.id}-2026-10-15`)
})

test('signing up again never makes a second code, resends at most once a day, and answers the same', async () => {
  const t = setup()
  const first = await signUp(t, { email: 'ann@example.com', consent: true })
  const again = await signUp(t, { email: 'ANN@example.com', consent: true }, { now: new Date(NOW.getTime() + 60_000) })
  assert.deepEqual(again, first)
  assert.equal(t.sent.length, 1, 'no second email the same day')
  assert.equal(t.fake.count('promotionCodes.create'), 1)

  const tomorrow = new Date(NOW.getTime() + DAY + 60_000)
  assert.deepEqual(await signUp(t, { email: 'ann@example.com', consent: true }, { now: tomorrow }), OK)
  assert.equal(t.sent.length, 2)
  assert.match(t.sent[1].text, /CODE1/, 'the same code again')
  assert.equal(t.fake.count('promotionCodes.create'), 1)
  assert.equal(t.fake.state.promotionCodes.length, 1)
  assert.equal(subscribers(t).length, 1)
  assert.equal(new Date(subscribers(t)[0].consentAt).getTime(), tomorrow.getTime(), 'the latest consent is kept')

  // A new address gets its own code; the coupon is not made again.
  assert.deepEqual(await signUp(t, { email: 'bo@example.com', consent: true }, { now: tomorrow }), OK)
  assert.equal(t.fake.count('coupons.create'), 1)
  assert.deepEqual(t.fake.state.promotionCodes.map(p => p.code), ['CODE1', 'CODE2'])
})

test('two sign-ups racing for one address end with one code', async () => {
  const t = setup({ ignoreIdempotency: true })
  const results = await Promise.all([1, 2, 3].map(() => signUp(t, { email: 'ann@example.com', consent: true })))
  for (const result of results) assert.deepEqual(result, OK)
  const [subscriber] = subscribers(t)
  const active = t.fake.state.promotionCodes.filter(p => p.active)
  assert.equal(active.length, 1, 'spare codes are switched off')
  assert.equal(active[0].code, subscriber.promotionCode)
  assert.equal(t.sent.length, 1)
  assert.match(t.sent[0].text, new RegExp(subscriber.promotionCode))
})

test('without email or payments set up the subscriber is kept and the answer is a plain 503', async () => {
  const t = setup({ env: { RESEND_API_KEY: '' } })
  const result = await signUp(t, { email: 'ann@example.com', consent: true })
  assert.equal(result.status, 503)
  assert.match(result.body.error, /on the list/)
  assert.doesNotMatch(result.body.error, /stripe|resend/i)
  assert.equal(subscribers(t).length, 1)
  assert.equal(t.fake.calls.length, 0)
  assert.equal(t.sent.length, 0)

  // Once email works, the same address gets its code.
  t.env.RESEND_API_KEY = 're_fake'
  assert.deepEqual(await signUp(t, { email: 'ann@example.com', consent: true }), OK)
  assert.equal(t.sent.length, 1)

  const noStripe = setup({ env: { STRIPE_SECRET_KEY: '' } })
  assert.equal((await signUp(noStripe, { email: 'ann@example.com', consent: true })).status, 503)
  assert.equal(subscribers(noStripe).length, 1)
})

test('an email or code that fails answers 503, and the next try sends it', async () => {
  const t = setup()
  t.mail.failNext = true
  assert.equal((await signUp(t, { email: 'ann@example.com', consent: true })).status, 503)
  assert.equal(t.sent.length, 0)
  assert.deepEqual(await signUp(t, { email: 'ann@example.com', consent: true }), OK)
  assert.equal(t.sent.length, 1)
  assert.equal(t.fake.count('promotionCodes.create'), 1)

  t.fake.state.fail['promotionCodes.create'] = Object.assign(new Error('Stripe is down'), { type: 'StripeAPIError' })
  const failed = await signUp(t, { email: 'bo@example.com', consent: true })
  assert.equal(failed.status, 503)
  assert.doesNotMatch(failed.body.error, /stripe/i)
})

test('sign-ups are rate limited per address and per IP', async () => {
  const t = setup()
  for (let i = 0; i < 5; i++) assert.equal((await signUp(t, { email: 'ann@example.com', consent: true }, { ip: `198.51.100.${i}` })).status, 200)
  await assert.rejects(signUp(t, { email: 'ann@example.com', consent: true }, { ip: '198.51.100.99' }), e => e.status === 429)
  assert.equal(t.sent.length, 1)

  const u = setup()
  for (let i = 0; i < 10; i++) await signUp(u, { email: `person${i}@example.com`, consent: true })
  await assert.rejects(signUp(u, { email: 'one-more@example.com', consent: true }), e => e.status === 429 && /Too many tries/.test(e.message))
  // A new hour, a new window.
  assert.equal((await signUp(u, { email: 'one-more@example.com', consent: true }, { now: new Date(NOW.getTime() + 61 * 60_000) })).status, 200)
  // Counters only keep a hash of the address and the IP.
  assert.ok(u.db.find('newsletterRateLimits').every(row => !/example|203\.0/.test(row._id)))
})

test('every discount email carries the subscriber’s own unsubscribe link, which works once and is undone by signing up again', async () => {
  const t = setup()
  await signUp(t, { email: 'ann@example.com', consent: true })
  const [subscriber] = subscribers(t)
  assert.match(subscriber.unsubscribeToken, /^[0-9a-f]{32}$/)
  const link = `https://batkle.test/api/newsletter/unsubscribe?token=${subscriber.unsubscribeToken}`
  assert.ok(t.sent[0].html.includes(link), 'the html email links to it')
  assert.ok(t.sent[0].text.includes(`Unsubscribe: ${link}`), 'so does the text version')

  for (const token of [undefined, '', 'nope', subscriber.unsubscribeToken.toUpperCase(), `${subscriber.unsubscribeToken}0`]) {
    assert.equal(await t.stripe.unsubscribeFromNewsletter(t.db, token, NOW), false, String(token))
  }
  assert.equal(subscribers(t)[0].unsubscribedAt ?? null, null)
  assert.equal(await t.stripe.unsubscribeFromNewsletter(t.db, subscriber.unsubscribeToken, NOW), true)
  assert.equal(new Date(subscribers(t)[0].unsubscribedAt).getTime(), NOW.getTime())
  assert.equal(await t.stripe.unsubscribeFromNewsletter(t.db, subscriber.unsubscribeToken, NOW), true, 'twice is fine')

  await signUp(t, { email: 'ann@example.com', consent: true }, { now: new Date(NOW.getTime() + DAY + 60_000) })
  assert.equal(subscribers(t)[0].unsubscribedAt, null, 'a new sign-up is a new consent')
  assert.equal(subscribers(t)[0].unsubscribeToken, subscriber.unsubscribeToken, 'the link stays the same')
})
