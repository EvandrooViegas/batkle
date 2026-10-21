'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { ATTRIBUTION_COOKIE, VISITOR_COOKIE, cookieValue, decodeAttribution, encodeAttribution, nextAttribution, readTouch } from '@/lib/analytics/attribution'

// Inside the app a page view is not a visit from anywhere.
const APP_PATHS = /^\/(app|editor|admin|studio|renders|onboarding|carousel|flow|design-library|developers\/dashboard|sso-callback)(\/|$)/
const DAY = 24 * 60 * 60

const setCookie = (name, value, maxAgeDays) => {
  document.cookie = `${name}=${value}; Max-Age=${maxAgeDays * DAY}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
}
const randomId = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''))

/**
 * On public pages: remembers where the visitor came from (lib/analytics/attribution.ts) and counts one visit per
 * browser session for the admin dashboard. Renders nothing.
 */
export default function VisitTracker() {
  const pathname = usePathname()
  useEffect(() => {
    try {
      if (APP_PATHS.test(location.pathname)) return
      const touch = readTouch(location.search, document.referrer, location.pathname, location.host)
      const previous = decodeAttribution(cookieValue(document.cookie, ATTRIBUTION_COOKIE))
      // A move between Batkle's own pages changes nothing; a new campaign or site moves the last touch.
      if (!previous || touch.channel !== 'Direct') setCookie(ATTRIBUTION_COOKIE, encodeAttribution(nextAttribution(previous, touch)), 90)
      const visitorId = cookieValue(document.cookie, VISITOR_COOKIE) || randomId()
      setCookie(VISITOR_COOKIE, visitorId, 365)
      if (sessionStorage.getItem('bk_visit')) return
      sessionStorage.setItem('bk_visit', '1')
      const body = JSON.stringify({ visitorId, ...touch })
      if (!navigator.sendBeacon?.('/api/track', new Blob([body], { type: 'application/json' }))) fetch('/api/track', { method: 'POST', body, keepalive: true }).catch(() => {})
    } catch {}
  }, [pathname])
  return null
}
