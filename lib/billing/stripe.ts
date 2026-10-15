import Stripe from 'stripe'
import { createHash, randomUUID } from 'node:crypto'
import { CREDIT_PACK, NEWSLETTER_DISCOUNT, PLANS, isInterval, isPaidPlanId, planForLookupKey, priceLookupKey, stripeLookupKeys } from './plans'
import type { Interval, PlanId } from './plans'
import { applySubscription, billingError, billingErrorBody, canStartTrial, findBillingByCustomer, grantExtraCredits, loadBilling, setStripeCustomer } from './account'
import type { BillingStatus } from './account'
import { emailConfigured, emailLayout, escapeHtml, sendEmail } from '../notifications/email'
import { publicMessage } from '../services/publicError'

/**
 * Payments through Stripe (server only): Checkout for plans and credit packs, the Billing Portal, the webhook that
 * keeps `billingAccounts` in step with Stripe, and the newsletter's one-off discount codes.
 * STRIPE_SECRET_KEY switches payments on and STRIPE_WEBHOOK_SECRET verifies the webhook; without them nothing here
 * runs and people see a plain "not set up yet". Prices are found by the lookup keys in plans.ts, which
 * scripts/stripe-setup.cjs creates.
 */

/** The events the webhook endpoint must send (scripts/stripe-setup.cjs prints the same list). */
export const WEBHOOK_EVENTS = [
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

export const NEWSLETTER_COUPON_ID = 'NEWSLETTER20'
/** The Billing Portal configuration scripts/stripe-setup.cjs makes carries this metadata. */
export const PORTAL_METADATA = { batkle: 'billing-portal' }

const API_VERSION = '2026-09-30.endive'
const CACHE_MS = 10 * 60_000
const DAY = 86_400_000
/** Statuses that keep the paid plan, as in account.ts. */
const PAID: string[] = ['active', 'trialing', 'past_due']
/** Statuses after which a subscription is over for good. */
const ENDED: string[] = ['canceled', 'incomplete_expired']
const STATUSES: BillingStatus[] = ['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']

// Messages Batkle writes itself for people; they are shown as they are (publicMessage would hide any naming billing).
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status, expose: true })
const unavailable = () => billingError(503, 'payments_unavailable', 'Payments aren’t set up yet. Please try again later.')
const idOf = (value: any): string | null => (typeof value === 'string' ? value : value?.id || null)
const fromSeconds = (value: unknown) => (typeof value === 'number' && value > 0 ? new Date(value * 1000) : null)

// ─── Client and prices ───────────────────────────────────────────────────────

let client: any = null

/** True when payments can run: STRIPE_SECRET_KEY is set. */
export function paymentsConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim())
}

/** The Stripe client, made on first use; refuses with payments_unavailable (503) when no key is set. */
export function stripe(): any {
  if (client) return client
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) throw unavailable()
  client = new Stripe(key, { apiVersion: API_VERSION as any, maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: 'Batkle' } })
  return client
}

/** True for an error thrown by the Stripe SDK; its message is never shown to people. */
export function isStripeError(error: any): boolean {
  return typeof error?.type === 'string' && error.type.startsWith('Stripe')
}

let priceCache: { at: number; prices: Promise<Map<string, any>> } | null = null

/** Batkle's active price for a lookup key, read from Stripe at most every few minutes per process. */
export async function priceFor(lookupKey: string): Promise<any> {
  if (!priceCache || Date.now() - priceCache.at > CACHE_MS) {
    const prices = stripe().prices.list({ lookup_keys: stripeLookupKeys().map(k => k.lookupKey), active: true, limit: 100 })
      .then((list: any) => new Map<string, any>(list.data.map((price: any) => [price.lookup_key, price])))
    priceCache = { at: Date.now(), prices }
    prices.catch(() => { priceCache = null })
  }
  const price = (await priceCache.prices).get(lookupKey)
  if (!price) {
    priceCache = null
    console.error(`[billing] Stripe has no active price with the lookup key ${lookupKey}. Run scripts/stripe-setup.cjs.`)
    throw unavailable()
  }
  return price
}

let portalCache: { at: number; id: Promise<string | null> } | null = null

/** The Billing Portal configuration made by scripts/stripe-setup.cjs, or null to use the account's default one. */
async function portalConfiguration(): Promise<string | null> {
  if (!portalCache || Date.now() - portalCache.at > CACHE_MS) {
    const id = stripe().billingPortal.configurations.list({ active: true, limit: 100 })
      .then((list: any) => list.data.find((c: any) => c.metadata?.batkle === PORTAL_METADATA.batkle)?.id || null)
    portalCache = { at: Date.now(), id }
    id.catch(() => { portalCache = null })
  }
  return portalCache.id
}

// ─── Checkout and the portal ─────────────────────────────────────────────────

export type Purchase = { kind: 'plan'; planId: PlanId; interval: Interval } | { kind: 'credits' }

/** The purchase a checkout request asks for: `{ planId, interval }` or `{ credits: true }`; a 400 otherwise. */
export function readPurchase(body: any): Purchase {
  if (body?.credits === true) return { kind: 'credits' }
  if (body?.planId === 'free') throw httpError(400, 'Free needs no checkout. To move to Free, cancel your plan in Manage billing.')
  if (!isPaidPlanId(body?.planId)) throw httpError(400, 'Choose Pro or Business.')
  if (!isInterval(body?.interval)) throw httpError(400, 'Choose monthly or yearly billing.')
  return { kind: 'plan', planId: body.planId, interval: body.interval }
}

/**
 * The account's Stripe customer, made the first time it is needed (with metadata.userId) and saved on the account.
 * A saved customer Stripe no longer has (deleted, or made with test keys before switching to live) is replaced.
 */
async function customerFor(db: any, user: { userId: string; email?: string; name?: string }) {
  const account = await loadBilling(db, user.userId)
  if (account.stripeCustomerId) {
    const existing = await stripe().customers.retrieve(account.stripeCustomerId).catch((error: any) => {
      if (error?.code === 'resource_missing' || error?.statusCode === 404) return null
      throw error
    })
    if (existing && !existing.deleted) return { account, customerId: account.stripeCustomerId as string }
  }
  const customer = await stripe().customers.create(
    { email: user.email || undefined, name: user.name || undefined, metadata: { userId: user.userId } },
    { idempotencyKey: `customer-${user.userId}-${account.stripeCustomerId || 'new'}` },
  )
  await setStripeCustomer(db, user.userId, customer.id)
  return { account: { ...account, stripeCustomerId: customer.id }, customerId: customer.id as string }
}

/**
 * The customer's subscription that is still running, if any. Asked of Stripe rather than read from the account, so
 * a subscription whose webhook has not arrived yet still counts. An `incomplete` one (a first payment that never went
 * through) does not: Stripe ends it within a day.
 */
async function liveSubscription(customerId: string): Promise<any | null> {
  const list = await stripe().subscriptions.list({ customer: customerId, status: 'all', limit: 20 })
  return list.data.find((s: any) => !ENDED.includes(s.status) && s.status !== 'incomplete') || null
}

async function portalSession(customerId: string, returnUrl: string, flow?: Record<string, unknown>) {
  const configuration = await portalConfiguration()
  const session = await stripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
    ...(configuration ? { configuration } : {}),
    ...(flow ? { flow_data: flow } : {}),
  })
  return { url: session.url as string }
}

/**
 * A change of plan for an account that already pays: never a second subscription. The portal's confirmation page
 * shows the prorated amount, charges it (with 3D Secure when the bank asks) and only then changes the price; the
 * webhook records the result. A subscription that is set to end or whose payments are failing opens the portal's
 * main page instead, where it can be renewed or paid first.
 */
async function switchSubscription(customerId: string, subscription: any, price: any, origin: string) {
  const item = subscription.items?.data?.[0]
  const settings = `${origin}/app/settings#plan`
  if (!item || !['active', 'trialing'].includes(subscription.status) || subscription.cancel_at_period_end || subscription.cancel_at) {
    return { ...(await portalSession(customerId, settings)), portal: true }
  }
  if (item.price?.id === price.id) throw httpError(409, 'You’re already on this plan.')
  return {
    ...(await portalSession(customerId, settings, {
      type: 'subscription_update_confirm',
      subscription_update_confirm: { subscription: subscription.id, items: [{ id: item.id, price: price.id, quantity: 1 }] },
      after_completion: { type: 'redirect', redirect: { return_url: `${origin}/app/settings?checkout=success#plan` } },
    })),
    portal: true,
  }
}

/**
 * Where to send the person to pay: a Checkout page for a new subscription or a credit pack, or the Billing Portal
 * to confirm a change when the account already has a subscription. A plan's free trial is offered only while
 * canStartTrial allows it, and needs a card.
 */
export async function createCheckoutSession(db: any, user: { userId: string; email?: string; name?: string }, purchase: Purchase, origin: string): Promise<{ url: string; portal?: boolean; updated?: boolean }> {
  if (!paymentsConfigured()) throw unavailable()
  const { account, customerId } = await customerFor(db, user)
  const base = { customer: customerId, client_reference_id: user.userId, allow_promotion_codes: true }

  if (purchase.kind === 'credits') {
    const price = await priceFor(CREDIT_PACK.lookupKey)
    const metadata = { userId: user.userId, kind: 'credits', credits: String(CREDIT_PACK.credits) }
    const session = await stripe().checkout.sessions.create({
      ...base,
      mode: 'payment',
      line_items: [{ price: price.id, quantity: 1 }],
      metadata,
      payment_intent_data: { metadata },
      success_url: `${origin}/app/settings?checkout=success#credits`,
      cancel_url: `${origin}/app/settings?checkout=cancelled#credits`,
    })
    return { url: session.url }
  }

  const plan = PLANS[purchase.planId]
  const price = await priceFor(priceLookupKey(purchase.planId, purchase.interval))
  const live = await liveSubscription(customerId)
  if (live) return switchSubscription(customerId, live, price, origin)

  const metadata = { userId: user.userId, kind: 'plan', planId: plan.id, interval: purchase.interval }
  const trial = plan.trialDays > 0 && canStartTrial(account)
  const session = await stripe().checkout.sessions.create({
    ...base,
    mode: 'subscription',
    line_items: [{ price: price.id, quantity: 1 }],
    metadata,
    payment_method_collection: 'always',
    subscription_data: {
      metadata,
      ...(trial ? { trial_period_days: plan.trialDays, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } } : {}),
    },
    success_url: `${origin}/app/settings?checkout=success#plan`,
    cancel_url: `${origin}/app/settings?checkout=cancelled#plan`,
  })
  return { url: session.url }
}

/** A Billing Portal session for the account: invoices, the card, switching plans and cancelling. */
export async function createPortalSession(db: any, userId: string, origin: string): Promise<{ url: string }> {
  if (!paymentsConfigured()) throw unavailable()
  const account = await loadBilling(db, userId)
  if (!account.stripeCustomerId) throw httpError(400, 'There’s nothing to manage yet. Choose a plan first.')
  return portalSession(account.stripeCustomerId, `${origin}/app/settings#plan`)
}

// ─── Keeping accounts in step with Stripe ───────────────────────────────────

/**
 * Copies a subscription's current state onto its account. The subscription is always read fresh from Stripe, so an
 * event that arrives late can never put back an older state. A subscription without a Batkle price is ignored, and so
 * is an older subscription that ended or stopped paying while the account has another one in good standing.
 */
export async function syncSubscription(db: any, subscriptionId: string) {
  const subscription = await stripe().subscriptions.retrieve(subscriptionId)
  const items: any[] = subscription.items?.data || []
  const item = items.find(i => planForLookupKey(i.price?.lookup_key)) || null
  const plan = item && planForLookupKey(item.price.lookup_key)
  if (!plan) {
    console.warn(`[billing] subscription ${subscription.id} has no Batkle price (${items.map(i => i.price?.lookup_key || i.price?.id).join(', ') || 'no items'}); ignored`)
    return null
  }
  const customerId = idOf(subscription.customer)
  const userId = subscription.metadata?.userId || (customerId && (await findBillingByCustomer(db, customerId))?.id) || null
  if (!userId) {
    console.warn(`[billing] subscription ${subscription.id} belongs to no Batkle account (customer ${customerId}); ignored`)
    return null
  }
  const status: BillingStatus = STATUSES.includes(subscription.status) ? subscription.status : 'incomplete'
  const account = await loadBilling(db, userId)
  const other = account.stripeSubscriptionId && account.stripeSubscriptionId !== subscription.id
  if (other && (ENDED.includes(status) || (!PAID.includes(status) && PAID.includes(account.status)))) {
    console.log(`[billing] subscription ${subscription.id} (${status}) left alone: ${userId} has ${account.stripeSubscriptionId} (${account.status})`)
    return null
  }
  // Since API version 2025-03-31 the billing period lives on each subscription item.
  const periodEnd = fromSeconds(item.current_period_end ?? subscription.current_period_end)
  const cancelAt = fromSeconds(subscription.cancel_at)
  return applySubscription(db, userId, {
    planId: plan.planId,
    status,
    interval: plan.interval,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    currentPeriodStart: fromSeconds(item.current_period_start ?? subscription.current_period_start),
    // A subscription set to end on a date of its own ends then, not at the end of the period.
    currentPeriodEnd: cancelAt && periodEnd && cancelAt < periodEnd ? cancelAt : periodEnd,
    cancelAtPeriodEnd: !ENDED.includes(status) && Boolean(subscription.cancel_at_period_end || cancelAt),
    trialEnd: fromSeconds(subscription.trial_end),
  })
}

/** Adds a paid credit pack's credits, once per Checkout session however often Stripe reports it. */
async function grantCreditPack(db: any, session: any) {
  if (session.metadata?.kind !== 'credits') return null
  // Bank payments finish later: checkout.session.async_payment_succeeded grants those.
  if (session.payment_status !== 'paid') return null
  const credits = Number(session.metadata.credits)
  if (!Number.isInteger(credits) || credits < 1) {
    console.warn(`[billing] checkout ${session.id} has no credit count; ignored`)
    return null
  }
  const customerId = idOf(session.customer)
  const userId = session.metadata.userId || session.client_reference_id || (customerId && (await findBillingByCustomer(db, customerId))?.id) || null
  if (!userId) {
    console.error(`[billing] paid checkout ${session.id} belongs to no Batkle account`)
    return null
  }
  return grantExtraCredits(db, userId, credits, { ref: session.id, note: `${credits} credits bought` })
}

/** The subscription an invoice bills, or null for a one-off invoice. */
function invoiceSubscriptionId(invoice: any): string | null {
  return idOf(invoice?.parent?.subscription_details?.subscription)
    || idOf(invoice?.subscription)
    || idOf(invoice?.lines?.data?.find((line: any) => line?.parent?.subscription_item_details?.subscription)?.parent.subscription_item_details.subscription)
}

async function processEvent(db: any, event: any) {
  const object = event.data?.object || {}
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      if (object.mode === 'payment') return grantCreditPack(db, object)
      if (object.mode === 'subscription' && object.subscription) return syncSubscription(db, idOf(object.subscription)!)
      return null
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      return syncSubscription(db, object.id)
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const id = invoiceSubscriptionId(object)
      return id ? syncSubscription(db, id) : null
    }
    default:
      return null
  }
}

let indexes: Promise<unknown> | null = null
function ensureIndexes(db: any) {
  indexes ||= Promise.all([
    db.collection('stripeEvents').createIndex({ id: 1 }, { unique: true }),
    // Stripe stops retrying an event after three days; a month of records is plenty.
    db.collection('stripeEvents').createIndex({ updatedAt: 1 }, { expireAfterSeconds: 30 * 86400 }),
    db.collection('newsletterSubscribers').createIndex({ email: 1 }, { unique: true }),
    db.collection('newsletterSubscribers').createIndex({ unsubscribeToken: 1 }, { sparse: true }),
    db.collection('newsletterSubscribers').createIndex({ id: 1 }, { unique: true }),
    db.collection('newsletterRateLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]).catch(error => { indexes = null; console.warn('[billing] could not create indexes:', error?.message) })
  return indexes
}

async function recordEvent(db: any, event: any, set: Record<string, unknown>) {
  const now = new Date()
  try {
    await db.collection('stripeEvents').updateOne({ id: event.id }, { $set: { type: event.type, updatedAt: now, ...set }, $setOnInsert: { id: event.id, createdAt: now } }, { upsert: true })
  } catch (error: any) {
    // Two deliveries of one event racing to open its record: the other one wrote it.
    if (error?.code !== 11000) throw error
  }
}

/**
 * Handles one verified Stripe event, once: an event already marked done in `stripeEvents` is skipped. It is marked
 * done only after it succeeded, so a failure makes Stripe send it again. Two deliveries at the same moment may both
 * run; that is safe, because syncing reads Stripe's latest state and credit packs count once per session.
 */
export async function handleStripeEvent(db: any, event: any): Promise<{ duplicate: boolean }> {
  if (!event?.id || !event?.type) throw new Error('Not a Stripe event')
  await ensureIndexes(db)
  if (await db.collection('stripeEvents').findOne({ id: event.id, status: 'done' })) return { duplicate: true }
  try {
    await processEvent(db, event)
  } catch (error: any) {
    await recordEvent(db, event, { status: 'failed', error: String(error?.message || error).slice(0, 300) }).catch(() => {})
    throw error
  }
  await recordEvent(db, event, { status: 'done', error: null })
  return { duplicate: false }
}

/**
 * The webhook: verifies Stripe's signature over the raw body, then handles the event. 400 for a bad signature,
 * 503 when payments are not set up, 500 when handling failed (Stripe retries), otherwise 200.
 */
export async function handleWebhookRequest(payload: string, signature: string | null, getDb: () => Promise<any>): Promise<{ status: number; body: Record<string, unknown> }> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!paymentsConfigured() || !secret) return { status: 503, body: { error: 'Payments are not set up.' } }
  let event: any
  try {
    event = stripe().webhooks.constructEvent(payload, signature || '', secret)
  } catch (error: any) {
    console.warn('[billing] webhook signature rejected:', error?.message)
    return { status: 400, body: { error: 'Invalid signature.' } }
  }
  try {
    const { duplicate } = await handleStripeEvent(await getDb(), event)
    return { status: 200, body: { received: true, ...(duplicate ? { duplicate } : {}) } }
  } catch (error: any) {
    console.error(`[billing] webhook ${event.type} ${event.id} failed:`, error)
    return { status: 500, body: { error: 'The event could not be handled.' } }
  }
}

/** The status and JSON body for an error from the billing routes: plan errors as written, Stripe's never shown. */
export function billingErrorResponse(error: any): { status: number; body: Record<string, unknown> } {
  const billing = billingErrorBody(error)
  if (billing) return { status: Number(error.status) || 402, body: billing }
  if (isStripeError(error)) {
    console.error('[billing] Stripe refused a request:', error?.type, error?.code, error?.message)
    return { status: 502, body: { error: 'Payments aren’t available right now. Please try again in a few minutes.' } }
  }
  const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500
  if (error?.expose && status < 500) return { status, body: { error: error.message } }
  if (status >= 500) console.error('[billing]', error)
  return { status, body: { error: publicMessage(error?.message, status) } }
}

// ─── Newsletter ──────────────────────────────────────────────────────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NEWSLETTER_OK = { ok: true, message: `Check your inbox for your ${NEWSLETTER_DISCOUNT.percent}% discount code.` }
const NEWSLETTER_LATER = 'You’re on the list, but we can’t send discount codes right now. Please try again later.'
const LIMITS = { ip: { limit: 10, windowMs: 60 * 60_000 }, email: { limit: 5, windowMs: 60 * 60_000 } }

const hashed = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32)

/** Counts one sign-up in the current window for `bucket`: true once more than `limit` arrived. */
async function overLimit(db: any, bucket: string, limit: number, windowMs: number, now: Date) {
  const slot = Math.floor(now.getTime() / windowMs)
  const count = () => db.collection('newsletterRateLimits').findOneAndUpdate(
    { _id: `${bucket}:${slot}` },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((slot + 2) * windowMs) } },
    { upsert: true, returnDocument: 'after' },
  )
  // Two first requests racing to open the counter: the loser counts again on the one that won.
  const counter = await count().catch((error: any) => (error?.code === 11000 ? count() : Promise.reject(error)))
  return (counter?.count || 1) > limit
}

let couponReady = false

/** The newsletter coupon, made on first use when the setup script has not made it. */
async function ensureNewsletterCoupon() {
  if (couponReady) return
  try {
    await stripe().coupons.retrieve(NEWSLETTER_COUPON_ID)
  } catch (error: any) {
    if (error?.code !== 'resource_missing' && error?.statusCode !== 404) throw error
    try {
      await stripe().coupons.create({ id: NEWSLETTER_COUPON_ID, percent_off: NEWSLETTER_DISCOUNT.percent, duration: 'once', name: `Newsletter: ${NEWSLETTER_DISCOUNT.percent}% off the first payment` })
    } catch (created: any) {
      if (created?.code !== 'resource_already_exists') throw created
    }
  }
  couponReady = true
}

/**
 * The subscriber's own promotion code, made once: one use, first payments only. The first code saved stays theirs;
 * Stripe's idempotency key makes requests racing within a day get the same code, and any other one is switched off.
 */
async function newsletterCode(db: any, subscriber: any): Promise<string> {
  if (subscriber.promotionCode) return subscriber.promotionCode
  await ensureNewsletterCoupon()
  const promo = await stripe().promotionCodes.create({
    promotion: { type: 'coupon', coupon: NEWSLETTER_COUPON_ID },
    max_redemptions: 1,
    restrictions: { first_time_transaction: true },
    metadata: { source: 'newsletter', subscriberId: subscriber.id },
  }, { idempotencyKey: `newsletter-code-${subscriber.id}` })
  const subscribers = db.collection('newsletterSubscribers')
  await subscribers.updateOne({ id: subscriber.id, promotionCode: null }, { $set: { promotionCode: promo.code, promotionCodeId: promo.id, codeCreatedAt: new Date() } })
  const saved = await subscribers.findOne({ id: subscriber.id })
  if (saved?.promotionCodeId && saved.promotionCodeId !== promo.id) {
    await stripe().promotionCodes.update(promo.id, { active: false }).catch((error: any) => console.warn('[newsletter] spare code not switched off:', error?.message))
  }
  return saved?.promotionCode || promo.code
}

function newsletterEmail(code: string, base: string, unsubscribeUrl: string) {
  const percent = NEWSLETTER_DISCOUNT.percent
  const plans = `${base}/app/settings#plan`
  return {
    subject: `Your ${percent}% off code for Batkle`,
    html: emailLayout({
      heading: `${percent}% off your first payment`,
      paragraphs: [
        'Thanks for signing up for Batkle news.',
        `Here’s your code for ${percent}% off your first payment on Pro or Business:`,
        `<strong style="display:inline-block;font-size:22px;letter-spacing:0.08em;color:#141210">${escapeHtml(code)}</strong>`,
        'Enter it at checkout. It works once, on a first payment.',
      ],
      button: base ? { label: 'See the plans', url: plans } : undefined,
      footer: `You’re getting this because this address was entered in the Batkle newsletter form. If that wasn’t you, you can ignore this email.${unsubscribeUrl ? ` <a href="${escapeHtml(unsubscribeUrl)}" style="color:#77716a">Unsubscribe</a>` : ''}`,
    }),
    text: [
      'Thanks for signing up for Batkle news.',
      '',
      `Your code for ${percent}% off your first payment on Pro or Business: ${code}`,
      'Enter it at checkout. It works once, on a first payment.',
      ...(base ? ['', `See the plans: ${plans}`] : []),
      ...(unsubscribeUrl ? ['', `Unsubscribe: ${unsubscribeUrl}`] : []),
    ].join('\n'),
  }
}

/**
 * A newsletter sign-up from the landing page: `{ email, consent: true }`. Stores the subscriber, gives them one
 * promotion code for their first payment and emails it, resending the same code at most once a day. Whoever signs
 * up, the answer is the same, so it never tells whether an address is already subscribed.
 */
export async function subscribeToNewsletter(db: any, body: any, { ip = '', origin = '', now = new Date() }: { ip?: string; origin?: string; now?: Date } = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  await ensureIndexes(db)
  if (await overLimit(db, `ip:${hashed(ip || 'unknown')}`, LIMITS.ip.limit, LIMITS.ip.windowMs, now)) throw httpError(429, 'Too many tries. Please wait a few minutes and try again.')
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || email.length > 254 || !EMAIL.test(email)) throw httpError(400, 'Enter a valid email address.')
  if (body?.consent !== true) throw httpError(400, 'Tick the box to agree to Batkle’s emails, then try again.')
  if (await overLimit(db, `email:${hashed(email)}`, LIMITS.email.limit, LIMITS.email.windowMs, now)) throw httpError(429, 'Too many tries. Please wait a few minutes and try again.')

  const subscribers = db.collection('newsletterSubscribers')
  const upsert = () => subscribers.updateOne(
    { email },
    {
      // Signing up again after unsubscribing is a new consent.
      $set: { consentAt: now, updatedAt: now, unsubscribedAt: null },
      $setOnInsert: { id: `nl_${randomUUID().replace(/-/g, '').slice(0, 24)}`, email, source: 'landing', createdAt: now, promotionCode: null, promotionCodeId: null, nextSendAt: new Date(0), sends: 0, unsubscribeToken: randomUUID().replace(/-/g, '') },
    },
    { upsert: true },
  )
  await upsert().catch((error: any) => (error?.code === 11000 ? upsert() : Promise.reject(error)))
  const subscriber = await subscribers.findOne({ email })

  if (!paymentsConfigured() || !emailConfigured()) return { status: 503, body: { error: NEWSLETTER_LATER } }

  let code: string
  try {
    code = await newsletterCode(db, subscriber)
  } catch (error: any) {
    console.error('[newsletter] no discount code:', error?.message)
    return { status: 503, body: { error: NEWSLETTER_LATER } }
  }

  // One email a day at most, however often the form is sent: only the request that moves nextSendAt sends it.
  const claim = await subscribers.updateOne({ id: subscriber.id, nextSendAt: { $lte: now } }, { $set: { nextSendAt: new Date(now.getTime() + DAY), lastSentAt: now }, $inc: { sends: 1 } })
  if (!claim.matchedCount) return { status: 200, body: NEWSLETTER_OK }
  try {
    const base = (process.env.NEXT_PUBLIC_BASE_URL?.trim() || origin || '').replace(/\/+$/, '')
    const unsubscribeUrl = base && subscriber.unsubscribeToken ? `${base}/api/newsletter/unsubscribe?token=${subscriber.unsubscribeToken}` : ''
    await sendEmail({ to: email, ...newsletterEmail(code, base, unsubscribeUrl), idempotencyKey: `newsletter-${subscriber.id}-${now.toISOString().slice(0, 10)}` })
  } catch (error: any) {
    console.error('[newsletter] code email not sent:', error?.message)
    await subscribers.updateOne({ id: subscriber.id }, { $set: { nextSendAt: new Date(0) }, $inc: { sends: -1 } }).catch(() => {})
    return { status: 503, body: { error: NEWSLETTER_LATER } }
  }
  return { status: 200, body: NEWSLETTER_OK }
}

/**
 * The unsubscribe link in Batkle's emails: the subscriber's own random token marks them unsubscribed. True when the
 * token belongs to a subscriber (unsubscribing twice is fine).
 */
export async function unsubscribeFromNewsletter(db: any, token: unknown, now = new Date()): Promise<boolean> {
  if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) return false
  const result = await db.collection('newsletterSubscribers').updateOne({ unsubscribeToken: token }, { $set: { unsubscribedAt: now, updatedAt: now } })
  return Boolean(result.matchedCount)
}
