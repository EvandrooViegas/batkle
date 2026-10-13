'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Loader2, PenLine, RotateCcw } from 'lucide-react'
import { RESEARCH_STEPS, researchStepAt } from '@/lib/client/onboarding'
import { cn } from '@/lib/utils'
import { appButton } from '../ui'
import { stepEyebrow, stepHeading, stepLead } from './styles'

const ROWS = [...RESEARCH_STEPS, { id: 'profile', label: () => 'Putting your brand profile together' }]

const clock = ms => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Live progress for the website research. `phase` is reading (request running), finishing
 * (English profile) or done. Remaining steps tick off quickly once the result is in, then onFinished runs.
 */
export default function ResearchStep({ domain, phase, error, onRetry, onChangeWebsite, onManual, onFinished, headingRef }) {
  const start = useRef(Date.now())
  const [elapsed, setElapsed] = useState(0)
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (error) return
    const target = phase === 'reading' ? null : phase === 'finishing' ? ROWS.length - 1 : ROWS.length
    const id = setInterval(() => {
      const now = Date.now() - start.current
      setElapsed(now)
      setShown(current => (target === null ? Math.max(current, researchStepAt(now)) : Math.min(target, current + 1)))
    }, phase === 'reading' ? 400 : 140)
    return () => clearInterval(id)
  }, [phase, error])

  const finished = shown >= ROWS.length
  useEffect(() => {
    if (!finished) return
    const id = setTimeout(onFinished, 600)
    return () => clearTimeout(id)
  }, [finished, onFinished])

  const active = ROWS[Math.min(shown, ROWS.length - 1)]

  return (
    <div>
      <p className={stepEyebrow}>Step 2 of 4 · Research</p>
      <h1 ref={headingRef} tabIndex={-1} className={stepHeading}>
        {error ? 'Research didn’t finish' : finished ? 'Your brand is ready to review' : <>Reading <span className="break-all">{domain}</span></>}
      </h1>
      <p className={stepLead}>
        {error
          ? `We couldn’t complete the research for ${domain}. Try again, use a different address or set the brand up by hand.`
          : 'This usually takes about a minute. Batkle reads your site the way a new copywriter would, then saves what it learns.'}
      </p>

      <div className="mt-8 rounded-2xl border border-bk-line bg-bk-surface p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4 text-[13px] text-bk-muted">
          <span className="font-semibold text-bk-fg">{error ? 'Stopped' : finished ? 'Done' : 'Working…'}</span>
          <span className="tabular-nums" aria-hidden="true">{clock(elapsed)}</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bk-line" aria-hidden="true">
          {error
            ? <div className="h-full w-full bg-[#C2412F]/40" />
            : finished
              ? <div className="h-full w-full bg-bk-butter transition-[width]" />
              : <div className="h-full w-2/5 rounded-full bg-bk-butter motion-safe:animate-bk-indeterminate motion-reduce:w-full motion-reduce:opacity-60" />}
        </div>

        <ol className="mt-5 space-y-3.5">
          {ROWS.map((row, i) => {
            const state = i < shown ? 'done' : i === shown ? (error ? 'failed' : 'active') : 'pending'
            return (
              <li key={row.id} className={cn('flex items-center gap-3 text-[15px] transition-colors', state === 'pending' ? 'text-bk-muted/70' : 'text-bk-fg', state === 'active' && 'font-semibold')}>
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors',
                    state === 'done' && 'border-transparent bg-bk-fg text-bk-bg',
                    state === 'active' && 'border-bk-fg',
                    state === 'failed' && 'border-transparent bg-[#C2412F] text-white',
                    state === 'pending' && 'border-bk-field',
                  )}
                >
                  {state === 'done' && <Check className="size-3.5" strokeWidth={3} />}
                  {state === 'active' && <Loader2 className="size-3.5 animate-spin" />}
                  {state === 'failed' && <AlertTriangle className="size-3" strokeWidth={2.5} />}
                </span>
                <span className="min-w-0">{row.label(domain)}</span>
                <span className="sr-only">{state === 'done' ? '(done)' : state === 'active' ? '(in progress)' : state === 'failed' ? '(failed)' : ''}</span>
              </li>
            )
          })}
        </ol>
        <p className="sr-only" aria-live="polite">{error ? 'Research stopped.' : finished ? 'Research finished.' : active.label(domain)}</p>
      </div>

      {error && (
        <div role="alert" className="mt-5 rounded-2xl border border-[#C2412F]/25 bg-[#C2412F]/[0.06] p-5">
          <p className="text-[15px] font-bold text-[#A8361F] dark:text-[#F0826F]">What went wrong</p>
          <p className="mt-1 text-[14px] leading-relaxed text-bk-fg/80">{error}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={onRetry} className={appButton('primary', 'md')}><RotateCcw className="size-4" />Try again</button>
            <button type="button" onClick={onChangeWebsite} className={appButton('outline', 'md')}>Use a different website</button>
            <button type="button" onClick={onManual} className={appButton('quiet', 'md')}><PenLine className="size-4" />Set it up by hand</button>
          </div>
        </div>
      )}
    </div>
  )
}
