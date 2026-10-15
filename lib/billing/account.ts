import { randomUUID } from 'node:crypto'
import { PLANS, TRIAL, approxPosts, cheapestPlanForBrands, cheapestPlanWith, formatBytes, planById, uploadsLabel } from './plans'
import type { Feature, ImageQuality, Interval, Plan, PlanId } from './plans'

/**
 * Each account's plan and credits, in `billingAccounts`, one record per Clerk user ID, opened on first use:
 * - plan, status, interval and the Stripe IDs, written by the Stripe webhook through applySubscription
 * - the month's credit use: credits renew every month from `creditAnchor` (the day the plan started), yearly plans too
 * - extraCredits: bought credit packs, used after the month's credits run out, never expiring
 * - textsUsed: text reminders sent this credit month
 * `creditCharges` records what each post took, so a post that fails can give its credits back, and `creditGrants`
 * makes a bought pack count once however often Stripe reports it.
 *
 * Accounts without a subscription are on Free. Payments not being set up changes nothing here.
 */

export type BillingStatus = 'none' | 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused'

export interface BillingAccount {
  id: string
  plan: PlanId
  status: BillingStatus
  interval: Interval | null
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
  cancelAtPeriodEnd?: boolean
  currentPeriodEnd?: Date | null
  trialEnd?: Date | null
  /** Set once a trial has started: a trial runs once per account. */
  trialUsed?: boolean
  creditAnchor: Date
  creditPeriodStart: Date
  creditsUsed: number
  textsUsed: number
  extraCredits: number
  createdAt: Date
  updatedAt: Date
}

/** The error codes the app shows as "upgrade" or "buy credits" prompts; their messages are written for people. */
export const BILLING_CODES = ['insufficient_credits', 'upgrade_required', 'limit_reached', 'payments_unavailable', 'trial_used']

/** Stripe statuses that keep the paid plan: past_due while Stripe retries the card. */
const PAID_STATUSES: BillingStatus[] = ['active', 'trialing', 'past_due']

export function billingError(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { status, code, billing: true, details })
}

/** The JSON body for a billing error, or null for any other error. */
export function billingErrorBody(error: any): Record<string, unknown> | null {
  if (!error?.billing || !BILLING_CODES.includes(error.code)) return null
  return { error: error.message, code: error.code, ...(error.details || {}) }
}

// ─── Credit months ───────────────────────────────────────────────────────────

/** `date` moved by whole months in UTC, keeping the day where the month has it (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear(), month = date.getUTCMonth() + months
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), last), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()))
}

/** The credit month `now` falls in, counted from `anchor`: each month starts on the anchor's day. */
export function creditPeriod(anchor: Date, now = new Date()): { start: Date; end: Date } {
  const from = new Date(anchor)
  if (now.getTime() < from.getTime()) return { start: from, end: addMonths(from, 1) }
  let months = (now.getUTCFullYear() - from.getUTCFullYear()) * 12 + now.getUTCMonth() - from.getUTCMonth()
  if (addMonths(from, months).getTime() > now.getTime()) months--
  return { start: addMonths(from, months), end: addMonths(from, months + 1) }
}

// ─── Reading the account ─────────────────────────────────────────────────────

let indexes: Promise<unknown> | null = null
function ensureIndexes(db: any) {
  indexes ||= Promise.all([
    db.collection('billingAccounts').createIndex({ id: 1 }, { unique: true }),
    db.collection('billingAccounts').createIndex({ stripeCustomerId: 1 }, { sparse: true }),
    db.collection('creditCharges').createIndex({ id: 1 }, { unique: true }),
    db.collection('creditCharges').createIndex({ ownerId: 1, ref: 1 }),
    db.collection('creditCharges').createIndex({ status: 1, createdAt: 1 }),
    db.collection('creditGrants').createIndex({ ref: 1 }, { unique: true }),
    db.collection('uploads').createIndex({ ownerId: 1 }, { sparse: true }),
  ]).catch(error => { indexes = null; console.warn('[billing] could not create indexes:', error?.message) })
  return indexes
}

const accounts = (db: any) => db.collection('billingAccounts')
const time = (value: unknown) => new Date(value as any).getTime()

/** The plan the account has now: its paid plan while the subscription is in good standing, otherwise Free. */
export function effectivePlanId(account: Pick<BillingAccount, 'plan' | 'status'>): PlanId {
  return account.plan !== 'free' && PAID_STATUSES.includes(account.status) ? planById(account.plan).id : 'free'
}

export function effectivePlan(account: Pick<BillingAccount, 'plan' | 'status'>): Plan {
  return PLANS[effectivePlanId(account)]
}

/** This month's allowances: the plan's, capped during a free trial. */
export function allowances(account: Pick<BillingAccount, 'plan' | 'status'>): { credits: number; textReminders: number } {
  const plan = effectivePlan(account)
  if (account.status !== 'trialing') return { credits: plan.credits, textReminders: plan.textReminders }
  return { credits: Math.min(plan.credits, TRIAL.credits), textReminders: Math.min(plan.textReminders, TRIAL.textReminders) }
}

/**
 * The account's billing record, opened on Free the first time it is needed. When a new credit month has begun, the
 * month's use starts again from zero (once, however many requests arrive together).
 */
export async function loadBilling(db: any, userId: string, now = new Date()): Promise<BillingAccount> {
  if (!userId) throw billingError(401, 'unauthenticated', 'Sign in to continue.')
  await ensureIndexes(db)
  let account: BillingAccount | null = await accounts(db).findOne({ id: userId }, { projection: { _id: 0 } })
  if (!account) {
    const period = creditPeriod(now, now)
    try {
      await accounts(db).updateOne(
        { id: userId },
        { $setOnInsert: { id: userId, plan: 'free', status: 'none', interval: null, creditAnchor: now, creditPeriodStart: period.start, creditsUsed: 0, textsUsed: 0, extraCredits: 0, createdAt: now, updatedAt: now } },
        { upsert: true },
      )
    } catch (error: any) {
      // Another request opened the record first.
      if (error?.code !== 11000) throw error
    }
    account = await accounts(db).findOne({ id: userId }, { projection: { _id: 0 } })
  }
  const period = creditPeriod(new Date(account!.creditAnchor), now)
  const current = time(account!.creditPeriodStart)
  // Only a later month resets: a request whose clock is behind, or a late webhook applied at its event's time, never
  // turns the month back (which would wipe what was used since).
  if (Number.isNaN(current) || current < period.start.getTime()) {
    // Only the first request of the new month resets it: the filter names the month it read.
    await accounts(db).updateOne(
      { id: userId, creditPeriodStart: account!.creditPeriodStart },
      { $set: { creditPeriodStart: period.start, creditsUsed: 0, textsUsed: 0, updatedAt: now } },
    )
    account = await accounts(db).findOne({ id: userId }, { projection: { _id: 0 } })
  }
  return account!
}

/** Credits left: the month's first, then bought ones. */
export function creditsLeft(account: BillingAccount): { monthly: number; extra: number; total: number } {
  const monthly = Math.max(0, allowances(account).credits - (account.creditsUsed || 0))
  const extra = Math.max(0, account.extraCredits || 0)
  return { monthly, extra, total: monthly + extra }
}

export interface BillingSummary {
  plan: PlanId
  planName: string
  status: BillingStatus
  interval: Interval | null
  trial: { active: boolean; endsAt: Date | null; available: boolean }
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: Date | null
  hasSubscription: boolean
  credits: { allowance: number; used: number; extra: number; left: number; approxPosts: number; renewsAt: Date }
  texts: { allowance: number; used: number; left: number }
  brands: { used: number; max: number }
  uploads: { images: number; bytes: number; maxImages: number | null; maxBytes: number | null; label: string }
  features: Record<Feature, boolean>
  imageQuality: ImageQuality
}

/** What the plan settings, the credits meter and upgrade prompts show. */
export async function getBillingSummary(db: any, userId: string, now = new Date()): Promise<BillingSummary> {
  const account = await loadBilling(db, userId, now)
  const [usage, brands] = await Promise.all([uploadUsage(db, userId), db.collection('flows').countDocuments({ ownerId: userId })])
  return summarize(account, usage, brands, now)
}

export function summarize(account: BillingAccount, usage: { images: number; bytes: number }, brands: number, now = new Date()): BillingSummary {
  const plan = effectivePlan(account)
  const allowance = allowances(account)
  const left = creditsLeft(account)
  const textsUsed = account.textsUsed || 0
  return {
    plan: plan.id,
    planName: plan.name,
    status: account.status,
    interval: plan.id === 'free' ? null : account.interval || null,
    trial: { active: account.status === 'trialing', endsAt: account.status === 'trialing' ? account.trialEnd || null : null, available: canStartTrial(account) },
    cancelAtPeriodEnd: Boolean(account.cancelAtPeriodEnd),
    currentPeriodEnd: plan.id === 'free' ? null : account.currentPeriodEnd || null,
    hasSubscription: Boolean(account.stripeSubscriptionId) && plan.id !== 'free',
    credits: { allowance: allowance.credits, used: Math.min(account.creditsUsed || 0, allowance.credits), extra: left.extra, left: left.total, approxPosts: approxPosts(left.total), renewsAt: creditPeriod(new Date(account.creditAnchor), now).end },
    texts: { allowance: allowance.textReminders, used: Math.min(textsUsed, allowance.textReminders), left: Math.max(0, allowance.textReminders - textsUsed) },
    brands: { used: brands, max: plan.brands },
    uploads: { images: usage.images, bytes: usage.bytes, maxImages: plan.uploads.maxImages ?? null, maxBytes: plan.uploads.maxBytes ?? null, label: uploadsLabel(plan) },
    features: { scheduling: plan.scheduling, emailReminders: plan.emailReminders, textReminders: plan.textReminders > 0, customDesigns: plan.customDesigns, adDesigns: plan.adDesigns },
    imageQuality: plan.imageQuality,
  }
}

/** A trial runs once per account, and only for an account that never had a subscription. */
export function canStartTrial(account: BillingAccount): boolean {
  return !account.trialUsed && !account.stripeSubscriptionId
}

// ─── Credits ─────────────────────────────────────────────────────────────────

export interface CreditCharge {
  id: string
  ownerId: string
  credits: number
  fromMonthly: number
  fromExtra: number
  periodStart: Date
  reason: string
  ref: string | null
  status: 'held' | 'settled' | 'refunded'
  createdAt: Date
}

const s = (n: number) => (n === 1 ? '' : 's')

/**
 * Takes `credits` from the account, the month's first, then bought ones, and records the charge. Refuses with
 * insufficient_credits (402) when the account has fewer left. Concurrent charges never overspend: each update only
 * applies to the balance it read.
 */
export async function chargeCredits(db: any, userId: string, credits: number, { reason = 'post', ref = null }: { reason?: string; ref?: string | null } = {}): Promise<CreditCharge> {
  if (!Number.isInteger(credits) || credits < 1) throw new Error('credits must be a positive whole number')
  for (let attempt = 0; attempt < 8; attempt++) {
    const account = await loadBilling(db, userId)
    const left = creditsLeft(account)
    if (credits > left.total) {
      const plan = effectivePlan(account)
      throw billingError(402, 'insufficient_credits',
        left.total
          ? `This needs ${credits} credit${s(credits)} and you have ${left.total} left. Buy extra credits or upgrade your plan to keep creating.`
          : `You've used all your credits${plan.id === 'free' ? ' for this month' : ''}. Buy extra credits or upgrade your plan to keep creating.`,
        { needed: credits, available: left.total, plan: plan.id, renewsAt: creditPeriod(new Date(account.creditAnchor)).end })
    }
    const fromMonthly = Math.min(credits, left.monthly), fromExtra = credits - fromMonthly
    const now = new Date()
    const result = await accounts(db).updateOne(
      { id: userId, creditPeriodStart: account.creditPeriodStart, creditsUsed: account.creditsUsed || 0, extraCredits: account.extraCredits || 0 },
      { $inc: { creditsUsed: fromMonthly, extraCredits: -fromExtra }, $set: { updatedAt: now } },
    )
    if (!result.matchedCount) continue
    const charge: CreditCharge = { id: `chg_${randomUUID()}`, ownerId: userId, credits, fromMonthly, fromExtra, periodStart: account.creditPeriodStart, reason, ref, status: 'held', createdAt: now }
    await db.collection('creditCharges').insertOne({ ...charge })
    return charge
  }
  throw Object.assign(new Error('Batkle is busy right now. Please try again in a minute.'), { status: 409 })
}

/** Gives a held charge back, once: the month's part only if it is still the same credit month. */
export async function refundCharge(db: any, userId: string, chargeId: string): Promise<boolean> {
  const result = await db.collection('creditCharges').updateOne({ id: chargeId, ownerId: userId, status: 'held' }, { $set: { status: 'refunded', refundedAt: new Date() } })
  if (!result.matchedCount) return false
  const charge: CreditCharge | null = await db.collection('creditCharges').findOne({ id: chargeId, ownerId: userId }, { projection: { _id: 0 } })
  if (!charge) return false
  const now = new Date()
  if (charge.fromMonthly > 0) {
    await accounts(db).updateOne({ id: userId, creditPeriodStart: charge.periodStart, creditsUsed: { $gte: charge.fromMonthly } }, { $inc: { creditsUsed: -charge.fromMonthly }, $set: { updatedAt: now } })
  }
  if (charge.fromExtra > 0) await accounts(db).updateOne({ id: userId }, { $inc: { extraCredits: charge.fromExtra }, $set: { updatedAt: now } })
  return true
}

/** Marks a held charge as used for good: it can no longer be refunded. */
export async function settleCharge(db: any, userId: string, chargeId: string): Promise<boolean> {
  const result = await db.collection('creditCharges').updateOne({ id: chargeId, ownerId: userId, status: 'held' }, { $set: { status: 'settled', settledAt: new Date() } })
  return Boolean(result.matchedCount)
}

/** The latest charge for `ref` (a post's ID) that was not refunded, or null. */
export async function findCharge(db: any, userId: string, ref: string): Promise<CreditCharge | null> {
  if (!ref) return null
  const found = await db.collection('creditCharges').find({ ownerId: userId, ref, status: { $in: ['held', 'settled'] } }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(1).toArray()
  return found[0] || null
}

/** How long a post's charge may stay held before releaseStaleCharges settles it: a post takes minutes to make. */
export const STALE_CHARGE_MS = 3 * 60 * 60 * 1000

/**
 * Settles charges left held by posts that were never finished (the tab was closed mid-way). A post whose images
 * were made (`imagesAt`) cost what it took, so it stays charged; one that stopped before its images gets its credits
 * back. Run by the scheduled job; returns how many of each.
 */
export async function releaseStaleCharges(db: any, { now = new Date(), olderThanMs = STALE_CHARGE_MS, limit = 200 } = {}): Promise<{ refunded: number; settled: number }> {
  const stale = await db.collection('creditCharges').find({ status: 'held', createdAt: { $lt: new Date(now.getTime() - olderThanMs) } }, { projection: { _id: 0 } }).limit(limit).toArray()
  let refunded = 0, settled = 0
  for (const charge of stale as (CreditCharge & { imagesAt?: Date })[]) {
    if (charge.imagesAt) { if (await settleCharge(db, charge.ownerId, charge.id)) settled++ }
    else if (await refundCharge(db, charge.ownerId, charge.id)) refunded++
  }
  return { refunded, settled }
}

/** Adds bought credits once per `ref` (the Stripe checkout session): false when that ref was already counted. */
export async function grantExtraCredits(db: any, userId: string, credits: number, { ref, note = 'Credit pack' }: { ref: string; note?: string }): Promise<boolean> {
  if (!Number.isInteger(credits) || credits < 1) throw new Error('credits must be a positive whole number')
  if (!ref) throw new Error('ref is required')
  await loadBilling(db, userId)
  try {
    await db.collection('creditGrants').insertOne({ ref, ownerId: userId, credits, note: String(note).slice(0, 200), createdAt: new Date() })
  } catch (error: any) {
    if (error?.code === 11000) return false
    throw error
  }
  await accounts(db).updateOne({ id: userId }, { $inc: { extraCredits: credits }, $set: { updatedAt: new Date() } })
  return true
}

/** Counts one text reminder against this month's allowance: false when none are left (nothing is counted then). */
export async function takeTextReminder(db: any, userId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const account = await loadBilling(db, userId)
    const used = account.textsUsed || 0
    if (used >= allowances(account).textReminders) return false
    const result = await accounts(db).updateOne({ id: userId, creditPeriodStart: account.creditPeriodStart, textsUsed: used }, { $inc: { textsUsed: 1 }, $set: { updatedAt: new Date() } })
    if (result.matchedCount) return true
  }
  return false
}

/** Gives back a text reminder that could not be sent. */
export async function returnTextReminder(db: any, userId: string) {
  await accounts(db).updateOne({ id: userId, textsUsed: { $gte: 1 } }, { $inc: { textsUsed: -1 }, $set: { updatedAt: new Date() } })
}

// ─── Plan features and limits ────────────────────────────────────────────────

/** How upgrade messages name each feature, and whether the name is plural ("are part of", "use them"). */
const FEATURE_NAMES: Record<Feature, [string, boolean]> = {
  scheduling: ['Scheduling posts', false],
  emailReminders: ['Email reminders', true],
  textReminders: ['Text reminders', true],
  customDesigns: ['Creating your own designs', false],
  adDesigns: ['Ad designs', true],
}

export async function hasFeature(db: any, userId: string, feature: Feature): Promise<boolean> {
  const plan = effectivePlan(await loadBilling(db, userId))
  return feature === 'textReminders' ? plan.textReminders > 0 : Boolean(plan[feature])
}

/** Refuses with upgrade_required (402) unless the account's plan includes `feature`. */
export async function requireFeature(db: any, userId: string, feature: Feature) {
  if (await hasFeature(db, userId, feature)) return
  const needed = cheapestPlanWith(feature)
  const [name, plural] = FEATURE_NAMES[feature]
  throw billingError(402, 'upgrade_required', `${name} ${plural ? 'are' : 'is'} part of ${needed.name}${needed.id === 'business' ? '' : ' and Business'}. Upgrade to use ${plural ? 'them' : 'it'}.`, { feature, requiredPlan: needed.id })
}

/** Refuses with limit_reached (402) when the account already has as many brands as its plan allows. */
export async function requireBrandSlot(db: any, userId: string) {
  const plan = effectivePlan(await loadBilling(db, userId))
  const used = await db.collection('flows').countDocuments({ ownerId: userId })
  if (used < plan.brands) return
  const next = cheapestPlanForBrands(used + 1)
  throw billingError(402, 'limit_reached', next
    ? `Your ${plan.name} plan includes ${plan.brands} brand${s(plan.brands)}. Upgrade to ${next.name} to add another, or delete a brand you no longer use.`
    : `Your ${plan.name} plan includes ${plan.brands} brands. Contact us to add more, or delete a brand you no longer use.`,
  { limit: 'brands', max: plan.brands, used, requiredPlan: next?.id || null })
}

/**
 * The person's own images: uploads with `ownerId` and `userUpload: true` (gallery uploads, photos added to a post
 * idea and images added in the editor), with their stored `size` in bytes.
 */
export async function uploadUsage(db: any, userId: string): Promise<{ images: number; bytes: number }> {
  const rows = await db.collection('uploads').aggregate([
    { $match: { ownerId: userId, userUpload: true } },
    { $group: { _id: null, images: { $sum: 1 }, bytes: { $sum: { $ifNull: ['$size', 0] } } } },
  ]).toArray()
  return { images: rows[0]?.images || 0, bytes: rows[0]?.bytes || 0 }
}

/** Refuses with limit_reached (402) when one more image of `bytes` would not fit in the plan's uploads allowance. */
export async function requireUploadRoom(db: any, userId: string, bytes: number) {
  const plan = effectivePlan(await loadBilling(db, userId))
  const usage = await uploadUsage(db, userId)
  const { maxImages, maxBytes } = plan.uploads
  if (maxImages != null && usage.images + 1 > maxImages) {
    throw billingError(402, 'limit_reached', `Your ${plan.name} plan holds up to ${maxImages} of your own images. Delete some from the Gallery, or upgrade for more space.`, { limit: 'uploads', maxImages, images: usage.images })
  }
  if (maxBytes != null && usage.bytes + Math.max(0, bytes) > maxBytes) {
    throw billingError(402, 'limit_reached', `This image doesn't fit: you've used ${formatBytes(usage.bytes)} of your ${formatBytes(maxBytes)}. Delete some images from the Gallery, or upgrade for more space.`, { limit: 'uploads', maxBytes, bytes: usage.bytes })
  }
}

/** Standard images on Free, the best model on paid plans. */
export async function imageQualityFor(db: any, userId: string | null | undefined): Promise<ImageQuality> {
  if (!userId) return 'standard'
  return effectivePlan(await loadBilling(db, userId)).imageQuality
}

// ─── Subscriptions (written by the Stripe webhook) ───────────────────────────

export interface SubscriptionUpdate {
  planId: PlanId
  status: BillingStatus
  interval: Interval | null
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
  currentPeriodStart?: Date | null
  currentPeriodEnd?: Date | null
  cancelAtPeriodEnd?: boolean
  trialEnd?: Date | null
}

/** The account that Stripe customer belongs to, or null. */
export async function findBillingByCustomer(db: any, stripeCustomerId: string): Promise<BillingAccount | null> {
  if (!stripeCustomerId) return null
  await ensureIndexes(db)
  return accounts(db).findOne({ stripeCustomerId }, { projection: { _id: 0 } })
}

export async function setStripeCustomer(db: any, userId: string, stripeCustomerId: string) {
  await loadBilling(db, userId)
  await accounts(db).updateOne({ id: userId }, { $set: { stripeCustomerId, updatedAt: new Date() } })
}

/**
 * Records the subscription's state. When the plan the account has changes (an upgrade, a downgrade, a trial that
 * starts or turns paid, a subscription that ends), a new credit month starts from that moment with nothing used.
 */
export async function applySubscription(db: any, userId: string, update: SubscriptionUpdate, now = new Date()) {
  const account = await loadBilling(db, userId, now)
  const before = { plan: effectivePlanId(account), trialing: account.status === 'trialing' }
  const after = { plan: effectivePlanId({ plan: update.planId, status: update.status }), trialing: update.status === 'trialing' }
  const set: Record<string, unknown> = {
    plan: update.planId,
    status: update.status,
    interval: update.interval,
    cancelAtPeriodEnd: Boolean(update.cancelAtPeriodEnd),
    currentPeriodEnd: update.currentPeriodEnd || null,
    trialEnd: update.trialEnd || null,
    updatedAt: now,
  }
  if (update.stripeCustomerId !== undefined) set.stripeCustomerId = update.stripeCustomerId
  if (update.stripeSubscriptionId !== undefined) set.stripeSubscriptionId = update.stripeSubscriptionId
  if (update.status === 'trialing') set.trialUsed = true
  if (before.plan !== after.plan || before.trialing !== after.trialing) {
    const start = update.currentPeriodStart && time(update.currentPeriodStart) <= now.getTime() ? new Date(update.currentPeriodStart) : now
    const anchor = after.plan === 'free' ? now : start
    Object.assign(set, { creditAnchor: anchor, creditPeriodStart: creditPeriod(anchor, now).start, creditsUsed: 0, textsUsed: 0 })
  }
  await accounts(db).updateOne({ id: userId }, { $set: set })
  return loadBilling(db, userId, now)
}
