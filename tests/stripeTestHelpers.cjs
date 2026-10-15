// Shared by tests/billingStripe.test.cjs and tests/newsletter.test.cjs: lib/billing/stripe.ts loaded with an
// in-memory database and a fake Stripe client, so nothing touches the network.
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const RealStripe = require('stripe')

/**
 * Loads a module with its types stripped: node: and npm imports are required, the rest come from `deps`. Returns
 * every exported function and constant.
 */
function load(file, deps = {}, env = {}) {
  let source = fs.readFileSync(file, 'utf8')
  if (file.endsWith('.ts')) source = stripTypeScriptTypes(source)
  const names = [...source.matchAll(/^export (?:async function|function|const|let) (\w+)/gm)].map(m => m[1])
  source = source
    .replace(/^import \{([^}]*)\} from '([^']+)'$/gm, (_, list, from) => {
      const names = list.split(',').map(s => s.trim()).filter(Boolean).join(', ')
      return from in deps ? `const { ${names} } = __deps['${from}']` : `const { ${names} } = require('${from}')`
    })
    .replace(/^import (\w+) from '([^']+)'$/gm, (_, name, from) => (from in deps ? `const ${name} = __deps['${from}']` : `const ${name} = require('${from}')`))
    .replace(/^export /gm, '')
  return new Function('require', '__deps', 'process', source + `;return {${names.join(',')}}`)(require, deps, { env })
}

/**
 * An in-memory stand-in for the MongoDB calls billing makes: equality filters (Dates by value, null for missing)
 * with $lt, $lte, $gt, $gte, $in, $ne and $exists; $set, $inc and $setOnInsert with upsert; unique keys; and
 * findOneAndUpdate. `failNext(name)` makes the next write to a collection throw.
 */
function fakeDb() {
  const data = {}
  const unique = { billingAccounts: [['id']], creditGrants: [['ref']], creditCharges: [['id']], stripeEvents: [['id']], newsletterSubscribers: [['email'], ['id']] }
  const failures = {}
  const clone = value => structuredClone(value)
  const same = (a, b) => (a instanceof Date || b instanceof Date ? a != null && b != null && new Date(a).getTime() === new Date(b).getTime() : a === b)
  const value = v => (v instanceof Date ? v.getTime() : v)
  const isOp = v => v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && Object.keys(v).some(k => k.startsWith('$'))
  const test = (actual, condition) => {
    if (!isOp(condition)) return condition === null ? actual == null : same(actual, condition)
    return Object.entries(condition).every(([op, v]) => {
      if (op === '$lt') return actual != null && value(actual) < value(v)
      if (op === '$lte') return actual != null && value(actual) <= value(v)
      if (op === '$gt') return actual != null && value(actual) > value(v)
      if (op === '$gte') return actual != null && value(actual) >= value(v)
      if (op === '$in') return v.some(x => same(actual, x))
      if (op === '$ne') return !same(actual, v)
      if (op === '$exists') return (actual !== undefined) === v
      throw new Error(`fake db: unsupported operator ${op}`)
    })
  }
  const matches = (doc, filter = {}) => Object.entries(filter).every(([k, v]) => test(doc[k], v))
  const apply = (doc, update, inserting) => {
    for (const [op, fields] of Object.entries(update)) {
      if (op === '$set') Object.assign(doc, clone(fields))
      else if (op === '$inc') for (const [k, v] of Object.entries(fields)) doc[k] = (doc[k] || 0) + v
      else if (op === '$setOnInsert') { if (inserting) Object.assign(doc, clone(fields)) }
      else throw new Error(`fake db: unsupported update ${op}`)
    }
    return doc
  }
  const table = name => (data[name] ||= [])
  const checkUnique = (name, doc, except = null) => {
    for (const keys of unique[name] || []) {
      if (keys.every(k => doc[k] !== undefined) && table(name).some(other => other !== except && keys.every(k => same(other[k], doc[k])))) {
        throw Object.assign(new Error(`E11000 duplicate key error collection: ${name}`), { code: 11000 })
      }
    }
  }
  const failIfAsked = name => {
    const error = failures[name]
    if (error) { delete failures[name]; throw error }
  }
  // Applies an update to the first match, or inserts one when upserting: [before, after], or null.
  const write = (name, filter, update, upsert) => {
    failIfAsked(name)
    const list = table(name)
    const index = list.findIndex(d => matches(d, filter))
    if (index >= 0) {
      const next = apply(clone(list[index]), update, false)
      checkUnique(name, next, list[index])
      const before = list[index]
      list[index] = next
      return [before, next, false]
    }
    if (!upsert) return null
    const created = apply(Object.fromEntries(Object.entries(filter).filter(([, v]) => !isOp(v)).map(([k, v]) => [k, clone(v)])), update, true)
    checkUnique(name, created)
    list.push(created)
    return [null, created, true]
  }
  const collection = name => ({
    async createIndex(spec, options = {}) {
      if (options.unique && !(unique[name] || []).some(keys => keys.join() === Object.keys(spec).join())) (unique[name] ||= []).push(Object.keys(spec))
    },
    async findOne(filter) { const doc = table(name).find(d => matches(d, filter)); return doc ? clone(doc) : null },
    async countDocuments(filter) { return table(name).filter(d => matches(d, filter)).length },
    aggregate: () => ({ toArray: async () => [] }),
    async insertOne(doc) { failIfAsked(name); const copy = clone(doc); checkUnique(name, copy); table(name).push(copy); return { acknowledged: true } },
    async updateOne(filter, update, options = {}) {
      const result = write(name, filter, update, options.upsert)
      return result ? { matchedCount: result[2] ? 0 : 1, upsertedCount: result[2] ? 1 : 0 } : { matchedCount: 0 }
    },
    async findOneAndUpdate(filter, update, options = {}) {
      const result = write(name, filter, update, options.upsert)
      if (!result) return null
      return clone(options.returnDocument === 'after' ? result[1] : result[0])
    },
  })
  const find = (name, filter = {}) => table(name).filter(d => matches(d, filter))
  return { data, collection, find, one: (name, filter) => find(name, filter)[0] || null, failNext: (name, error = new Error('database down')) => { failures[name] = error } }
}

const missing = what => Object.assign(new Error(`No such ${what}`), { type: 'StripeInvalidRequestError', code: 'resource_missing', statusCode: 404 })

/**
 * Enough of the Stripe client for lib/billing/stripe.ts, recording every call. Prices exist for every Batkle lookup
 * key, and the Billing Portal settings made by the setup script are there. Webhook signatures use the real SDK.
 */
function fakeStripe(plans, { ignoreIdempotency = false } = {}) {
  const calls = []
  let n = 0
  const state = {
    customers: new Map(),
    subscriptions: new Map(),
    prices: plans.stripeLookupKeys().map(({ lookupKey }) => ({ id: `price_${lookupKey}`, lookup_key: lookupKey, active: true })),
    coupons: new Map(),
    promotionCodes: [],
    portalConfigs: [{ id: 'bpc_other', metadata: {} }, { id: 'bpc_batkle', metadata: { batkle: 'billing-portal' } }],
    fail: {},
  }
  const record = (name, ...args) => {
    calls.push({ name, args: clone(args) })
    const error = state.fail[name]
    if (error) { delete state.fail[name]; throw error }
  }
  const clone = value => JSON.parse(JSON.stringify(value ?? null))
  const idempotent = new Map()
  const client = {
    customers: {
      async create(params, options) { record('customers.create', params, options); const c = { id: `cus_${++n}`, object: 'customer', ...params }; state.customers.set(c.id, c); return c },
      async retrieve(id) { record('customers.retrieve', id); if (!state.customers.has(id)) throw missing('customer'); return state.customers.get(id) },
    },
    prices: {
      async list(params) { record('prices.list', params); return { data: state.prices.filter(p => params.lookup_keys.includes(p.lookup_key) && (!params.active || p.active)) } },
    },
    subscriptions: {
      async list(params) { record('subscriptions.list', params); return { data: [...state.subscriptions.values()].filter(s => s.customer === params.customer).map(clone) } },
      async retrieve(id) { record('subscriptions.retrieve', id); if (!state.subscriptions.has(id)) throw missing('subscription'); return clone(state.subscriptions.get(id)) },
    },
    checkout: {
      sessions: { async create(params) { record('checkout.sessions.create', params); const id = `cs_${++n}`; return { id, url: `https://checkout.stripe.test/${id}` } } },
    },
    billingPortal: {
      sessions: { async create(params) { record('billingPortal.sessions.create', params); const id = `bps_${++n}`; return { id, url: `https://billing.stripe.test/${id}` } } },
      configurations: { async list(params) { record('billingPortal.configurations.list', params); return { data: state.portalConfigs } } },
    },
    coupons: {
      async retrieve(id) { record('coupons.retrieve', id); if (!state.coupons.has(id)) throw missing('coupon'); return state.coupons.get(id) },
      async create(params) { record('coupons.create', params); const c = { object: 'coupon', ...params }; state.coupons.set(params.id, c); return c },
    },
    promotionCodes: {
      async create(params, options) {
        record('promotionCodes.create', params, options)
        const key = options?.idempotencyKey
        if (key && !ignoreIdempotency && idempotent.has(key)) return idempotent.get(key)
        const promo = { id: `promo_${++n}`, object: 'promotion_code', code: `CODE${n}`, active: true, ...params }
        state.promotionCodes.push(promo)
        if (key) idempotent.set(key, promo)
        return promo
      },
      async update(id, params) { record('promotionCodes.update', id, params); const promo = state.promotionCodes.find(p => p.id === id); Object.assign(promo, params); return promo },
    },
    webhooks: RealStripe.webhooks,
  }
  return { client, calls, state, count: name => calls.filter(c => c.name === name).length, last: name => calls.filter(c => c.name === name).at(-1)?.args }
}

const DAY = 86_400_000
const seconds = ms => Math.floor(ms / 1000)

/** A Stripe subscription with one item; times are days from now. */
function subscription({ id = 'sub_1', customer = 'cus_1', status = 'active', key = 'batkle_pro_monthly', userId = 'user_1', startDays = -2, endDays = 28, trialEndDays = null, cancelAtPeriodEnd = false, cancelAtDays = null } = {}) {
  const at = days => seconds(Date.now() + days * DAY)
  return {
    id, object: 'subscription', customer, status,
    metadata: userId ? { userId, kind: 'plan' } : {},
    cancel_at_period_end: cancelAtPeriodEnd,
    cancel_at: cancelAtDays == null ? null : at(cancelAtDays),
    trial_end: trialEndDays == null ? null : at(trialEndDays),
    items: { object: 'list', data: [{ id: `si_${id}`, price: { id: `price_${key}`, lookup_key: key }, current_period_start: at(startDays), current_period_end: at(endDays) }] },
  }
}

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_WEBHOOK_SECRET: 'whsec_fake_secret',
  RESEND_API_KEY: 're_fake',
  EMAIL_FROM: 'Batkle <hello@batkle.test>',
  NEXT_PUBLIC_BASE_URL: 'https://batkle.test',
}

/**
 * Fresh modules (their caches are per load), a database and a Stripe fake. `env` can be changed while a test runs;
 * `sent` collects the emails sendEmail was asked to send, and `emailFails` makes the next one fail.
 */
function setup({ env = {}, ignoreIdempotency = false } = {}) {
  const environment = { ...ENV, ...env }
  const plans = load('lib/billing/plans.ts')
  const account = load('lib/billing/account.ts', { './plans': plans })
  const publicError = load('lib/services/publicError.ts')
  const realEmail = load('lib/notifications/email.ts', {}, environment)
  const sent = []
  const mail = { failNext: false }
  const email = {
    ...realEmail,
    sendEmail: async message => {
      if (mail.failNext) { mail.failNext = false; throw Object.assign(new Error('Resend: HTTP 500'), { status: 502 }) }
      sent.push(message)
      return { id: `email_${sent.length}` }
    },
  }
  const fake = fakeStripe(plans, { ignoreIdempotency })
  const made = []
  function FakeStripe(key, config) { made.push({ key, config }); return fake.client }
  const stripe = load('lib/billing/stripe.ts', {
    stripe: FakeStripe,
    './plans': plans,
    './account': account,
    '../notifications/email': email,
    '../services/publicError': publicError,
  }, environment)
  return { env: environment, plans, account, stripe, fake, db: fakeDb(), sent, mail, made }
}

module.exports = { load, fakeDb, fakeStripe, subscription, setup, RealStripe, DAY, ENV }
