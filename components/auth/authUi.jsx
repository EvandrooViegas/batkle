'use client'

import { useEffect, useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { isClerkAPIResponseError } from '@clerk/nextjs/errors'
import { appButton } from '@/components/app/ui'
import { appField } from '@/components/app/field'
import { fieldHint, fieldLabel } from '@/components/app/onboarding/styles'
import { cn } from '@/lib/utils'

export const PASSWORD_MIN = 8

export const authLinkClass = 'font-bold text-bk-fg underline decoration-bk-field underline-offset-4 transition-colors hover:decoration-bk-fg'

export function AuthHeading({ eyebrow, title, children, headingRef }) {
  return (
    <div>
      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-bk-muted">{eyebrow}</p>
      <h1 ref={headingRef} tabIndex={-1} className="mt-2.5 font-bk-display text-[clamp(30px,3.6vw,38px)] font-bold leading-[1.05] tracking-[-0.04em] outline-none">
        {title}
      </h1>
      {children && <p className="mt-2.5 text-[15px] leading-relaxed text-bk-muted">{children}</p>}
    </div>
  )
}

/** Google's "G", in its own colours as Google's sign-in guidelines ask. */
function GoogleMark({ className }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.28 14.29A7.2 7.2 0 0 1 4.9 12c0-.8.14-1.57.38-2.29v-3.1H1.27a12 12 0 0 0 0 10.78l4.01-3.1Z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.27 6.61l4.01 3.1C6.22 6.86 8.87 4.75 12 4.75Z" />
    </svg>
  )
}

export function GoogleButton({ onClick, busy, disabled, className = '' }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || busy} className={appButton('outline', 'md', cn('h-11 w-full text-[14.5px]', className))}>
      {busy ? <Loader2 className="size-[18px] animate-spin" /> : <GoogleMark className="size-[18px]" />}
      Continue with Google
    </button>
  )
}

export function OrDivider() {
  return (
    <div className="my-5 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.14em] text-bk-muted">
      <span aria-hidden="true" className="h-px flex-1 bg-bk-line" />or<span aria-hidden="true" className="h-px flex-1 bg-bk-line" />
    </div>
  )
}

function FieldMessage({ id, error, hint }) {
  if (error) return <p id={`${id}-error`} className="mt-1.5 text-[13px] font-semibold leading-relaxed text-[#C2412F] dark:text-[#F0826F]">{error}</p>
  return hint ? <p id={`${id}-hint`} className={fieldHint}>{hint}</p> : null
}

const describedBy = (id, error, hint) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined)

export function Field({ id, label, error, hint, action, className = '', ...input }) {
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className={fieldLabel}>{label}</label>
        {action}
      </div>
      <input id={id} aria-invalid={Boolean(error)} aria-describedby={describedBy(id, error, hint)} className={appField('mt-2')} {...input} />
      <FieldMessage id={id} error={error} hint={hint} />
    </div>
  )
}

export function PasswordField({ id, label = 'Password', error, hint, action, className = '', ...input }) {
  const [shown, setShown] = useState(false)
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className={fieldLabel}>{label}</label>
        {action}
      </div>
      <div className="relative mt-2">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy(id, error, hint)}
          className={appField('pr-11')}
          {...input}
        />
        <button
          type="button"
          onClick={() => setShown(value => !value)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-controls={id}
          className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-bk-muted transition-colors hover:text-bk-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-bk-fg"
        >
          {shown ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
        </button>
      </div>
      <FieldMessage id={id} error={error} hint={hint} />
    </div>
  )
}

/** A one-time code from an email: digits only, filled in by the browser or a password manager when it can be. */
export function CodeField({ id, label = 'Verification code', value, onChange, error, ...input }) {
  return (
    <div>
      <label htmlFor={id} className={fieldLabel}>{label}</label>
      <input
        id={id}
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        placeholder="000000"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={appField('mt-2 h-14 text-center font-bk-display text-[24px] font-bold tracking-[0.5em] placeholder:tracking-[0.5em] placeholder:text-bk-muted/40 focus:placeholder:text-transparent')}
        {...input}
      />
      <FieldMessage id={id} error={error} />
    </div>
  )
}

/** Seconds left before another code may be sent, and a function that starts the wait. */
export function useCooldown(seconds = 30) {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!left) return
    const timer = setTimeout(() => setLeft(value => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [left])
  return [left, () => setLeft(seconds)]
}

export function SubmitButton({ busy, busyLabel, disabled, children }) {
  return (
    <button type="submit" disabled={busy || disabled} className={appButton('primary', 'md', 'h-11 w-full text-[14.5px]')}>
      {busy && <Loader2 className="size-4 animate-spin" />}
      {busy ? busyLabel : children}
    </button>
  )
}

export function TextButton({ className = '', ...props }) {
  return <button type="button" className={cn('text-[13px] font-semibold text-bk-muted underline decoration-bk-field underline-offset-4 transition-colors hover:text-bk-fg hover:decoration-bk-fg disabled:opacity-50', className)} {...props} />
}

export function AuthFooter({ children }) {
  return <p className="mt-7 text-center text-[14px] text-bk-muted">{children}</p>
}

// Clerk error codes worth saying in Batkle's words, and the field each belongs to.
const MESSAGES = {
  form_identifier_not_found: ['email', 'No Batkle account uses this email. Check it, or create an account.'],
  form_password_incorrect: ['password', 'That password isn’t right. Try again, or reset it.'],
  form_password_pwned: ['password', 'This password has shown up in a data breach elsewhere. Choose a different one.'],
  form_password_length_too_short: ['password', `Use at least ${PASSWORD_MIN} characters.`],
  form_identifier_exists: ['email', 'An account already uses this email. Sign in instead.'],
  form_code_incorrect: ['code', 'That code isn’t right. Check the email and try again.'],
  verification_expired: ['code', 'That code has expired. Send a new one.'],
  verification_failed: ['code', 'Too many wrong codes. Send a new one.'],
  strategy_for_user_invalid: [null, 'This account signs in with Google. Use “Continue with Google”.'],
  captcha_invalid: [null, 'We couldn’t confirm you’re human. Refresh the page and try again.'],
  captcha_unavailable: [null, 'We couldn’t confirm you’re human. Refresh the page and try again.'],
  too_many_requests: [null, 'Too many attempts. Wait a minute, then try again.'],
  oauth_access_denied: [null, 'Google sign-in was cancelled.'],
  not_allowed_access: [null, 'This email can’t be used with Batkle.'],
}

const FIELDS = { identifier: 'email', email_address: 'email', password: 'password', code: 'code' }

/** What went wrong, in words for people, and the form field it belongs to (or null for the whole form). */
export function authError(error) {
  if (!isClerkAPIResponseError(error)) {
    const offline = /failed to fetch|network|load failed/i.test(String(error?.message || ''))
    return { field: null, message: offline ? 'Batkle couldn’t reach the sign-in service. Check your connection and try again.' : 'Something went wrong. Please try again.' }
  }
  const first = error.errors?.[0] || {}
  const known = MESSAGES[first.code]
  if (known) return { field: known[0], message: known[1] }
  const field = FIELDS[first.meta?.paramName] || null
  if (first.code === 'form_param_format_invalid' && field === 'email') return { field, message: 'Enter a valid email address.' }
  return { field, message: first.longMessage || first.message || 'Something went wrong. Please try again.' }
}

export function hasCode(error, code) {
  return isClerkAPIResponseError(error) && error.errors?.some(e => e.code === code)
}

/** A plain check before asking Clerk, so an obvious typo is caught without a round trip. */
export function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
