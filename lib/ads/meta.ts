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
 * Ad text lengths. Meta shows the first ~125 characters of the primary text before "See more" (so they must work on
 * their own) and accepts more after them; headlines show 40 characters on Instagram and about 27 in the Facebook feed,
 * so their point sits in the first 27; the description shows about 30.
 */
export const AD_TEXT_LIMITS = { primaryText: 125, primaryTextMax: 360, headline: 40, headlineVisible: 27, description: 30 }

/** The three primary text versions, in order: each opens a different way, to test against each other. */
export const AD_ANGLES = [
  { id: 'short', label: 'Short', use: 'everything in one or two sentences, within 125 characters' },
  { id: 'problem', label: 'Problem → answer', use: 'the reader’s problem or moment, what the brand does about it, then the next step; 3–5 short lines' },
  { id: 'proof', label: 'Proof first', use: 'a real proof point from the profile (a named project, a credential, years or work done), then the offer and the next step; 3–5 short lines' },
] as const

/**
 * Words on the image itself: Meta favours little text. A hook, a badge naming the offer, an optional line, and a short
 * call to action matching the button under the image.
 */
export const CREATIVE_LIMITS = { headline: 7, supportingText: 10, label: 3, cta: 3 }

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

export const placementById = (id: unknown) => AD_PLACEMENTS.find(p => p.id === id)
export const objectiveById = (id: unknown) => AD_OBJECTIVES.find(o => o.id === id) || AD_OBJECTIVES[1]
export const isMetaCta = (value: unknown): value is MetaCta => typeof value === 'string' && (META_CTAS as readonly string[]).includes(value)

/** The placements asked for, valid and in Batkle's order; the defaults when none are. */
export function readPlacements(value: unknown): string[] {
  const asked = Array.isArray(value) ? value.filter(v => placementById(v)) : []
  const ids = asked.length ? asked : DEFAULT_PLACEMENTS
  return AD_PLACEMENTS.map(p => p.id).filter(id => ids.includes(id))
}
