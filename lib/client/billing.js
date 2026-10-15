// The browser side of plan limits: recognising the API's billing errors and where to send people to upgrade.

/** Error codes the API answers with when a plan limit stops a request (lib/billing/account.ts). */
export const BILLING_CODES = ['insufficient_credits', 'upgrade_required', 'limit_reached', 'payments_unavailable', 'trial_used']

/** The plan settings page; `#plan` and `#credits` open those sections. */
export const PLANS_HREF = '/app/settings#plan'
export const CREDITS_HREF = '/app/settings#credits'

export function isBillingCode(code) {
  return typeof code === 'string' && BILLING_CODES.includes(code)
}

/**
 * An Error for a failed API response that keeps the billing details: `error.code` and `error.billing` (the body)
 * when a plan limit stopped the request, so the page can offer an upgrade instead of "try again".
 */
export function apiError(data, status, fallback = 'Something went wrong. Please try again.') {
  const error = new Error((data && typeof data.error === 'string' && data.error) || fallback)
  error.status = status
  if (data && isBillingCode(data.code)) {
    error.code = data.code
    error.billing = data
  }
  return error
}

/** The address "Contact us" opens (NEXT_PUBLIC_CONTACT_EMAIL), or null when none is set. */
export function contactHref() {
  const email = (process.env.NEXT_PUBLIC_CONTACT_EMAIL || '').trim()
  return email ? `mailto:${email}` : null
}

/** Where an upgrade prompt for this error should lead, and the button's words. */
export function billingAction(error) {
  const code = error?.code || error?.billing?.code
  if (code === 'insufficient_credits') return { href: CREDITS_HREF, label: 'Get more credits' }
  // Business is the largest plan: more brands than it holds is a conversation, not a checkout.
  if (code === 'limit_reached' && error?.billing?.limit === 'brands' && !error?.billing?.requiredPlan && contactHref()) return { href: contactHref(), label: 'Contact us' }
  return { href: PLANS_HREF, label: 'See plans' }
}
