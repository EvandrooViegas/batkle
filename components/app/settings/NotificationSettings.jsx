'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader2, Mail, MessageSquareText } from 'lucide-react'
import { isComingSoon } from '@/lib/billing/plans'
import { CALLING_CODES, toE164 } from '@/lib/notifications/sms'
import { defaultPhoneCountry } from '@/lib/onboardingOptions'
import { apiError } from '@/lib/client/billing'
import { cn } from '@/lib/utils'
import UpgradeNotice from '../billing/UpgradeNotice'
import { appField } from '../field'
import { fieldHint, fieldLabel } from '../onboarding/styles'
import { Notice, appButton, panelClass } from '../ui'

const errorText = 'mt-2 text-[13px] font-semibold text-[#C2412F] dark:text-[#F0826F]'
// While text reminders are "Coming soon" (COMING_SOON in plans.ts) their row says so, with no switch or number.
const TEXTS_SOON = isComingSoon('textReminders')

async function call(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, { method, cache: 'no-store', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw apiError(data, res.status)
  return data
}

const offline = error => (/failed to fetch|network/i.test(error?.message || '') ? 'Batkle couldn’t reach its server. Check your connection and try again.' : error?.message)

/**
 * A mobile number field: a country code picker (shown as "PT +351", a native select underneath) and the number.
 * A number typed with its own "+" code ignores the picker.
 */
export function PhoneInput({ id, country, onCountryChange, value, onChange, invalid = false, describedBy, disabled = false, autoFocus = false, className = '' }) {
  const selected = CALLING_CODES.find(c => c.country === country) || CALLING_CODES.find(c => c.country === 'US')
  return (
    <div className={cn('flex gap-2', className)}>
      <div className="relative h-11 shrink-0 rounded-lg border border-bk-field bg-bk-surface transition-[border-color,box-shadow] focus-within:border-bk-fg focus-within:shadow-[0_0_0_4px_rgb(255_216_77/0.45)]">
        <span aria-hidden="true" className="pointer-events-none flex h-full items-center pl-3 pr-8 text-[15px] font-semibold tabular-nums">
          {selected.country} +{selected.code}
          <ChevronDown className="absolute right-2.5 size-4 text-bk-muted" />
        </span>
        <select
          aria-label="Country code"
          value={selected.country}
          disabled={disabled}
          onChange={e => onCountryChange(e.target.value)}
          className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-default"
        >
          {CALLING_CODES.map(c => <option key={c.country} value={c.country}>{c.name} (+{c.code})</option>)}
        </select>
      </div>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        autoFocus={autoFocus}
        maxLength={32}
        placeholder="Mobile number"
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className={appField('flex-1')}
      />
    </div>
  )
}

function Switch({ id, checked, onChange, disabled, labelledBy, describedBy, busy }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-bk-fg bg-bk-fg' : 'border-bk-field bg-bk-alt',
      )}
    >
      <span aria-hidden="true" className={cn('inline-block size-[18px] rounded-full shadow-sm transition-transform', checked ? 'translate-x-[22px] bg-bk-butter' : 'translate-x-[2px] bg-bk-surface')} />
    </button>
  )
}

function Row({ icon: Icon, id, title, description, control, children }) {
  return (
    <div className="px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3.5">
        <span aria-hidden="true" className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-bk-alt text-bk-fg"><Icon className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p id={`${id}-title`} className="text-[14.5px] font-bold">{title}</p>
          {description && <p id={`${id}-description`} className="mt-0.5 text-[13px] leading-relaxed text-bk-muted">{description}</p>}
        </div>
        {control && <div className="shrink-0 pt-0.5">{control}</div>}
      </div>
      {children && <div className="mt-3 sm:pl-[46px]">{children}</div>}
    </div>
  )
}

/**
 * Adding, changing and verifying the phone number for text reminders: the number and the consent box, then the
 * code from the text. `phone` is the saved one (masked) or null. `onVerified(info)` gets the new settings.
 */
function PhoneSetup({ phone, consentText, onVerified, onRemoved, onUpgrade }) {
  const [editing, setEditing] = useState(!phone)
  const [country, setCountry] = useState('')
  const [number, setNumber] = useState('')
  const [consent, setConsent] = useState(false)
  const [sentTo, setSentTo] = useState(null) // { phone (E.164, or null for the saved one), masked }
  const [code, setCode] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState('')
  const codeInput = useRef(null)

  useEffect(() => { setCountry(current => current || defaultPhoneCountry(navigator.languages || [navigator.language])) }, [])
  useEffect(() => { if (sentTo) codeInput.current?.focus() }, [sentTo])

  const fail = (field, error) => {
    if (error?.billing) return onUpgrade(error)
    setErrors({ [field]: offline(error) })
  }

  // Without `useSaved`, the number typed in the form; with it, the unverified number saved in onboarding.
  const sendCode = async ({ useSaved = false } = {}) => {
    setErrors({})
    setStatus('')
    const e164 = useSaved ? null : toE164(number, country)
    if (!useSaved && !e164) return setErrors({ number: 'That doesn’t look like a mobile number. Check it and try again.' })
    if (!consent) return setErrors({ consent: 'Tick the box to agree to reminder texts.' })
    setBusy('send')
    try {
      const data = await call('/api/notifications/phone/start', { method: 'POST', body: e164 ? { phone: e164 } : {} })
      setSentTo({ phone: e164, masked: data.phone })
      setCode('')
      setStatus(`We texted a code to ${data.phone}.`)
    } catch (error) {
      fail(sentTo ? 'code' : 'number', error)
    } finally {
      setBusy('')
    }
  }

  const verify = async e => {
    e.preventDefault()
    setErrors({})
    if (!/^\d{4,10}$/.test(code.replace(/\s/g, ''))) return setErrors({ code: 'Enter the code from the text.' })
    setBusy('verify')
    try {
      const info = await call('/api/notifications/phone/check', { method: 'POST', body: { ...(sentTo.phone ? { phone: sentTo.phone } : {}), code, consent } })
      setSentTo(null)
      setEditing(false)
      setNumber('')
      setCode('')
      setStatus('Your number is verified.')
      onVerified(info)
    } catch (error) {
      fail('code', error)
    } finally {
      setBusy('')
    }
  }

  const remove = async () => {
    setBusy('remove')
    setErrors({})
    try {
      onRemoved(await call('/api/notifications/phone', { method: 'DELETE' }))
      setEditing(true)
      setStatus('Your number was removed.')
    } catch (error) {
      setErrors({ remove: offline(error) })
    } finally {
      setBusy('')
    }
  }

  const consentBox = (
    <div className="mt-3">
      <label className="flex items-start gap-2.5 text-[13px] leading-relaxed">
        <input
          type="checkbox"
          checked={consent}
          onChange={e => { setConsent(e.target.checked); setErrors({}) }}
          aria-invalid={Boolean(errors.consent)}
          aria-describedby={errors.consent ? 'phone-consent-error' : undefined}
          className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[#14131A] dark:accent-[#FFD84D]"
        />
        <span>{consentText}</span>
      </label>
      {errors.consent && <p id="phone-consent-error" role="alert" className={errorText}>{errors.consent}</p>}
    </div>
  )

  return (
    <div className="rounded-xl border border-bk-line bg-bk-alt/50 p-3.5">
      <p role="status" aria-live="polite" className="sr-only">{status}</p>

      {phone && !editing && !sentTo && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="mr-auto text-[14px]">
            <span className="font-bold tabular-nums">{phone.masked}</span>
            <span className={cn('ml-2 text-[12.5px] font-bold', phone.verified ? 'text-[#1E8A5A] dark:text-[#4CC38A]' : 'text-[#9A6B00] dark:text-[#F2C14E]')}>
              {phone.verified ? 'Verified' : 'Not verified yet'}
            </span>
          </p>
          {!phone.verified && (
            <button type="button" onClick={() => setEditing('saved')} className={appButton('primary', 'sm')}>Verify it</button>
          )}
          <button type="button" onClick={() => { setEditing(true); setErrors({}) }} className={appButton('outline', 'sm')}>Change number</button>
          <button type="button" onClick={remove} disabled={busy === 'remove'} className={appButton('quiet', 'sm', 'text-bk-muted hover:text-bk-fg')}>
            {busy === 'remove' && <Loader2 className="size-3.5 animate-spin" />}Remove
          </button>
          {errors.remove && <p role="alert" className={cn(errorText, 'w-full')}>{errors.remove}</p>}
        </div>
      )}

      {editing && !sentTo && (
        <form noValidate onSubmit={e => { e.preventDefault(); sendCode({ useSaved: editing === 'saved' }) }}>
          {editing === 'saved' ? (
            <p className="text-[14px]">We’ll text a code to <span className="font-bold tabular-nums">{phone?.masked}</span>.</p>
          ) : (
            <>
              <label htmlFor="settings-phone" className={fieldLabel}>Mobile number</label>
              <PhoneInput
                id="settings-phone"
                className="mt-2 max-w-[420px]"
                country={country}
                onCountryChange={value => { setCountry(value); setErrors({}) }}
                value={number}
                onChange={value => { setNumber(value); setErrors({}) }}
                invalid={Boolean(errors.number)}
                describedBy={errors.number ? 'settings-phone-error' : 'settings-phone-hint'}
              />
              {errors.number
                ? <p id="settings-phone-error" role="alert" className={errorText}>{errors.number}</p>
                : <p id="settings-phone-hint" className={fieldHint}>Only used for post reminders. We’ll text you a code to check it.</p>}
            </>
          )}
          {consentBox}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" disabled={busy === 'send'} className={appButton('primary', 'sm')}>
              {busy === 'send' && <Loader2 className="size-3.5 animate-spin" />}Send code
            </button>
            {phone && (
              <button type="button" onClick={() => { setEditing(false); setErrors({}) }} className={appButton('quiet', 'sm')}>Cancel</button>
            )}
          </div>
        </form>
      )}

      {sentTo && (
        <form noValidate onSubmit={verify}>
          <label htmlFor="settings-phone-code" className={fieldLabel}>Code from the text</label>
          <p className={fieldHint}>We texted it to <span className="font-semibold tabular-nums">{sentTo.masked}</span>.</p>
          <input
            ref={codeInput}
            id="settings-phone-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            placeholder="123456"
            value={code}
            onChange={e => { setCode(e.target.value.replace(/[^\d\s]/g, '')); setErrors({}) }}
            aria-invalid={Boolean(errors.code)}
            aria-describedby={errors.code ? 'settings-phone-code-error' : undefined}
            className={appField('mt-2 max-w-[200px] tracking-[0.2em] tabular-nums')}
          />
          {errors.code && <p id="settings-phone-code-error" role="alert" className={errorText}>{errors.code}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" disabled={Boolean(busy)} className={appButton('primary', 'sm')}>
              {busy === 'verify' && <Loader2 className="size-3.5 animate-spin" />}Verify
            </button>
            <button type="button" onClick={() => sendCode({ useSaved: !sentTo.phone })} disabled={Boolean(busy)} className={appButton('outline', 'sm')}>
              {busy === 'send' && <Loader2 className="size-3.5 animate-spin" />}Send a new code
            </button>
            <button type="button" onClick={() => { setSentTo(null); setEditing(true); setErrors({}) }} disabled={Boolean(busy)} className={appButton('quiet', 'sm')}>Use a different number</button>
          </div>
        </form>
      )}
    </div>
  )
}

/**
 * The reminders section of /app/settings (#notifications): email and text reminders, when they arrive, and the
 * phone number texts go to. Batkle never posts by itself; these remind the person when a scheduled post is due.
 */
export default function NotificationSettings() {
  const [info, setInfo] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  const [upgrade, setUpgrade] = useState(null)
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    setLoadError('')
    try {
      setInfo(await call('/api/notifications'))
    } catch (err) {
      setLoadError(offline(err) || 'Your reminder settings could not be loaded.')
    }
  }, [])
  useEffect(() => { load() }, [load])

  const save = async (key, changes, done) => {
    setSaving(key)
    setError('')
    setUpgrade(null)
    setStatus('')
    try {
      setInfo(await call('/api/notifications', { method: 'PUT', body: changes }))
      setStatus(done)
    } catch (err) {
      if (err.billing) setUpgrade(err)
      else setError(offline(err))
    } finally {
      setSaving('')
    }
  }

  const heading = (
    <div>
      <h2 id="notifications-title" className="font-bk-display text-[22px] font-bold tracking-[-0.02em]">Reminders</h2>
      <p className="mt-1 max-w-[640px] text-[14px] leading-relaxed text-bk-muted">
        Batkle doesn’t post for you. When a scheduled post is due, it reminds you, with the slides and caption ready to post.
      </p>
    </div>
  )

  if (!info) {
    return (
      <section id="notifications" aria-labelledby="notifications-title" className="scroll-mt-24">
        {heading}
        {loadError ? (
          <Notice tone="error" className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span>{loadError}</span>
            <button type="button" onClick={load} className={appButton('outline', 'sm')}>Try again</button>
          </Notice>
        ) : (
          <div role="status" aria-label="Loading your reminder settings" className="mt-4 h-[220px] rounded-2xl bg-bk-surface motion-safe:animate-pulse" />
        )}
      </section>
    )
  }

  const { email, texts, settings, phone, upgrade: planUpgrade } = info
  const toError = body => (body ? apiError(body, 402) : null)
  const emailGate = toError(planUpgrade?.emailReminders)
  const textsLive = texts.configured && !TEXTS_SOON
  const textGate = TEXTS_SOON ? null : toError(planUpgrade?.textReminders)
  // One prompt when the plan has no reminders at all; the text one only when just texts are missing.
  const planNotice = upgrade || emailGate || textGate
  const anyReminders = (email.configured && email.included) || (textsLive && texts.included)
  const phoneOk = Boolean(phone?.verified && phone?.consented)
  const textsLine = texts.included ? `${texts.left} of ${texts.allowance} text${texts.allowance === 1 ? '' : 's'} left this month.` : ''

  return (
    <section id="notifications" aria-labelledby="notifications-title" className="scroll-mt-24">
      {heading}
      <p role="status" aria-live="polite" className="sr-only">{status}</p>
      {planNotice && <UpgradeNotice error={planNotice} className="mt-4" />}
      {error && <Notice tone="error" className="mt-4">{error}</Notice>}

      <div className={cn(panelClass, 'mt-4 divide-y divide-bk-line')}>
        <Row
          icon={Mail}
          id="reminder-email"
          title="Email reminders"
          description={email.configured ? (email.address ? `Sent to ${email.address}.` : 'Sent to your account’s email.') : 'Email reminders aren’t available right now.'}
          control={email.configured && (
            <Switch
              id="reminder-email-switch"
              checked={email.included && settings.email}
              disabled={!email.included || saving === 'email'}
              busy={saving === 'email'}
              labelledBy="reminder-email-title"
              describedBy="reminder-email-description"
              onChange={value => save('email', { email: value }, value ? 'Email reminders are on.' : 'Email reminders are off.')}
            />
          )}
        />

        <Row
          icon={MessageSquareText}
          id="reminder-sms"
          title="Text reminders"
          description={TEXTS_SOON
            ? 'Coming soon: a short text with a link to the post.'
            : !texts.configured
              ? 'Text reminders aren’t available right now.'
              : `A short text with a link to the post.${textsLine ? ` ${textsLine}` : ''}`}
          control={textsLive && (
            <Switch
              id="reminder-sms-switch"
              checked={texts.included && settings.sms}
              disabled={!texts.included || saving === 'sms' || (!settings.sms && !phoneOk)}
              busy={saving === 'sms'}
              labelledBy="reminder-sms-title"
              describedBy="reminder-sms-description"
              onChange={value => save('sms', { sms: value }, value ? 'Text reminders are on.' : 'Text reminders are off.')}
            />
          )}
        >
          {textsLive && texts.included && (
            <>
              {phone?.optedOut && (
                <Notice tone="warning" className="mb-3">
                  You replied STOP to a Batkle text, so texts are off. To get them again, reply START to that text, then turn text reminders back on.
                </Notice>
              )}
              {!phoneOk && !settings.sms && <p className="mb-3 text-[13px] text-bk-muted">Add and verify your mobile number to turn on text reminders.</p>}
              <PhoneSetup
                phone={phone}
                consentText={info.consentText}
                onUpgrade={setUpgrade}
                onRemoved={next => { setInfo(next); setStatus('Text reminders are off.') }}
                onVerified={next => {
                  setInfo(next)
                  // Verifying a number here, with the box ticked, is asking for the texts.
                  if (!next.settings.sms) save('sms', { sms: true }, 'Your number is verified and text reminders are on.')
                }}
              />
            </>
          )}
        </Row>

        <fieldset className="px-4 py-4 sm:px-5" disabled={!anyReminders || saving === 'lead'}>
          <legend className="text-[14.5px] font-bold">When reminders arrive</legend>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {[[0, 'When the post is due'], [60, '1 hour before']].map(([minutes, label]) => {
              const on = settings.leadMinutes === minutes
              return (
                <label
                  key={minutes}
                  className={cn(
                    'flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-bk-fg',
                    on ? 'border-bk-fg bg-bk-fg text-bk-bg' : 'border-bk-field hover:border-bk-fg/50',
                    !anyReminders && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <input
                    type="radio"
                    name="reminder-lead"
                    value={minutes}
                    checked={on}
                    onChange={() => save('lead', { leadMinutes: minutes }, minutes ? 'Reminders arrive an hour before.' : 'Reminders arrive when the post is due.')}
                    className="sr-only"
                  />
                  {saving === 'lead' && on && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
                  {label}
                </label>
              )
            })}
          </div>
        </fieldset>
      </div>
    </section>
  )
}
