/**
 * Batkle's plans: what each one costs and what it allows. The pricing page, the plan settings, Stripe checkout and
 * every limit the server enforces read these numbers, so a change here changes all of them. Prices are in US dollars.
 * Stripe prices are found by their lookup keys, which scripts/stripe-setup.cjs creates.
 *
 * This file is shared by the browser and the server, so it imports nothing.
 */

export type PlanId = 'free' | 'pro' | 'business'
export type Interval = 'month' | 'year'
export type ImageQuality = 'standard' | 'high'
/** Plan features that are switched on or off, as `requireFeature` checks them. */
export type Feature = 'scheduling' | 'emailReminders' | 'textReminders' | 'customDesigns' | 'adDesigns'

export interface Plan {
  id: PlanId
  name: string
  /** Who the plan is for, in one line. */
  tagline: string
  /** Price per month, and per year (two months free). */
  price: { month: number; year: number }
  brands: number
  /** Credits each month. One credit is one image: a single post is 1, a carousel 1 per slide. */
  credits: number
  imageQuality: ImageQuality
  /** The person's own images: a number of images, or a total size in bytes. */
  uploads: { maxImages?: number; maxBytes?: number }
  scheduling: boolean
  emailReminders: boolean
  /** Text-message reminders each month; 0 when the plan has none. */
  textReminders: number
  /** Creating designs for the Design Library from your own references, and using the ones members publish. */
  customDesigns: boolean
  /** Meta (Facebook and Instagram) ads: copy within Meta's limits and the creative in each ad size. */
  adDesigns: boolean
  /** Days of free trial a new subscriber gets; 0 for none. */
  trialDays: number
  popular?: boolean
}

const GB = 1024 ** 3

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free', name: 'Free', tagline: 'Trying Batkle out',
    price: { month: 0, year: 0 },
    brands: 1, credits: 30, imageQuality: 'standard', uploads: { maxImages: 20 },
    scheduling: false, emailReminders: false, textReminders: 0, customDesigns: false, adDesigns: false, trialDays: 0,
  },
  pro: {
    id: 'pro', name: 'Pro', tagline: 'One business posting regularly',
    price: { month: 34.99, year: 349.9 },
    brands: 2, credits: 150, imageQuality: 'high', uploads: { maxBytes: 2 * GB },
    scheduling: true, emailReminders: true, textReminders: 30, customDesigns: true, adDesigns: false, trialDays: 7,
    popular: true,
  },
  business: {
    id: 'business', name: 'Business', tagline: 'Several brands or a lot of content',
    price: { month: 79.99, year: 799.9 },
    brands: 5, credits: 500, imageQuality: 'high', uploads: { maxBytes: 10 * GB },
    scheduling: true, emailReminders: true, textReminders: 100, customDesigns: true, adDesigns: true, trialDays: 7,
  },
}

export const PLAN_IDS: PlanId[] = ['free', 'pro', 'business']
export const PAID_PLAN_IDS: PlanId[] = ['pro', 'business']
export const INTERVALS: Interval[] = ['month', 'year']

/**
 * Features shown as "Coming soon": built but not launched (text reminders,
 * until Twilio is set up). Taking textReminders out turns texts back on everywhere: the plan cards, the comparison
 * table, the trial text, the usage tile, the reminder settings and the phone number in onboarding.
 */
export const COMING_SOON: Feature[] = ['textReminders']

export const isComingSoon = (feature: Feature): boolean => COMING_SOON.includes(feature)

/**
 * A free trial runs once per account, needs a card, and turns into the paid plan when it ends unless cancelled.
 * During the trial the plan's allowances are capped, so a trial cannot cost more than a few dollars of AI images.
 */
export const TRIAL = { days: 7, credits: 50, textReminders: 5 }

/** Extra credits, bought once; they never expire and are used after the month's credits run out. */
export const CREDIT_PACK = { credits: 100, price: 10, lookupKey: 'batkle_credits_100' }

/** Newsletter subscribers get this much off their first payment, once. */
export const NEWSLETTER_DISCOUNT = { percent: 20 }

/** "≈ X posts" assumes this many slides (credits) per post. */
export const SLIDES_PER_POST = 4

/** The plans that need a sales conversation instead of a checkout. */
export const CONTACT = { brandsOver: PLANS.business.brands, label: `Need more than ${PLANS.business.brands} brands? Contact us.` }

export const isPlanId = (value: unknown): value is PlanId => typeof value === 'string' && (PLAN_IDS as string[]).includes(value)
export const isPaidPlanId = (value: unknown): value is PlanId => typeof value === 'string' && (PAID_PLAN_IDS as string[]).includes(value)
export const isInterval = (value: unknown): value is Interval => value === 'month' || value === 'year'

export function planById(id: unknown): Plan {
  return isPlanId(id) ? PLANS[id] : PLANS.free
}

/** The Stripe price lookup key for a paid plan, e.g. batkle_pro_monthly. */
export function priceLookupKey(planId: PlanId, interval: Interval): string {
  return `batkle_${planId}_${interval === 'year' ? 'yearly' : 'monthly'}`
}

/** Every Stripe lookup key Batkle uses, with what it sells. */
export function stripeLookupKeys(): { lookupKey: string; planId?: PlanId; interval?: Interval; credits?: number }[] {
  return [
    ...PAID_PLAN_IDS.flatMap(planId => INTERVALS.map(interval => ({ lookupKey: priceLookupKey(planId, interval), planId, interval }))),
    { lookupKey: CREDIT_PACK.lookupKey, credits: CREDIT_PACK.credits },
  ]
}

/** The plan and interval a lookup key sells, or null. */
export function planForLookupKey(lookupKey: unknown): { planId: PlanId; interval: Interval } | null {
  const match = typeof lookupKey === 'string' && lookupKey.match(/^batkle_(pro|business)_(monthly|yearly)$/)
  return match ? { planId: match[1] as PlanId, interval: match[2] === 'yearly' ? 'year' : 'month' } : null
}

/** About how many posts some credits make. */
export function approxPosts(credits: number): number {
  return Math.max(0, Math.floor(credits / SLIDES_PER_POST))
}

/** The cheapest plan that has a feature, for "upgrade to …" messages. */
export function cheapestPlanWith(feature: Feature): Plan {
  return PLAN_IDS.map(id => PLANS[id]).find(plan => Boolean(plan[feature])) || PLANS.business
}

/** The cheapest plan with at least this many brands. */
export function cheapestPlanForBrands(count: number): Plan | null {
  return PLAN_IDS.map(id => PLANS[id]).find(plan => plan.brands >= count) || null
}

export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${Number((bytes / GB).toFixed(1))} GB`
  if (bytes >= 1024 ** 2) return `${Number((bytes / 1024 ** 2).toFixed(1))} MB`
  return `${Math.max(0, Math.round(bytes / 1024))} KB`
}

export function formatPrice(dollars: number): string {
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`
}

/** The uploads allowance as words: "Up to 20 images" or "2 GB". */
export function uploadsLabel(plan: Plan): string {
  if (plan.uploads.maxImages != null) return `Up to ${plan.uploads.maxImages} images`
  if (plan.uploads.maxBytes != null) return formatBytes(plan.uploads.maxBytes)
  return 'Unlimited'
}

export interface PricingRow {
  label: string
  /** One value per plan, in PLAN_IDS order: text, or true / false for a tick or a dash. */
  values: (string | boolean)[]
  /** A feature not built yet: its values are "Coming soon" or false, never true. */
  comingSoon?: boolean
}

/** The comparison table, as the pricing page and the plan settings show it. */
export function pricingRows(): PricingRow[] {
  const plans = PLAN_IDS.map(id => PLANS[id])
  const each = (value: (plan: Plan) => string | boolean) => plans.map(value)
  return [
    { label: 'Brands', values: each(p => String(p.brands)) },
    { label: 'Credits per month (1 credit = 1 image)', values: each(p => `${p.credits} (≈ ${approxPosts(p.credits)} posts)`) },
    { label: 'AI image quality', values: each(p => (p.imageQuality === 'high' ? 'High' : 'Standard')) },
    { label: 'Choose carousel length', values: each(() => true) },
    { label: 'Upload your own images', values: each(uploadsLabel) },
    { label: 'Download slides and copy caption', values: each(() => true) },
    { label: 'Schedule calendar', values: each(p => p.scheduling) },
    { label: 'Email reminders', values: each(p => p.emailReminders) },
    isComingSoon('textReminders')
      ? { label: 'Text reminders', values: each(p => (p.textReminders ? 'Coming soon' : false)), comingSoon: true }
      : { label: 'Text reminders', values: each(p => (p.textReminders ? `${p.textReminders} a month` : false)) },
    { label: 'Create and share your own designs', values: each(p => p.customDesigns) },
    { label: 'Designs published by other members', values: each(p => (p.customDesigns ? true : 'Browse only')) },
    { label: 'Facebook and Instagram ads', values: each(p => p.adDesigns) },
  ]
}
