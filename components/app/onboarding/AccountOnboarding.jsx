'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useClerk } from '@clerk/nextjs'
import { ArrowRight, Check, Globe, Loader2, LogOut, Palette, Search, Sparkles } from 'lucide-react'
import { BatkleLogo } from '@/components/landing/brand'
import { isComingSoon } from '@/lib/billing/plans'
import { NAME_MAX, defaultPhoneCountry, parsePhoneAnswer } from '@/lib/onboardingOptions'
import { cn } from '@/lib/utils'
import { Notice, appButton, appLayer } from '../ui'
import { appField } from '../field'
import { PhoneInput } from '../settings/NotificationSettings'
import { fieldHint, fieldLabel, stepEyebrow, stepHeading, stepLead } from './styles'

const STEPS = [['about', 'About you'], ['brand', 'First brand']]
const UP_NEXT = [
  { icon: Globe, text: 'Paste your website' },
  { icon: Search, text: 'Batkle researches your brand' },
  { icon: Palette, text: 'Pick the designs it uses' },
  { icon: Sparkles, text: 'Get your first post ideas' },
]
const errorText = 'mt-2 text-[13px] font-semibold text-[#C2412F] dark:text-[#F0826F]'
// The number is only for text reminders, so it isn't asked for while they are "Coming soon" (plans.ts).
const ASK_PHONE = !isComingSoon('textReminders')

function Stepper({ index }) {
  return (
    <ol aria-label="Progress" className="hidden items-center gap-2 md:flex">
      {STEPS.map(([key, label], i) => (
        <li key={key} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden="true" className={cn('h-px w-8 transition-colors', i <= index ? 'bg-bk-fg' : 'bg-bk-field')} />}
          <span aria-current={i === index ? 'step' : undefined} className={cn('flex items-center gap-2 text-[13px] font-semibold', i <= index ? 'text-bk-fg' : 'text-bk-muted')}>
            <span
              aria-hidden="true"
              className={cn(
                'flex size-6 items-center justify-center rounded-full text-[12px] font-bold transition-colors',
                i < index ? 'bg-bk-fg text-bk-bg' : i === index ? 'bg-bk-butter text-bk-ink' : 'border border-bk-field text-bk-muted',
              )}
            >
              {i < index ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            {label}
            <span className="sr-only">{i < index ? '(done)' : i === index ? '(current)' : ''}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

function UpNext({ hasBrands }) {
  return (
    <div className="rounded-2xl border border-bk-line bg-bk-surface p-5">
      <p className={stepEyebrow}>{hasBrands ? 'After this' : 'Up next · First brand'}</p>
      {hasBrands ? (
        <p className="mt-3 text-[14px] leading-relaxed text-bk-muted">Your brands and posts are waiting in the studio.</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {UP_NEXT.map(({ icon: Icon, text }, i) => (
            <li key={text} className="flex items-center gap-3 text-[14px] font-semibold">
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-bk-alt text-bk-fg"><Icon className="size-4" /></span>
              <span><span className="sr-only">{i + 1}. </span>{text}</span>
            </li>
          ))}
        </ol>
      )}
      {!hasBrands && <p className="mt-5 border-t border-bk-line pt-4 text-[12.5px] leading-relaxed text-bk-muted">About a minute from here to your first brand profile.</p>}
    </div>
  )
}

/**
 * Account onboarding, once per account: the name to use (filled in from Google when there is one) and, optionally, a
 * mobile number for text reminders (saved unverified; it is checked with a code in Settings before any text; not
 * asked while texts are "Coming soon"). Then
 * `next` opens, which for a new account is the brand onboarding. Answers typed but not submitted are kept as a
 * `draft`, so someone who leaves finds them filled in.
 */
export default function AccountOnboarding({ next = '/app', initialName = '', email = '', hasBrands = false, draft = null }) {
  const { signOut } = useClerk()
  const [name, setName] = useState(() => draft?.answers?.name || initialName)
  const [phone, setPhone] = useState(() => draft?.answers?.phone || '')
  // The country chosen in the picker; until then, the one the browser's language suggests.
  const [phoneCountry, setPhoneCountry] = useState(() => draft?.answers?.phoneCountry || '')
  const [guessedCountry, setGuessedCountry] = useState('US')
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  useEffect(() => { setGuessedCountry(defaultPhoneCountry(navigator.languages || [navigator.language])) }, [])
  const country = phoneCountry || guessedCountry

  // Typed answers are saved shortly after each change, and right away when the page is left.
  const pending = useRef(null)
  const dirty = useRef(false)
  const flushDraft = useCallback(() => {
    if (!pending.current) return
    const body = JSON.stringify(pending.current)
    pending.current = null
    fetch('/api/account/onboarding/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
  }, [])
  useEffect(() => {
    if (saving) return
    // Nothing to save until something changes.
    if (!dirty.current) { dirty.current = true; return }
    pending.current = { answers: { name, phone, ...(phoneCountry ? { phoneCountry } : {}) } }
    const timer = setTimeout(flushDraft, 600)
    return () => clearTimeout(timer)
  }, [name, phone, phoneCountry, saving, flushDraft])
  useEffect(() => {
    window.addEventListener('pagehide', flushDraft)
    return () => window.removeEventListener('pagehide', flushDraft)
  }, [flushDraft])

  const submit = async e => {
    e.preventDefault()
    if (!name.trim()) return setErrors({ name: 'Tell us your name.' })
    // A number kept in a draft from before is not sent while the field is hidden.
    const phoneValue = ASK_PHONE ? phone : ''
    const phoneAnswer = parsePhoneAnswer(phoneValue, country)
    if (phoneAnswer.error) return setErrors({ phone: phoneAnswer.error })
    setErrors({})
    setSaving(true)
    pending.current = null
    try {
      const res = await fetch('/api/account/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, phone: phoneValue, phoneCountry: country }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok && (data.field === 'name' || data.field === 'phone')) {
        setErrors({ [data.field]: data.error })
        setSaving(false)
        return
      }
      if (!res.ok) throw new Error(data.error || 'Your name could not be saved. Please try again.')
      // A full page load, so the app reads the finished account rather than a cached redirect back here.
      window.location.assign(next)
    } catch (error) {
      setErrors({ form: /failed to fetch|network/i.test(error.message) ? 'Batkle couldn’t reach its server. Check your connection and try again.' : error.message })
      setSaving(false)
    }
  }

  return (
    <div className={cn(appLayer, 'flex min-h-dvh flex-col bg-bk-alt')}>
      <header className="flex items-center justify-between gap-4 px-5 py-4 sm:px-8 sm:py-5">
        <Link href="/" aria-label="Batkle home" className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bk-fg">
          <BatkleLogo size={30} />
        </Link>
        <Stepper index={0} />
        <button type="button" onClick={() => signOut({ redirectUrl: '/' })} className={appButton('quiet', 'sm')} title={email ? `Signed in as ${email}` : undefined}>
          <LogOut className="size-4" /><span className="hidden sm:inline">Sign out</span>
        </button>
      </header>

      <main id="onboarding" className="mx-auto grid w-full max-w-[1120px] flex-1 items-start gap-10 px-5 pb-16 pt-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-16 lg:pt-12">
        <section className="min-w-0 max-w-[640px] motion-safe:animate-bk-rise">
          <form noValidate onSubmit={submit}>
            <p className={stepEyebrow}>About you</p>
            <h1 className={stepHeading}>{initialName ? `Welcome, ${initialName.split(' ')[0]}` : 'Welcome to Batkle'}</h1>
            <p className={stepLead}>{initialName ? 'Check your name' : 'Tell us your name'}, then {hasBrands ? 'you’re back in Batkle.' : 'you’ll add your first brand.'}</p>

            <div className="mt-8 max-w-[420px]">
              <label htmlFor="onboarding-name" className={fieldLabel}>Your name</label>
              <input
                id="onboarding-name"
                autoComplete="name"
                autoFocus={!initialName}
                maxLength={NAME_MAX}
                placeholder="Alex Morgan"
                value={name}
                onChange={e => { setName(e.target.value); setErrors({}) }}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? 'onboarding-name-error' : undefined}
                className={appField('mt-2')}
              />
              {errors.name && <p id="onboarding-name-error" role="alert" className={errorText}>{errors.name}</p>}
            </div>

            {ASK_PHONE && (
              <div className="mt-6 max-w-[420px]">
                <label htmlFor="onboarding-phone" className={fieldLabel}>
                  Mobile number <span className="font-semibold text-bk-muted">(optional)</span>
                </label>
                <PhoneInput
                  id="onboarding-phone"
                  className="mt-2"
                  country={country}
                  onCountryChange={value => { setPhoneCountry(value); setErrors({}) }}
                  value={phone}
                  onChange={value => { setPhone(value); setErrors({}) }}
                  invalid={Boolean(errors.phone)}
                  describedBy={errors.phone ? 'onboarding-phone-error onboarding-phone-hint' : 'onboarding-phone-hint'}
                />
                {errors.phone && <p id="onboarding-phone-error" role="alert" className={errorText}>{errors.phone}</p>}
                <p id="onboarding-phone-hint" className={fieldHint}>Only used for post reminders by text, which you can turn on in Settings.</p>
              </div>
            )}

            {errors.form && <Notice tone="error" className="mt-6">{errors.form}</Notice>}

            <div className="mt-10 border-t border-bk-line pt-6">
              <button type="submit" disabled={saving} className={appButton('primary', 'md', 'h-11 px-5')}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                {saving ? 'Saving…' : hasBrands ? 'Open Batkle' : 'Add your first brand'}
                {!saving && <ArrowRight className="size-4" />}
              </button>
            </div>
          </form>
        </section>
        <aside className="hidden lg:block" aria-label="What happens next"><UpNext hasBrands={hasBrands} /></aside>
      </main>
    </div>
  )
}
