'use client'
import { useId, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from './brand'
import { newsletterConsent, newsletterOutcome } from './pricingText'

/**
 * The newsletter sign-up. It says "subscribed" only when the server confirms it (`ok: true`); anything else shows
 * the server's error, or a plain one when the request never got an answer.
 */
export default function NewsletterForm({ className = '' }) {
  const id = useId()
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  // A ref as well as state: two quick submits can both run before React re-renders the disabled button.
  const busy = useRef(false)

  async function submit(event) {
    event.preventDefault()
    if (busy.current) return
    const address = email.trim()
    if (!address || !consent) return
    busy.current = true
    setSending(true)
    setResult(null)
    try {
      const response = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: address, consent: true }),
      })
      const data = await response.json().catch(() => null)
      const outcome = newsletterOutcome(response.status, data)
      setResult(outcome)
      if (outcome.ok) {
        setEmail('')
        setConsent(false)
      }
    } catch {
      setResult({ ok: false, message: "We couldn't reach Batkle. Check your connection and try again." })
    } finally {
      busy.current = false
      setSending(false)
    }
  }

  return (
    <form onSubmit={submit} aria-busy={sending} className={cn('mt-5', className)}>
      <label htmlFor={`${id}-email`} className="block text-[14px] font-bold">
        Email
      </label>
      <div className="mt-2 flex flex-col gap-2 min-[420px]:flex-row">
        <input
          id={`${id}-email`}
          type="email"
          name="email"
          required
          autoComplete="email"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="h-12 min-w-0 rounded-lg border border-bk-field bg-bk-surface px-3.5 text-[16px] text-bk-fg outline-none transition-shadow placeholder:text-bk-muted/80 focus-visible:border-bk-fg focus-visible:shadow-[0_0_0_3px_rgb(255_216_77/0.55)] min-[420px]:flex-1"
        />
        <button
          type="submit"
          disabled={sending}
          className="h-12 shrink-0 rounded-lg bg-bk-ink px-5 text-[15px] font-bold text-bk-butter transition-[background-color,transform] duration-200 hover:bg-black active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 dark:bg-bk-butter dark:text-bk-ink dark:hover:bg-[#FFCD24]"
        >
          {sending ? 'Subscribing…' : 'Subscribe'}
        </button>
      </div>
      <label htmlFor={`${id}-consent`} className="mt-4 flex cursor-pointer items-start gap-3 text-[14px] leading-snug text-bk-muted">
        <input
          id={`${id}-consent`}
          type="checkbox"
          name="consent"
          required
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-[1px] size-[18px] shrink-0 cursor-pointer rounded accent-bk-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg dark:accent-bk-butter"
        />
        {newsletterConsent()}
      </label>
      <p
        role="status"
        aria-live="polite"
        className={cn(
          'text-[14px] leading-snug',
          result?.ok ? 'text-[#17583F] dark:text-[#4CC79A]' : 'text-[#8F2D20] dark:text-[#F0826F]',
        )}
      >
        {result && (
          <span className="mt-4 flex items-start gap-2">
            {result.ok && <Check className="mt-[2px] size-4 shrink-0" strokeWidth={3} aria-hidden="true" />}
            {result.message}
          </span>
        )}
      </p>
    </form>
  )
}
