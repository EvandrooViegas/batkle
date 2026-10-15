'use client'

import { ArrowRight, Check, Loader2, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { appButton } from '../ui'
import { stepEyebrow, stepHeading } from './styles'

/**
 * "Continue where you left off": shown when someone comes back to an onboarding they left halfway. `steps` are
 * [key, label] pairs and `current` the index to continue at; `details` are [label, value] rows of what was saved.
 */
export default function ResumePanel({
  visual, children, steps, current = 0, details, continueLabel, onContinue, startOverLabel = 'Start over', onStartOver, note, busy = false, headingRef,
}) {
  return (
    <div className="mx-auto max-w-[560px] text-center">
      {visual && (
        <div className="relative mx-auto w-fit motion-safe:animate-bk-rise">
          {visual}
          <span aria-hidden="true" className="absolute -bottom-2 -right-2 flex size-9 items-center justify-center rounded-full border-4 border-bk-alt bg-bk-butter text-bk-ink">
            <RotateCcw className="size-4" strokeWidth={2.5} />
          </span>
        </div>
      )}
      <p className={cn(stepEyebrow, visual && 'mt-8')}>Welcome back</p>
      <h1 ref={headingRef} tabIndex={-1} className={stepHeading}>Continue where you left off</h1>
      {children && <p className="mx-auto mt-3 max-w-[460px] text-[16px] leading-relaxed text-bk-muted">{children}</p>}

      {steps && (
        <ol aria-label="Progress" className="mt-6 flex flex-wrap justify-center gap-2">
          {steps.map(([key, label], i) => (
            <li
              key={key}
              aria-current={i === current ? 'step' : undefined}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold',
                i < current && 'bg-bk-fg text-bk-bg',
                i === current && 'bg-bk-butter text-bk-ink',
                i > current && 'border border-bk-field text-bk-muted',
              )}
            >
              {i < current && <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />}
              {label}
              <span className="sr-only">{i < current ? '(done)' : i === current ? '(continue here)' : ''}</span>
            </li>
          ))}
        </ol>
      )}

      {details?.length > 0 && (
        <dl className="mx-auto mt-6 max-w-[420px] divide-y divide-bk-line rounded-2xl border border-bk-line bg-bk-surface px-4 text-left">
          {details.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-4 py-2.5 text-[14px]">
              <dt className="shrink-0 text-bk-muted">{label}</dt>
              <dd className="min-w-0 truncate text-right font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-8 flex flex-col items-center justify-center gap-2 sm:flex-row">
        <button type="button" onClick={onContinue} disabled={busy} className={appButton('primary', 'md', 'h-11 px-5')}>
          {continueLabel}<ArrowRight className="size-4" />
        </button>
        <button type="button" onClick={onStartOver} disabled={busy} className={appButton('outline', 'md', 'h-11')}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
          {startOverLabel}
        </button>
      </div>
      {note && <p className="mx-auto mt-4 max-w-[420px] text-[13px] leading-relaxed text-bk-muted">{note}</p>}
    </div>
  )
}
