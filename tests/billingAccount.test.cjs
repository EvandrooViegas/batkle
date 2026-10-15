const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { randomUUID } = require('node:crypto')
const { stripTypeScriptTypes } = require('node:module')

// The fake database and loader are shared with tests/generationCredits.test.cjs; requiring this file there must not
// run these tests a second time.
const it = require.main === module ? test : () => {}

const strip = file => stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))
const PLAN_EXPORTS = ['PLANS', 'TRIAL', 'approxPosts', 'cheapestPlanForBrands', 'cheapestPlanWith', 'formatBytes', 'planById', 'uploadsLabel']
const ACCOUNT_EXPORTS = ['BILLING_CODES', 'billingError', 'billingErrorBody', 'addMonths', 'creditPeriod', 'effectivePlanId', 'effectivePlan', 'allowances', 'loadBilling', 'creditsLeft', 'getBillingSummary', 'summarize', 'canStartTrial', 'chargeCredits', 'refundCharge', 'settleCharge', 'findCharge', 'grantExtraCredits', 'takeTextReminder', 'returnTextReminder', 'hasFeature', 'requireFeature', 'requireBrandSlot', 'uploadUsage', 'requireUploadRoom', 'imageQualityFor', 'findBillingByCustomer', 'setStripeCustomer', 'applySubscription', 'releaseStaleCharges', 'STALE_CHARGE_MS']
const plans = new Function(strip('lib/billing/plans.ts') + `;return {${PLAN_EXPORTS.join(',')}}`)()

/** A clock the billing code reads through its own `Date`: `new Date()` and `Date.now()` give `clock.now`. */
function makeClock(start = '2026-01-31T10:00:00Z') {
  const clock = { now: Date.parse(start) }
  class ClockDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(clock.now) }
    static now() { return clock.now }
  }
  clock.Date = ClockDate
  clock.set = iso => { clock.now = Date.parse(iso) }
  clock.advance = ms => { clock.now += ms }
  return clock
}

/** lib/billing/account.ts, freshly loaded (its index cache is per module), reading time from `clock`. */
function loadAccount(clock = makeClock()) {
  return new Function('randomUUID', 'Date', ...PLAN_EXPORTS, strip('lib/billing/account.ts') + `;return {${ACCOUNT_EXPORTS.join(',')}}`)(
    randomUUID, clock.Date, ...PLAN_EXPORTS.map(name => plans[name]))
}

/**
 * An in-memory stand-in for the MongoDB calls billing makes: equality filters (Dates by value) with $gte, $lt, $in,
 * $exists and $ne; $set, $inc and $setOnInsert updates with upsert; unique indexes from createIndex; find with sort
 * and limit; countDocuments; deleteOne; and the $match + $group aggregate uploadUsage runs. Every update is atomic,
 * as one document update is in MongoDB. With `interleave`, every call first waits a turn of the event loop, so
 * concurrent requests read and write in the worst order: all of them read before any of them writes.
 */
function fakeMongo({ interleave = false, seed = {} } = {}) {
  const tables = new Map(Object.entries(seed).map(([name, docs]) => [name, docs.map(d => structuredClone(d))]))
  const unique = new Map()
  const indexes = []
  const calls = []
  const table = name => { if (!tables.has(name)) tables.set(name, []); return tables.get(name) }
  const turn = () => (interleave ? new Promise(resolve => setImmediate(resolve)) : Promise.resolve())
  const clone = value => structuredClone(value)
  const same = (a, b) => (a instanceof Date || b instanceof Date ? a != null && b != null && new Date(a).getTime() === new Date(b).getTime() : a === b)
  const isOperator = value => value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value) && Object.keys(value).some(k => k.startsWith('$'))
  const matchValue = (actual, condition) => {
    if (isOperator(condition)) {
      return Object.entries(condition).every(([op, value]) => {
        if (op === '$gte') return actual != null && actual >= value
        if (op === '$lt') return actual != null && actual < value
        if (op === '$in') return value.some(v => same(actual, v))
        if (op === '$exists') return (actual !== undefined) === value
        if (op === '$ne') return value === null ? actual != null : !same(actual, value)
        throw new Error(`fake db: unsupported operator ${op}`)
      })
    }
    if (condition === null) return actual == null
    return same(actual, condition)
  }
  const matches = (doc, filter = {}) => Object.entries(filter).every(([key, value]) => matchValue(doc[key], value))
  const apply = (doc, update, inserting) => {
    for (const [op, fields] of Object.entries(update)) {
      if (op === '$set') Object.assign(doc, clone(fields))
      else if (op === '$inc') for (const [key, value] of Object.entries(fields)) doc[key] = (doc[key] || 0) + value
      else if (op === '$setOnInsert') { if (inserting) Object.assign(doc, clone(fields)) }
      else throw new Error(`fake db: unsupported update ${op}`)
    }
    return doc
  }
  const checkUnique = (name, doc, replacing = null) => {
    for (const keys of unique.get(name) || []) {
      if (table(name).some(other => other !== replacing && keys.every(key => same(other[key], doc[key])))) {
        throw Object.assign(new Error(`E11000 duplicate key error collection: ${name}`), { code: 11000 })
      }
    }
  }
  const sorted = (docs, spec) => {
    const [[key, direction]] = Object.entries(spec)
    return [...docs].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * direction)
  }
  const group = (docs, spec) => {
    if (!docs.length) return []
    const row = { _id: spec._id }
    for (const [field, accumulator] of Object.entries(spec)) {
      if (field === '_id') continue
      const sum = accumulator.$sum
      row[field] = docs.reduce((total, doc) => total + (typeof sum === 'number' ? sum : sum?.$ifNull ? (doc[sum.$ifNull[0].slice(1)] ?? sum.$ifNull[1]) : 0), 0)
    }
    return [row]
  }

  const collection = name => ({
    async createIndex(spec, options = {}) {
      indexes.push({ collection: name, spec, options })
      if (options.unique) unique.set(name, [...(unique.get(name) || []), Object.keys(spec)])
      return Object.keys(spec).join('_')
    },
    async findOne(filter) {
      await turn()
      calls.push({ op: 'findOne', name, filter })
      const doc = table(name).find(d => matches(d, filter))
      return doc ? clone(doc) : null
    },
    async insertOne(doc) {
      await turn()
      calls.push({ op: 'insertOne', name, doc })
      const copy = clone(doc)
      checkUnique(name, copy)
      table(name).push(copy)
      return { acknowledged: true }
    },
    async updateOne(filter, update, options = {}) {
      await turn()
      calls.push({ op: 'updateOne', name, filter, update })
      const list = table(name)
      const index = list.findIndex(d => matches(d, filter))
      if (index >= 0) {
        const next = apply(clone(list[index]), update, false)
        checkUnique(name, next, list[index])
        list[index] = next
        return { matchedCount: 1, modifiedCount: 1 }
      }
      if (!options.upsert) return { matchedCount: 0, modifiedCount: 0 }
      const created = apply(Object.fromEntries(Object.entries(filter).filter(([, v]) => !isOperator(v)).map(([k, v]) => [k, clone(v)])), update, true)
      checkUnique(name, created)
      list.push(created)
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }
    },
    async deleteOne(filter) {
      await turn()
      const list = table(name)
      const index = list.findIndex(d => matches(d, filter))
      if (index >= 0) list.splice(index, 1)
      return { deletedCount: index >= 0 ? 1 : 0 }
    },
    async countDocuments(filter) {
      await turn()
      return table(name).filter(d => matches(d, filter)).length
    },
    find(filter) {
      let order = null, limit = Infinity
      const cursor = {
        sort(spec) { order = spec; return cursor },
        limit(n) { limit = n; return cursor },
        async toArray() {
          await turn()
          const found = table(name).filter(d => matches(d, filter))
          return (order ? sorted(found, order) : found).slice(0, limit).map(clone)
        },
      }
      return cursor
    },
    aggregate(pipeline) {
      return {
        async toArray() {
          await turn()
          let docs = table(name)
          for (const stage of pipeline) {
            if (stage.$match) docs = docs.filter(d => matches(d, stage.$match))
            else if (stage.$group) docs = group(docs, stage.$group)
            else throw new Error('fake db: unsupported stage')
          }
          return clone(docs)
        },
      }
    },
  })
  return { collection, tables, table, indexes, calls }
}

/** A fresh account module, fake database and clock. */
function setup({ start, interleave, seed } = {}) {
  const clock = makeClock(start)
  return { clock, db: fakeMongo({ interleave, seed }), billing: loadAccount(clock) }
}

const DAY = 24 * 3600 * 1000
const iso = date => new Date(date).toISOString()
const USER = 'user_1'
const stored = (db, id = USER) => db.table('billingAccounts').find(a => a.id === id)
const subscribe = (billing, db, planId, status, extra = {}) =>
  billing.applySubscription(db, USER, { planId, status, interval: 'month', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', ...extra })

module.exports = { fakeMongo, makeClock, loadAccount, setup, plans }

// ─── Credit months ───────────────────────────────────────────────────────────

it('addMonths keeps the day where the month has it and the time of day', () => {
  const { billing } = setup()
  const add = (from, months) => iso(billing.addMonths(new Date(from), months))
  assert.equal(add('2026-01-31T10:00:00.000Z', 1), '2026-02-28T10:00:00.000Z')
  assert.equal(add('2028-01-31T10:00:00.000Z', 1), '2028-02-29T10:00:00.000Z', 'a leap year has February 29')
  assert.equal(add('2028-02-29T00:00:00.000Z', 12), '2029-02-28T00:00:00.000Z')
  assert.equal(add('2028-02-29T00:00:00.000Z', 48), '2032-02-29T00:00:00.000Z')
  assert.equal(add('2026-03-31T23:59:59.999Z', 1), '2026-04-30T23:59:59.999Z')
  assert.equal(add('2026-12-15T08:30:00.000Z', 1), '2027-01-15T08:30:00.000Z', 'the year rolls over')
  assert.equal(add('2026-01-31T00:00:00.000Z', 13), '2027-02-28T00:00:00.000Z')
  assert.equal(add('2026-08-31T00:00:00.000Z', 6), '2027-02-28T00:00:00.000Z')
  assert.equal(add('2026-03-31T00:00:00.000Z', -1), '2026-02-28T00:00:00.000Z', 'going back clamps too')
  assert.equal(add('2026-05-20T00:00:00.000Z', 0), '2026-05-20T00:00:00.000Z')
})

it('creditPeriod finds the credit month a moment falls in, counted from the anchor day', () => {
  const { billing } = setup()
  const period = (anchor, now) => { const p = billing.creditPeriod(new Date(anchor), new Date(now)); return [iso(p.start), iso(p.end)] }
  const anchor = '2026-01-31T10:00:00.000Z'
  assert.deepEqual(period(anchor, '2026-01-31T10:00:00.000Z'), [anchor, '2026-02-28T10:00:00.000Z'], 'the anchor itself starts the first month')
  assert.deepEqual(period(anchor, '2026-02-27T12:00:00.000Z'), [anchor, '2026-02-28T10:00:00.000Z'])
  assert.deepEqual(period(anchor, '2026-02-28T09:59:59.999Z'), [anchor, '2026-02-28T10:00:00.000Z'], 'a month ends exactly at its end')
  assert.deepEqual(period(anchor, '2026-02-28T10:00:00.000Z'), ['2026-02-28T10:00:00.000Z', '2026-03-31T10:00:00.000Z'], 'and the next starts there')
  assert.deepEqual(period(anchor, '2026-03-15T00:00:00.000Z'), ['2026-02-28T10:00:00.000Z', '2026-03-31T10:00:00.000Z'], 'short months do not shift later ones')
  assert.deepEqual(period(anchor, '2026-04-30T10:00:00.000Z'), ['2026-04-30T10:00:00.000Z', '2026-05-31T10:00:00.000Z'])
  assert.deepEqual(period('2028-02-29T00:00:00.000Z', '2029-02-28T12:00:00.000Z'), ['2029-02-28T00:00:00.000Z', '2029-03-29T00:00:00.000Z'], 'leap-day anchors')
  assert.deepEqual(period('2028-02-29T00:00:00.000Z', '2029-02-27T12:00:00.000Z'), ['2029-01-29T00:00:00.000Z', '2029-02-28T00:00:00.000Z'])
  assert.deepEqual(period('2026-03-15T00:00:00.000Z', '2027-03-14T23:00:00.000Z'), ['2027-02-15T00:00:00.000Z', '2027-03-15T00:00:00.000Z'], 'across a year')
  assert.deepEqual(period(anchor, '2025-12-01T00:00:00.000Z'), [anchor, '2026-02-28T10:00:00.000Z'], 'a moment before the anchor is in the first month')
  // Every moment lies inside its month, and every month starts on a whole number of months from the anchor.
  for (let i = 0; i < 400; i++) {
    const from = new Date(Date.UTC(2026, 0, 1 + (i % 31), i % 24)), now = new Date(from.getTime() + i * 2.3 * DAY + 1234)
    const p = billing.creditPeriod(from, now)
    assert.ok(p.start <= now && now < p.end, `${iso(now)} in [${iso(p.start)}, ${iso(p.end)})`)
    const months = (p.start.getUTCFullYear() - from.getUTCFullYear()) * 12 + p.start.getUTCMonth() - from.getUTCMonth()
    assert.equal(p.start.getTime(), billing.addMonths(from, months).getTime())
    assert.equal(p.end.getTime(), billing.addMonths(from, months + 1).getTime())
  }
})

// ─── Reading the account ─────────────────────────────────────────────────────

it('an account opens on Free, once, with the indexes billing relies on', async () => {
  const { billing, db, clock } = setup({ interleave: true })
  const opened = await Promise.all([1, 2, 3, 4].map(() => billing.loadBilling(db, USER)))
  assert.equal(db.table('billingAccounts').length, 1, 'concurrent first requests open one record')
  assert.ok(opened.every(a => a.plan === 'free' && a.status === 'none' && a.creditsUsed === 0 && a.extraCredits === 0 && a.textsUsed === 0))
  assert.equal(opened[0].creditAnchor.getTime(), clock.now)
  assert.equal(opened[0]._id, undefined)
  const uniqueIndexes = db.indexes.filter(i => i.options.unique).map(i => `${i.collection}.${Object.keys(i.spec)}`)
  assert.deepEqual(uniqueIndexes.sort(), ['billingAccounts.id', 'creditCharges.id', 'creditGrants.ref'])
  await assert.rejects(billing.loadBilling(db, ''), error => error.status === 401 && error.code === 'unauthenticated' && billing.billingErrorBody(error) === null)
})

it('a new credit month starts from nothing used, lazily and once, and keeps bought credits', async () => {
  const { billing, db, clock } = setup({ start: '2026-01-31T10:00:00Z' })
  await billing.grantExtraCredits(db, USER, 100, { ref: 'cs_pack' })
  await billing.chargeCredits(db, USER, 12)
  assert.ok(await billing.takeTextReminder(db, USER) === false, 'Free has no text reminders')
  db.table('billingAccounts')[0].textsUsed = 3
  clock.set('2026-02-28T09:59:59Z')
  assert.equal((await billing.loadBilling(db, USER)).creditsUsed, 12, 'still the first month')
  clock.set('2026-02-28T10:00:00Z')
  const renewed = await billing.loadBilling(db, USER)
  assert.equal(renewed.creditsUsed, 0)
  assert.equal(renewed.textsUsed, 0)
  assert.equal(renewed.extraCredits, 100, 'bought credits never expire')
  assert.equal(iso(renewed.creditPeriodStart), '2026-02-28T10:00:00.000Z')
  assert.equal(iso(renewed.creditAnchor), '2026-01-31T10:00:00.000Z', 'the anchor stays')
  const resets = () => db.calls.filter(c => c.op === 'updateOne' && c.update.$set?.creditPeriodStart).length
  const before = resets()
  await billing.loadBilling(db, USER)
  assert.equal(resets(), before, 'reading again in the same month resets nothing')
})

it('when a new month begins under load, it resets once and never wipes a charge made after the reset', async () => {
  const { billing, db, clock } = setup({ start: '2026-03-01T00:00:00Z', interleave: true })
  await billing.chargeCredits(db, USER, 20)
  clock.set('2026-04-01T00:00:01Z')
  const [charge] = await Promise.all([billing.chargeCredits(db, USER, 7), ...[1, 2, 3, 4, 5].map(() => billing.loadBilling(db, USER))])
  const account = await billing.loadBilling(db, USER)
  assert.equal(account.creditsUsed, 7, 'only the charge of the new month counts')
  assert.equal(charge.periodStart.getTime(), Date.parse('2026-04-01T00:00:00Z'))
})

it('a request whose clock is behind never turns a newer credit month back', async () => {
  // Stripe can deliver a webhook long after its event; applying it with the event's time must not reset the month.
  const { billing, db, clock } = setup({ start: '2026-03-01T00:00:00Z' })
  await billing.loadBilling(db, USER)
  clock.set('2026-04-02T00:00:00Z')
  await billing.chargeCredits(db, USER, 9)
  const late = await billing.loadBilling(db, USER, new Date('2026-03-31T23:00:00Z'))
  assert.equal(late.creditsUsed, 9)
  assert.equal(iso(stored(db).creditPeriodStart), '2026-04-01T00:00:00.000Z')
  assert.equal((await billing.loadBilling(db, USER)).creditsUsed, 9, 'and the next request on time keeps the month as it is')
})

it('effective plans, allowances and image quality follow the subscription status', async () => {
  const { billing, db } = setup()
  const plan = (p, status) => billing.effectivePlanId({ plan: p, status })
  assert.equal(plan('pro', 'active'), 'pro')
  assert.equal(plan('business', 'trialing'), 'business')
  assert.equal(plan('pro', 'past_due'), 'pro', 'Stripe retrying the card keeps the plan')
  for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', 'none']) assert.equal(plan('pro', status), 'free', status)
  assert.equal(plan('platinum', 'active'), 'free', 'an unknown plan is Free')
  assert.deepEqual(billing.allowances({ plan: 'business', status: 'active' }), { credits: 500, textReminders: 100 })
  assert.deepEqual(billing.allowances({ plan: 'pro', status: 'canceled' }), { credits: 30, textReminders: 0 })
  assert.equal(await billing.imageQualityFor(db, null), 'standard')
  assert.equal(await billing.imageQualityFor(db, USER), 'standard', 'Free')
  await subscribe(billing, db, 'pro', 'trialing')
  assert.equal(await billing.imageQualityFor(db, USER), 'high', 'a trial has the paid quality')
  await subscribe(billing, db, 'pro', 'canceled')
  assert.equal(await billing.imageQualityFor(db, USER), 'standard')
})

// ─── Credits ─────────────────────────────────────────────────────────────────

it('charges take the month’s credits first, then bought ones, and record what each took', async () => {
  const { billing, db, clock } = setup()
  const first = await billing.chargeCredits(db, USER, 25, { reason: 'post', ref: 'post_a' })
  assert.deepEqual({ credits: first.credits, fromMonthly: first.fromMonthly, fromExtra: first.fromExtra, status: first.status, ref: first.ref, reason: first.reason }, { credits: 25, fromMonthly: 25, fromExtra: 0, status: 'held', ref: 'post_a', reason: 'post' })
  assert.match(first.id, /^chg_/)
  assert.equal(first.periodStart.getTime(), clock.now)
  await billing.grantExtraCredits(db, USER, 100, { ref: 'cs_1' })
  const second = await billing.chargeCredits(db, USER, 10)
  assert.deepEqual([second.fromMonthly, second.fromExtra, second.ref, second.reason], [5, 5, null, 'post'])
  const account = stored(db)
  assert.deepEqual([account.creditsUsed, account.extraCredits], [30, 95])
  assert.deepEqual(billing.creditsLeft(account), { monthly: 0, extra: 95, total: 95 })
  assert.deepEqual(db.table('creditCharges').map(c => [c.id, c.status]), [[first.id, 'held'], [second.id, 'held']])
  for (const credits of [0, -1, 1.5, NaN, '2']) await assert.rejects(billing.chargeCredits(db, USER, credits), error => !error.billing, String(credits))
})

it('a charge larger than what is left is refused with insufficient_credits and nothing is taken', async () => {
  const { billing, db, clock } = setup({ start: '2026-01-31T10:00:00Z' })
  await billing.chargeCredits(db, USER, 28)
  let refused
  await assert.rejects(billing.chargeCredits(db, USER, 5), error => { refused = error; return true })
  assert.equal(refused.status, 402)
  assert.equal(refused.code, 'insufficient_credits')
  assert.equal(refused.message, 'This needs 5 credits and you have 2 left. Buy extra credits or upgrade your plan to keep creating.')
  const { renewsAt, ...body } = billing.billingErrorBody(refused)
  assert.deepEqual(body, { error: refused.message, code: 'insufficient_credits', needed: 5, available: 2, plan: 'free' })
  assert.equal(iso(renewsAt), '2026-02-28T10:00:00.000Z', 'when the month renews')
  assert.equal(stored(db).creditsUsed, 28)
  assert.equal(db.table('creditCharges').length, 1)
  await billing.chargeCredits(db, USER, 2)
  await assert.rejects(billing.chargeCredits(db, USER, 1), { message: "You've used all your credits for this month. Buy extra credits or upgrade your plan to keep creating." })
  await subscribe(billing, db, 'pro', 'active')
  await billing.chargeCredits(db, USER, 150)
  clock.advance(1000)
  await assert.rejects(billing.chargeCredits(db, USER, 1), { message: "You've used all your credits. Buy extra credits or upgrade your plan to keep creating." })
})

it('a refund gives a held charge back once, and only the bought part after the month has changed', async () => {
  const { billing, db, clock } = setup({ start: '2026-01-10T00:00:00Z' })
  const charge = await billing.chargeCredits(db, USER, 8, { ref: 'post_a' })
  assert.equal(await billing.refundCharge(db, 'someone_else', charge.id), false, 'only the owner can refund')
  assert.equal(await billing.refundCharge(db, USER, charge.id), true)
  assert.equal(stored(db).creditsUsed, 0)
  assert.equal(await billing.refundCharge(db, USER, charge.id), false, 'a second refund gives nothing')
  assert.equal(stored(db).creditsUsed, 0)
  assert.equal(db.table('creditCharges')[0].status, 'refunded')
  assert.equal(await billing.refundCharge(db, USER, 'chg_missing'), false)

  // 30 monthly credits used, then 6 from a pack; the refund arrives in the next credit month.
  await billing.grantExtraCredits(db, USER, 10, { ref: 'cs_1' })
  await billing.chargeCredits(db, USER, 24)
  const mixed = await billing.chargeCredits(db, USER, 12)
  assert.deepEqual([mixed.fromMonthly, mixed.fromExtra], [6, 6])
  clock.set('2026-02-10T00:00:01Z')
  assert.equal((await billing.loadBilling(db, USER)).creditsUsed, 0)
  assert.equal(await billing.refundCharge(db, USER, mixed.id), true)
  const account = stored(db)
  assert.equal(account.creditsUsed, 0, 'the new month is not credited with last month’s credits')
  assert.equal(account.extraCredits, 10, 'bought credits come back whenever the refund happens')

  // A refund that lands before anyone read the new month still ends with nothing used in the new month.
  const late = await billing.chargeCredits(db, USER, 30)
  clock.set('2026-03-10T00:00:01Z')
  assert.equal(await billing.refundCharge(db, USER, late.id), true)
  assert.equal((await billing.loadBilling(db, USER)).creditsUsed, 0)
})

it('settling makes a charge final; findCharge returns the latest charge for a ref that was not refunded', async () => {
  const { billing, db, clock } = setup()
  assert.equal(await billing.findCharge(db, USER, ''), null)
  assert.equal(await billing.findCharge(db, USER, 'post_a'), null)
  const first = await billing.chargeCredits(db, USER, 2, { ref: 'post_a' })
  clock.advance(1000)
  const second = await billing.chargeCredits(db, USER, 3, { ref: 'post_a' })
  assert.equal((await billing.findCharge(db, USER, 'post_a')).id, second.id, 'the latest')
  assert.equal(await billing.findCharge(db, 'someone_else', 'post_a'), null, 'never another account’s')
  await billing.refundCharge(db, USER, second.id)
  assert.equal((await billing.findCharge(db, USER, 'post_a')).id, first.id, 'refunded charges are skipped')
  assert.equal(await billing.settleCharge(db, 'someone_else', first.id), false)
  assert.equal(await billing.settleCharge(db, USER, first.id), true)
  assert.equal(await billing.settleCharge(db, USER, first.id), false, 'settled once')
  const settled = await billing.findCharge(db, USER, 'post_a')
  assert.deepEqual([settled.id, settled.status], [first.id, 'settled'])
  assert.equal(await billing.refundCharge(db, USER, first.id), false, 'a settled charge cannot be refunded')
  assert.equal(stored(db).creditsUsed, 2)
})

it('concurrent charges never spend more than the account has', async () => {
  const { billing, db } = setup({ interleave: true })
  // Two posts that each need 20 of the 30 credits read the same balance before either writes: one gets them.
  const pair = await Promise.allSettled([billing.chargeCredits(db, USER, 20), billing.chargeCredits(db, USER, 20)])
  assert.deepEqual(pair.map(r => r.status).sort(), ['fulfilled', 'rejected'])
  assert.equal(pair.find(r => r.status === 'rejected').reason.code, 'insufficient_credits')
  assert.equal(stored(db).creditsUsed, 20)

  await billing.grantExtraCredits(db, USER, 7, { ref: 'cs_1' })
  const many = await Promise.allSettled(Array.from({ length: 12 }, () => billing.chargeCredits(db, USER, 3)))
  const taken = many.filter(r => r.status === 'fulfilled').map(r => r.value)
  for (const failure of many.filter(r => r.status === 'rejected')) {
    assert.ok(failure.reason.code === 'insufficient_credits' || failure.reason.status === 409, failure.reason.message)
  }
  const account = stored(db)
  assert.ok(account.creditsUsed <= 30 && account.extraCredits >= 0, 'never overspent')
  assert.equal(account.creditsUsed - 20, taken.reduce((n, c) => n + c.fromMonthly, 0), 'every monthly credit taken is recorded')
  assert.equal(7 - account.extraCredits, taken.reduce((n, c) => n + c.fromExtra, 0), 'every bought credit taken is recorded')
  assert.equal(db.table('creditCharges').length, 1 + taken.length)
  assert.ok(taken.length >= 1 && taken.length <= 5, `${taken.length} charges of 3 fit in the 17 credits left`)
})

it('a bought pack counts once per checkout, however often it is reported', async () => {
  const { billing, db } = setup({ interleave: true })
  assert.equal(await billing.grantExtraCredits(db, USER, 100, { ref: 'cs_1' }), true, 'it also opens the account')
  assert.equal(stored(db).extraCredits, 100)
  assert.equal(await billing.grantExtraCredits(db, USER, 100, { ref: 'cs_1' }), false)
  const repeated = await Promise.all([1, 2, 3].map(() => billing.grantExtraCredits(db, USER, 100, { ref: 'cs_2' })))
  assert.deepEqual(repeated.sort(), [false, false, true])
  assert.equal(stored(db).extraCredits, 200)
  assert.deepEqual(db.table('creditGrants').map(g => [g.ref, g.ownerId, g.credits, g.note]), [['cs_1', USER, 100, 'Credit pack'], ['cs_2', USER, 100, 'Credit pack']])
  await assert.rejects(billing.grantExtraCredits(db, USER, 0, { ref: 'cs_3' }), /positive whole number/)
  await assert.rejects(billing.grantExtraCredits(db, USER, 100, { ref: '' }), /ref is required/)
})

// ─── Text reminders and trials ───────────────────────────────────────────────

it('text reminders count against the month’s allowance, can be given back and never run over', async () => {
  const { billing, db, clock } = setup({ start: '2026-05-01T00:00:00Z', interleave: true })
  assert.equal(await billing.takeTextReminder(db, USER), false, 'Free has none')
  assert.equal(stored(db).textsUsed, 0)
  await billing.returnTextReminder(db, USER)
  assert.equal(stored(db).textsUsed, 0, 'giving back never goes below zero')
  await subscribe(billing, db, 'pro', 'active')
  db.table('billingAccounts')[0].textsUsed = 28
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => billing.takeTextReminder(db, USER)))
  assert.equal(results.filter(Boolean).length, 2, 'only the two left are taken')
  assert.equal(stored(db).textsUsed, 30)
  await billing.returnTextReminder(db, USER)
  assert.equal(stored(db).textsUsed, 29)
  assert.equal(await billing.takeTextReminder(db, USER), true)
  assert.equal(await billing.takeTextReminder(db, USER), false)
  clock.advance(31 * DAY)
  assert.equal(await billing.takeTextReminder(db, USER), true, 'a new month brings a new allowance')
  assert.equal(stored(db).textsUsed, 1)
})

it('a free trial caps credits at 50 and texts at 5, whatever the plan', async () => {
  for (const planId of ['pro', 'business']) {
    const { billing, db } = setup()
    const account = await subscribe(billing, db, planId, 'trialing', { trialEnd: new Date('2026-02-07T10:00:00Z') })
    assert.deepEqual(billing.allowances(account), { credits: 50, textReminders: 5 })
    assert.equal(account.trialUsed, true)
    assert.equal(billing.canStartTrial(account), false, 'a trial runs once')
    await billing.chargeCredits(db, USER, 50)
    await assert.rejects(billing.chargeCredits(db, USER, 1), { code: 'insufficient_credits' })
    for (let i = 0; i < 5; i++) assert.equal(await billing.takeTextReminder(db, USER), true)
    assert.equal(await billing.takeTextReminder(db, USER), false)
    const summary = billing.summarize(stored(db), { images: 0, bytes: 0 }, 0)
    assert.deepEqual([summary.plan, summary.trial.active, iso(summary.trial.endsAt), summary.credits.allowance, summary.credits.left, summary.texts.left], [planId, true, '2026-02-07T10:00:00.000Z', 50, 0, 0])
  }
  const { billing } = setup()
  assert.equal(billing.canStartTrial({ trialUsed: false, stripeSubscriptionId: null }), true)
  assert.equal(billing.canStartTrial({ stripeSubscriptionId: 'sub_old' }), false, 'nor for an account that subscribed before')
})

// ─── Subscriptions ───────────────────────────────────────────────────────────

it('a plan change starts a new credit month with nothing used; a renewal does not', async () => {
  const { billing, db, clock } = setup({ start: '2026-01-31T10:00:00Z' })
  await billing.grantExtraCredits(db, USER, 40, { ref: 'cs_1' })
  await billing.chargeCredits(db, USER, 20)

  // Free → Pro: the month follows the subscription's period.
  clock.set('2026-02-10T12:00:00Z')
  const paidFrom = new Date('2026-02-10T11:59:00Z')
  let account = await subscribe(billing, db, 'pro', 'active', { currentPeriodStart: paidFrom, currentPeriodEnd: new Date('2026-03-10T11:59:00Z') })
  assert.deepEqual([account.plan, account.status, account.creditsUsed, account.extraCredits], ['pro', 'active', 0, 40])
  assert.equal(iso(account.creditAnchor), iso(paidFrom))
  assert.equal(iso(account.creditPeriodStart), iso(paidFrom))
  assert.equal(billing.creditsLeft(account).monthly, 150)
  assert.deepEqual([account.stripeCustomerId, account.stripeSubscriptionId, account.cancelAtPeriodEnd], ['cus_1', 'sub_1', false])

  // An update on the same plan keeps the month's use; credits renew from the anchor instead.
  await billing.chargeCredits(db, USER, 40)
  clock.set('2026-02-20T09:00:00Z')
  account = await subscribe(billing, db, 'pro', 'active', { currentPeriodStart: paidFrom, currentPeriodEnd: new Date('2026-03-10T11:59:00Z') })
  assert.deepEqual([account.creditsUsed, iso(account.creditAnchor)], [40, iso(paidFrom)])
  clock.set('2026-03-10T12:00:00Z')
  account = await subscribe(billing, db, 'pro', 'active', { currentPeriodStart: new Date('2026-03-10T11:59:00Z'), currentPeriodEnd: new Date('2026-04-10T11:59:00Z') })
  assert.equal(iso(account.creditAnchor), iso(paidFrom), 'the anchor stays')
  assert.equal(iso(account.currentPeriodEnd), '2026-04-10T11:59:00.000Z')
  assert.equal(account.creditsUsed, 0, 'the lazy monthly reset renewed it at the anchor day')
  await billing.chargeCredits(db, USER, 15)
  account = await subscribe(billing, db, 'pro', 'past_due', { cancelAtPeriodEnd: true })
  assert.equal(account.creditsUsed, 15, 'a failed payment while Stripe retries changes nothing')
  assert.equal(account.cancelAtPeriodEnd, true)

  // Pro → Business, an upgrade: a full Business month from now on.
  clock.set('2026-03-20T00:00:00Z')
  account = await subscribe(billing, db, 'business', 'active', { currentPeriodStart: new Date('2026-03-20T00:00:00Z') })
  assert.deepEqual([account.creditsUsed, billing.creditsLeft(account).monthly, iso(account.creditAnchor)], [0, 500, '2026-03-20T00:00:00.000Z'])

  // Cancelled → Free: the Free month starts now, whatever period Stripe reports.
  await billing.chargeCredits(db, USER, 60)
  clock.set('2026-04-02T08:00:00Z')
  account = await subscribe(billing, db, 'business', 'canceled', { currentPeriodStart: new Date('2026-03-20T00:00:00Z') })
  assert.equal(billing.effectivePlanId(account), 'free')
  assert.deepEqual([account.creditsUsed, iso(account.creditAnchor), billing.creditsLeft(account).total], [0, '2026-04-02T08:00:00.000Z', 30 + 40])
})

it('a trial that turns paid starts the paid month; a period start in the future anchors at now', async () => {
  const { billing, db, clock } = setup({ start: '2026-06-01T00:00:00Z' })
  let account = await subscribe(billing, db, 'pro', 'trialing', { currentPeriodStart: new Date('2026-06-01T00:00:00Z'), trialEnd: new Date('2026-06-08T00:00:00Z') })
  await billing.chargeCredits(db, USER, 45)
  clock.set('2026-06-08T00:00:05Z')
  account = await subscribe(billing, db, 'pro', 'active', { currentPeriodStart: new Date('2026-06-08T00:00:00Z') })
  assert.deepEqual([account.status, account.creditsUsed, billing.allowances(account).credits, iso(account.creditAnchor)], ['active', 0, 150, '2026-06-08T00:00:00.000Z'])
  assert.equal(account.trialEnd, null)
  assert.equal(account.trialUsed, true, 'still counts as used')

  const other = setup({ start: '2026-06-01T00:00:00Z' })
  const future = await subscribe(other.billing, other.db, 'pro', 'active', { currentPeriodStart: new Date('2026-06-02T00:00:00Z') })
  assert.equal(iso(future.creditAnchor), '2026-06-01T00:00:00.000Z')
})

it('Stripe customers are found by ID once recorded', async () => {
  const { billing, db } = setup()
  assert.equal(await billing.findBillingByCustomer(db, ''), null)
  await billing.setStripeCustomer(db, USER, 'cus_9')
  assert.equal((await billing.findBillingByCustomer(db, 'cus_9')).id, USER)
  assert.equal(await billing.findBillingByCustomer(db, 'cus_other'), null)
})

// ─── Plan features and limits ────────────────────────────────────────────────

it('requireFeature names the feature and the plans that have it', async () => {
  const { billing, db } = setup()
  const refusal = async feature => { try { await billing.requireFeature(db, USER, feature) } catch (error) { return error } return null }
  const expected = {
    scheduling: 'Scheduling posts is part of Pro and Business. Upgrade to use it.',
    emailReminders: 'Email reminders are part of Pro and Business. Upgrade to use them.',
    textReminders: 'Text reminders are part of Pro and Business. Upgrade to use them.',
    customDesigns: 'Creating your own designs is part of Pro and Business. Upgrade to use it.',
    adDesigns: 'Ad designs are part of Business. Upgrade to use them.',
  }
  for (const [feature, message] of Object.entries(expected)) {
    const error = await refusal(feature)
    assert.equal(error.message, message)
    assert.deepEqual(billing.billingErrorBody(error), { error: message, code: 'upgrade_required', feature, requiredPlan: feature === 'adDesigns' ? 'business' : 'pro' })
    assert.equal(error.status, 402)
    assert.equal(await billing.hasFeature(db, USER, feature), false)
  }
  await subscribe(billing, db, 'pro', 'active')
  for (const feature of ['scheduling', 'emailReminders', 'textReminders', 'customDesigns']) assert.equal(await refusal(feature), null, feature)
  assert.equal((await refusal('adDesigns')).message, expected.adDesigns)
  await subscribe(billing, db, 'business', 'active')
  assert.equal(await refusal('adDesigns'), null)
})

it('requireBrandSlot stops a new brand at the plan’s limit, counting only the account’s own brands', async () => {
  const brands = (owner, n) => Array.from({ length: n }, (_, i) => ({ id: `${owner}-${i}`, ownerId: owner }))
  const refusal = async (billing, db) => { try { await billing.requireBrandSlot(db, USER) } catch (error) { return error } return null }
  let { billing, db } = setup({ seed: { flows: brands('someone_else', 4) } })
  assert.equal(await refusal(billing, db), null, 'brands of other accounts do not count')
  db.table('flows').push({ id: 'mine', ownerId: USER })
  let error = await refusal(billing, db)
  assert.equal(error.message, 'Your Free plan includes 1 brand. Upgrade to Pro to add another, or delete a brand you no longer use.')
  assert.deepEqual(billing.billingErrorBody(error), { error: error.message, code: 'limit_reached', limit: 'brands', max: 1, used: 1, requiredPlan: 'pro' })
  await subscribe(billing, db, 'pro', 'active')
  assert.equal(await refusal(billing, db), null)
  db.table('flows').push({ id: 'mine-2', ownerId: USER })
  assert.equal((await refusal(billing, db)).message, 'Your Pro plan includes 2 brands. Upgrade to Business to add another, or delete a brand you no longer use.')

  ;({ billing, db } = setup({ seed: { flows: brands(USER, 5) } }))
  await subscribe(billing, db, 'business', 'active')
  error = await refusal(billing, db)
  assert.equal(error.message, 'Your Business plan includes 5 brands. Contact us to add more, or delete a brand you no longer use.')
  assert.equal(billing.billingErrorBody(error).requiredPlan, null)

  // Brands made before the limits keep working; only adding another is stopped, and the upgrade named fits them all.
  ;({ billing, db } = setup({ seed: { flows: brands(USER, 3) } }))
  error = await refusal(billing, db)
  assert.deepEqual([error.code, billing.billingErrorBody(error).used, billing.billingErrorBody(error).requiredPlan], ['limit_reached', 3, 'business'])
})

it('uploads are limited by image count on Free and by size on paid plans, counting only the person’s own images', async () => {
  const MB = 1024 ** 2
  const own = (n, size) => Array.from({ length: n }, (_, i) => ({ id: `u${i}`, ownerId: USER, userUpload: true, ...(size == null ? {} : { size }) }))
  let { billing, db } = setup({ seed: { uploads: [...own(19, 1000), { id: 'generated', ownerId: USER, size: 5 * MB }, { id: 'theirs', ownerId: 'someone_else', userUpload: true, size: 1 }, { id: 'nosize', ownerId: USER, userUpload: true }] } })
  assert.deepEqual(await billing.uploadUsage(db, USER), { images: 20, bytes: 19000 })
  let error = await billing.requireUploadRoom(db, USER, 10).catch(e => e)
  assert.equal(error.message, 'Your Free plan holds up to 20 of your own images. Delete some from the Gallery, or upgrade for more space.')
  assert.deepEqual(billing.billingErrorBody(error), { error: error.message, code: 'limit_reached', limit: 'uploads', maxImages: 20, images: 20 })
  db.table('uploads').pop()
  assert.equal(await billing.requireUploadRoom(db, USER, 10 * MB), undefined, 'Free counts images, not bytes')

  ;({ billing, db } = setup({ seed: { uploads: own(1, 2 * 1024 * MB - MB) } }))
  assert.deepEqual(await billing.uploadUsage(setup().db, USER), { images: 0, bytes: 0 }, 'no uploads at all')
  await subscribe(billing, db, 'pro', 'active')
  assert.equal(await billing.requireUploadRoom(db, USER, MB / 2), undefined)
  error = await billing.requireUploadRoom(db, USER, 2 * MB).catch(e => e)
  assert.equal(error.message, "This image doesn't fit: you've used 2 GB of your 2 GB. Delete some images from the Gallery, or upgrade for more space.")
  assert.deepEqual(billing.billingErrorBody(error), { error: error.message, code: 'limit_reached', limit: 'uploads', maxBytes: 2 * 1024 ** 3, bytes: 2 * 1024 * MB - MB })
})

it('billingErrorBody answers for plan limits only', () => {
  const { billing } = setup()
  const error = billing.billingError(402, 'limit_reached', 'Upgrade to add another brand.', { limit: 'brands', max: 1 })
  assert.deepEqual([error.status, error.code, error.billing, error instanceof Error], [402, 'limit_reached', true, true])
  assert.deepEqual(billing.billingErrorBody(error), { error: 'Upgrade to add another brand.', code: 'limit_reached', limit: 'brands', max: 1 })
  for (const code of billing.BILLING_CODES) assert.equal(billing.billingErrorBody(billing.billingError(402, code, 'x')).code, code)
  assert.equal(billing.billingErrorBody(new Error('boom')), null)
  assert.equal(billing.billingErrorBody(Object.assign(new Error('x'), { code: 'insufficient_credits' })), null, 'only errors made by billingError')
  assert.equal(billing.billingErrorBody(billing.billingError(401, 'unauthenticated', 'Sign in')), null)
  assert.equal(billing.billingErrorBody(null), null)
  assert.equal(billing.billingErrorBody(undefined), null)
})

it('the summary shows what is left this month, including bought credits', async () => {
  const { billing, db } = setup({ start: '2026-01-31T10:00:00Z', seed: { flows: [{ id: 'b', ownerId: USER }], uploads: [{ id: 'u', ownerId: USER, userUpload: true, size: 2048 }] } })
  await billing.grantExtraCredits(db, USER, 10, { ref: 'cs_1' })
  await billing.chargeCredits(db, USER, 5)
  const summary = await billing.getBillingSummary(db, USER)
  const { renewsAt, ...credits } = summary.credits
  assert.deepEqual(credits, { allowance: 30, used: 5, extra: 10, left: 35, approxPosts: 8 })
  assert.equal(iso(renewsAt), '2026-02-28T10:00:00.000Z')
  assert.deepEqual([summary.plan, summary.planName, summary.interval, summary.hasSubscription, summary.imageQuality], ['free', 'Free', null, false, 'standard'])
  assert.deepEqual(summary.brands, { used: 1, max: 1 })
  assert.deepEqual(summary.uploads, { images: 1, bytes: 2048, maxImages: 20, maxBytes: null, label: 'Up to 20 images' })
  assert.deepEqual(summary.texts, { allowance: 0, used: 0, left: 0 })
  assert.equal(summary.trial.available, true)
  assert.deepEqual(summary.features, { scheduling: false, emailReminders: false, textReminders: false, customDesigns: false, adDesigns: false })
})
