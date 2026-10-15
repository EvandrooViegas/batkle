// Shared by the reminders, SMS and onboarding tests: a source loader and an in-memory stand-in for the MongoDB calls
// the billing, settings, schedule and reminder code makes.
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')

/**
 * Loads a module with its types stripped and returns `names` from it. Imports listed in `deps` come from there,
 * other imports are required (node: modules), and `process` is `{ env }`.
 */
function load(file, names, deps = {}, env = {}) {
  let source = fs.readFileSync(file, 'utf8')
  if (/\.tsx?$/.test(file)) source = stripTypeScriptTypes(source)
  source = source
    .replace(/^import \{([^}]*)\} from '([^']+)'$/gm, (_, list, from) => {
      const names = list.split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/\s+as\s+/, ': ')).join(', ')
      return from in deps ? `const { ${names} } = __deps['${from}']` : `const { ${names} } = require('${from}')`
    })
    .replace(/^import (\w+) from '([^']+)'$/gm, (_, name, from) => (from in deps ? `const ${name} = __deps['${from}']` : `const ${name} = require('${from}')`))
    .replace(/^export (default )?/gm, '')
  return new Function('require', '__deps', 'process', source + `;return {${names.join(',')}}`)(require, deps, { env })
}

const isPlain = value => value !== null && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value)
const get = (doc, path) => path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc)
function put(doc, path, value) {
  const keys = path.split('.')
  let target = doc
  for (const key of keys.slice(0, -1)) {
    if (!isPlain(target[key])) target[key] = {}
    target = target[key]
  }
  target[keys.at(-1)] = value
}
function drop(doc, path) {
  const keys = path.split('.')
  const parent = keys.length > 1 ? get(doc, keys.slice(0, -1).join('.')) : doc
  if (parent && typeof parent === 'object') delete parent[keys.at(-1)]
}
const time = value => (value instanceof Date ? value.getTime() : value)
function same(a, b) {
  if (b === null) return a == null
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  if (typeof a === 'object' && typeof b === 'object' && a && b) return JSON.stringify(a) === JSON.stringify(b)
  return a === b
}

function expression(doc, expr) {
  const operand = value => (typeof value === 'string' && value.startsWith('$') ? get(doc, value.slice(1)) : value)
  if (expr.$ne) return !same(operand(expr.$ne[0]), operand(expr.$ne[1]))
  if (expr.$eq) return same(operand(expr.$eq[0]), operand(expr.$eq[1]))
  throw new Error(`fake db: unsupported $expr ${JSON.stringify(expr)}`)
}

function matches(doc, query) {
  return Object.entries(query).every(([key, cond]) => {
    if (key === '$or') return cond.some(q => matches(doc, q))
    if (key === '$and') return cond.every(q => matches(doc, q))
    if (key === '$expr') return expression(doc, cond)
    const value = get(doc, key)
    if (isPlain(cond) && Object.keys(cond).some(k => k.startsWith('$'))) {
      return Object.entries(cond).every(([op, arg]) => {
        switch (op) {
          case '$ne': return !same(value, arg)
          case '$in': return arg.some(x => same(value, x))
          case '$nin': return !arg.some(x => same(value, x))
          case '$exists': return (value !== undefined) === Boolean(arg)
          case '$gte': return value != null && time(value) >= time(arg)
          case '$gt': return value != null && time(value) > time(arg)
          case '$lte': return value != null && time(value) <= time(arg)
          case '$lt': return value != null && time(value) < time(arg)
          default: throw new Error(`fake db: unsupported operator ${op}`)
        }
      })
    }
    return same(value, cond)
  })
}

function apply(doc, update, inserting) {
  for (const [path, value] of Object.entries(update.$set || {})) put(doc, path, structuredClone(value))
  for (const path of Object.keys(update.$unset || {})) drop(doc, path)
  for (const [path, n] of Object.entries(update.$inc || {})) put(doc, path, (get(doc, path) || 0) + n)
  if (inserting) for (const [path, value] of Object.entries(update.$setOnInsert || {})) put(doc, path, structuredClone(value))
}

/** Equality fields of a query, for the document an upsert creates. */
function seed(query) {
  const doc = {}
  for (const [key, value] of Object.entries(query)) if (!key.startsWith('$') && !(isPlain(value) && Object.keys(value).some(k => k.startsWith('$')))) put(doc, key, structuredClone(value))
  return doc
}

const sortBy = spec => (a, b) => {
  for (const [key, dir] of Object.entries(spec || {})) {
    const x = time(get(a, key)) ?? -Infinity, y = time(get(b, key)) ?? -Infinity
    if (x < y) return -dir
    if (x > y) return dir
  }
  return 0
}

/** An in-memory database: `data[name]` holds each collection's documents. Every call returns copies. */
function fakeDb(initial = {}) {
  const data = {}
  for (const [name, docs] of Object.entries(initial)) data[name] = docs.map(doc => structuredClone(doc))
  let nextId = 0
  const list = name => (data[name] ||= [])
  const out = doc => (doc ? structuredClone(doc) : null)
  const collection = name => ({
    createIndex: async () => 'index',
    findOne: async query => out(list(name).find(doc => matches(doc, query))),
    find: (query = {}) => {
      let docs = list(name).filter(doc => matches(doc, query))
      let max = Infinity
      const chain = {
        sort: spec => { docs = [...docs].sort(sortBy(spec)); return chain },
        limit: n => { max = n; return chain },
        toArray: async () => docs.slice(0, max).map(out),
      }
      return chain
    },
    insertOne: async doc => { list(name).push(structuredClone({ _id: `oid${++nextId}`, ...doc })); return { insertedId: nextId } },
    updateOne: async (query, update, options = {}) => {
      const doc = list(name).find(d => matches(d, query))
      if (doc) { apply(doc, update, false); return { matchedCount: 1, modifiedCount: 1 } }
      if (options.upsert) { const created = { _id: `oid${++nextId}`, ...seed(query) }; apply(created, update, true); list(name).push(created); return { matchedCount: 0, upsertedCount: 1 } }
      return { matchedCount: 0, modifiedCount: 0 }
    },
    updateMany: async (query, update) => {
      const docs = list(name).filter(d => matches(d, query))
      docs.forEach(doc => apply(doc, update, false))
      return { matchedCount: docs.length, modifiedCount: docs.length }
    },
    findOneAndUpdate: async (query, update, options = {}) => {
      let doc = list(name).find(d => matches(d, query))
      if (!doc && !options.upsert) return null
      const before = out(doc)
      if (!doc) { doc = { _id: `oid${++nextId}`, ...seed(query) }; apply(doc, update, true); list(name).push(doc) } else apply(doc, update, false)
      return options.returnDocument === 'after' ? out(doc) : before
    },
    deleteOne: async query => {
      const index = list(name).findIndex(d => matches(d, query))
      if (index >= 0) list(name).splice(index, 1)
      return { deletedCount: index >= 0 ? 1 : 0 }
    },
    countDocuments: async (query = {}) => list(name).filter(d => matches(d, query)).length,
    aggregate: () => ({ toArray: async () => [] }),
  })
  return { data, collection }
}

/** A stand-in for next/server's NextResponse.json: the body and status, nothing else. */
const NextResponse = { json: (body, init) => ({ body, status: init?.status || 200 }) }

/**
 * The real billing, settings, reminder and schedule modules wired to fake email and SMS services. `services` switches
 * them on and off or makes them fail; `outbox` records what was sent. `reset()` clears both.
 */
function notificationModules() {
  const plans = load('lib/billing/plans.ts', ['PLANS', 'TRIAL', 'approxPosts', 'cheapestPlanForBrands', 'cheapestPlanWith', 'formatBytes', 'planById', 'uploadsLabel'])
  const account = load('lib/billing/account.ts', ['loadBilling', 'effectivePlan', 'allowances', 'takeTextReminder', 'returnTextReminder', 'requireFeature', 'hasFeature', 'getBillingSummary', 'billingError', 'billingErrorBody', 'creditPeriod'], { './plans': plans })
  const schedule = load('lib/client/schedule.js', ['PLATFORM_IDS', 'CAPTION_MAX', 'platformNames', 'scheduleProblem'])
  const email = load('lib/notifications/email.ts', ['emailLayout', 'escapeHtml'])
  const sms = load('lib/notifications/sms.ts', ['CALLING_CODES', 'toE164', 'maskPhone', 'smsErrorMessage', 'OPTED_OUT'])

  const outbox = {}, services = {}
  const reset = () => {
    Object.assign(outbox, { emails: [], emailAttempts: 0, texts: [], smsAttempts: 0, codes: [], checks: [] })
    Object.assign(services, { email: true, sms: true, verify: true, emailFailures: 0, smsError: null, code: '123456' })
  }
  reset()
  const fakeEmail = {
    ...email,
    emailConfigured: () => services.email,
    sendEmail: async message => {
      outbox.emailAttempts++
      if (services.emailFailures > 0) {
        services.emailFailures--
        throw Object.assign(new Error(`Resend: HTTP 500 (could not send to ${message.to})`), { status: 502 })
      }
      outbox.emails.push(message)
      return { id: `em_${outbox.emails.length}` }
    },
  }
  const fakeSms = {
    ...sms,
    smsConfigured: () => services.sms,
    verifyConfigured: () => services.verify,
    sendSms: async (to, body) => {
      outbox.smsAttempts++
      if (services.smsError) throw services.smsError
      outbox.texts.push({ to, body })
      return `SM${outbox.texts.length}`
    },
    startVerification: async to => { outbox.codes.push(to); return { status: 'pending' } },
    checkVerification: async (to, code) => { outbox.checks.push({ to, code }); return { approved: code === services.code } },
  }
  const settings = load('lib/notifications/settings.ts', ['CONSENT_TEXT', 'PHONE_CODES_PER_HOUR', 'readNotifications', 'phoneReady', 'unverifiedPhone', 'takeRateSlot', 'notificationsView', 'updateNotifications', 'startPhoneVerification', 'checkPhoneVerification', 'removePhone'],
    { '@/lib/billing/account': account, './email': fakeEmail, './sms': fakeSms })
  const reminders = load('lib/notifications/reminders.ts', ['DEFAULT_LIMIT', 'MAX_ATTEMPTS', 'STALE_AFTER_MS', 'RETRY_AFTER_MS', 'cronAuthProblem', 'reminderEmail', 'reminderText', 'runReminders'],
    { '@/lib/billing/account': account, '@/lib/client/schedule': schedule, './email': fakeEmail, './sms': fakeSms, './settings': settings })
  const handlers = load('lib/handlers/scheduleHandlers.ts', ['handleApprovePost', 'handleUpdateScheduledPost', 'handleDeleteScheduledPost', 'handleListSchedule'],
    { 'next/server': { NextResponse }, '@/lib/client/schedule': schedule, '@/lib/billing/account': account })
  return { plans, account, schedule, sms, settings, reminders, handlers, outbox, services, reset }
}

const HOUR = 3600_000

/** A `billingAccounts` record on `plan`, in a credit month that started 10 days before `now`. */
function billingRecord(account, id, plan, { status = plan === 'free' ? 'none' : 'active', now = new Date(), ...extra } = {}) {
  const anchor = new Date(now.getTime() - 240 * HOUR)
  return { id, plan, status, interval: plan === 'free' ? null : 'month', creditAnchor: anchor, creditPeriodStart: account.creditPeriod(anchor, now).start, creditsUsed: 0, textsUsed: 0, extraCredits: 0, createdAt: anchor, updatedAt: anchor, ...extra }
}

module.exports = { load, fakeDb, NextResponse, notificationModules, billingRecord, HOUR }
