'use client'

import Link from 'next/link'
import { Coins } from 'lucide-react'
import { CREDITS_HREF } from '@/lib/client/billing'
import { cn } from '@/lib/utils'
import { planLabel } from './PlanBadge'

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

/** The share of this month's credits still left, 0 to 100. */
function monthLeft(credits) {
  return credits.allowance ? Math.round((Math.max(0, credits.allowance - credits.used) / credits.allowance) * 100) : 0
}

/** The meter in words, for screen readers and the collapsed rail's tooltip. */
export function creditsLabel(summary) {
  if (!summary) return 'Credits'
  const { left, approxPosts } = summary.credits
  return `${left ? `${plural(left, 'credit')} left · ≈ ${plural(approxPosts, 'post')}` : 'No credits left'} · ${planLabel(summary)} plan`
}

/**
 * The sidebar's credits meter: credits left and about how many posts they make, linking to the credits settings (the
 * plan is in its label; the sidebar shows it as a PlanBadge with the account). `compact` is the collapsed rail's
 * version: the number alone, its details in the label. While `loading`
 * it holds its place; without a summary (the API could not be reached) it shows nothing.
 */
export default function CreditsMeter({ summary, loading = false, compact = false, onNavigate, className = '' }) {
  if (!summary) return loading && !compact ? <div aria-hidden="true" className={cn('h-[74px] rounded-xl bg-bk-surface motion-safe:animate-pulse', className)} /> : null
  const { left, approxPosts } = summary.credits
  const empty = left === 0
  const label = `${creditsLabel(summary)}. See credits and plans.`

  if (compact) {
    return (
      <Link href={CREDITS_HREF} onClick={onNavigate} aria-label={label} className={cn('relative flex size-9 items-center justify-center rounded-lg text-bk-fg/75 transition-colors hover:bg-bk-alt hover:text-bk-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg', className)}>
        <Coins aria-hidden="true" className="size-[17px]" />
        <span className={cn('absolute -right-1 -top-1 min-w-[16px] rounded-full px-1 text-center text-[9.5px] font-bold leading-4 tabular-nums', empty ? 'bg-[#C2412F] text-white' : 'bg-bk-butter text-bk-ink')}>
          {left > 999 ? '999+' : left}
        </span>
      </Link>
    )
  }

  return (
    <Link href={CREDITS_HREF} onClick={onNavigate} aria-label={label} className={cn('group block rounded-xl border border-bk-line bg-bk-surface px-3 py-2.5 transition-colors hover:border-bk-fg/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg', className)}>
      <span className={cn('flex items-center gap-1.5 text-[12.5px] font-bold', empty && 'text-[#C2412F] dark:text-[#F0826F]')}>
        <Coins aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate tabular-nums">{empty ? 'No credits left' : `${left} credit${left === 1 ? '' : 's'} left`}</span>
      </span>
      <span aria-hidden="true" className="mt-2 block h-1.5 overflow-hidden rounded-full bg-bk-alt">
        <span className="block h-full rounded-full bg-bk-butter transition-[width] duration-500" style={{ width: `${monthLeft(summary.credits)}%` }} />
      </span>
      <span className="mt-1.5 flex items-center justify-between gap-2 text-[11.5px] text-bk-muted">
        <span>{empty ? 'Get more to keep creating' : `≈ ${plural(approxPosts, 'post')}`}</span>
        <span className="font-semibold text-bk-fg/70 underline-offset-4 group-hover:underline">{summary.plan === 'free' ? 'Upgrade' : 'Details'}</span>
      </span>
    </Link>
  )
}
