// Sets up Batkle in a Stripe account: the products, the prices (found by their lookup keys, from
// lib/billing/plans.ts), the newsletter coupon and the Billing Portal settings, then says how to add the webhook.
// Safe to run again: it only creates or fixes what is missing or different. A changed price in plans.ts becomes a
// new Stripe price that takes over the lookup key; the old one is archived and its subscribers keep paying it.
//   node scripts/stripe-setup.cjs          with test keys (sk_test_…)
//   node scripts/stripe-setup.cjs --live   with live keys, on purpose
// Reads STRIPE_SECRET_KEY (and NEXT_PUBLIC_BASE_URL) from the environment, .env.local or .env.
const fs = require('node:fs')
const path = require('node:path')
const { stripTypeScriptTypes } = require('node:module')

const ROOT = path.join(__dirname, '..')
// The same list as WEBHOOK_EVENTS in lib/billing/stripe.ts; tests/billingStripe.test.cjs checks they match.
const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
]
// As in lib/billing/stripe.ts: the app finds the coupon and the portal settings by these.
const COUPON_ID = 'NEWSLETTER20'
const PORTAL_METADATA = { batkle: 'billing-portal' }

/** lib/billing/plans.ts, loaded the way the tests load it: types stripped, nothing imported. */
function loadPlans() {
  const source = stripTypeScriptTypes(fs.readFileSync(path.join(ROOT, 'lib/billing/plans.ts'), 'utf8')).replace(/^export /gm, '')
  return new Function(`${source};return { PLANS, PAID_PLAN_IDS, INTERVALS, CREDIT_PACK, NEWSLETTER_DISCOUNT, priceLookupKey }`)()
}

/** Refuses live keys unless --live was passed. */
function checkKey(key, live) {
  if (!key) throw new Error('Set STRIPE_SECRET_KEY (in .env.local, .env or the environment).')
  if (!/^(sk|rk)_(test|live)_/.test(key)) throw new Error('STRIPE_SECRET_KEY should start with sk_test_ or sk_live_.')
  if (/^(sk|rk)_live_/.test(key) && !live) throw new Error('This is a live key: real money. Run again with --live if that is what you want.')
}

const missing = error => error?.code === 'resource_missing' || error?.statusCode === 404
const idOf = value => (typeof value === 'string' ? value : value?.id || null)
const cents = dollars => Math.round(dollars * 100)
const dollars = amount => `$${(amount / 100).toFixed(2).replace(/\.00$/, '')}`

function products(plans) {
  return [
    ...plans.PAID_PLAN_IDS.map(id => ({ id: `batkle_${id}`, name: `Batkle ${plans.PLANS[id].name}`, description: plans.PLANS[id].tagline })),
    { id: 'batkle_credits', name: 'Batkle extra credits', description: `${plans.CREDIT_PACK.credits} credits for AI images. They never expire.` },
  ]
}

function wantedPrices(plans) {
  return [
    ...plans.PAID_PLAN_IDS.flatMap(planId => plans.INTERVALS.map(interval => ({
      lookup_key: plans.priceLookupKey(planId, interval),
      product: `batkle_${planId}`,
      unit_amount: cents(plans.PLANS[planId].price[interval]),
      currency: 'usd',
      recurring: { interval },
      nickname: `${plans.PLANS[planId].name} ${interval === 'year' ? 'yearly' : 'monthly'}`,
    }))),
    { lookup_key: plans.CREDIT_PACK.lookupKey, product: 'batkle_credits', unit_amount: cents(plans.CREDIT_PACK.price), currency: 'usd', recurring: null, nickname: `${plans.CREDIT_PACK.credits} credits` },
  ]
}

function samePrice(price, wanted) {
  return price.active && idOf(price.product) === wanted.product && price.unit_amount === wanted.unit_amount && price.currency === wanted.currency &&
    (price.recurring?.interval || null) === (wanted.recurring?.interval || null) && (price.recurring?.interval_count || 1) === 1
}

async function ensureProduct(stripe, wanted, log) {
  const product = await stripe.products.retrieve(wanted.id).catch(error => (missing(error) ? null : Promise.reject(error)))
  if (!product) {
    log(`Created product ${wanted.name}`)
    return stripe.products.create({ ...wanted, metadata: { batkle: wanted.id } })
  }
  if (product.active && product.name === wanted.name && product.description === wanted.description) return product
  log(`Updated product ${wanted.name}`)
  return stripe.products.update(wanted.id, { active: true, name: wanted.name, description: wanted.description })
}

async function ensurePrices(stripe, plans, log) {
  const wanted = wantedPrices(plans)
  const { data } = await stripe.prices.list({ lookup_keys: wanted.map(w => w.lookup_key), limit: 100 })
  const prices = {}
  for (const w of wanted) {
    const current = data.find(p => p.lookup_key === w.lookup_key)
    if (current && samePrice(current, w)) { prices[w.lookup_key] = current; continue }
    const { recurring, ...fields } = w
    prices[w.lookup_key] = await stripe.prices.create({ ...fields, ...(recurring ? { recurring } : {}), transfer_lookup_key: true, metadata: { batkle: w.lookup_key } })
    if (current?.active) await stripe.prices.update(current.id, { active: false })
    log(current ? `Replaced price ${w.lookup_key} with ${dollars(w.unit_amount)} (the old price is archived)` : `Created price ${w.lookup_key}: ${dollars(w.unit_amount)}${recurring ? ` a ${recurring.interval}` : ''}`)
  }
  return prices
}

async function ensureCoupon(stripe, plans, log) {
  const coupon = await stripe.coupons.retrieve(COUPON_ID).catch(error => (missing(error) ? null : Promise.reject(error)))
  const percent = plans.NEWSLETTER_DISCOUNT.percent
  if (!coupon) {
    await stripe.coupons.create({ id: COUPON_ID, percent_off: percent, duration: 'once', name: `Newsletter: ${percent}% off the first payment` })
    log(`Created coupon ${COUPON_ID}: ${percent}% off once`)
  } else if (coupon.percent_off !== percent || coupon.duration !== 'once') {
    // A coupon's discount can't be changed; delete it in the Dashboard and run this again to remake it.
    log(`Warning: coupon ${COUPON_ID} is ${coupon.percent_off}% (${coupon.duration}), not ${percent}% once. Delete it in the Stripe Dashboard and run this again.`)
  }
}

async function ensurePortal(stripe, plans, prices, baseUrl, log) {
  const base = (baseUrl || '').trim().replace(/\/+$/, '')
  const settings = {
    business_profile: { headline: 'Manage your Batkle plan and billing' },
    ...(/^https:\/\//.test(base) ? { default_return_url: `${base}/app/settings#plan` } : {}),
    features: {
      customer_update: { enabled: true, allowed_updates: ['name', 'address'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        proration_behavior: 'none',
        cancellation_reason: { enabled: true, options: ['too_expensive', 'missing_features', 'unused', 'switched_service', 'too_complex', 'other'] },
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        proration_behavior: 'create_prorations',
        products: plans.PAID_PLAN_IDS.map(planId => ({ product: `batkle_${planId}`, prices: plans.INTERVALS.map(interval => prices[plans.priceLookupKey(planId, interval)].id) })),
      },
    },
    metadata: PORTAL_METADATA,
  }
  const { data } = await stripe.billingPortal.configurations.list({ limit: 100 })
  const existing = data.find(c => c.metadata?.batkle === PORTAL_METADATA.batkle)
  if (existing) {
    await stripe.billingPortal.configurations.update(existing.id, { ...settings, active: true })
    log(`Updated the Billing Portal settings (${existing.id})`)
  } else {
    const created = await stripe.billingPortal.configurations.create(settings)
    log(`Created the Billing Portal settings (${created.id})`)
  }
}

/** Everything Batkle needs in the Stripe account; `stripe` is a Stripe client. */
async function setup(stripe, plans, { baseUrl = '', log = console.log } = {}) {
  for (const product of products(plans)) await ensureProduct(stripe, product, log)
  const prices = await ensurePrices(stripe, plans, log)
  await ensureCoupon(stripe, plans, log)
  await ensurePortal(stripe, plans, prices, baseUrl, log)
  return prices
}

function webhookHelp(baseUrl) {
  // Stripe can't reach a local address, so a local base URL gets the placeholder too.
  const given = (baseUrl || '').trim().replace(/\/+$/, '')
  const base = /^https:\/\//.test(given) ? given : 'https://<your-domain>'
  return [
    '',
    'Webhook: in the Stripe Dashboard, Developers > Webhooks > Add endpoint:',
    `  URL: ${base}/api/stripe/webhook`,
    '  Events:',
    ...WEBHOOK_EVENTS.map(event => `    ${event}`),
    'Then copy its signing secret (whsec_...) into STRIPE_WEBHOOK_SECRET.',
    '',
    'On your computer, npm run dev forwards them with the Stripe CLI and sets its secret itself (scripts/dev.cjs).',
    'Install the CLI first: winget install Stripe.StripeCli (Windows) or brew install stripe/stripe-cli/stripe (macOS).',
  ].join('\n')
}

async function main() {
  const live = process.argv.includes('--live')
  const dotenv = require('dotenv')
  dotenv.config({ path: path.join(ROOT, '.env.local'), quiet: true })
  dotenv.config({ path: path.join(ROOT, '.env'), quiet: true })
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  checkKey(key, live)
  const Stripe = require('stripe')
  console.log(`Setting up Batkle in Stripe (${/_live_/.test(key) ? 'LIVE' : 'test'} mode)…`)
  await setup(new Stripe(key), loadPlans(), { baseUrl: process.env.NEXT_PUBLIC_BASE_URL })
  console.log('Products, prices, the newsletter coupon and the Billing Portal are ready.')
  console.log(webhookHelp(process.env.NEXT_PUBLIC_BASE_URL))
}

module.exports = { setup, loadPlans, checkKey, wantedPrices, WEBHOOK_EVENTS, COUPON_ID, PORTAL_METADATA }

if (require.main === module) main().catch(error => { console.error(error.message); process.exit(1) })
