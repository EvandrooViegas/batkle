import { billingErrorBody, getBillingSummary, requireFeature } from '@/lib/billing/account'
import { emailConfigured } from './email'
import { checkVerification, maskPhone, smsConfigured, smsErrorMessage, startVerification, toE164, verifyConfigured } from './sms'
import type { Feature } from '@/lib/billing/plans'

/**
 * How post reminders reach a person, stored on their `users` record:
 * - notifications: { email (default on), sms (default off), leadMinutes: 0 (when the post is due) or 60 (an hour before) }
 * - phone: { number (E.164), verifiedAt, smsConsentAt, optedOutAt }, optional. A number given in onboarding is
 *   saved unverified; nothing is ever texted to a number until it is verified with a code and the person agreed.
 * The plan decides whether reminders go out at all (lib/billing/plans.ts); these are the person's own choices.
 */

export interface NotificationPrefs { email: boolean; sms: boolean; leadMinutes: 0 | 60 }
export interface PhoneRecord {
  number: string
  verifiedAt: Date | null
  smsConsentAt: Date | null
  optedOutAt: Date | null
  /** The words the person agreed to, kept with the consent. */
  consentText?: string
}

/** The consent checkbox's words; the settings page shows them and the record keeps them. */
export const CONSENT_TEXT = 'I agree to get reminder texts from Batkle. Message and data rates may apply. Reply STOP to stop.'
export const DEFAULT_NOTIFICATIONS: NotificationPrefs = { email: true, sms: false, leadMinutes: 0 }
export const LEAD_CHOICES = [0, 60]
/** Verification codes someone can ask for in an hour: each one is a paid text. */
export const PHONE_CODES_PER_HOUR = 5

const HOUR = 3600_000
// Messages written for people: the API shows them as they are (`expose`), even a 429's.
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status, expose: true })
const users = (db: any) => db.collection('users')
// MongoDB driver v6 returns the document; older drivers wrap it in { value, ok }.
const unwrap = (result: any) => (result && typeof result === 'object' && 'ok' in result && 'value' in result ? result.value : result)

let indexes: Promise<unknown> | null = null
function ensureIndexes(db: any) {
  indexes ||= db.collection('notificationLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    .catch((error: any) => { indexes = null; console.warn('[notifications] could not create indexes:', error?.message) })
  return indexes
}

/** The person's reminder choices, with the defaults for anything never set. */
export function readNotifications(user: any): NotificationPrefs {
  const saved = user?.notifications || {}
  return {
    email: typeof saved.email === 'boolean' ? saved.email : DEFAULT_NOTIFICATIONS.email,
    sms: saved.sms === true,
    leadMinutes: saved.leadMinutes === 60 ? 60 : 0,
  }
}

/** A number that may be texted: verified, agreed to, and not opted out by replying STOP. */
export function phoneReady(user: any): boolean {
  const phone = user?.phone
  return Boolean(phone?.number && toE164(phone.number) && phone.verifiedAt && phone.smsConsentAt && !phone.optedOutAt)
}

/** The phone record for a number given in onboarding: the saved one when it is the same number, else unverified. */
export function unverifiedPhone(number: string, existing?: PhoneRecord | null): PhoneRecord {
  if (existing?.number === number) return existing
  return { number, verifiedAt: null, smsConsentAt: null, optedOutAt: null }
}

/**
 * Counts one use of `bucket` in the current window and says whether it is within `limit`. Fixed windows in
 * `notificationLimits`, which MongoDB empties itself (TTL index).
 */
export async function takeRateSlot(db: any, bucket: string, limit: number, windowMs: number, now = new Date()): Promise<boolean> {
  await ensureIndexes(db)
  const window = Math.floor(now.getTime() / windowMs)
  const counter = unwrap(await db.collection('notificationLimits').findOneAndUpdate(
    { _id: `${bucket}:${window}` },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 2) * windowMs) } },
    { upsert: true, returnDocument: 'after' },
  ))
  return (counter?.count || 1) <= limit
}

async function loadUser(db: any, userId: string) {
  return users(db).findOne({ id: userId }, { projection: { _id: 0, email: 1, notifications: 1, phone: 1 } })
}

/** The upgrade message for each feature the plan lacks, as the API's billing error body; null where it is included. */
async function upgradeBodies(db: any, userId: string, features: Record<string, boolean>) {
  const names: Feature[] = ['scheduling', 'emailReminders', 'textReminders']
  const bodies = await Promise.all(names.map(async feature => {
    if (features[feature]) return null
    try {
      await requireFeature(db, userId, feature)
      return null
    } catch (error) {
      const body = billingErrorBody(error)
      if (!body) throw error
      return body
    }
  }))
  return Object.fromEntries(names.map((feature, i) => [feature, bodies[i]]))
}

/**
 * What the reminder settings show: the person's choices, their phone (masked), whether email and texts can be sent
 * at all, what the plan includes (with the upgrade message where it doesn't) and the texts left this month.
 */
export async function notificationsView(db: any, userId: string) {
  const [user, summary] = await Promise.all([loadUser(db, userId), getBillingSummary(db, userId)])
  const phone = user?.phone?.number ? user.phone : null
  return {
    email: { address: user?.email || '', configured: emailConfigured(), included: summary.features.emailReminders },
    texts: {
      configured: smsConfigured() && verifyConfigured(),
      included: summary.features.textReminders,
      allowance: summary.texts.allowance,
      used: summary.texts.used,
      left: summary.texts.left,
    },
    settings: readNotifications(user),
    phone: phone ? { masked: maskPhone(phone.number), verified: Boolean(phone.verifiedAt), consented: Boolean(phone.smsConsentAt), optedOut: Boolean(phone.optedOutAt) } : null,
    plan: { id: summary.plan, name: summary.planName, trial: summary.trial.active, scheduling: summary.features.scheduling },
    upgrade: await upgradeBodies(db, userId, summary.features),
    consentText: CONSENT_TEXT,
  }
}

/**
 * Saves `{ email, sms, leadMinutes }` (any of them). Turning texts on needs the plan's text reminders, texts being
 * set up, and a verified phone the person agreed to get texts on.
 */
export async function updateNotifications(db: any, userId: string, body: any, now = new Date()) {
  const set: Record<string, unknown> = {}
  if (body && 'email' in body) {
    if (typeof body.email !== 'boolean') throw httpError(400, 'Choose whether to get email reminders.')
    set['notifications.email'] = body.email
  }
  if (body && 'leadMinutes' in body) {
    if (!LEAD_CHOICES.includes(body.leadMinutes)) throw httpError(400, 'Choose when reminders arrive: when the post is due, or an hour before.')
    set['notifications.leadMinutes'] = body.leadMinutes
  }
  if (body && 'sms' in body) {
    if (typeof body.sms !== 'boolean') throw httpError(400, 'Choose whether to get text reminders.')
    if (body.sms) {
      await requireFeature(db, userId, 'textReminders')
      if (!smsConfigured()) throw httpError(503, 'Text reminders aren’t available right now.')
      const user = await loadUser(db, userId)
      if (!user?.phone?.verifiedAt || !user.phone.smsConsentAt) throw httpError(400, 'Add and verify your phone number first.')
      // Turning texts back on after a STOP reply is the person asking for them again.
      if (user.phone.optedOutAt) set['phone.optedOutAt'] = null
    }
    set['notifications.sms'] = body.sms
  }
  if (!Object.keys(set).length) throw httpError(400, 'Nothing to change.')
  await users(db).updateOne({ id: userId }, { $set: { ...set, updatedAt: now } })
  return notificationsView(db, userId)
}

/** A failed verification call as an error for people, when the reason is one they can fix. */
function smsFailure(error: any) {
  const known = smsErrorMessage(error)
  return known ? httpError(known.status, known.message) : error
}

/** The number a phone request is about: `phone` from the body, else the one saved on the account. */
function requestedNumber(body: any, user: any): string {
  const number = body && typeof body.phone === 'string' && body.phone.trim() ? toE164(body.phone) : user?.phone?.number || null
  if (!number) throw httpError(400, 'Enter your mobile number with its country code.')
  return number
}

/** Texts a verification code to `{ phone }` (or the saved number); about five codes an hour per account. */
export async function startPhoneVerification(db: any, userId: string, body: any, now = new Date()) {
  await requireFeature(db, userId, 'textReminders')
  if (!verifyConfigured() || !smsConfigured()) throw httpError(503, 'Text reminders aren’t available right now.')
  const number = requestedNumber(body, await loadUser(db, userId))
  if (!await takeRateSlot(db, `phone-code:${userId}`, PHONE_CODES_PER_HOUR, HOUR, now)) {
    throw httpError(429, 'You’ve asked for a lot of codes. Please try again in an hour.')
  }
  try {
    await startVerification(number)
  } catch (error) {
    throw smsFailure(error)
  }
  return { sent: true, phone: maskPhone(number) }
}

/**
 * Checks the code for `{ phone }` (or the saved number). A right code saves the number as verified, with the
 * person's consent (`consent: true`, from the checkbox) and when they gave it.
 */
export async function checkPhoneVerification(db: any, userId: string, body: any, now = new Date()) {
  await requireFeature(db, userId, 'textReminders')
  if (!verifyConfigured()) throw httpError(503, 'Text reminders aren’t available right now.')
  if (body?.consent !== true) throw httpError(400, 'Tick the box to agree to reminder texts.')
  const code = typeof body?.code === 'string' ? body.code.replace(/\s/g, '') : ''
  if (!/^\d{4,10}$/.test(code)) throw httpError(400, 'Enter the code from the text.')
  const number = requestedNumber(body, await loadUser(db, userId))
  let result
  try {
    result = await checkVerification(number, code)
  } catch (error) {
    throw smsFailure(error)
  }
  if (!result.approved) throw httpError(400, 'That code isn’t right. Check the text and try again.')
  const phone: PhoneRecord = { number, verifiedAt: now, smsConsentAt: now, optedOutAt: null, consentText: CONSENT_TEXT }
  await users(db).updateOne({ id: userId }, { $set: { phone, updatedAt: now } })
  return notificationsView(db, userId)
}

/** Forgets the phone number and turns text reminders off. */
export async function removePhone(db: any, userId: string, now = new Date()) {
  await users(db).updateOne({ id: userId }, { $unset: { phone: '' }, $set: { 'notifications.sms': false, updatedAt: now } })
  return notificationsView(db, userId)
}
