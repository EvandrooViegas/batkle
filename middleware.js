import { NextResponse } from 'next/server'
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Pages that need an account.
const isAppPage = createRouteMatcher(['/app(.*)', '/onboarding(.*)', '/studio(.*)', '/renders(.*)', '/design-library(.*)', '/editor(.*)', '/carousel(.*)', '/flow(.*)', '/admin(.*)'])
// Sign-in pages: someone already signed in goes straight to the app.
const isAuthPage = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)'])

/**
 * API routes that need no session: images and renders are linked from posts, exports and the server-side renderer,
 * and /api/v1 is the developer API, which checks the caller's API key itself (lib/developer/api.ts). Services call
 * the others and prove who they are themselves: Stripe signs its webhook, the reminders job sends CRON_SECRET and
 * Twilio signs its callbacks. The newsletter sign-up and its unsubscribe link are public, and so is /api/track, which
 * counts a visit to a public page (lib/analytics/visits.ts). Everything else under /api
 * needs an account.
 */
function isPublicApi(request) {
  const { pathname } = request.nextUrl
  const method = request.method
  if (method === 'OPTIONS') return true
  if (pathname === '/api/v1' || pathname.startsWith('/api/v1/')) return true
  if (pathname.startsWith('/api/cron/')) return true
  if (pathname === '/api/newsletter/unsubscribe') return true
  if (method === 'POST' && (pathname === '/api/stripe/webhook' || pathname === '/api/newsletter' || pathname === '/api/track' || pathname.startsWith('/api/twilio/'))) return true
  return method === 'GET' && (/^\/api\/(uploads|rendered)\/[^/]+$/.test(pathname) || pathname === '/api' || pathname === '/api/')
}

export default clerkMiddleware(async (auth, request) => {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/api/') || pathname === '/api') {
    if (isPublicApi(request)) return
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
    return
  }

  if (isAppPage(request)) {
    const { userId, redirectToSignIn, redirectToSignUp } = await auth()
    if (userId) return
    // The home page's "Add your brand" buttons and website form open /app, and its pricing page's plan buttons open
    // /app/settings?plan=…: those visitors are mostly new, so they sign up.
    const fromHomePage = pathname === '/app' || (pathname === '/app/settings' && request.nextUrl.searchParams.has('plan'))
    return fromHomePage ? redirectToSignUp({ returnBackUrl: request.url }) : redirectToSignIn({ returnBackUrl: request.url })
  }

  if (isAuthPage(request)) {
    const { userId } = await auth()
    if (userId) return NextResponse.redirect(new URL('/app', request.url))
  }
}, { signInUrl: '/sign-in', signUpUrl: '/sign-up' })

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes.
    '/(api|trpc)(.*)',
  ],
}
