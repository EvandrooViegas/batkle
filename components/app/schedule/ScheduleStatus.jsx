'use client'

import { BadgeCheck, CalendarClock, CircleAlert, History, Send } from 'lucide-react'
import { formatWhen } from '@/lib/client/schedule'
import { cn } from '@/lib/utils'
import { PlatformList } from './platforms'

/**
 * The next approval step for a built post, by its schedule state (see scheduleState): approve it, schedule it or
 * change its schedule. Null once it is posted.
 */
export function approvalAction(state) {
  switch (state) {
    case 'unapproved': return { kind: 'approve', label: 'Approve' }
    case 'changed': return { kind: 'approve', label: 'Approve this version' }
    case 'approved': return { kind: 'schedule', label: 'Schedule' }
    case 'scheduled':
    case 'due': return { kind: 'schedule', label: 'Edit schedule' }
    default: return null
  }
}

const LINES = {
  changed: { Icon: History, text: () => 'Rebuilt since you approved it' },
  approved: { Icon: BadgeCheck, text: () => 'Approved · not scheduled yet' },
  scheduled: { Icon: CalendarClock, text: e => `Scheduled · ${formatWhen(e.scheduledAt)}` },
  due: { Icon: CircleAlert, text: e => `Due now · ${formatWhen(e.scheduledAt)}` },
  posted: { Icon: Send, text: e => `Posted${e.postedAt ? ` · ${formatWhen(e.postedAt)}` : ''}` },
}

const TONES = {
  light: { changed: 'text-bk-muted', approved: 'text-[#1E8A5A] dark:text-[#4CC38A]', scheduled: 'text-bk-fg', due: 'text-[#9A6B00] dark:text-[#F2C14E]', posted: 'text-bk-muted' },
  dark: { changed: 'text-bk-cream/70', approved: 'text-[#7EE2B0]', scheduled: 'text-bk-butter', due: 'text-[#F2C14E]', posted: 'text-bk-cream/70' },
}

/** One line on where an approved post stands, with the platforms it goes to. Nothing before approval. */
export function ScheduleLine({ state, entry, tone = 'light', className = '' }) {
  const line = LINES[state]
  if (!line || !entry) return null
  const { Icon } = line
  return (
    <p className={cn('inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] font-bold', TONES[tone][state], className)}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {line.text(entry)}
      {['scheduled', 'due', 'posted'].includes(state) && entry.platforms?.length > 0 && (
        <><span aria-hidden="true">·</span><PlatformList ids={entry.platforms} /></>
      )}
    </p>
  )
}
