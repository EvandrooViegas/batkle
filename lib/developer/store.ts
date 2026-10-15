import { hashApiKey, maskedKey, newApiKey, newId } from './keys'
import { starterCredits } from './pricing'
import { apiError } from './validate'

/**
 * The developer API's records, all keyed by the Clerk user ID (`ownerId`):
 * - developerAccounts: the credit balance, opened with the starter credits on first use
 * - apiKeys: one per key, holding its SHA-256 hash, never the key itself
 * - apiUsage: one per API request, kept for USAGE_DAYS days
 * - creditLedger: credits added to an account (starter credits and grants)
 * - apiRateLimits: per-minute request counters, removed two minutes after their minute ends
 */

export const USAGE_DAYS = 90
export const MAX_ACTIVE_KEYS = 10

let indexes: Promise<unknown> | null = null
function ensureIndexes(db: any) {
  indexes ||= Promise.all([
    db.collection('developerAccounts').createIndex({ id: 1 }, { unique: true }),
    db.collection('apiKeys').createIndex({ hash: 1 }, { unique: true }),
    db.collection('apiKeys').createIndex({ ownerId: 1, createdAt: -1 }),
    db.collection('apiUsage').createIndex({ ownerId: 1, createdAt: -1 }),
    db.collection('apiUsage').createIndex({ createdAt: 1 }, { expireAfterSeconds: USAGE_DAYS * 86400 }),
    db.collection('creditLedger').createIndex({ ownerId: 1, createdAt: -1 }),
    db.collection('apiRateLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]).catch(error => { indexes = null; console.warn('[developer] could not create indexes:', error?.message) })
  return indexes
}

// ─── Credits ─────────────────────────────────────────────────────────────────

/** The account's balance record, opened with the starter credits the first time it is needed. */
export async function developerAccount(db: any, ownerId: string): Promise<{ id: string; balance: number; createdAt: Date }> {
  await ensureIndexes(db)
  const accounts = db.collection('developerAccounts')
  const existing = await accounts.findOne({ id: ownerId }, { projection: { _id: 0 } })
  if (existing) return existing
  const now = new Date(), credits = starterCredits()
  try {
    await accounts.insertOne({ id: ownerId, balance: credits, createdAt: now, updatedAt: now })
    if (credits) await db.collection('creditLedger').insertOne({ id: newId('cr'), ownerId, credits, reason: 'starter', note: 'Starter credits', createdAt: now })
  } catch (error: any) {
    // Another request opened the account first.
    if (error?.code !== 11000) throw error
  }
  return accounts.findOne({ id: ownerId }, { projection: { _id: 0 } })
}

/** Takes `credits` when the balance holds that many: the balance after, or null when it is too low. */
export async function takeCredits(db: any, ownerId: string, credits: number): Promise<number | null> {
  const account = await developerAccount(db, ownerId)
  if (credits <= 0) return account.balance
  const after = await db.collection('developerAccounts').findOneAndUpdate(
    { id: ownerId, balance: { $gte: credits } },
    { $inc: { balance: -credits }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after', projection: { _id: 0, balance: 1 } },
  )
  return after ? after.balance : null
}

/** Takes up to `credits`, never below zero: the credits taken. For charges settled after the work is done. */
export async function takeCreditsUpTo(db: any, ownerId: string, credits: number): Promise<number> {
  if (credits <= 0) return 0
  const before = await db.collection('developerAccounts').findOneAndUpdate(
    { id: ownerId },
    [{ $set: { balance: { $max: [0, { $subtract: ['$balance', credits] }] }, updatedAt: '$$NOW' } }],
    { returnDocument: 'before', projection: { _id: 0, balance: 1 } },
  )
  return before ? Math.min(credits, Math.max(0, before.balance)) : 0
}

export async function returnCredits(db: any, ownerId: string, credits: number) {
  if (credits <= 0) return
  await db.collection('developerAccounts').updateOne({ id: ownerId }, { $inc: { balance: credits }, $set: { updatedAt: new Date() } })
}

/** Adds credits to an account and records why. */
export async function grantCredits(db: any, ownerId: string, credits: number, note = 'Credits added') {
  if (!Number.isInteger(credits) || credits <= 0) throw apiError(400, 'invalid_request', 'Credits must be a positive whole number.')
  await developerAccount(db, ownerId)
  const now = new Date()
  await db.collection('developerAccounts').updateOne({ id: ownerId }, { $inc: { balance: credits }, $set: { updatedAt: now } })
  await db.collection('creditLedger').insertOne({ id: newId('cr'), ownerId, credits, reason: 'grant', note: String(note).slice(0, 200), createdAt: now })
}

/**
 * The credits one request has taken, so a failed request can give them all back. `take` refuses when the balance
 * is too low, with an insufficient_credits error that says how many were needed.
 */
export function creditCharge(db: any, ownerId: string) {
  let charged = 0
  return {
    get charged() { return charged },
    async take(credits: number) {
      if (credits <= 0) return
      const balance = await takeCredits(db, ownerId, credits)
      if (balance === null) {
        const { balance: left } = await developerAccount(db, ownerId)
        throw apiError(402, 'insufficient_credits', `This request needs ${credits} more credit${credits === 1 ? '' : 's'} and the balance is ${left}. Add credits in the developer dashboard.`, { needed: credits, balance: left })
      }
      charged += credits
    },
    /** Settles the charge at `total`: gives back what was over, takes what is missing (as far as the balance goes). */
    async settle(total: number) {
      if (total < charged) { await returnCredits(db, ownerId, charged - total); charged = total }
      else if (total > charged) charged += await takeCreditsUpTo(db, ownerId, total - charged)
    },
    async refundAll() {
      const credits = charged
      charged = 0
      await returnCredits(db, ownerId, credits)
    },
  }
}

// ─── Keys ────────────────────────────────────────────────────────────────────

const keyName = (name: unknown) => (typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 60) : '') || 'API key'

/** A key as the dashboard shows it: never the hash. */
export function publicKey(record: any) {
  return { id: record.id, name: record.name, masked: maskedKey(record), createdAt: record.createdAt, lastUsedAt: record.lastUsedAt || null, revokedAt: record.revokedAt || null }
}

/** Creates a key. The key itself is in the result only this once. */
export async function createApiKey(db: any, ownerId: string, name: unknown) {
  await developerAccount(db, ownerId)
  const keys = db.collection('apiKeys')
  if (await keys.countDocuments({ ownerId, revokedAt: null }) >= MAX_ACTIVE_KEYS) {
    throw apiError(400, 'invalid_request', `An account can have ${MAX_ACTIVE_KEYS} active keys. Revoke one you no longer use first.`)
  }
  const { key, hash, start, last4 } = newApiKey()
  const record = { id: newId('key'), ownerId, name: keyName(name), hash, start, last4, createdAt: new Date(), lastUsedAt: null, revokedAt: null }
  await keys.insertOne({ ...record })
  return { key, record: publicKey(record) }
}

export async function listApiKeys(db: any, ownerId: string) {
  await ensureIndexes(db)
  const keys = await db.collection('apiKeys').find({ ownerId }, { projection: { _id: 0, hash: 0 } }).sort({ createdAt: -1 }).limit(100).toArray()
  return keys.map(publicKey)
}

/** Revokes a key at once: requests made with it fail from now on. */
export async function revokeApiKey(db: any, ownerId: string, id: string) {
  const result = await db.collection('apiKeys').updateOne({ id, ownerId, revokedAt: null }, { $set: { revokedAt: new Date() } })
  if (!result.matchedCount) throw apiError(404, 'not_found', 'Key not found, or already revoked.')
}

/** The key record for an API key, or null when it is unknown or revoked. Marks it used. */
export async function authenticateKey(db: any, key: string) {
  await ensureIndexes(db)
  const record = await db.collection('apiKeys').findOne({ hash: hashApiKey(key) }, { projection: { _id: 0, hash: 0 } })
  if (!record || record.revokedAt) return null
  // Last use is kept to the minute, so a busy key costs at most one extra write a minute.
  const now = new Date()
  if (!record.lastUsedAt || now.getTime() - new Date(record.lastUsedAt).getTime() > 60_000) {
    await db.collection('apiKeys').updateOne({ id: record.id }, { $set: { lastUsedAt: now } })
  }
  return record as { id: string; ownerId: string; name: string }
}

// ─── Rate limits ─────────────────────────────────────────────────────────────

/** Counts one request in this minute's window for `bucket`; refuses once `limit` is passed. */
export async function checkRateLimit(db: any, bucket: string, limit: number) {
  const now = Date.now(), minute = Math.floor(now / 60_000)
  const counter = await db.collection('apiRateLimits').findOneAndUpdate(
    { _id: `${bucket}:${minute}` },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((minute + 2) * 60_000) } },
    { upsert: true, returnDocument: 'after' },
  )
  if ((counter?.count || 1) <= limit) return
  const retryAfter = Math.max(1, Math.ceil(((minute + 1) * 60_000 - now) / 1000))
  throw apiError(429, 'rate_limited', `Too many requests: the limit is ${limit} a minute. Try again in ${retryAfter} seconds.`, { headers: { 'Retry-After': String(retryAfter) } })
}

// ─── Usage ───────────────────────────────────────────────────────────────────

export interface UsageEntry {
  requestId: string
  ownerId: string
  keyId: string
  method: string
  endpoint: string
  status: number
  credits: number
  durationMs: number
  meta?: Record<string, unknown>
  error?: string
}

/** Records one API request. A failure to record never fails the request. */
export async function recordUsage(db: any, entry: UsageEntry) {
  try {
    await db.collection('apiUsage').insertOne({ id: entry.requestId, ...entry, createdAt: new Date() })
  } catch (error: any) {
    console.warn('[developer] usage not recorded:', error?.message)
  }
}

const DAY = 86_400_000

/** The calendar dates of the last `days` days in a time zone, oldest first, as YYYY-MM-DD. */
export function lastDays(days: number, timeZone: string, now = new Date()): string[] {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-').map(Number)
  return Array.from({ length: days }, (_, i) => new Date(Date.UTC(y, m - 1, d - (days - 1 - i))).toISOString().slice(0, 10))
}

/** Everything the dashboard shows: balance, keys, the last `days` days of usage and the latest requests. */
export async function usageOverview(db: any, ownerId: string, { days = 30, timeZone = 'UTC' }: { days?: number; timeZone?: string } = {}) {
  const account = await developerAccount(db, ownerId)
  const dates = lastDays(days, timeZone)
  // A day of margin: the first date starts at local midnight, which can be up to 14 hours from UTC midnight.
  const match = { ownerId, createdAt: { $gte: new Date(Date.parse(dates[0]) - DAY) } }
  const totals = {
    credits: { $sum: '$credits' },
    requests: { $sum: 1 },
    errors: { $sum: { $cond: [{ $gte: ['$status', 400] }, 1, 0] } },
  }
  const usage = db.collection('apiUsage')
  const [byDay, byEndpoint, byKey, recent, keys, grants] = await Promise.all([
    usage.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: timeZone } }, ...totals } }]).toArray(),
    usage.aggregate([{ $match: match }, { $addFields: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: timeZone } } } }, { $match: { day: { $gte: dates[0] } } }, { $group: { _id: '$endpoint', ...totals } }, { $sort: { credits: -1, requests: -1 } }]).toArray(),
    usage.aggregate([{ $match: match }, { $addFields: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: timeZone } } } }, { $match: { day: { $gte: dates[0] } } }, { $group: { _id: '$keyId', ...totals } }]).toArray(),
    usage.find({ ownerId }, { projection: { _id: 0, ownerId: 0 } }).sort({ createdAt: -1 }).limit(50).toArray(),
    listApiKeys(db, ownerId),
    db.collection('creditLedger').find({ ownerId }, { projection: { _id: 0, ownerId: 0 } }).sort({ createdAt: -1 }).limit(20).toArray(),
  ])
  const day = new Map(byDay.map((row: any) => [row._id, row]))
  const series = dates.map(date => {
    const row: any = day.get(date)
    return { date, credits: row?.credits || 0, requests: row?.requests || 0, errors: row?.errors || 0 }
  })
  const perKey = new Map(byKey.map((row: any) => [row._id, row]))
  const keyNames = new Map(keys.map((k: any) => [k.id, k.name]))
  return {
    balance: account.balance,
    timeZone,
    days,
    totals: series.reduce((sum, d) => ({ credits: sum.credits + d.credits, requests: sum.requests + d.requests, errors: sum.errors + d.errors }), { credits: 0, requests: 0, errors: 0 }),
    series,
    endpoints: byEndpoint.map((row: any) => ({ endpoint: row._id, credits: row.credits, requests: row.requests, errors: row.errors })),
    keys: keys.map((k: any) => {
      const row: any = perKey.get(k.id)
      return { ...k, credits: row?.credits || 0, requests: row?.requests || 0 }
    }),
    recent: recent.map((r: any) => ({ id: r.id, endpoint: r.endpoint, status: r.status, credits: r.credits, durationMs: r.durationMs, keyName: keyNames.get(r.keyId) || 'Deleted key', meta: r.meta || null, createdAt: r.createdAt })),
    grants,
  }
}
