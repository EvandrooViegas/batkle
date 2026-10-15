/** Where the app opens after signing in or finishing onboarding, when nothing else was asked for. */
export const DEFAULT_AFTER_AUTH = '/app'

/**
 * A same-site path to go to after signing in or onboarding, or the app home. Accepts a path or a full URL on this
 * origin (Clerk's `redirect_url` is absolute); anything pointing at another site is ignored.
 */
export function safeRedirect(value, origin) {
  if (typeof value !== 'string' || !value) return DEFAULT_AFTER_AUTH
  try {
    const base = origin || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
    const url = new URL(value, base)
    if (url.origin !== new URL(base).origin) return DEFAULT_AFTER_AUTH
    const path = `${url.pathname}${url.search}${url.hash}`
    // Never send someone back to a sign-in page they just left.
    if (/^\/(sign-in|sign-up|sso-callback)(\/|$|\?)/.test(path)) return DEFAULT_AFTER_AUTH
    return path.startsWith('/') && !path.startsWith('//') ? path : DEFAULT_AFTER_AUTH
  } catch {
    return DEFAULT_AFTER_AUTH
  }
}
