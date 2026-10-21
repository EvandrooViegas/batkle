import { ATTRIBUTION_COOKIE, VISITOR_COOKIE, channelOf, cookieValue, decodeAttribution, UTM_KEYS } from './attribution'

/**
 * Visits to Batkle's public pages (one per browser session, sent by components/analytics/VisitTracker) and the
 * campaign each account came from. `visits`: { at, visitorId, path, channel, source, medium, campaign, content, term,
 * referrer }; no IP address, no user agent.
 */
const VISITOR_ID = /^[a-zA-Z0-9-]{8,64}$/
// The endpoint is public: a visitor is counted once per half hour, and a flood stops being stored.
const DEDUPE_MS = 30 * 60 * 1000
const MAX_PER_MINUTE = 600

const clean = (value: unknown, max = 120) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '')

let indexed: Promise<unknown> | null = null
function ensureIndexes(db: any) {
  indexed ||= Promise.all([
    db.collection('visits').createIndex({ at: -1 }),
    db.collection('visits').createIndex({ visitorId: 1, at: -1 }),
  ]).catch(() => { indexed = null })
  return indexed
}

/** Stores one visit; false when it was not stored (invalid, a repeat, or too many at once). */
export async function recordVisit(db: any, body: any, now = new Date()): Promise<boolean> {
  const visitorId = clean(body?.visitorId, 64)
  if (!VISITOR_ID.test(visitorId)) return false
  await ensureIndexes(db)
  const visits = db.collection('visits')
  if (await visits.findOne({ visitorId, at: { $gte: new Date(now.getTime() - DEDUPE_MS) } }, { projection: { _id: 1 } })) return false
  if (await visits.countDocuments({ at: { $gte: new Date(now.getTime() - 60_000) } }) >= MAX_PER_MINUTE) return false
  const tags = Object.fromEntries(UTM_KEYS.map(k => [k, clean(body?.[k])]))
  const visit = { at: now, visitorId, path: clean(body?.landing || body?.path, 200) || '/', referrer: clean(body?.referrer), ...tags }
  await visits.insertOne({ ...visit, channel: channelOf(visit as any) })
  return true
}

/**
 * Saves where a new account came from, once, from the attribution cookie its browser carried. Called when onboarding
 * is finished, which every account does before using Batkle.
 */
export async function recordSignupAttribution(db: any, userId: string, cookieHeader: string | null | undefined) {
  const attribution = decodeAttribution(cookieValue(cookieHeader, ATTRIBUTION_COOKIE))
  const visitorId = clean(cookieValue(cookieHeader, VISITOR_COOKIE), 64)
  const value = attribution ? { ...attribution, ...(VISITOR_ID.test(visitorId) ? { visitorId } : {}) } : { first: null, last: null }
  await db.collection('users').updateOne({ id: userId, attribution: { $exists: false } }, { $set: { attribution: { ...value, savedAt: new Date() } } })
}
