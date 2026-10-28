'use client'

import { useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { Check, Loader2 } from 'lucide-react'
import { NAME_MAX } from '@/lib/onboardingOptions'
import { cn } from '@/lib/utils'
import { appButton, panelClass } from '../ui'
import { appField } from '../field'

/**
 * The account's name (#profile): on the account menu, and what the people it shares brands with see beside its work.
 * Saved to the account and to Clerk's profile (POST /api/account/name); Clerk's copy in this browser is reloaded so
 * the studio shows it straight away.
 */
export default function ProfileSettings({ initialName = '' }) {
  const { user } = useUser()
  const [saved, setSaved] = useState(initialName)
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const changed = name.trim().replace(/\s+/g, ' ') !== saved

  const save = async e => {
    e.preventDefault()
    if (!name.trim()) return setError('Tell us your name.')
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/account/name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Your name could not be saved. Please try again.')
      setSaved(data.name)
      setName(data.name)
      setDone(true)
      await user?.reload().catch(() => {})
    } catch (err) {
      setError(/failed to fetch|network/i.test(err.message) ? 'Batkle couldn’t reach its server. Check your connection and try again.' : err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section id="profile" aria-labelledby="profile-title" className="scroll-mt-24">
      <h2 id="profile-title" className="font-bk-display text-[22px] font-bold tracking-[-0.02em]">Your name</h2>
      <p className="mt-1 max-w-[640px] text-[14px] leading-relaxed text-bk-muted">On your account, and what the people you share brands with see beside your work.</p>
      <form noValidate onSubmit={save} className={cn(panelClass, 'mt-4 p-4 sm:p-5')}>
        <label htmlFor="settings-name" className="text-[13px] font-bold">Name</label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="settings-name"
            autoComplete="name"
            maxLength={NAME_MAX}
            value={name}
            onChange={e => { setName(e.target.value); setError(''); setDone(false) }}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'settings-name-error' : undefined}
            className={appField('sm:max-w-[420px]')}
          />
          <button type="submit" disabled={saving || !changed} className={appButton('primary', 'md', 'h-11 shrink-0')}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? 'Saving…' : 'Save name'}
          </button>
        </div>
        {error && <p id="settings-name-error" role="alert" className="mt-2 text-[13px] font-semibold text-[#C2412F] dark:text-[#F0826F]">{error}</p>}
        <p role="status" className="empty:hidden mt-2 flex items-center gap-1.5 text-[12.5px] text-bk-muted">
          {done && !changed && !error && <><Check aria-hidden="true" className="size-3.5 text-[#1F7A5A] dark:text-[#4CC79A]" />Saved. The people you share brands with see the new name.</>}
        </p>
      </form>
    </section>
  )
}
