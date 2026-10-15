'use client'

import { Crown, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * How each plan looks: Pro in butter, Business inverted (ink on the light theme, cream on the dark one, since the
 * fixed ink would vanish on the dark background) and Free quiet.
 */
const LOOKS = {
  free: { colors: 'bg-bk-alt text-bk-muted', Icon: null },
  pro: { colors: 'bg-bk-butter text-bk-ink', Icon: Sparkles },
  business: { colors: 'bg-bk-fg text-bk-bg', Icon: Crown },
}

/** The plan's name as people see it: "Pro", "Business", "Free", or "Pro trial" during a trial. */
export const planLabel = summary => (summary.trial?.active ? `${summary.planName} trial` : summary.planName)

/** The plan as a pill, from the billing summary (GET /api/billing); nothing until it has loaded. */
export default function PlanBadge({ summary, className = '' }) {
  if (!summary) return null
  const { colors, Icon } = LOOKS[summary.plan] || LOOKS.free
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10.5px] font-bold uppercase leading-4 tracking-[0.08em]', colors, className)}>
      {Icon && <Icon aria-hidden="true" className="size-3" />}
      {planLabel(summary)}
    </span>
  )
}

/** The collapsed rail's version: a small mark on the avatar's corner for Pro and Business, nothing on Free. */
export function PlanMark({ summary }) {
  const look = summary && summary.plan !== 'free' ? LOOKS[summary.plan] : null
  if (!look?.Icon) return null
  return (
    <span aria-hidden="true" className={cn('absolute -bottom-1.5 -right-1.5 flex size-[18px] items-center justify-center rounded-full ring-2 ring-bk-bg', look.colors)}>
      <look.Icon className="size-2.5" />
    </span>
  )
}
