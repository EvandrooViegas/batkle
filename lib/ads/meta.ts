/**
 * Meta (Facebook and Instagram) ads: the image sizes Batkle makes, the limits Meta shows text within before it cuts
 * it off, its fixed call-to-action buttons and its campaign objectives. Batkle makes the creative and the copy; people
 * paste them into Ads Manager (nothing is published through Meta's API).
 *
 * Shared by the browser and the server, so it imports nothing.
 */

export interface AdPlacement { id: string; label: string; ratio: string; width: number; height: number; where: string }

export const AD_PLACEMENTS: AdPlacement[] = [
  { id: 'feed-portrait', label: 'Feed, portrait', ratio: '4:5', width: 1080, height: 1350, where: 'Facebook and Instagram feeds; the most space on a phone' },
  { id: 'feed-square', label: 'Feed, square', ratio: '1:1', width: 1080, height: 1080, where: 'Facebook and Instagram feeds, Marketplace and search' },
  { id: 'story', label: 'Stories and Reels', ratio: '9:16', width: 1080, height: 1920, where: 'Facebook and Instagram Stories and Reels' },
  { id: 'landscape', label: 'Landscape', ratio: '1.91:1', width: 1200, height: 628, where: 'Facebook link ads and the right column' },
]
export const DEFAULT_PLACEMENTS = ['feed-portrait', 'feed-square', 'story']

/**
 * Ad formats, as Ads Manager names them: one image, or a carousel of 2 to 10 cards people swipe through, each with its
 * own image and its own headline and description under it. The primary text and the button are the ad's, shared.
 */
export const AD_FORMATS = [
  { id: 'single', label: 'Single image' },
  { id: 'carousel', label: 'Carousel' },
] as const
export type AdFormat = typeof AD_FORMATS[number]['id']
export const CAROUSEL_CARDS = { min: 2, max: 10, default: 4 }

/**
 * Every card of a carousel has the same shape, and Meta recommends square. A carousel runs in the feeds and in Stories
 * (one card per frame), never as a landscape link ad.
 */
export const CAROUSEL_PLACEMENTS = ['feed-portrait', 'feed-square', 'story']
export const CAROUSEL_DEFAULT_PLACEMENTS = ['feed-square']

/**
 * Ad text lengths. Meta shows the first ~125 characters of the primary text before "See more" (so they must work on
 * their own) and accepts more after them; headlines show 40 characters on Instagram and about 27 in the Facebook feed,
 * so their point sits in the first 27; the description shows about 30, and about 20 under a carousel card.
 */
export const AD_TEXT_LIMITS = { primaryText: 125, primaryTextMax: 500, headline: 40, headlineVisible: 27, description: 30, cardDescription: 20 }

/**
 * The three primary text versions, in order: each opens a different way, to test against each other. An ad sells, so
 * the longer two make the whole case (the problem, the answer, the proof, the objection) and every one ends by telling
 * the reader what to do.
 */
export const AD_ANGLES = [
  { id: 'short', label: 'Short', use: 'the hook, the offer and a direct call to action, in one or two sentences within 125 characters' },
  { id: 'problem', label: 'Problem → answer', use: 'the reader’s problem and what it keeps costing them, what the brand does about it, a proof point, then a direct call to action; 4–6 short lines' },
  { id: 'proof', label: 'Proof first', use: 'a real proof point from the profile (a named project, a credential, years or work done), what the reader gets (two or three concrete points, one per line), the main objection answered, then a direct call to action; 4–7 short lines' },
] as const

/**
 * Words on the image itself: Meta favours little text. A hook, a badge naming the offer, an optional line, and an
 * optional closing invitation. Meta draws its button under the image, so the closing line never repeats the button: it
 * says in other words what the reader gets by acting ("Ask us about your damp wall" above "Send Message").
 */
export const CREATIVE_LIMITS = { headline: 7, supportingText: 10, label: 3, cta: 6 }

/**
 * Stories and Reels draw the account name over the top of the image and the reply bar and button over the bottom: Meta
 * asks to keep about 14% at the top and 20% at the bottom free of words and logos.
 */
export const STORY_SAFE = { top: 250, bottom: 340 }

/** Ads Manager's call-to-action buttons, as Meta names them (English; Ads Manager translates them for viewers). */
export const META_CTAS = [
  'Learn More', 'Shop Now', 'Sign Up', 'Book Now', 'Contact Us', 'Get Quote', 'Get Offer', 'Apply Now', 'Subscribe',
  'Download', 'Order Now', 'Send Message', 'Call Now', 'Get Directions', 'Request Time', 'See Menu', 'Watch More',
] as const
export type MetaCta = typeof META_CTAS[number]

/** Meta's campaign objectives, and what the ad is written to make people do. */
export const AD_OBJECTIVES = [
  { id: 'awareness', label: 'Awareness', goal: 'make the right people remember the brand', cta: 'Learn More' },
  { id: 'traffic', label: 'Traffic', goal: 'get people to visit the website or page', cta: 'Learn More' },
  { id: 'engagement', label: 'Engagement', goal: 'get messages, comments or follows', cta: 'Send Message' },
  { id: 'leads', label: 'Leads', goal: 'get people to ask for a quote or leave their details', cta: 'Get Quote' },
  { id: 'sales', label: 'Sales', goal: 'get people to buy or book', cta: 'Shop Now' },
] as const
export type AdObjective = typeof AD_OBJECTIVES[number]['id']

/** Variants of the primary text and headline, to test against each other in Ads Manager. */
export const AD_VARIANTS = 3

/**
 * Variations of an ad's image, to test against each other in Ads Manager: each its own hook and picture from another
 * angle, with the text around the ad shared. A carousel's variations change its first card, the one that makes people
 * stop. The plan sets how many an ad may have (lib/billing/plans.ts, adVariations); this is the most any plan makes.
 */
export const AD_VARIATIONS_MAX = 5

/** The number of variations asked for, from 1 (the ad alone) to `max`. */
export function readVariations(value: unknown, max = AD_VARIATIONS_MAX): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n > 1 ? Math.min(max, n) : 1
}

export const placementById = (id: unknown) => AD_PLACEMENTS.find(p => p.id === id)
export const objectiveById = (id: unknown) => AD_OBJECTIVES.find(o => o.id === id) || AD_OBJECTIVES[1]
export const isMetaCta = (value: unknown): value is MetaCta => typeof value === 'string' && (META_CTAS as readonly string[]).includes(value)

export const readFormat = (value: unknown): AdFormat => (value === 'carousel' ? 'carousel' : 'single')
/** The sizes a format can be made at, and the ones it starts with. */
export const placementsFor = (format: AdFormat) => (format === 'carousel' ? CAROUSEL_PLACEMENTS : AD_PLACEMENTS.map(p => p.id))
export const defaultPlacements = (format: AdFormat) => (format === 'carousel' ? CAROUSEL_DEFAULT_PLACEMENTS : DEFAULT_PLACEMENTS)

/** A carousel's number of cards, within Meta's 2 to 10. */
export function readCards(value: unknown): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n > 0 ? Math.min(CAROUSEL_CARDS.max, Math.max(CAROUSEL_CARDS.min, n)) : CAROUSEL_CARDS.default
}

/** The placements asked for, valid for the format and in Batkle's order; the format's defaults when none are. */
export function readPlacements(value: unknown, format: AdFormat = 'single'): string[] {
  const allowed = placementsFor(format)
  const asked = Array.isArray(value) ? value.filter(v => typeof v === 'string' && allowed.includes(v)) : []
  const ids = asked.length ? asked : defaultPlacements(format)
  return AD_PLACEMENTS.map(p => p.id).filter(id => ids.includes(id))
}

/**
 * What an ad costs: one credit per image made at every size. A single image is one per variation; a carousel is one per
 * card, and each further variation adds its own first card.
 */
export function adCredits(brief: { format?: string; cards?: number; placements: string[]; variations?: number }) {
  const extra = readVariations(brief.variations) - 1
  return brief.placements.length * (brief.format === 'carousel' ? readCards(brief.cards) + extra : 1 + extra)
}

/** The images of one size: the ad's own, and each further variation's (a single image, or a carousel's first card). */
export const imagesPerSize = (brief: { format?: string; cards?: number; variations?: number }) => adCredits({ ...brief, placements: ['size'] })
