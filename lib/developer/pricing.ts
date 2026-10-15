/**
 * What the API charges, in credits: one per image it renders, so a single post is one credit and a carousel one per
 * slide. Failed requests are refunded. The docs page and the dashboard show these same numbers.
 */
export const CREDIT_COSTS = { image: 1 }

/** Requests per minute on one key. */
export const RATE_LIMITS = { perKey: 60 }

/** Credits a new developer account starts with: DEVELOPER_FREE_CREDITS, 100 when it is not set. */
export function starterCredits(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.DEVELOPER_FREE_CREDITS)
  return env.DEVELOPER_FREE_CREDITS?.trim() && Number.isInteger(value) && value >= 0 ? value : 100
}

export function imageCost(images: number): number {
  return CREDIT_COSTS.image * Math.max(1, images)
}
