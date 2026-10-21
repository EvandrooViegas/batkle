// The pricing section's words and numbers, worked out from lib/billing/plans.ts so a price or limit changed there
// changes the landing page too. Pure functions, no React, so tests/landingPricing.test.cjs can check them.
import { CREDIT_PACK, NEWSLETTER_DISCOUNT, PAID_PLAN_IDS, PLANS, SLIDES_PER_POST, TRIAL, approxPosts, formatBytes, formatPrice, isComingSoon } from '@/lib/billing/plans'

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

/** "a", "a and b", "a, b and c". */
function listText(items) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Months a yearly plan saves against paying monthly: 2 when a year costs ten months. */
export function freeMonths(plan) {
  return plan.price.month ? Math.max(0, Math.round(12 - plan.price.year / plan.price.month)) : 0
}

/** The yearly switch's badge, e.g. "2 months free", or '' when yearly saves nothing. */
export function yearlySavingLabel() {
  const months = Math.min(...PAID_PLAN_IDS.map(id => freeMonths(PLANS[id])))
  return months > 0 ? `${plural(months, 'month')} free` : ''
}

/** A yearly price as a monthly one, to the cent: $349.90 a year is $29.16 a month. */
export function monthlyEquivalent(yearly) {
  return formatPrice(Math.round((yearly / 12) * 100) / 100)
}

/** A plan card's price: the big amount, what it is per, and the small line under it. */
export function priceParts(plan, interval) {
  if (!plan.price.month) return { amount: formatPrice(0), unit: '', detail: 'No card needed' }
  if (interval === 'year') return { amount: formatPrice(plan.price.year), unit: 'a year', detail: `≈ ${monthlyEquivalent(plan.price.year)}/month` }
  return { amount: formatPrice(plan.price.month), unit: 'a month', detail: 'Billed monthly' }
}

/** The price in one line: "$34.99 a month", "$349.90 a year (≈ $29.16/month)" or "$0". */
export function priceText(plan, interval) {
  const { amount, unit, detail } = priceParts(plan, interval)
  if (!plan.price.month) return amount
  return interval === 'year' ? `${amount} ${unit} (${detail})` : `${amount} ${unit}`
}

function uploadsText(plan) {
  if (plan.uploads.maxImages != null) return `Up to ${plan.uploads.maxImages} of your own images`
  if (plan.uploads.maxBytes != null) return `${formatBytes(plan.uploads.maxBytes)} for your own images`
  return 'Unlimited space for your own images'
}

function scheduleText(plan) {
  const parts = [
    plan.scheduling && 'Schedule calendar',
    plan.emailReminders && 'email reminders',
    plan.textReminders > 0 && !isComingSoon('textReminders') && `${plural(plan.textReminders, 'text reminder')} a month`,
  ].filter(Boolean)
  return parts.length ? { text: listText(parts), included: true } : { text: 'No schedule calendar or reminders', included: false }
}

/** The lines a plan card lists: the ones that differ between plans. `included: false` shows with a dash. */
export function planHighlights(plan) {
  return [
    { text: plural(plan.brands, 'brand'), included: true },
    { text: `${plan.credits} credits a month (≈ ${plural(approxPosts(plan.credits), 'post')})`, included: true },
    { text: plan.imageQuality === 'high' ? 'High-quality AI images' : 'Standard AI images', included: true },
    { text: uploadsText(plan), included: true },
    scheduleText(plan),
    plan.customDesigns ? { text: 'Create and share your own designs', included: true } : { text: 'Batkle’s designs; browse the ones members make', included: true },
    { text: 'Facebook and Instagram ads', included: plan.adDesigns },
  ]
}

/**
 * Where a plan card's button leads. Paid plans open the plan settings with the plan and billing period chosen;
 * signed-out visitors are sent to sign in first and come back there.
 */
export function planCta(plan, interval, startHref) {
  if (!plan.price.month) return { href: startHref, label: 'Start free', note: 'Upgrade whenever you like.' }
  const href = `/app/settings?plan=${plan.id}&interval=${interval === 'year' ? 'year' : 'month'}#plan`
  if (!plan.trialDays) return { href, label: `Choose ${plan.name}`, note: 'Cancel anytime.' }
  return { href, label: `Start ${plan.trialDays}-day free trial`, note: 'Card required. Cancel anytime before the trial ends.' }
}

/** The answer to "How much does it cost?". */
export function pricingFaqAnswer() {
  const free = PLANS.free
  const paid = PAID_PLAN_IDS.map(id => PLANS[id])
  const prices = listText(paid.map((plan, i) => `${plan.name}${i ? '' : ' is'} ${formatPrice(plan.price.month)} a month`))
  const saving = yearlySavingLabel()
  return `Start on the free plan: ${plural(free.brands, 'brand')} and ${free.credits} credits a month, no card needed. ` +
    `${prices}, each with a ${TRIAL.days}-day free trial${saving ? `, and paying yearly gets you ${saving}` : ''}. ` +
    'Credits are images: a single post costs 1 credit, a carousel 1 per slide. See the plans above for everything each one includes.'
}

/** The answer to "What is a credit?". */
export function creditFaqAnswer() {
  return `One credit makes one image. A single post costs 1 credit and a carousel 1 per slide, so a ${SLIDES_PER_POST}-slide carousel uses ${SLIDES_PER_POST}. ` +
    "Your plan's credits renew every month, on yearly plans too. " +
    `Need more? Extra credits are ${CREDIT_PACK.credits} for ${formatPrice(CREDIT_PACK.price)}, never expire and are used once the month's credits run out. ` +
    'The developer API has its own credits, billed separately.'
}

/** The line under the pricing title. */
export function pricingIntro() {
  const trialPlans = PAID_PLAN_IDS.map(id => PLANS[id]).filter(plan => plan.trialDays > 0)
  const trial = trialPlans.length ? ` ${listText(trialPlans.map(plan => plan.name))} start with a ${trialPlans[0].trialDays}-day free trial.` : ''
  return `Start free and upgrade when you need more.${trial}`
}

/** The notes under the comparison table, as a bold title and the rest. */
export function creditPackNote() {
  return { title: 'Extra credits.', text: `${CREDIT_PACK.credits} for ${formatPrice(CREDIT_PACK.price)}, on any plan, and they never expire.` }
}

export function trialNote() {
  const texts = isComingSoon('textReminders') ? '' : ` and ${plural(TRIAL.textReminders, 'text reminder')}`
  return {
    title: 'Free trial.',
    text: `Once per account, with ${TRIAL.credits} credits${texts} during the ${TRIAL.days} days. Unless you cancel, it becomes the paid plan when it ends.`,
  }
}

export const newsletterTitle = () => `${NEWSLETTER_DISCOUNT.percent}% off your first payment`
export const newsletterBlurb = () => `Subscribe for product news and get a code for ${NEWSLETTER_DISCOUNT.percent}% off your first payment.`
export const newsletterConsent = () => `Email me product news and a ${NEWSLETTER_DISCOUNT.percent}% discount code. Unsubscribe anytime.`

const NEWSLETTER_FALLBACKS = {
  400: 'Check your email address and try again.',
  429: 'Too many tries. Please wait a minute and try again.',
  503: "The newsletter isn't available right now. Please try again later.",
}

/**
 * What the newsletter form shows for the server's answer. Only a 2xx answer with `ok: true` counts as subscribed;
 * anything else is an error, with the server's own message when it sent one.
 */
export function newsletterOutcome(status, data) {
  if (status >= 200 && status < 300 && data?.ok === true) {
    return { ok: true, message: (typeof data.message === 'string' && data.message.trim()) || "You're subscribed." }
  }
  const error = typeof data?.error === 'string' && data.error.trim()
  return { ok: false, message: error || NEWSLETTER_FALLBACKS[status] || 'Something went wrong. Please try again.' }
}
