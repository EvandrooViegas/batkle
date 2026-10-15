'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, BellRing, CalendarClock, CalendarDays, Copy, Download, Info, List, Loader2, Share2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { PLATFORMS, defaultScheduleView, groupSchedule, scheduleState } from '@/lib/client/schedule'
import { cn } from '@/lib/utils'
import { usePopup } from '../popup'
import { EmptyState, Notice, PageHeader, SegmentedTabs, appButton, pageInner, pageShell, panelClass } from '../ui'
import { PostThumb, ThumbSkeleton, editorHref } from '../creation/PostThumb'
import UpgradeNotice from '../billing/UpgradeNotice'
import { ScheduleCalendar } from './ScheduleCalendar'
import { ScheduleDialog } from './ScheduleDialog'
import { ScheduleLine } from './ScheduleStatus'
import { PLATFORM_LINKS } from './platforms'
import { canPostFromPhone, copyCaption, downloadSlides, postNow, slideFiles } from './postFiles'
import { useSchedulingGate } from './schedulingGate'
import { useSchedule } from './useSchedule'

/** Latest saved canvases for the posts on the page, for their thumbnails; loaded once each. */
function useCanvases(ids) {
  const [canvases, setCanvases] = useState({})
  const key = [...new Set(ids)].sort().join(',')
  useEffect(() => {
    const missing = key ? key.split(',').filter(id => !(id in canvases)) : []
    if (!missing.length) return
    let live = true
    Promise.all(missing.map(id => fetch(`/api/canvases/${id}`).then(r => (r.ok ? r.json() : null)).catch(() => null).then(canvas => [id, canvas])))
      .then(pairs => live && setCanvases(current => ({ ...current, ...Object.fromEntries(pairs) })))
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return canvases
}

// The view this browser last chose (calendar or list); storage can be missing or blocked, which just means no choice.
const VIEW_KEY = 'batkle:schedule-view'
function savedView() {
  try {
    const view = window.localStorage.getItem(VIEW_KEY)
    return view === 'calendar' || view === 'list' ? view : null
  } catch {
    return null
  }
}
function saveView(view) {
  try { window.localStorage.setItem(VIEW_KEY, view) } catch {}
}

/** "Today", "Tomorrow", else "Thursday 16 October", in the viewer's own language. */
function dayLabel(iso, now) {
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const at = new Date(iso)
  const days = Math.round((startOfDay(at) - startOfDay(new Date(now))) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(at)
}

function Section({ id, title, description, count, children }) {
  return (
    <section aria-labelledby={id} className="mt-9 first:mt-7">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={id} className="font-bk-display text-[19px] font-bold tracking-[-0.02em]">{title}</h2>
        <span className="text-[13px] font-semibold tabular-nums text-bk-muted">{count}</span>
        {description && <p className="w-full text-[13.5px] text-bk-muted">{description}</p>}
      </div>
      {children}
    </section>
  )
}

/**
 * One approved post: its first slide, where it stands, and the actions that fit its state. A due post, or the one a
 * reminder linked to (`highlight`), offers everything to post it by hand: Post now on phones that can share files,
 * Download, Copy caption and marking it posted. As a `card` (the calendar's post popup) it is stacked, and a scheduled
 * post offers all of that before it is due too.
 */
function ScheduleRow({ entry, canvas, state, busy, highlight, card = false, shareable, ready, onEdit, onDownload, onCopy, onPostNow, onPosted, onUnpost, onRemove }) {
  const href = editorHref(canvas || { id: entry.canvasId })
  const working = action => busy === `${entry.id}:${action}`
  const any = Boolean(busy?.startsWith(`${entry.id}:`))
  const handOut = state === 'due' || (highlight && state !== 'posted') || (card && state === 'scheduled')
  return (
    <li
      id={card ? undefined : `post-${entry.id}`}
      tabIndex={highlight ? -1 : undefined}
      aria-label={highlight ? `From your reminder: ${entry.topic || 'Untitled post'}` : undefined}
      className={cn('flex flex-col outline-none', card ? 'gap-4' : 'gap-3 px-4 py-3.5 sm:px-5 md:flex-row md:items-center md:gap-5', highlight && 'bg-bk-butter/[0.12] shadow-[inset_4px_0_0_0_#FFD84D]')}
    >
      <div className="flex min-w-0 flex-1 gap-3.5 sm:gap-4">
        <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open in the editor: ${entry.topic}`} className="block w-[64px] shrink-0 rounded-md transition-transform duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg can-hover:-translate-y-0.5 sm:w-[80px]">
          {canvas ? <PostThumb canvas={canvas} className="shadow-bk-card" /> : <ThumbSkeleton className="bg-bk-chip" />}
        </a>
        <div className="min-w-0 flex-1">
          {highlight && (
            <p className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#9A6B00] dark:text-[#F2C14E]">
              <BellRing aria-hidden="true" className="size-3.5" />From your reminder
            </p>
          )}
          <p className="text-[12px] font-semibold text-bk-muted">{entry.format === 'carousel' ? `Carousel · ${entry.slides} slides` : 'Single post'}</p>
          <h3 className="mt-0.5 line-clamp-2 font-bk-display text-[15px] font-bold leading-snug tracking-[-0.015em]">{entry.topic || 'Untitled post'}</h3>
          <ScheduleLine state={state} entry={entry} className="mt-1.5" />
          {entry.caption && <p className="mt-1 line-clamp-1 text-[12.5px] text-bk-muted">{entry.caption}</p>}
          {handOut && entry.platforms?.length > 0 && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 text-[12.5px] font-semibold">
              {PLATFORMS.filter(p => entry.platforms.includes(p.id)).map(p => (
                <a key={p.id} href={PLATFORM_LINKS[p.id]} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline decoration-bk-field underline-offset-4 hover:decoration-bk-fg">
                  Open {p.label}<ArrowUpRight aria-hidden="true" className="size-3.5" />
                </a>
              ))}
            </p>
          )}
        </div>
      </div>

      <div className={cn('flex flex-wrap items-center gap-2', !card && 'md:shrink-0 md:justify-end')}>
        {handOut && (
          <>
            {shareable && (
              <button type="button" onClick={onPostNow} disabled={any} className={appButton('primary', 'sm')}>
                {working('share') ? <Loader2 className="size-3.5 animate-spin" /> : <Share2 className="size-3.5" />}
                {working('share') ? 'Getting slides…' : ready ? 'Share now' : 'Post now'}
              </button>
            )}
            <button type="button" onClick={onDownload} disabled={any} className={appButton('outline', 'sm')}>
              {working('download') ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              {entry.format === 'carousel' ? 'Download slides' : 'Download'}
            </button>
            <button type="button" onClick={onCopy} className={appButton('outline', 'sm')}><Copy className="size-3.5" />Copy caption</button>
            <button type="button" onClick={onPosted} disabled={any} className={appButton(shareable ? 'outline' : 'primary', 'sm')}>
              {working('posted') && <Loader2 className="size-3.5 animate-spin" />}{highlight || card ? 'I posted it' : 'Mark as posted'}
            </button>
            <button type="button" onClick={onEdit} disabled={any} className={appButton('quiet', 'sm')}>{state === 'approved' ? 'Schedule' : card ? 'Edit schedule' : 'Edit'}</button>
          </>
        )}
        {!handOut && state === 'approved' && (
          <>
            <button type="button" onClick={onEdit} disabled={any} className={appButton('primary', 'sm')}><CalendarClock className="size-3.5" />Schedule</button>
            <button type="button" onClick={onRemove} disabled={any} className={appButton('quiet', 'sm', 'text-bk-muted hover:text-bk-fg')}>Remove</button>
          </>
        )}
        {!handOut && state === 'scheduled' && (
          <>
            <button type="button" onClick={onEdit} disabled={any} className={appButton('outline', 'sm')}><CalendarClock className="size-3.5" />Edit schedule</button>
            <button type="button" onClick={onDownload} disabled={any} title="Download the slides now" aria-label="Download the slides now" className={appButton('quiet', 'sm', 'px-2')}>
              {working('download') ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            </button>
          </>
        )}
        {state === 'posted' && (
          <button type="button" onClick={onUnpost} disabled={any} className={appButton('quiet', 'sm', 'text-bk-muted hover:text-bk-fg')}>
            {working('unpost') ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}Not posted yet
          </button>
        )}
      </div>
    </li>
  )
}

/**
 * The brand's approved posts on their way out: due now, waiting for a time, upcoming by day, and posted.
 * Batkle doesn't publish by itself, so a due post comes with its slides and caption to post by hand. A reminder
 * links here with `?post=<id>`: that post is scrolled to, highlighted, and its slides are got ready to share.
 * The same posts can be seen as a month calendar (ScheduleCalendar) or as this list; each browser keeps its choice.
 */
export default function SchedulePage({ flowId, brandName = 'Your brand' }) {
  const schedule = useSchedule(flowId)
  const popup = usePopup()
  const gate = useSchedulingGate()
  const [now, setNow] = useState(() => Date.now())
  // The post in the schedule dialog: `{ id, at, returnFocus }`, where `at` is the time it starts at when it has none.
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(null)
  const [focusId, setFocusId] = useState(null)
  const [shareable, setShareable] = useState(false)
  // Posts whose slides finished preparing after the browser stopped counting the tap: the next tap shares at once.
  const [ready, setReady] = useState({})
  const [postedBefore, setPostedBefore] = useState(false)
  const [viewChoice, setViewChoice] = useState(null)

  // Read in the browser only: whether this device shares files, the post a reminder linked to, and the saved view.
  useEffect(() => {
    const post = new URLSearchParams(window.location.search).get('post')
    setShareable(canPostFromPhone())
    setFocusId(post)
    // A reminder's link opens the list, where its post waits with everything to post it, whatever was chosen before.
    setViewChoice(post ? 'list' : savedView())
  }, [])

  // Without a saved choice the first view follows what there is, then stays put while posts get scheduled.
  useEffect(() => {
    if (schedule.loaded && !schedule.loadError) setViewChoice(current => current || defaultScheduleView(schedule.entries))
  }, [schedule.loaded]) // eslint-disable-line react-hooks/exhaustive-deps
  const view = viewChoice || defaultScheduleView(schedule.entries)
  const chooseView = next => {
    setViewChoice(next)
    saveView(next)
  }

  const focusEntry = focusId ? schedule.entries.find(e => e.id === focusId) || null : null
  const scrolled = useRef(false)
  useEffect(() => {
    if (!schedule.loaded || !focusEntry || scrolled.current) return
    scrolled.current = true
    setPostedBefore(focusEntry.status === 'posted')
    requestAnimationFrame(() => {
      const row = document.getElementById(`post-${focusEntry.id}`)
      if (!row) return
      row.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      row.focus({ preventScroll: true })
    })
    // Rendered ahead, so Post now opens the share sheet straight away.
    if (focusEntry.status !== 'posted' && canPostFromPhone()) slideFiles(focusEntry).catch(() => {})
  }, [schedule.loaded, focusEntry])

  // Upcoming posts move to "Due now" while the page stays open.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])

  const groups = useMemo(() => groupSchedule(schedule.entries, now), [schedule.entries, now])
  const canvases = useCanvases(schedule.entries.map(e => e.canvasId))
  const editingEntry = schedule.entries.find(e => e.id === editing?.id) || null

  const run = async (entry, action, task, success) => {
    setBusy(`${entry.id}:${action}`)
    try {
      await task()
      if (success) toast.success(success)
    } catch (error) {
      toast.error(error.message || 'Something went wrong. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const remove = async entry => {
    const removed = await popup.confirm({
      title: 'Remove from the schedule?',
      description: `“${entry.topic || 'This post'}” stays in Creation; it just isn’t approved any more. You can approve it again later.`,
      confirmLabel: 'Remove',
      busyLabel: 'Removing…',
      action: () => schedule.remove(entry.id),
    })
    if (removed) toast.success('Removed from the schedule')
  }

  const share = entry => run(entry, 'share', async () => {
    const { result, copied } = await postNow(entry)
    if (result === 'ready') {
      setReady(current => ({ ...current, [entry.id]: true }))
      toast('The slides are ready. Tap Share now to post them.')
      return
    }
    setReady(({ [entry.id]: _, ...rest }) => rest)
    if (result === 'shared') toast.success(copied ? 'Caption copied. Paste it in when you post.' : 'Shared. Copy the caption before you post.')
    else if (copied) toast('Caption copied.')
  })

  // Opens the schedule dialog; it has no trigger, so it is told where focus goes back to.
  const edit = (entry, at = null, returnFocus = document.activeElement) => setEditing({ id: entry.id, at, returnFocus })

  // A list row, or as a `card`, the same post with the same actions in the calendar's post popup.
  const row = (entry, card = false) => (
    <ScheduleRow
      key={entry.id}
      entry={entry}
      canvas={canvases[entry.canvasId]}
      state={scheduleState(entry, null, now)}
      busy={busy}
      highlight={!card && entry.id === focusId}
      card={card}
      shareable={shareable}
      ready={Boolean(ready[entry.id])}
      onEdit={() => edit(entry)}
      onPostNow={() => share(entry)}
      onDownload={() => run(entry, 'download', () => downloadSlides(entry))}
      onCopy={() => copyCaption(entry).then(() => toast.success('Caption copied'), () => toast.error('The caption could not be copied'))}
      onPosted={() => run(entry, 'posted', () => schedule.update(entry.id, { status: 'posted' }), 'Marked as posted')}
      onUnpost={() => run(entry, 'unpost', () => schedule.update(entry.id, { status: 'approved' }), 'Moved back to Needs a time')}
      onRemove={() => remove(entry)}
    />
  )
  const list = entries => <ul className={cn(panelClass, 'mt-3 divide-y divide-bk-line overflow-hidden')}>{entries.map(entry => row(entry))}</ul>

  // Upcoming posts in runs of the same day.
  const days = []
  for (const entry of groups.upcoming) {
    const label = dayLabel(entry.scheduledAt, now)
    if (days.at(-1)?.label === label) days.at(-1).entries.push(entry)
    else days.push({ label, entries: [entry] })
  }

  const empty = schedule.loaded && !schedule.loadError && schedule.entries.length === 0
  const hasPosts = schedule.loaded && !schedule.loadError && schedule.entries.length > 0

  return (
    <div className={pageShell}>
      <div className={pageInner}>
        <PageHeader
          eyebrow={`${brandName} · Schedule`}
          title="Schedule"
          description="Approved posts and when they go out on Instagram and TikTok."
          actions={(
            <>
              {hasPosts && (
                <SegmentedTabs
                  label="Show the schedule as"
                  value={view}
                  onChange={chooseView}
                  items={[
                    ['calendar', <><CalendarDays aria-hidden="true" className="size-3.5" />Calendar</>],
                    ['list', <><List aria-hidden="true" className="size-3.5" />List</>],
                  ]}
                />
              )}
              <Link href={`/app/${flowId}/creation`} className={appButton('outline', 'sm')}>Approve more in Creation</Link>
            </>
          )}
        />

        <p className="mt-5 flex max-w-[760px] gap-2.5 rounded-xl border border-bk-line bg-bk-surface px-3.5 py-3 text-[13px] leading-relaxed text-bk-fg/80">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-bk-muted" />
          <span>
            Batkle doesn’t post to Instagram or TikTok for you. When a post’s time comes, it reminds you and the post moves to Due now, with its slides and caption ready.{' '}
            <Link href="/app/settings#notifications" className="font-semibold underline decoration-bk-field underline-offset-4 hover:decoration-bk-fg">Reminder settings</Link>
          </span>
        </p>
        {gate && <UpgradeNotice error={gate} className="mt-3 max-w-[760px]" />}
        {schedule.loaded && !schedule.loadError && focusId && !focusEntry && (
          <Notice className="mt-3 max-w-[760px]">That post isn’t on the schedule any more.</Notice>
        )}
        {postedBefore && focusEntry?.status === 'posted' && (
          <Notice tone="success" className="mt-3 max-w-[760px]">You’ve already marked “{focusEntry.topic || 'this post'}” as posted.</Notice>
        )}

        {!schedule.loaded && (
          <div role="status" aria-label="Loading the schedule" className="mt-7 space-y-3">
            {[0, 1, 2].map(i => <div key={i} className="h-[112px] rounded-2xl bg-bk-surface motion-safe:animate-pulse" />)}
          </div>
        )}
        {schedule.loadError && (
          <Notice tone="error" className="mt-7 flex flex-wrap items-center justify-between gap-3">
            <span>{schedule.loadError}</span>
            <button type="button" onClick={schedule.reload} className={appButton('outline', 'sm')}>Try again</button>
          </Notice>
        )}
        {empty && (
          <EmptyState
            icon={CalendarClock}
            title="Nothing approved yet"
            className="mt-7"
            action={<Link href={`/app/${flowId}/creation`} className={appButton('primary', 'md')}>Go to Creation</Link>}
          >
            Approve a finished post in Creation and it shows up here, ready to schedule for Instagram, TikTok or both.
          </EmptyState>
        )}

        {hasPosts && view === 'calendar' ? (
          <div role="tabpanel" aria-label="Calendar">
            <ScheduleCalendar
              entries={schedule.entries}
              groups={groups}
              now={now}
              canvases={canvases}
              gate={gate}
              flowId={flowId}
              renderPost={entry => row(entry, true)}
              onSchedule={edit}
            />
          </div>
        ) : (
          // The list as it always was. Its first section now gets `first:mt-7`, so the wrapper's padding (not a margin,
          // which would collapse into it) keeps the gap above at 36px.
          <div role={hasPosts ? 'tabpanel' : undefined} aria-label={hasPosts ? 'List' : undefined} className="pt-2">
            {groups.due.length > 0 && (
              <Section id="schedule-due" title="Due now" count={groups.due.length} description="Their time has come. Post them, then mark them as posted.">
                {list(groups.due)}
              </Section>
            )}
            {groups.approved.length > 0 && (
              <Section id="schedule-approved" title="Needs a time" count={groups.approved.length} description="Approved, waiting for a date and a platform.">
                {list(groups.approved)}
              </Section>
            )}
            {groups.upcoming.length > 0 && (
              <Section id="schedule-upcoming" title="Upcoming" count={groups.upcoming.length}>
                {days.map(day => (
                  <div key={day.label} className="mt-4">
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-bk-muted">{day.label}</h3>
                    {list(day.entries)}
                  </div>
                ))}
              </Section>
            )}
            {groups.posted.length > 0 && (
              <Section id="schedule-posted" title="Posted" count={groups.posted.length}>
                {list(groups.posted.slice(0, 30))}
              </Section>
            )}
          </div>
        )}
      </div>

      <ScheduleDialog
        open={!!editingEntry}
        onOpenChange={open => !open && setEditing(null)}
        entry={editingEntry}
        canvas={editingEntry ? canvases[editingEntry.canvasId] : null}
        defaultAt={editing?.at || null}
        returnFocus={editing?.returnFocus || null}
        onSave={changes => schedule.update(editingEntry.id, changes)}
        onUnschedule={() => schedule.update(editingEntry.id, { status: 'approved' })}
      />
    </div>
  )
}
