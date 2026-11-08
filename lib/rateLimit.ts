/**
 * Request limits kept in MongoDB, so they hold across every server instance: one counter per bucket and time window
 * (collection `rateLimits`), removed by a TTL index once its window is over. Used where a request costs money (the AI
 * routes that take no credits) or writes to the database for anyone (the public visit counter).
 */

let indexed: Promise<unknown> | null = null

/**
 * Counts one request in `bucket` for the current window of `windowMs`: true once more than `limit` arrived in it, so
 * the caller refuses or drops this one. A limit that cannot be read never blocks the request.
 */
export async function overLimit(db: any, bucket: string, limit: number, windowMs: number, now = new Date()): Promise<boolean> {
  try {
    const counters = db.collection('rateLimits')
    indexed ||= counters.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => { indexed = null })
    const slot = Math.floor(now.getTime() / windowMs)
    const count = () => counters.findOneAndUpdate(
      { _id: `${bucket}:${windowMs}:${slot}` },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((slot + 1) * windowMs + 60_000) } },
      { upsert: true, returnDocument: 'after' },
    )
    // Two first requests racing to open the counter: the loser counts again on the one that won.
    const counter = await count().catch((error: any) => (error?.code === 11000 ? count() : Promise.reject(error)))
    return (counter?.count ?? counter?.value?.count ?? 1) > limit
  } catch (error: any) {
    console.warn('[rate-limit] not counted:', error?.message)
    return false
  }
}

/** The caller's IP address as Vercel gives it (it sets x-forwarded-for itself, so a client cannot fake it). */
export function clientIp(request: Request): string {
  return (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown'
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/**
 * The AI routes that take no credits (ideas, copy, research, translation, design studies, ad ideas, logo versions)
 * are paid for by Batkle per request. Generous for a person working, low enough that a script cannot run up the AI
 * bill or use up the AI account's per-minute limit for everyone else.
 */
export const AI_LIMITS = [
  { limit: 40, windowMs: 10 * MINUTE },
  { limit: 400, windowMs: 24 * HOUR },
]

/** Said when an account went over AI_LIMITS. */
export const AI_LIMIT_MESSAGE = 'You’re going faster than Batkle can keep up with. Please wait a few minutes and try again.'

/** True when this account went over AI_LIMITS (every window is counted, so a burst counts toward the day too). */
export async function overAiLimit(db: any, userId: string, now = new Date()): Promise<boolean> {
  let over = false
  for (const { limit, windowMs } of AI_LIMITS) if (await overLimit(db, `ai:${userId}`, limit, windowMs, now)) over = true
  return over
}
