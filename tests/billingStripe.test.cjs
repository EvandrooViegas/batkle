const { test } = require('node:test')
const assert = require('node:assert/strict')
const { RealStripe, DAY, setup, subscription } = require('./stripeTestHelpers.cjs')
const setupScript = require('../scripts/stripe-setup.cjs')

const USER = { userId: 'user_1', email: 'ann@example.com', name: 'Ann Lee' }
const ORIGIN = 'https://batkle.test'
const plan = (planId, interval = 'month') => ({ kind: 'plan', planId, interval })
const billing = (t, id = 'user_1') => t.db.one('billingAccounts', { id })
const event = (id, type, object) => ({ id, object: 'event', type, data: { object } })

test('a first plan checkout makes the customer, offers the trial and carries the account in metadata', async () => {
  const t = setup()
  const result = await t.stripe.createCheckoutSession(t.db, USER, plan('pro'), ORIGIN)
  assert.match(result.url, /^https:\/\/checkout\.stripe\.test\//)
  assert.deepEqual(t.fake.last('customers.create')[0], { email: 'ann@example.com', name: 'Ann Lee', metadata: { userId: 'user_1' } })
  assert.equal(billing(t).stripeCustomerId, 'cus_1')
  const [params] = t.fake.last('checkout.sessions.create')
  const metadata = { userId: 'user_1', kind: 'plan', planId: 'pro', interval: 'month' }
  assert.equal(params.mode, 'subscription')
  assert.equal(params.customer, 'cus_1')
  assert.equal(params.client_reference_id, 'user_1')
  assert.deepEqual(params.metadata, metadata)
  assert.deepEqual(params.line_items, [{ price: 'price_batkle_pro_monthly', quantity: 1 }])
  assert.equal(params.allow_promotion_codes, true)
  assert.equal(params.payment_method_collection, 'always')
  assert.deepEqual(params.subscription_data, { metadata, trial_period_days: 7, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } })
  assert.equal(params.success_url, 'https://batkle.test/app/settings?checkout=success#plan')
  assert.equal(params.cancel_url, 'https://batkle.test/app/settings?checkout=cancelled#plan')

  // The same customer next time, and the yearly price.
  await t.stripe.createCheckoutSession(t.db, USER, plan('business', 'year'), ORIGIN)
  assert.equal(t.fake.count('customers.create'), 1)
  const [yearly] = t.fake.last('checkout.sessions.create')
  assert.deepEqual(yearly.line_items, [{ price: 'price_batkle_business_yearly', quantity: 1 }])
  assert.equal(yearly.subscription_data.metadata.interval, 'year')
})

test('no trial once the account has had one, or once it had any subscription', async () => {
  const t = setup()
  await t.account.loadBilling(t.db, 'user_1')
  await t.db.collection('billingAccounts').updateOne({ id: 'user_1' }, { $set: { trialUsed: true } })
  await t.stripe.createCheckoutSession(t.db, USER, plan('pro'), ORIGIN)
  let [params] = t.fake.last('checkout.sessions.create')
  assert.equal(params.payment_method_collection, 'always')
  assert.deepEqual(params.subscription_data, { metadata: { userId: 'user_1', kind: 'plan', planId: 'pro', interval: 'month' } })

  // A subscription that ended: a new checkout, without a trial.
  await t.account.loadBilling(t.db, 'user_2')
  await t.db.collection('billingAccounts').updateOne({ id: 'user_2' }, { $set: { stripeSubscriptionId: 'sub_old', status: 'canceled', plan: 'pro' } })
  await t.stripe.createCheckoutSession(t.db, { userId: 'user_2', email: 'bo@example.com' }, plan('pro'), ORIGIN)
  ;[params] = t.fake.last('checkout.sessions.create')
  assert.equal(params.subscription_data.trial_period_days, undefined)
  assert.equal(params.subscription_data.trial_settings, undefined)
})

test('the credit pack is a one-time payment that carries its credits', async () => {
  const t = setup()
  await t.stripe.createCheckoutSession(t.db, USER, { kind: 'credits' }, ORIGIN)
  const [params] = t.fake.last('checkout.sessions.create')
  const metadata = { userId: 'user_1', kind: 'credits', credits: '100' }
  assert.equal(params.mode, 'payment')
  assert.deepEqual(params.line_items, [{ price: 'price_batkle_credits_100', quantity: 1 }])
  assert.deepEqual(params.metadata, metadata)
  assert.deepEqual(params.payment_intent_data, { metadata })
  assert.equal(params.client_reference_id, 'user_1')
  assert.equal(params.allow_promotion_codes, true)
  assert.equal(params.subscription_data, undefined)
  assert.match(params.success_url, /\/app\/settings\?checkout=success#credits$/)
})

test('an account that already subscribes changes plan in the portal, never with a second subscription', async () => {
  const t = setup()
  await t.stripe.createCheckoutSession(t.db, USER, plan('pro'), ORIGIN)
  // Stripe has the subscription, but its webhook has not arrived: the account doesn't know yet.
  t.fake.state.subscriptions.set('sub_1', subscription())
  assert.equal(billing(t).stripeSubscriptionId, undefined)
  const checkouts = t.fake.count('checkout.sessions.create')

  const result = await t.stripe.createCheckoutSession(t.db, USER, plan('business', 'year'), ORIGIN)
  assert.equal(t.fake.count('checkout.sessions.create'), checkouts, 'no new checkout')
  assert.match(result.url, /^https:\/\/billing\.stripe\.test\//)
  const [portal] = t.fake.last('billingPortal.sessions.create')
  assert.equal(portal.customer, 'cus_1')
  assert.equal(portal.configuration, 'bpc_batkle')
  assert.equal(portal.return_url, 'https://batkle.test/app/settings#plan')
  assert.deepEqual(portal.flow_data, {
    type: 'subscription_update_confirm',
    subscription_update_confirm: { subscription: 'sub_1', items: [{ id: 'si_sub_1', price: 'price_batkle_business_yearly', quantity: 1 }] },
    after_completion: { type: 'redirect', redirect: { return_url: 'https://batkle.test/app/settings?checkout=success#plan' } },
  })

  await assert.rejects(t.stripe.createCheckoutSession(t.db, USER, plan('pro'), ORIGIN), e => e.status === 409 && /already on this plan/.test(e.message))

  // A trial can switch too; one set to end or failing to pay opens the portal's main page first.
  t.fake.state.subscriptions.set('sub_1', subscription({ status: 'trialing', trialEndDays: 5 }))
  await t.stripe.createCheckoutSession(t.db, USER, plan('business'), ORIGIN)
  assert.equal(t.fake.last('billingPortal.sessions.create')[0].flow_data.type, 'subscription_update_confirm')
  for (const changes of [{ cancelAtPeriodEnd: true }, { status: 'past_due' }, { status: 'unpaid' }]) {
    t.fake.state.subscriptions.set('sub_1', subscription(changes))
    await t.stripe.createCheckoutSession(t.db, USER, plan('business'), ORIGIN)
    assert.equal(t.fake.last('billingPortal.sessions.create')[0].flow_data, undefined, JSON.stringify(changes))
  }
  assert.equal(t.fake.count('checkout.sessions.create'), checkouts)

  // Credit packs are still bought at checkout, and an ended subscription doesn't block a new one.
  await t.stripe.createCheckoutSession(t.db, USER, { kind: 'credits' }, ORIGIN)
  t.fake.state.subscriptions.set('sub_1', subscription({ status: 'canceled' }))
  await t.stripe.createCheckoutSession(t.db, USER, plan('pro'), ORIGIN)
  assert.equal(t.fake.count('checkout.sessions.create'), checkouts + 2)
})

test('a saved customer Stripe no longer has is replaced', async () => {
  const t = setup()
  await t.account.loadBilling(t.db, 'user_1')
  await t.db.collection('billingAccounts').updateOne({ id: 'user_1' }, { $set: { stripeCustomerId: 'cus_from_test_mode' } })
  await t.stripe.createCheckoutSession(t.db, USER, { kind: 'credits' }, ORIGIN)
  assert.equal(t.fake.count('customers.create'), 1)
  assert.equal(billing(t).stripeCustomerId, 'cus_1')
  assert.equal(t.fake.last('checkout.sessions.create')[0].customer, 'cus_1')
})

test('purchases are checked, and nothing reaches Stripe without payments set up', async () => {
  const t = setup()
  assert.deepEqual(t.stripe.readPurchase({ planId: 'business', interval: 'year' }), plan('business', 'year'))
  assert.deepEqual(t.stripe.readPurchase({ credits: true }), { kind: 'credits' })
  for (const body of [null, {}, { planId: 'gold', interval: 'month' }, { planId: 'free', interval: 'month' }, { planId: 'pro' }, { planId: 'pro', interval: 'week' }, { credits: 'yes' }]) {
    assert.throws(() => t.stripe.readPurchase(body), e => e.status === 400, JSON.stringify(body))
  }
  // Batkle's own messages are shown as written, even ones that mention billing.
  try { t.stripe.readPurchase({ planId: 'free' }) } catch (error) {
    assert.deepEqual(t.stripe.billingErrorResponse(error), { status: 400, body: { error: 'Free needs no checkout. To move to Free, cancel your plan in Manage billing.' } })
  }
  // Stripe's own messages never are.
  const stripeError = Object.assign(new Error("No such price: 'price_x'"), { type: 'StripeInvalidRequestError', statusCode: 400 })
  const response = t.stripe.billingErrorResponse(stripeError)
  assert.equal(response.status, 502)
  assert.doesNotMatch(response.body.error, /price_x|stripe/i)

  // A lookup key Stripe doesn't have (the setup script never ran): payments_unavailable.
  t.fake.state.prices = t.fake.state.prices.filter(p => p.lookup_key !== 'batkle_pro_yearly')
  await assert.rejects(t.stripe.createCheckoutSession(t.db, USER, plan('pro', 'year'), ORIGIN), e => e.status === 503 && e.code === 'payments_unavailable')

  t.env.STRIPE_SECRET_KEY = ''
  assert.equal(t.stripe.paymentsConfigured(), false)
  const calls = t.fake.calls.length
  for (const attempt of [t.stripe.createCheckoutSession(t.db, USER, plan('pro'), ORIGIN), t.stripe.createPortalSession(t.db, 'user_1', ORIGIN)]) {
    const error = await attempt.then(() => null, e => e)
    assert.equal(error.code, 'payments_unavailable')
    assert.deepEqual(t.stripe.billingErrorResponse(error), { status: 503, body: { error: 'Payments aren’t set up yet. Please try again later.', code: 'payments_unavailable' } })
  }
  assert.equal(t.fake.calls.length, calls)
})

test('the billing portal needs a customer and opens with Batkle’s portal settings', async () => {
  const t = setup()
  await assert.rejects(t.stripe.createPortalSession(t.db, 'user_1', ORIGIN), e => e.status === 400)
  await t.stripe.createCheckoutSession(t.db, USER, { kind: 'credits' }, ORIGIN)
  const { url } = await t.stripe.createPortalSession(t.db, 'user_1', ORIGIN)
  assert.match(url, /^https:\/\/billing\.stripe\.test\//)
  assert.deepEqual(t.fake.last('billingPortal.sessions.create')[0], { customer: 'cus_1', return_url: 'https://batkle.test/app/settings#plan', configuration: 'bpc_batkle' })
})

test('subscriptions map onto the account: monthly, yearly, trialing, ending and canceled', async () => {
  const t = setup()
  const subs = t.fake.state.subscriptions
  const sub = subscription()
  subs.set('sub_1', sub)
  await t.stripe.syncSubscription(t.db, 'sub_1')
  let account = billing(t)
  assert.deepEqual([account.plan, account.status, account.interval, account.stripeSubscriptionId, account.stripeCustomerId, account.cancelAtPeriodEnd], ['pro', 'active', 'month', 'sub_1', 'cus_1', false])
  assert.equal(new Date(account.currentPeriodEnd).getTime(), sub.items.data[0].current_period_end * 1000)
  assert.equal(new Date(account.creditAnchor).getTime(), sub.items.data[0].current_period_start * 1000, 'the credit month starts with the period')
  assert.equal(t.account.effectivePlanId(account), 'pro')

  subs.set('sub_1', subscription({ key: 'batkle_business_yearly', endDays: 363 }))
  await t.stripe.syncSubscription(t.db, 'sub_1')
  account = billing(t)
  assert.deepEqual([account.plan, account.interval], ['business', 'year'])

  subs.set('sub_1', subscription({ key: 'batkle_business_yearly', cancelAtPeriodEnd: true }))
  await t.stripe.syncSubscription(t.db, 'sub_1')
  assert.equal(billing(t).cancelAtPeriodEnd, true)
  // Ending on a date of its own: that date is when it ends.
  const ending = subscription({ key: 'batkle_business_yearly', cancelAtDays: 10 })
  subs.set('sub_1', ending)
  await t.stripe.syncSubscription(t.db, 'sub_1')
  assert.equal(billing(t).cancelAtPeriodEnd, true)
  assert.equal(new Date(billing(t).currentPeriodEnd).getTime(), ending.cancel_at * 1000)

  subs.set('sub_1', subscription({ status: 'canceled' }))
  await t.stripe.syncSubscription(t.db, 'sub_1')
  account = billing(t)
  assert.equal(account.status, 'canceled')
  assert.equal(account.cancelAtPeriodEnd, false)
  assert.equal(t.account.effectivePlanId(account), 'free')
  assert.equal(t.account.canStartTrial(account), false, 'a trial only before any subscription')

  // A trial, found through the customer when the subscription has no userId.
  await t.account.loadBilling(t.db, 'user_2')
  await t.db.collection('billingAccounts').updateOne({ id: 'user_2' }, { $set: { stripeCustomerId: 'cus_2' } })
  const trial = subscription({ id: 'sub_2', customer: 'cus_2', userId: null, status: 'trialing', trialEndDays: 7 })
  subs.set('sub_2', trial)
  await t.stripe.syncSubscription(t.db, 'sub_2')
  account = billing(t, 'user_2')
  assert.deepEqual([account.plan, account.status, account.trialUsed], ['pro', 'trialing', true])
  assert.equal(new Date(account.trialEnd).getTime(), trial.trial_end * 1000)
  assert.deepEqual(t.account.allowances(account), { credits: 50, textReminders: 5 })
})

test('a subscription without a Batkle price, or without an account, changes nothing', async () => {
  const t = setup()
  await t.account.loadBilling(t.db, 'user_1')
  const before = billing(t)
  t.fake.state.subscriptions.set('sub_x', subscription({ id: 'sub_x', key: 'someone_elses_price' }))
  assert.equal(await t.stripe.syncSubscription(t.db, 'sub_x'), null)
  t.fake.state.subscriptions.set('sub_y', subscription({ id: 'sub_y', userId: null, customer: 'cus_unknown' }))
  assert.equal(await t.stripe.syncSubscription(t.db, 'sub_y'), null)
  assert.deepEqual(billing(t), before)
  assert.equal(t.db.find('billingAccounts').length, 1)
})

test('events are synced from Stripe’s latest state, and an old subscription never replaces the current one', async () => {
  const t = setup()
  const subs = t.fake.state.subscriptions
  subs.set('sub_1', subscription({ status: 'canceled' }))
  // The event still says active; Stripe says it has been canceled since.
  await t.stripe.handleStripeEvent(t.db, event('evt_late', 'customer.subscription.updated', subscription()))
  assert.equal(billing(t).status, 'canceled')

  subs.set('sub_2', subscription({ id: 'sub_2', key: 'batkle_business_monthly' }))
  await t.stripe.handleStripeEvent(t.db, event('evt_new', 'customer.subscription.created', subs.get('sub_2')))
  assert.deepEqual([billing(t).stripeSubscriptionId, billing(t).plan, billing(t).status], ['sub_2', 'business', 'active'])
  await t.stripe.handleStripeEvent(t.db, event('evt_old', 'customer.subscription.deleted', subs.get('sub_1')))
  assert.deepEqual([billing(t).stripeSubscriptionId, billing(t).status], ['sub_2', 'active'])
  subs.set('sub_3', subscription({ id: 'sub_3', status: 'incomplete' }))
  await t.stripe.handleStripeEvent(t.db, event('evt_inc', 'customer.subscription.created', subs.get('sub_3')))
  assert.equal(billing(t).stripeSubscriptionId, 'sub_2')

  // Invoices sync the subscription they bill; checkout of a subscription too.
  subs.set('sub_2', subscription({ id: 'sub_2', key: 'batkle_business_monthly', status: 'past_due' }))
  await t.stripe.handleStripeEvent(t.db, event('evt_inv', 'invoice.payment_failed', { id: 'in_1', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_2' } } }))
  assert.equal(billing(t).status, 'past_due')
  subs.set('sub_2', subscription({ id: 'sub_2', key: 'batkle_business_monthly' }))
  await t.stripe.handleStripeEvent(t.db, event('evt_paid', 'invoice.paid', { id: 'in_2', parent: { subscription_details: { subscription: { id: 'sub_2' } } } }))
  assert.equal(billing(t).status, 'active')
  const retrieved = t.fake.count('subscriptions.retrieve')
  await t.stripe.handleStripeEvent(t.db, event('evt_oneoff', 'invoice.paid', { id: 'in_3', parent: null }))
  await t.stripe.handleStripeEvent(t.db, event('evt_other', 'customer.created', { id: 'cus_9' }))
  assert.equal(t.fake.count('subscriptions.retrieve'), retrieved)
  await t.stripe.handleStripeEvent(t.db, event('evt_cs', 'checkout.session.completed', { id: 'cs_9', mode: 'subscription', subscription: 'sub_2', payment_status: 'paid', metadata: { userId: 'user_1', kind: 'plan' } }))
  assert.equal(t.fake.last('subscriptions.retrieve')[0], 'sub_2')
})

test('the same event twice changes things once, and a credit pack counts once per checkout', async () => {
  const t = setup()
  const extra = () => billing(t).extraCredits
  const session = { id: 'cs_pack', object: 'checkout.session', mode: 'payment', payment_status: 'paid', customer: 'cus_1', client_reference_id: 'user_1', metadata: { userId: 'user_1', kind: 'credits', credits: '100' } }
  assert.deepEqual(await t.stripe.handleStripeEvent(t.db, event('evt_1', 'checkout.session.completed', session)), { duplicate: false })
  assert.equal(extra(), 100)
  assert.deepEqual(await t.stripe.handleStripeEvent(t.db, event('evt_1', 'checkout.session.completed', session)), { duplicate: true })
  assert.equal(extra(), 100)
  // Another event about the same checkout adds nothing either.
  await t.stripe.handleStripeEvent(t.db, event('evt_2', 'checkout.session.async_payment_succeeded', session))
  assert.equal(extra(), 100)
  assert.equal(t.db.find('creditGrants').length, 1)
  assert.equal(t.db.one('stripeEvents', { id: 'evt_1' }).status, 'done')

  // A bank payment: nothing when the checkout completes unpaid, the credits once it succeeds.
  const bank = { ...session, id: 'cs_bank', payment_status: 'unpaid' }
  await t.stripe.handleStripeEvent(t.db, event('evt_3', 'checkout.session.completed', bank))
  assert.equal(extra(), 100)
  await t.stripe.handleStripeEvent(t.db, event('evt_4', 'checkout.session.async_payment_succeeded', { ...bank, payment_status: 'paid' }))
  assert.equal(extra(), 200)
})

test('an event is only marked done once it worked, so Stripe’s retry handles it', async () => {
  const t = setup()
  t.fake.state.subscriptions.set('sub_1', subscription())
  t.fake.state.fail['subscriptions.retrieve'] = Object.assign(new Error('Stripe is down'), { type: 'StripeConnectionError' })
  const evt = event('evt_retry', 'customer.subscription.updated', subscription())
  await assert.rejects(t.stripe.handleStripeEvent(t.db, evt))
  assert.equal(t.db.one('stripeEvents', { id: 'evt_retry' }).status, 'failed')
  assert.equal(t.db.find('billingAccounts').length, 0)
  assert.deepEqual(await t.stripe.handleStripeEvent(t.db, evt), { duplicate: false })
  assert.equal(t.db.one('stripeEvents', { id: 'evt_retry' }).status, 'done')
  assert.equal(billing(t).status, 'active')
})

test('the webhook checks Stripe’s signature over the raw body', async () => {
  const t = setup()
  const getDb = async () => t.db
  const session = { id: 'cs_1', mode: 'payment', payment_status: 'paid', metadata: { userId: 'user_1', kind: 'credits', credits: '100' } }
  const payload = JSON.stringify(event('evt_sig', 'checkout.session.completed', session))
  const signature = RealStripe.webhooks.generateTestHeaderString({ payload, secret: t.env.STRIPE_WEBHOOK_SECRET })

  assert.deepEqual(await t.stripe.handleWebhookRequest(payload, signature, getDb), { status: 200, body: { received: true } })
  assert.equal(billing(t).extraCredits, 100)
  assert.deepEqual(await t.stripe.handleWebhookRequest(payload, signature, getDb), { status: 200, body: { received: true, duplicate: true } })
  assert.equal(billing(t).extraCredits, 100)

  const forged = payload.replace('"credits":"100"', '"credits":"9999"')
  const wrongSecret = RealStripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_someone_else' })
  for (const [body, header] of [[forged, signature], [payload, wrongSecret], [payload, null], [payload, 't=1,v1=abc']]) {
    const result = await t.stripe.handleWebhookRequest(body, header, getDb)
    assert.equal(result.status, 400)
  }
  assert.equal(billing(t).extraCredits, 100)

  // Handling fails: 500, so Stripe tries again.
  const other = JSON.stringify(event('evt_down', 'checkout.session.completed', { ...session, id: 'cs_2' }))
  const otherSignature = RealStripe.webhooks.generateTestHeaderString({ payload: other, secret: t.env.STRIPE_WEBHOOK_SECRET })
  assert.equal((await t.stripe.handleWebhookRequest(other, otherSignature, async () => { throw new Error('MONGO_URL not set') })).status, 500)

  t.env.STRIPE_WEBHOOK_SECRET = ''
  assert.equal((await t.stripe.handleWebhookRequest(payload, signature, getDb)).status, 503)
  t.env.STRIPE_WEBHOOK_SECRET = 'whsec_fake_secret'
  t.env.STRIPE_SECRET_KEY = ''
  assert.equal((await t.stripe.handleWebhookRequest(payload, signature, getDb)).status, 503)
})

/** Enough of Stripe for scripts/stripe-setup.cjs. */
function setupFake() {
  const calls = []
  const store = { products: new Map(), prices: [], coupons: new Map(), configs: [] }
  let n = 0
  const call = name => calls.push(name)
  const notFound = () => Object.assign(new Error('No such object'), { code: 'resource_missing', statusCode: 404 })
  const stripe = {
    products: {
      retrieve: async id => { call('products.retrieve'); if (!store.products.has(id)) throw notFound(); return store.products.get(id) },
      create: async p => { call('products.create'); const product = { active: true, ...p }; store.products.set(p.id, product); return product },
      update: async (id, p) => { call('products.update'); return Object.assign(store.products.get(id), p) },
    },
    prices: {
      list: async ({ lookup_keys }) => { call('prices.list'); return { data: store.prices.filter(p => lookup_keys.includes(p.lookup_key)) } },
      create: async p => {
        call('prices.create')
        if (p.transfer_lookup_key) for (const other of store.prices) if (other.lookup_key === p.lookup_key) other.lookup_key = null
        const { transfer_lookup_key, recurring, ...fields } = p
        const price = { id: `price_${++n}`, active: true, ...fields, recurring: recurring ? { interval_count: 1, ...recurring } : null, type: recurring ? 'recurring' : 'one_time' }
        store.prices.push(price)
        return price
      },
      update: async (id, p) => { call('prices.update'); return Object.assign(store.prices.find(x => x.id === id), p) },
    },
    coupons: {
      retrieve: async id => { call('coupons.retrieve'); if (!store.coupons.has(id)) throw notFound(); return store.coupons.get(id) },
      create: async p => { call('coupons.create'); store.coupons.set(p.id, p); return p },
    },
    billingPortal: {
      configurations: {
        list: async () => { call('portal.list'); return { data: store.configs } },
        create: async p => { call('portal.create'); const config = { id: `bpc_${++n}`, ...p }; store.configs.push(config); return config },
        update: async (id, p) => { call('portal.update'); return Object.assign(store.configs.find(c => c.id === id), p) },
      },
    },
  }
  return { stripe, store, calls, count: name => calls.filter(c => c === name).length }
}

test('the setup script makes products, prices, the coupon and the portal once, and fixes a changed price', async () => {
  const plans = setupScript.loadPlans()
  const fake = setupFake()
  const log = () => {}
  await setupScript.setup(fake.stripe, plans, { baseUrl: 'https://batkle.test/', log })
  assert.deepEqual([...fake.store.products.keys()], ['batkle_pro', 'batkle_business', 'batkle_credits'])
  const byKey = Object.fromEntries(fake.store.prices.map(p => [p.lookup_key, p]))
  assert.deepEqual(Object.keys(byKey).sort(), ['batkle_business_monthly', 'batkle_business_yearly', 'batkle_credits_100', 'batkle_pro_monthly', 'batkle_pro_yearly'])
  // Amounts are plans.ts prices in cents, so a price change there never needs this test changed.
  const cents = dollars => Math.round(dollars * 100)
  assert.deepEqual([byKey.batkle_pro_monthly.unit_amount, byKey.batkle_pro_monthly.currency, byKey.batkle_pro_monthly.recurring.interval, byKey.batkle_pro_monthly.product], [cents(plans.PLANS.pro.price.month), 'usd', 'month', 'batkle_pro'])
  assert.deepEqual([byKey.batkle_business_yearly.unit_amount, byKey.batkle_business_yearly.recurring.interval], [cents(plans.PLANS.business.price.year), 'year'])
  assert.ok(Number.isInteger(byKey.batkle_pro_monthly.unit_amount), 'a price with cents is sent as whole cents')
  assert.deepEqual([byKey.batkle_credits_100.unit_amount, byKey.batkle_credits_100.recurring, byKey.batkle_credits_100.product], [1000, null, 'batkle_credits'])
  assert.deepEqual(fake.store.coupons.get('NEWSLETTER20'), { id: 'NEWSLETTER20', percent_off: 20, duration: 'once', name: 'Newsletter: 20% off the first payment' })
  const [config] = fake.store.configs
  assert.deepEqual(config.metadata, { batkle: 'billing-portal' })
  assert.equal(config.default_return_url, 'https://batkle.test/app/settings#plan')
  assert.equal(config.features.subscription_cancel.mode, 'at_period_end')
  assert.deepEqual([config.features.payment_method_update.enabled, config.features.invoice_history.enabled], [true, true])
  assert.deepEqual(config.features.subscription_update.products, [
    { product: 'batkle_pro', prices: [byKey.batkle_pro_monthly.id, byKey.batkle_pro_yearly.id] },
    { product: 'batkle_business', prices: [byKey.batkle_business_monthly.id, byKey.batkle_business_yearly.id] },
  ])

  // A second run creates nothing.
  await setupScript.setup(fake.stripe, plans, { log })
  for (const name of ['products.create', 'prices.create', 'coupons.create', 'portal.create']) assert.equal(fake.count(name), name === 'prices.create' ? 5 : name === 'products.create' ? 3 : 1, name)
  assert.equal(fake.count('portal.update'), 1)

  // A new price in plans.ts takes over the lookup key; the old price is archived.
  const changed = { ...plans, PLANS: { ...plans.PLANS, pro: { ...plans.PLANS.pro, price: { month: 21, year: plans.PLANS.pro.price.year } } } }
  const old = byKey.batkle_pro_monthly
  await setupScript.setup(fake.stripe, changed, { log })
  assert.equal(fake.count('prices.create'), 6)
  const current = fake.store.prices.find(p => p.lookup_key === 'batkle_pro_monthly')
  assert.equal(current.unit_amount, 2100)
  assert.equal(old.active, false)
})

test('the setup script lists the webhook events the server handles, and refuses live keys unless asked', () => {
  const t = setup()
  assert.deepEqual(setupScript.WEBHOOK_EVENTS, t.stripe.WEBHOOK_EVENTS)
  assert.equal(setupScript.COUPON_ID, t.stripe.NEWSLETTER_COUPON_ID)
  assert.throws(() => setupScript.checkKey('sk_live_abc', false), /--live/)
  assert.throws(() => setupScript.checkKey('', false), /STRIPE_SECRET_KEY/)
  assert.doesNotThrow(() => setupScript.checkKey('sk_live_abc', true))
  assert.doesNotThrow(() => setupScript.checkKey('sk_test_abc', false))
  assert.ok(DAY > 0)
})
