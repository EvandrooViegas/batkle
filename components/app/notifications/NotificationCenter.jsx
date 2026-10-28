'use client'

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell, BellRing, CalendarClock, CircleCheck, Coins, LayoutGrid, LayoutTemplate, Loader2, Megaphone, Send, Smartphone, UserPlus, UserRound, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { SegmentedTabs, appButton, appLayer } from '../ui'

const STROKE = 1.6
const KINDS = {
  post: { Icon: LayoutGrid, group: 'content' },
  story: { Icon: Smartphone, group: 'content' },
  ad: { Icon: Megaphone, group: 'content' },
  design: { Icon: LayoutTemplate, group: 'content' },
  approved: { Icon: CircleCheck, group: 'schedule' },
  scheduled: { Icon: CalendarClock, group: 'schedule' },
  due: { Icon: BellRing, group: 'schedule' },
  posted: { Icon: Send, group: 'schedule' },
  invite: { Icon: UserPlus, group: 'team' },
  joined: { Icon: UserRound, group: 'team' },
  credits: { Icon: Coins, group: 'account' },
}
const FILTERS = [['all', 'All'], ['content', 'Created'], ['schedule', 'Schedule'], ['team', 'Team']]

const DAY = 86400_000
const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
function dayLabel(at, now = Date.now()) {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return new Date(at).toLocaleDateString(undefined, { weekday: 'long' })
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
}
function ago(at, now = Date.now()) {
  const minutes = Math.floor((now - new Date(at).getTime()) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
const scheduledFor = when => new Date(when).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * The account's activity for the notification center (/api/activity): loaded once, again every minute while the tab
 * is open and in view, when the window comes back into focus, and shortly after anything spends credits (a post,
 * story or ad being made).
 */
export function useActivity() {
  const [data, setData] = useState(null)
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/activity', { cache: 'no-store' })
      if (res.ok) setData(await res.json())
    } catch {}
  }, [])
  useEffect(() => {
    load()
    const visible = () => document.visibilityState === 'visible' && load()
    let soon
    const later = () => { clearTimeout(soon); soon = setTimeout(load, 2000) }
    const timer = setInterval(visible, 60000)
    window.addEventListener('focus', visible)
    window.addEventListener('bk:credits-changed', later)
    window.addEventListener('bk:activity-changed', load)
    return () => {
      clearInterval(timer); clearTimeout(soon)
      window.removeEventListener('focus', visible)
      window.removeEventListener('bk:credits-changed', later)
      window.removeEventListener('bk:activity-changed', load)
    }
  }, [load])
  const markSeen = useCallback(async () => {
    setData(d => (d ? { ...d, unread: 0, seenAt: new Date().toISOString() } : d))
    try { await fetch('/api/activity', { method: 'POST' }) } catch {}
  }, [])
  return { items: data?.items || [], unread: data?.unread || 0, seenAt: data?.seenAt || null, loaded: Boolean(data), load, markSeen }
}

/** The bell: opens the notification center; a red count while something is unread. Its size comes with `className`. */
export const NotificationBell = forwardRef(function NotificationBell({ unread, className = '', ...props }, ref) {
  const label = unread ? `Notifications, ${unread} unread` : 'Notifications'
  return (
    <button ref={ref} type="button" aria-label={label} title="Notifications" {...props} className={cn('relative flex shrink-0 items-center justify-center rounded-lg text-bk-muted transition-colors hover:text-bk-fg data-[state=open]:border-bk-fg data-[state=open]:text-bk-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg', className)}>
      <Bell className="size-4" strokeWidth={STROKE} aria-hidden="true" />
      {unread > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-[#C2412F] px-1 text-center text-[9.5px] font-bold leading-4 tabular-nums text-white ring-2 ring-bk-alt">{unread > 9 ? '9+' : unread}</span>}
    </button>
  )
})

/** A brand invitation answered right in the list; an accepted brand joins the brand list straight away. */
function InviteActions({ id, onDone }) {
  const router = useRouter()
  const [busy, setBusy] = useState(''), [error, setError] = useState('')
  const answer = async accept => {
    setBusy(accept ? 'accept' : 'decline'); setError('')
    try {
      const res = await fetch(`/api/teams/invitations/${id}${accept ? '/accept' : ''}`, { method: accept ? 'POST' : 'DELETE', headers: { 'Content-Type': 'application/json' }, body: accept ? '{}' : undefined })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'That did not work. Please try again.')
      onDone()
      if (accept) router.refresh()
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  return (
    <div className="mt-2">
      <div className="flex gap-2">
        <button type="button" disabled={!!busy} onClick={() => answer(true)} className={appButton('primary', 'xs')}>{busy === 'accept' && <Loader2 className="size-3.5 animate-spin" />}Accept</button>
        <button type="button" disabled={!!busy} onClick={() => answer(false)} className={appButton('outline', 'xs')}>{busy === 'decline' && <Loader2 className="size-3.5 animate-spin" />}Decline</button>
      </div>
      {error && <p className="mt-1.5 text-[12px] text-[#8F2D20] dark:text-[#F0826F]">{error}</p>}
    </div>
  )
}

function ActivityRow({ item, unread, onOpen, onChanged }) {
  const { Icon } = KINDS[item.kind] || KINDS.post
  const detail = item.kind === 'scheduled' && item.when ? `${item.detail} · goes out ${scheduledFor(item.when)}` : item.detail
  const icon = (
    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full border', unread ? 'border-[#E2A100]/50 bg-bk-butter/20 text-bk-fg' : 'border-bk-line bg-bk-surface text-bk-muted')}>
      <Icon className="size-4" strokeWidth={STROKE} aria-hidden="true" />
    </span>
  )
  const text = (
    <>
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-[13.5px] font-semibold leading-snug text-bk-fg">{item.title}</span>
        {unread && <span aria-label="Unread" className="mt-1.5 size-2 shrink-0 rounded-full bg-[#E2A100]" />}
      </span>
      {detail && <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-bk-muted">{detail}</span>}
      <span className="mt-1 block text-[11.5px] text-bk-muted/90">{[item.brand, ago(item.at)].filter(Boolean).join(' · ')}</span>
    </>
  )
  const row = 'flex w-full gap-3 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bk-fg'
  // An invitation is answered in place; everything else opens what it is about.
  if (item.invitation) return (
    <li className={cn(row, unread && 'bg-bk-butter/[0.08]')}>
      {icon}
      <span className="min-w-0 flex-1">{text}<InviteActions id={item.invitation} onDone={onChanged} /></span>
    </li>
  )
  return (
    <li>
      <Link href={item.href} onClick={onOpen} className={cn(row, unread ? 'bg-bk-butter/[0.08] hover:bg-bk-butter/[0.14]' : 'hover:bg-bk-alt')}>
        {icon}<span className="min-w-0 flex-1">{text}</span>
      </Link>
    </li>
  )
}

/**
 * The notification feed: the account's activity over the last 30 days, newest first and grouped by day: posts,
 * stories and ads made, the schedule, team invitations (answered right here) and joins, credits added and designs the
 * team published. Opening it marks everything as seen; what was new stays highlighted until it closes.
 */
function NotificationFeed({ open, activity, onClose, closeButton }) {
  const [filter, setFilter] = useState('all')
  // What was unread when the feed opened, so it stays highlighted while it is open.
  const seenBefore = useRef(null)
  useEffect(() => {
    if (!open) return
    seenBefore.current = activity.seenAt ? new Date(activity.seenAt).getTime() : Date.now() - 3 * DAY
    // Seen first, then the fresh list: a list read before the seen time is stored would bring the count back.
    ;(async () => { if (activity.unread) await activity.markSeen(); activity.load() })()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([key]) => [key, key === 'all' ? activity.items.length : activity.items.filter(i => KINDS[i.kind]?.group === key).length])), [activity.items])
  const shown = filter === 'all' ? activity.items : activity.items.filter(i => KINDS[i.kind]?.group === filter)
  const days = useMemo(() => {
    const groups = []
    for (const item of shown) {
      const label = dayLabel(item.at)
      if (groups.at(-1)?.label !== label) groups.push({ label, items: [] })
      groups.at(-1).items.push(item)
    }
    return groups
  }, [shown])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
        <div className="min-w-0">
          <h2 className="font-bk-display text-[20px] font-bold tracking-[-0.02em] text-bk-fg">Notifications</h2>
          <p className="mt-0.5 text-[12.5px] text-bk-muted">What happened in your studio over the last 30 days.</p>
        </div>
        {closeButton}
      </div>
      <div className="border-b border-bk-line px-5 pb-3">
        <SegmentedTabs label="Show" value={filter} onChange={setFilter} className="w-full [&>button]:flex-1 [&>button]:justify-center" items={FILTERS.map(([key, text]) => [key, text, counts[key] || undefined])} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {!activity.loaded ? (
          <div role="status" aria-label="Loading notifications" className="space-y-2 px-3 pt-4">
            {[0, 1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-bk-alt motion-safe:animate-pulse" />)}
          </div>
        ) : !shown.length ? (
          <div className="px-6 py-14 text-center">
            <span className="mx-auto flex size-11 items-center justify-center rounded-full border border-bk-line bg-bk-surface text-bk-muted"><Bell className="size-5" strokeWidth={STROKE} aria-hidden="true" /></span>
            <p className="mt-3 font-bk-display text-[16px] font-bold tracking-[-0.02em]">{filter === 'all' ? 'Nothing yet' : 'Nothing here yet'}</p>
            <p className="mx-auto mt-1 max-w-[280px] text-[13px] leading-relaxed text-bk-muted">Posts, stories and ads you make, your schedule and team invitations show up here.</p>
          </div>
        ) : days.map(group => (
          <section key={group.label} aria-label={group.label} className="pt-3">
            <p className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-bk-muted/80">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map(item => (
                <ActivityRow key={item.id} item={item} unread={new Date(item.at).getTime() > (seenBefore.current ?? Infinity)} onOpen={onClose} onChanged={activity.load} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

const closeClass = appButton('outline', 'xs', 'size-8 shrink-0 px-0')

/**
 * The notification center on a large screen: the bell in the studio's top bar, opening the feed as a pop-up below it
 * (`side`).
 */
export function NotificationPopover({ open, onOpenChange, activity, triggerClassName = '', side = 'right' }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <NotificationBell unread={activity.unread} className={triggerClassName} />
      </PopoverTrigger>
      <PopoverContent side={side} align="end" sideOffset={side === 'bottom' ? 8 : 12} collisionPadding={16} aria-label="Notifications"
        className={cn(appLayer, 'flex h-[min(640px,calc(100vh-32px))] w-[400px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border-bk-line bg-bk-bg p-0 text-bk-fg shadow-bk-pop')}>
        <NotificationFeed open={open} activity={activity} onClose={() => onOpenChange(false)}
          closeButton={<button type="button" onClick={() => onOpenChange(false)} className={closeClass} aria-label="Close notifications"><X className="size-4" strokeWidth={STROKE} /></button>} />
      </PopoverContent>
    </Popover>
  )
}

/** The notification center on a phone: a full-height panel, opened from the bell in the header or the menu. */
export function NotificationSheet({ open, onOpenChange, activity }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={cn(appLayer, 'flex w-[420px] max-w-[94vw] flex-col gap-0 border-bk-line bg-bk-bg p-0 text-bk-fg sm:max-w-[420px] [&>button:first-child]:hidden')}>
        <SheetTitle className="sr-only">Notifications</SheetTitle>
        <SheetDescription className="sr-only">What happened in your studio over the last 30 days.</SheetDescription>
        <NotificationFeed open={open} activity={activity} onClose={() => onOpenChange(false)}
          closeButton={<SheetClose className={closeClass} aria-label="Close notifications"><X className="size-4" strokeWidth={STROKE} /></SheetClose>} />
      </SheetContent>
    </Sheet>
  )
}
