import { createHash, timingSafeEqual } from 'node:crypto'
import { allowances, effectivePlan, loadBilling, returnTextReminder, takeTextReminder } from '@/lib/billing/account'
import { platformNames } from '@/lib/client/schedule'
import { emailConfigured, emailLayout, escapeHtml, sendEmail } from './email'
import { OPTED_OUT, sendSms, smsConfigured } from './sms'
import { phoneReady, readNotifications } from './settings'

/**
 * Post reminders. Batkle never posts by itself: when a scheduled post is due (or an hour before, if the person
 * chose that), it emails them and, on plans with texts, texts them a link to the post with its slides and caption.
 *
 * An external scheduler calls /api/cron/reminders every few minutes, which runs runReminders. Each post's reminder
 * state lives on its `scheduledPosts` entry as `reminder`:
 *   { at: the scheduledAt it is for, claimedAt, attempts, done, sentAt, channels: { email, sms }, errors }
 * A run claims a post atomically before sending, so two runs at once never remind twice; a channel that failed is
 * tried again on later runs, up to MAX_ATTEMPTS. Rescheduling a post clears `reminder` (scheduleHandlers), so the
 * new time gets its own reminder.
 */

/** Runs at most this many reminders, so one call stays well inside the function's time limit. */
export const DEFAULT_LIMIT = 100
export const MAX_ATTEMPTS = 3
/** Posts more than this late get no reminder: after an outage, a stale "time to post" helps nobody. */
export const STALE_AFTER_MS = 6 * 3600_000
/** A failed channel waits this long before a later run tries it again (and an unfinished claim is taken over). */
export const RETRY_AFTER_MS = 4 * 60_000
const MAX_LEAD_MINUTES = 60
// Twilio errors that no retry fixes: an invalid, unreachable or landline number, or a country not enabled.
const UNDELIVERABLE = [21211, 21408, 21612, 21614]

type Channel = 'email' | 'sms'
type Outcome = 'sent' | 'failed' | 'off' | 'not_on_plan' | 'unavailable' | 'no_address' | 'no_texts_left' | 'opted_out' | 'undeliverable'

const posts = (db: any) => db.collection('scheduledPosts')
const unwrap = (result: any) => (result && typeof result === 'object' && 'ok' in result && 'value' in result ? result.value : result)

let indexes: Promise<unknown> | null = null
function ensureIndexes(db: any) {
  indexes ||= posts(db).createIndex({ status: 1, scheduledAt: 1 })
    .catch((error: any) => { indexes = null; console.warn('[reminders] could not create indexes:', error?.message) })
  return indexes
}

/**
 * Whether a request may run the reminders: null when it may, otherwise the status and message to answer with.
 * Without CRON_SECRET the job is switched off (503) rather than open to anyone.
 */
export function cronAuthProblem(header: string | null | undefined, secret: string | undefined): { status: number; error: string } | null {
  const expected = secret?.trim()
  if (!expected) return { status: 503, error: 'Reminders are not set up.' }
  const given = typeof header === 'string' ? header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '' : ''
  // Hashes have the same length, so the comparison takes the same time whatever was sent.
  const digest = (value: string) => createHash('sha256').update(value).digest()
  if (!given || !timingSafeEqual(digest(given), digest(expected))) return { status: 401, error: 'Not allowed.' }
  return null
}

/** Drops email addresses and phone numbers from an error message before it is stored, and keeps it short. */
function safeError(error: any) {
  const message = String(error?.message || 'Failed').replace(/[^\s@]+@[^\s@]+/g, '[email]').replace(/\+?\d[\d\s-]{6,}\d/g, '[number]').slice(0, 160)
  return { message, ...(error?.code ? { code: error.code } : {}), ...(error?.status ? { status: error.status } : {}) }
}

/** "Tue 14 Oct, 18:00" in the time zone the post was scheduled in. */
function formatDue(at: Date, timeZone?: string | null) {
  const options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
  try {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: timeZone || 'UTC' }).format(at)
  } catch {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(at) + ' UTC'
  }
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

/** The reminder email: what to post, for which brand and where, the caption to copy and a button to the post. */
export function reminderEmail({ entry, brand, link, settingsLink, now }: { entry: any; brand: string; link: string; settingsLink: string; now: Date }) {
  const topic = clip(String(entry.topic || 'Your post').trim() || 'Your post', 120)
  const at = new Date(entry.scheduledAt)
  const due = at.getTime() <= now.getTime() ? `is due now (${formatDue(at, entry.timeZone)})` : `is due at ${formatDue(at, entry.timeZone)}`
  const where = platformNames(entry.platforms || [])
  const caption = String(entry.caption || '').trim()
  const lead = `Your ${brand} post ${due}${where ? ` on ${where}` : ''}.`
  const html = emailLayout({
    heading: `Time to post: ${topic}`,
    paragraphs: [
      `Your <strong>${escapeHtml(brand)}</strong> post ${escapeHtml(due)}${where ? ` on ${escapeHtml(where)}` : ''}. Batkle doesn’t post for you, so here’s everything you need.`,
      ...(caption ? [
        'The caption, ready to copy:',
        `<span style="display:block;padding:14px 16px;background:#f4f1ec;border-radius:10px;font-size:15px;line-height:1.5;color:#141210;white-space:pre-wrap">${escapeHtml(caption).replace(/\n/g, '<br>')}</span>`,
      ] : []),
      'Open the post to download the slides, or on your phone to share them straight to the app. Then mark it as posted.',
    ],
    button: { label: 'Open the post', url: link },
    footer: `You’re getting this because you scheduled this post in Batkle with email reminders on. <a href="${escapeHtml(settingsLink)}" style="color:#77716a">Turn reminders off</a>.`,
  })
  const text = [
    `Time to post: ${topic}`,
    '',
    `${lead} Batkle doesn't post for you, so here's everything you need.`,
    ...(caption ? ['', 'Caption:', caption] : []),
    '',
    `Open the post: ${link}`,
    '',
    `You're getting this because you scheduled this post in Batkle with email reminders on. Turn reminders off: ${settingsLink}`,
  ].join('\n')
  return { subject: `Time to post: ${topic}`, html, text }
}

/** The reminder text: short, so it fits in one or two messages. */
export function reminderText({ entry, brand, link }: { entry: any; brand: string; link: string }) {
  const topic = clip(String(entry.topic || 'your post').trim().replace(/"/g, '\'') || 'your post', 60)
  return `Batkle: time to post "${topic}" for ${clip(brand, 40)}. ${link}`
}

interface Owner { user: any; plan: ReturnType<typeof effectivePlan>; textAllowance: number }

/**
 * Sends the reminders that are due: scheduled posts whose time is within their owner's lead time (now, or an hour
 * ahead) and no more than 6 hours past, not yet reminded for that time. At most `limit` posts, and it stops starting
 * new ones once `budgetMs` has passed. Returns counts for the log.
 */
export async function runReminders(db: any, { now = new Date(), limit = DEFAULT_LIMIT, budgetMs = 45_000, baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000' }: { now?: Date; limit?: number; budgetMs?: number; baseUrl?: string } = {}) {
  await ensureIndexes(db)
  const started = Date.now()
  const base = (baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`).replace(/\/+$/, '')
  const summary = { candidates: 0, reminded: 0, emails: 0, texts: 0, failed: 0, skipped: 0, more: false }

  // Posts already handled for their time are left out; failed ones come back for another try.
  const candidates = await posts(db).find({
    status: 'scheduled',
    scheduledAt: { $gte: new Date(now.getTime() - STALE_AFTER_MS), $lte: new Date(now.getTime() + MAX_LEAD_MINUTES * 60_000) },
    $or: [{ 'reminder.done': { $ne: true } }, { $expr: { $ne: ['$reminder.at', '$scheduledAt'] } }],
  }, { projection: { _id: 0 } }).sort({ scheduledAt: 1 }).limit(limit * 3).toArray()
  summary.candidates = candidates.length

  const owners = new Map<string, Owner>()
  const brands = new Map<string, string>()
  const ownerOf = async (ownerId: string): Promise<Owner> => {
    if (!owners.has(ownerId)) {
      const [user, billing] = await Promise.all([
        db.collection('users').findOne({ id: ownerId }, { projection: { _id: 0, email: 1, notifications: 1, phone: 1 } }),
        loadBilling(db, ownerId, now),
      ])
      owners.set(ownerId, { user, plan: effectivePlan(billing), textAllowance: allowances(billing).textReminders })
    }
    return owners.get(ownerId)!
  }
  const brandOf = async (entry: any) => {
    const key = `${entry.ownerId}:${entry.flowId}`
    if (!brands.has(key)) {
      const flow = await db.collection('flows').findOne({ id: entry.flowId, ownerId: entry.ownerId }, { projection: { _id: 0, name: 1, 'brandContext.name': 1 } })
      brands.set(key, String(flow?.brandContext?.name || flow?.name || 'your brand').trim() || 'your brand')
    }
    return brands.get(key)!
  }

  let handled = 0
  for (const candidate of candidates) {
    if (handled >= limit || Date.now() - started > budgetMs) { summary.more = true; break }
    const owner = await ownerOf(candidate.ownerId)
    const prefs = readNotifications(owner.user)
    // Due within this owner's lead time; a post further ahead waits for a later run.
    if (new Date(candidate.scheduledAt).getTime() > now.getTime() + prefs.leadMinutes * 60_000) continue

    const claimed = await claim(db, candidate, now)
    if (!claimed) { summary.skipped++; continue }
    handled++
    const outcome = await remind(db, claimed.entry, claimed.retry, { owner, prefs, brand: await brandOf(claimed.entry), base, now })
    if (outcome.email === 'sent') summary.emails++
    if (outcome.sms === 'sent') summary.texts++
    if (outcome.email === 'sent' || outcome.sms === 'sent') summary.reminded++
    if (outcome.email === 'failed' || outcome.sms === 'failed') summary.failed++
  }
  return summary
}

/**
 * Takes a post for this run: a first reminder for its current time, or another try of one that failed on an earlier
 * run (and isn't being sent by another run right now). Null when another run has it or it changed meanwhile.
 */
async function claim(db: any, entry: any, now: Date): Promise<{ entry: any; retry: boolean } | null> {
  const at = new Date(entry.scheduledAt)
  const same = { id: entry.id, ownerId: entry.ownerId, status: 'scheduled', scheduledAt: at }
  const fresh = unwrap(await posts(db).findOneAndUpdate(
    { ...same, 'reminder.at': { $ne: at } },
    { $set: { reminder: { at, claimedAt: now, attempts: 1, done: false, channels: {}, errors: [] } } },
    { returnDocument: 'after', projection: { _id: 0 } },
  ))
  if (fresh) return { entry: fresh, retry: false }
  const retry = unwrap(await posts(db).findOneAndUpdate(
    { ...same, 'reminder.at': at, 'reminder.done': false, 'reminder.attempts': { $lt: MAX_ATTEMPTS }, 'reminder.claimedAt': { $lte: new Date(now.getTime() - RETRY_AFTER_MS) } },
    { $set: { 'reminder.claimedAt': now }, $inc: { 'reminder.attempts': 1 } },
    { returnDocument: 'after', projection: { _id: 0 } },
  ))
  return retry ? { entry: retry, retry: true } : null
}

/** Sends a claimed post's reminder on each channel the plan, the settings and the setup allow, and records how it went. */
async function remind(db: any, entry: any, retry: boolean, { owner, prefs, brand, base, now }: { owner: Owner; prefs: ReturnType<typeof readNotifications>; brand: string; base: string; now: Date }) {
  const at = new Date(entry.scheduledAt)
  const previous: Record<string, Outcome> = entry.reminder?.channels || {}
  const channels: Record<string, Outcome> = { ...previous }
  const errors: any[] = []
  const link = `${base}/app/${encodeURIComponent(entry.flowId)}/schedule?post=${encodeURIComponent(entry.id)}`
  // Only this run's claim may write, and not after the post was rescheduled (which clears `reminder`).
  const mine = { id: entry.id, 'reminder.at': at, 'reminder.claimedAt': now }
  const record = (channel: Channel, outcome: Outcome) => {
    channels[channel] = outcome
    return posts(db).updateOne(mine, { $set: { [`reminder.channels.${channel}`]: outcome, ...(outcome === 'sent' && !entry.reminder?.sentAt ? { 'reminder.sentAt': new Date() } : {}) } })
  }
  // A retry sends only what failed (or never got as far as being recorded) last time.
  const due = (channel: Channel) => !retry || !previous[channel] || previous[channel] === 'failed'

  if (due('email')) {
    const reason: Outcome | null = !owner.plan.emailReminders ? 'not_on_plan' : !prefs.email ? 'off' : !emailConfigured() ? 'unavailable'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner.user?.email || '') ? 'no_address' : null
    if (reason) channels.email = reason
    else {
      let sent = false
      try {
        const message = reminderEmail({ entry, brand, link, settingsLink: `${base}/app/settings#notifications`, now })
        // The same key within a day sends once, so a retry after a lost answer never emails twice.
        await sendEmail({ to: owner.user.email, ...message, idempotencyKey: `reminder-${entry.id}-${at.toISOString()}` })
        sent = true
      } catch (error) {
        console.warn('[reminders] email failed for', entry.id, (error as any)?.message)
        errors.push({ channel: 'email', at: now, ...safeError(error) })
      }
      await record('email', sent ? 'sent' : 'failed')
    }
  }

  if (due('sms')) {
    const reason: Outcome | null = !(owner.textAllowance > 0 && owner.plan.textReminders > 0) ? 'not_on_plan' : !prefs.sms ? 'off'
      : owner.user?.phone?.optedOutAt ? 'opted_out' : !phoneReady(owner.user) ? 'off' : !smsConfigured() ? 'unavailable' : null
    if (reason) channels.sms = reason
    else if (!await takeTextReminder(db, entry.ownerId)) await record('sms', 'no_texts_left')
    else {
      let outcome: Outcome = 'sent'
      try {
        await sendSms(owner.user.phone.number, reminderText({ entry, brand, link }))
      } catch (error: any) {
        await returnTextReminder(db, entry.ownerId)
        errors.push({ channel: 'sms', at: now, ...safeError(error) })
        if (Number(error?.code) === OPTED_OUT) {
          // They replied STOP: no more texts until they turn them back on in Settings.
          outcome = 'opted_out'
          await db.collection('users').updateOne({ id: entry.ownerId }, { $set: { 'phone.optedOutAt': now, 'notifications.sms': false, updatedAt: now } })
          owner.user = { ...owner.user, phone: { ...owner.user.phone, optedOutAt: now }, notifications: { ...owner.user?.notifications, sms: false } }
        } else {
          outcome = UNDELIVERABLE.includes(Number(error?.code)) ? 'undeliverable' : 'failed'
          console.warn('[reminders] text failed for', entry.id, error?.message)
        }
      }
      await record('sms', outcome)
    }
  }

  const failed = Object.values(channels).includes('failed')
  const done = !failed || (entry.reminder?.attempts || 1) >= MAX_ATTEMPTS
  await posts(db).updateOne(mine, {
    $set: { 'reminder.channels': channels, 'reminder.errors': [...(entry.reminder?.errors || []), ...errors].slice(-6), 'reminder.done': done, 'reminder.finishedAt': new Date() },
  })
  return channels
}
