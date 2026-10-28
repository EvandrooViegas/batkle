'use client'

import { useState } from 'react'
import { useClerk } from '@clerk/nextjs'
import { Loader2, LogOut } from 'lucide-react'
import { appButton } from '../ui'

/**
 * Sign out from the onboarding pages, which have no account menu. Signing out ends the session, then opens the home
 * page. The button says so meanwhile: the home page can take seconds to load (in development it compiles first), which
 * looked like a click that did nothing. If the page is still showing once the session has ended, a full page load
 * finishes the job. Before Clerk has loaded it runs the sign-out itself as soon as it can, so no fallback is set.
 * `onBefore` runs first, e.g. to save typed answers.
 */
export default function SignOutButton({ title, onBefore }) {
  const clerk = useClerk()
  const [leaving, setLeaving] = useState(false), [failed, setFailed] = useState(false)
  const leave = async () => {
    setLeaving(true); setFailed(false)
    onBefore?.()
    const here = window.location.pathname
    try {
      const ready = clerk.loaded
      await clerk.signOut({ redirectUrl: '/' })
      if (ready) setTimeout(() => { if (window.location.pathname === here) window.location.assign('/') }, 4000)
    } catch {
      setLeaving(false); setFailed(true)
    }
  }
  const label = leaving ? 'Signing out…' : failed ? 'Couldn’t sign out. Try again' : 'Sign out'
  return (
    <button type="button" onClick={leave} disabled={leaving} className={appButton('quiet', 'sm')} title={title} aria-label={label}>
      {leaving ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
      <span className="hidden sm:inline" aria-live="polite">{label}</span>
    </button>
  )
}
