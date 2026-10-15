'use client'

import { useEffect, useState } from 'react'
import { apiError } from '@/lib/client/billing'

// What the plan includes and how reminders are set up (GET /api/notifications), shared by every schedule view for
// a minute so opening dialogs doesn't ask again each time.
let cached = null

/** The reminder settings and plan features, or null when they couldn't be loaded. */
export function loadReminderInfo() {
  if (!cached || Date.now() - cached.at > 60_000) {
    cached = { at: Date.now(), promise: fetch('/api/notifications', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null) }
  }
  return cached.promise
}

/**
 * The upgrade prompt for scheduling (an Error for UpgradeNotice) when the plan doesn't include it; null while
 * unknown or when it does. The API refuses a time on those plans anyway; this just says so before the form is filled.
 */
export function useSchedulingGate(active = true) {
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!active) return
    let live = true
    loadReminderInfo().then(info => { if (live) setError(info?.upgrade?.scheduling ? apiError(info.upgrade.scheduling, 402) : null) })
    return () => { live = false }
  }, [active])
  return error
}
