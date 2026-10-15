'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiError } from '@/lib/client/billing'

/** The window event that makes credit meters reload; code that spends or adds credits dispatches it. */
export const CREDITS_EVENT = 'bk:credits-changed'

export function announceCreditsChanged() {
  window.dispatchEvent(new CustomEvent(CREDITS_EVENT))
}

/** A billing API call: GET without a body, POST with one. Errors keep their billing code (apiError). */
export async function billingRequest(path, body) {
  const res = await fetch(path, body === undefined
    ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw apiError(data, res.status, 'Your plan could not be loaded. Please try again.')
  return data
}

/**
 * GET /api/billing: `data` ({ summary, paymentsConfigured, portal, plans, … }), the load `error`, and `load()` to
 * read it again. With `follow`, it also reloads whenever CREDITS_EVENT fires; an older answer never replaces a newer one.
 */
export function useBilling({ follow = false } = {}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const latest = useRef(0)
  const load = useCallback(async () => {
    const id = ++latest.current
    try {
      const next = await billingRequest('/api/billing')
      if (id === latest.current) { setData(next); setError(null) }
      return next
    } catch (e) {
      if (id === latest.current) setError(e.message)
      return null
    }
  }, [])
  useEffect(() => {
    load()
    if (!follow) return
    const reload = () => { load() }
    window.addEventListener(CREDITS_EVENT, reload)
    return () => window.removeEventListener(CREDITS_EVENT, reload)
  }, [follow, load])
  return { data, error, load }
}
