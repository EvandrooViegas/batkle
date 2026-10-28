'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, CreditCard, Loader2, Settings, UserPlus, UserRound, Users } from 'lucide-react'
import { BatkleLogo } from '@/components/landing/brand'
import { isComingSoon } from '@/lib/billing/plans'
import PlanBadge from '../billing/PlanBadge'
import { NAME_MAX, defaultPhoneCountry, parsePhoneAnswer } from '@/lib/onboardingOptions'
import { cn } from '@/lib/utils'
import { Notice, appButton, appLayer } from '../ui'
import { appField } from '../field'
import { PhoneInput } from '../settings/NotificationSettings'
import { fieldHint, fieldLabel, stepEyebrow, stepHeading, stepLead } from './styles'
import SignOutButton from './SignOutButton'

const STEPS = [['about', 'About you'], ['brand', 'First brand']]
const FREE = { plan: 'free', planName: 'Free' }
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

const initialsOf = name => {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/**
 * Where the name shows, drawn as Batkle's own screens and updated as it is typed: the account menu at the top right
 * of the studio, and the invitation someone gets when this person adds them to a brand. A picture only: the field
 * is the one place to change it.
 */
function NamePreview({ name, email }) {
  const shown = name.trim().replace(/\s+/g, ' ') || 'Your name'
  const menuItem = 'flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-bk-fg/85 [&>svg]:size-4 [&>svg]:text-bk-muted'
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-2xl bg-bk-surface shadow-bk-card lg:sticky lg:top-8">
      <div className="bg-bk-alt/70 px-5 pb-6 pt-5">
        <p className="text-[12.5px] font-semibold text-bk-muted">Your account menu</p>
        <div className="mt-3 flex justify-end">
          <span className="flex size-[34px] items-center justify-center rounded-full bg-bk-ink text-[12px] font-bold text-bk-cream ring-2 ring-bk-butter ring-offset-2 ring-offset-bk-alt">{name.trim() ? initialsOf(shown) : '?'}</span>
        </div>
        <div className="mt-2.5 rounded-xl border border-bk-line bg-bk-surface p-1.5 shadow-bk-pop">
          <div className="px-2 pb-1.5 pt-1">
            <span className="flex items-center gap-2">
              <span className="min-w-0 truncate text-[13px] font-bold">{shown}</span>
              <PlanBadge summary={FREE} />
            </span>
            <span className="block truncate text-[11.5px] text-bk-muted">{email || 'you@example.com'}</span>
          </div>
          <div className="my-1 h-px bg-bk-line" />
          <span className={menuItem}><Settings strokeWidth={1.6} />Account settings</span>
          <span className={menuItem}><CreditCard strokeWidth={1.6} />Plan &amp; billing</span>
          <span className={menuItem}><Users strokeWidth={1.6} />Teams &amp; invitations</span>
        </div>
      </div>
      <div className="px-5 pb-5 pt-4">
        <p className="text-[12.5px] font-semibold text-bk-muted">What someone you invite to a brand sees</p>
        <div className="mt-3 flex gap-3 rounded-xl bg-bk-butter/[0.08] px-3 py-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[#E2A100]/50 bg-bk-butter/20 text-bk-fg">
            <UserPlus className="size-4" strokeWidth={1.6} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-semibold leading-snug text-bk-fg"><span className="break-words">{shown}</span> invited you to your brand</span>
            <span className="mt-0.5 block text-[12.5px] leading-snug text-bk-muted">As Editor. Accept to add it to your brand list.</span>
            <span className="mt-2 flex gap-2">
              <span className={appButton('primary', 'xs', 'pointer-events-none')}>Accept</span>
              <span className={appButton('outline', 'xs', 'pointer-events-none')}>Decline</span>
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Account onboarding, once per account: the name to use (filled in from Google when there is one), shown beside a
 * live picture of where it appears, and, optionally, a mobile number for text reminders (saved unverified; it is
 * checked with a code in Settings before any text; not asked while texts are "Coming soon"). Then
 * `next` opens, which for a new account is the brand onboarding. Answers typed but not submitted are kept as a
 * `draft`, so someone who leaves finds them filled in.
 */
export default function AccountOnboarding({ next = '/app', initialName = '', email = '', hasBrands = false, draft = null }) {
  const [name, setName] = useState(() => draft?.answers?.name || initialName)
  const [phone, setPhone] = useState(() => draft?.answers?.phone || '')
  // The country chosen in the picker; until then, the one the browser's language suggests.
  const [phoneCountry, setPhoneCountry] = useState(() => draft?.answers?.phoneCountry || '')
  const [guessedCountry, setGuessedCountry] = useState('US')
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  useEffect(() => { setGuessedCountry(defaultPhoneCountry(navigator.languages || [navigator.language])) }, [])
  const country = phoneCountry || guessedCountry
  const firstName = initialName.trim().split(/\s+/)[0]

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

  // Inside the name field, as on the website step; below the form when the phone number is asked for too.
  const submitButton = (
    <button type="submit" disabled={saving} className={appButton(ASK_PHONE ? 'primary' : 'ink', 'md', 'h-12 shrink-0 px-5 text-[15px]')}>
      {saving && <Loader2 className="size-4 animate-spin" />}
      {saving ? 'Saving…' : hasBrands ? 'Open Batkle' : 'Continue'}
      {!saving && <ArrowRight className="size-4" />}
    </button>
  )

  return (
    <div className={cn(appLayer, 'flex min-h-dvh flex-col bg-bk-alt')}>
      <header className="flex items-center justify-between gap-4 px-5 py-4 sm:px-8 sm:py-5">
        <Link href="/" aria-label="Batkle home" className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bk-fg">
          <BatkleLogo size={30} />
        </Link>
        <Stepper index={0} />
        {/* Typed answers are saved before signing out. */}
        <SignOutButton title={email ? `Signed in as ${email}` : undefined} onBefore={flushDraft} />
      </header>

      <main id="onboarding" className="mx-auto grid w-full max-w-[1120px] flex-1 items-start gap-10 px-5 pb-16 pt-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-16 lg:pt-12">
        <section className="min-w-0 motion-safe:animate-bk-rise">
          <form noValidate onSubmit={submit}>
            <p className={stepEyebrow}>About you</p>
            <h1 className={stepHeading}>{firstName ? `Welcome, ${firstName}` : 'Welcome to Batkle'}</h1>
            <p className={stepLead}>
              {initialName ? 'Check the name on your account.' : 'Add the name for your account.'} It’s on your account menu, and the people you invite to a brand see it beside your work.
            </p>

            <div className="mt-8">
              <label htmlFor="onboarding-name" className={fieldLabel}>Your name</label>
              <div className={cn(
                'mt-2 flex items-center gap-2 rounded-xl border-2 bg-bk-surface p-1.5 pl-4 transition-shadow focus-within:shadow-[0_0_0_4px_rgb(255_216_77/0.55)]',
                errors.name ? 'border-[#C2412F]' : 'border-bk-fg',
              )}>
                <UserRound aria-hidden="true" className="size-5 shrink-0 text-bk-muted" />
                <input
                  id="onboarding-name"
                  autoComplete="name"
                  autoFocus={!initialName}
                  maxLength={NAME_MAX}
                  placeholder="Alex Morgan"
                  value={name}
                  onChange={e => { setName(e.target.value); setErrors({}) }}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? 'onboarding-name-error' : 'onboarding-name-hint'}
                  className="h-12 min-w-0 flex-1 bg-transparent text-[17px] text-bk-fg outline-none placeholder:text-bk-muted/80"
                />
                {!ASK_PHONE && submitButton}
              </div>
              {errors.name
                ? <p id="onboarding-name-error" role="alert" className={errorText}>{errors.name}</p>
                : <p id="onboarding-name-hint" className={fieldHint}>{hasBrands ? 'Then you’re back in the studio.' : 'Next, your first brand: paste its website and Batkle learns it in about a minute.'}</p>}
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

            {errors.form && <Notice tone="error" className="mt-6 max-w-[560px]">{errors.form}</Notice>}
            {ASK_PHONE && <div className="mt-8">{submitButton}</div>}

            <p className="mt-10 border-t border-bk-line pt-6 text-[13.5px] text-bk-muted">
              You can change your name any time in Settings.
            </p>
          </form>
        </section>
        <aside className="hidden lg:block" aria-label="Where your name shows"><NamePreview name={name} email={email} /></aside>
      </main>
    </div>
  )
}
