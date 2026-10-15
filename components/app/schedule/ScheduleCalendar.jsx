'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, ChevronLeft, ChevronRight, CircleAlert, Plus, Send } from 'lucide-react'
import { WEEK_STARTS_ON, calendarMonth, calendarTime, slotOnDay } from '@/lib/client/schedule'
import { cn } from '@/lib/utils'
import { Popup } from '../popup'
import { appButton, panelClass } from '../ui'
import { PostThumb, ThumbSkeleton } from '../creation/PostThumb'
import UpgradeNotice from '../billing/UpgradeNotice'

// More posts than this on a day and its cell ends with "+N more", which opens the day.
const CHIPS_PER_DAY = 3
// Ready posts listed beside the calendar before "Show all".
const READY_SHOWN = 6

const posts = n => `${n} ${n === 1 ? 'post' : 'posts'}`
// The outline style as an arbitrary property: cn (tailwind-merge) drops a plain `outline` next to `outline-2`.
const focusRing = 'focus-visible:[outline-style:solid] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bk-fg'

// How each kind of post looks on the calendar; the label is read out after the topic.
const STATUS = {
  scheduled: { label: 'scheduled', Icon: null, chip: 'bg-bk-lilac/45 text-bk-fg dark:bg-bk-lilac/[0.16]', swatch: 'bg-bk-lilac dark:bg-bk-lilac/60' },
  due: { label: 'due now, not posted yet', Icon: CircleAlert, chip: 'bg-[#F2A900]/[0.18] text-[#7A5500] dark:bg-[#F2C14E]/[0.16] dark:text-[#F2C14E]', swatch: 'bg-[#F2A900]' },
  posted: { label: 'posted', Icon: Send, chip: 'bg-bk-chip text-bk-muted', swatch: 'bg-bk-field' },
}
const LEGEND = [['scheduled', 'Scheduled'], ['due', 'Due now'], ['posted', 'Posted']]

/** Dates and times in the browser's own language. */
function useFormats() {
  return useMemo(() => {
    const format = options => new Intl.DateTimeFormat(undefined, options)
    return {
      month: format({ month: 'long', year: 'numeric' }),
      day: format({ weekday: 'long', day: 'numeric', month: 'long' }),
      weekday: format({ weekday: 'short' }),
      weekdayLong: format({ weekday: 'long' }),
      time: format({ hour: '2-digit', minute: '2-digit' }),
      when: format({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    }
  }, [])
}

/** One post on the calendar: its time and topic, coloured by where it stands. Opens the post's actions. */
function PostChip({ item, formats, onOpen, large = false, withDay = false }) {
  const { entry, state, at } = item
  const status = STATUS[state] || STATUS.scheduled
  const time = (withDay ? formats.when : formats.time).format(at)
  const topic = entry.topic || 'Untitled post'
  return (
    <button
      type="button"
      onClick={() => onOpen(entry.id)}
      title={`${time} · ${topic}`}
      className={cn(
        'pointer-events-auto flex w-full min-w-0 items-center rounded-md text-left font-semibold transition-[filter] can-hover:brightness-95',
        focusRing,
        large ? 'min-h-10 items-start gap-2 px-3 py-2 text-[13.5px]' : 'h-6 gap-1 px-1.5 text-[11.5px]',
        status.chip,
      )}
    >
      {status.Icon && <status.Icon aria-hidden="true" className={cn('shrink-0', large ? 'mt-0.5 size-4' : 'size-3')} />}
      {large ? (
        // Side panels are narrow: the topic gets the full width and the time goes under it.
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2">{topic}</span>
          <span className="mt-0.5 block text-[12px] font-medium tabular-nums opacity-80">{time}</span>
        </span>
      ) : (
        <>
          <span className="shrink-0 tabular-nums">{time}</span>
          <span className="min-w-0 truncate">{topic}</span>
        </>
      )}
      <span className="sr-only">, {status.label}</span>
    </button>
  )
}

/** A post waiting for a time: its first slide, topic and a Schedule button. */
function ReadyPost({ entry, canvas, onSchedule }) {
  const topic = entry.topic || 'Untitled post'
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-xl border border-bk-line bg-bk-surface p-2 pr-2.5">
      <div className="w-9 shrink-0">{canvas ? <PostThumb canvas={canvas} /> : <ThumbSkeleton className="bg-bk-chip" />}</div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[13.5px] font-bold leading-snug">{topic}</p>
        <p className="text-[12px] text-bk-muted">{entry.format === 'carousel' ? `Carousel · ${entry.slides} slides` : 'Single post'}</p>
      </div>
      <button type="button" onClick={onSchedule} aria-label={`Schedule: ${topic}`} className={appButton('primary', 'xs')}>
        <CalendarClock aria-hidden="true" className="size-3.5" />Schedule
      </button>
    </li>
  )
}

/**
 * A day of the month grid. The whole cell is a button that opens the day (its posts, and scheduling on it from today
 * on); the post chips sit above it with their own buttons. A past day without posts has nothing to open.
 */
function DayCell({ day, index, label, formats, onOpenDay, onOpenPost }) {
  const count = day.entries.length
  const openable = count > 0 || !day.isPast
  const shown = day.entries.slice(0, CHIPS_PER_DAY)
  return (
    <td className={cn('group relative h-[116px] border-l border-t border-bk-line p-1 align-top first:border-l-0', !day.inMonth && 'bg-bk-alt/70', day.isToday && 'bg-bk-butter/[0.1]')}>
      {openable && (
        <button
          type="button"
          data-index={index}
          aria-label={label}
          aria-current={day.isToday ? 'date' : undefined}
          onClick={() => onOpenDay(day.key)}
          className="absolute inset-0 transition-colors can-hover:bg-bk-alt/60 focus-visible:[outline-style:solid] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bk-fg"
        />
      )}
      <div className="pointer-events-none relative flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center justify-between">
          <span aria-hidden="true" className={cn('flex size-6 items-center justify-center rounded-full text-[12px] font-bold tabular-nums', day.isToday ? 'bg-bk-butter text-bk-ink' : day.inMonth && !day.isPast ? 'text-bk-fg' : 'text-bk-muted')}>
            {day.day}
          </span>
          {!day.isPast && <Plus aria-hidden="true" className="mr-0.5 size-3.5 text-bk-muted opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100" />}
        </div>
        {!openable && <span className="sr-only">{label}</span>}
        {shown.length > 0 && (
          <ul className="flex min-w-0 flex-col gap-0.5">
            {shown.map(item => <li key={item.entry.id} className="min-w-0"><PostChip item={item} formats={formats} onOpen={onOpenPost} /></li>)}
          </ul>
        )}
        {count > CHIPS_PER_DAY && (
          <button
            type="button"
            onClick={() => onOpenDay(day.key)}
            aria-label={`Show all ${posts(count)} on ${formats.day.format(day.date)}`}
            className={cn('pointer-events-auto h-5 self-start rounded px-1.5 text-[11.5px] font-bold text-bk-muted hover:text-bk-fg', focusRing)}
          >
            +{count - CHIPS_PER_DAY} more
          </button>
        )}
      </div>
    </td>
  )
}

/** Phones: the month's days that have posts (and today), one under the other, instead of the seven-column grid. */
function Agenda({ grid, formats, monthLabel, onOpenDay, onOpenPost }) {
  const days = grid.weeks.flat().filter(day => day.inMonth && (day.entries.length > 0 || day.isToday))
  return (
    <div className="sm:hidden">
      {days.length > 0 && (
        <ol className="divide-y divide-bk-line">
          {days.map(day => {
            const name = formats.day.format(day.date)
            return (
              <li key={day.key} className={cn('px-4 py-3', day.isToday && 'bg-bk-butter/[0.1]')}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="min-w-0 text-[12px] font-bold uppercase tracking-[0.12em] text-bk-muted">
                    {day.isToday && <span className="mr-1.5 rounded-full bg-bk-butter px-1.5 py-0.5 text-bk-ink">Today</span>}
                    {name}
                  </h3>
                  {!day.isPast && (
                    <button type="button" onClick={() => onOpenDay(day.key)} aria-label={`Schedule a post on ${name}`} className={appButton('quiet', 'xs')}>
                      <Plus aria-hidden="true" className="size-3.5" />Add
                    </button>
                  )}
                </div>
                {day.entries.length > 0
                  ? <ul className="mt-2 space-y-1.5">{day.entries.map(item => <li key={item.entry.id}><PostChip item={item} formats={formats} onOpen={onOpenPost} large /></li>)}</ul>
                  : <p className="mt-1 text-[13px] text-bk-muted">Nothing scheduled yet.</p>}
              </li>
            )
          })}
        </ol>
      )}
      {grid.count === 0 && <p className={cn('px-4 py-5 text-[13.5px] text-bk-muted', days.length > 0 && 'border-t border-bk-line')}>Nothing scheduled in {monthLabel}.</p>}
    </div>
  )
}

/** What a day opens: its posts, then the ready posts to schedule on it (or why that can't be done). */
function DayDetails({ day, now, formats, ready, canvases, gate, flowId, onOpenPost, onPick }) {
  const slot = day.isPast ? null : slotOnDay(day.date, now)
  return (
    <div className="space-y-5">
      {day.entries.length > 0 && (
        <ul aria-label="Posts on this day" className="space-y-1.5">
          {day.entries.map(item => <li key={item.entry.id}><PostChip item={item} formats={formats} onOpen={onOpenPost} large /></li>)}
        </ul>
      )}
      {day.isPast ? (
        <p className="text-[13.5px] text-bk-muted">This day has passed, so nothing new can be scheduled on it.</p>
      ) : gate ? (
        <UpgradeNotice error={gate} />
      ) : (
        <section aria-labelledby="calendar-day-ready">
          <h3 id="calendar-day-ready" className="text-[11px] font-bold uppercase tracking-[0.14em] text-bk-muted">Schedule a post on this day</h3>
          {ready.length > 0 ? (
            <>
              <p className="mt-1 text-[13px] text-bk-muted">It starts at {formats.time.format(new Date(slot))}. You can change the time next.</p>
              <ul className="mt-2.5 space-y-2">
                {ready.map(entry => <ReadyPost key={entry.id} entry={entry} canvas={canvases[entry.canvasId]} onSchedule={() => onPick(entry, slot)} />)}
              </ul>
            </>
          ) : (
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-bk-muted">
              Nothing is ready to schedule. Approve a post in Creation and it shows up here.{' '}
              <Link href={`/app/${flowId}/creation`} className="font-semibold text-bk-fg underline decoration-bk-field underline-offset-4 hover:decoration-bk-fg">Go to Creation</Link>
            </p>
          )}
        </section>
      )}
    </div>
  )
}

function SideSection({ id, title, count, description, className = '', children }) {
  return (
    <section aria-labelledby={id} className={cn('rounded-2xl border p-4', className)}>
      <div className="flex items-baseline gap-2">
        <h2 id={id} className="font-bk-display text-[16px] font-bold tracking-[-0.02em]">{title}</h2>
        <span className="text-[13px] font-semibold tabular-nums text-bk-muted">{count}</span>
      </div>
      {description && <p className="mt-1 text-[12.5px] leading-relaxed text-bk-muted">{description}</p>}
      {children}
    </section>
  )
}

/**
 * The schedule as a month calendar (an agenda of the month on phones), with the posts that are due and the ones
 * ready for a time beside it. A post opens its actions in a popup: `renderPost(entry)` is the list's row for it, and
 * its Edit opens the schedule dialog on top. A day from today on opens the ready posts to schedule on it
 * (`onSchedule(entry, at, returnFocus)` opens the schedule dialog at that time; without `at`, at the usual
 * suggestion), or on plans without scheduling, the upgrade notice (`gate`, from useSchedulingGate).
 */
export function ScheduleCalendar({ entries, groups, now, canvases, gate, flowId, renderPost, onSchedule }) {
  const formats = useFormats()
  const [month, setMonth] = useState(() => { const at = new Date(now); return new Date(at.getFullYear(), at.getMonth(), 1) })
  // Each popup keeps what it shows while it fades out, so it is closed with `open` and not by clearing it.
  const [dayPopup, setDayPopup] = useState({ key: null, open: false })
  const [postPopup, setPostPopup] = useState({ id: null, open: false })
  const [announcement, setAnnouncement] = useState('')
  const [allReady, setAllReady] = useState(false)
  const table = useRef(null)
  // Popups opened without a trigger don't return focus by themselves, so each one remembers what opened it. Leaving
  // the day popup for a post or the schedule dialog hands focus on instead, and a post opened from the day popup
  // goes back to whatever opened the day.
  const dayOpener = useRef(null)
  const postOpener = useRef(null)
  const handingOver = useRef(false)
  const refocus = element => { if (element?.isConnected) element.focus() }

  const grid = useMemo(() => calendarMonth(entries, month, { weekStartsOn: WEEK_STARTS_ON, now }), [entries, month, now])
  const days = grid.weeks.flat()
  const monthLabel = formats.month.format(grid.month)
  const dayLabel = d => `${d.isToday ? 'Today, ' : ''}${formats.day.format(d.date)}, ${d.entries.length ? posts(d.entries.length) : 'no posts'}`

  const go = delta => {
    const base = delta === 0 ? new Date(now) : month
    const next = new Date(base.getFullYear(), base.getMonth() + delta, 1)
    const { count } = calendarMonth(entries, next, { weekStartsOn: WEEK_STARTS_ON, now })
    setMonth(next)
    setAnnouncement(`${formats.month.format(next)}, ${count ? posts(count) : 'no posts'}`)
  }

  const openDay = key => {
    dayOpener.current = document.activeElement
    setDayPopup({ key, open: true })
  }
  const closeDay = () => setDayPopup(current => ({ ...current, open: false }))
  const leaveDay = () => {
    const open = dayPopup.open
    if (open) { handingOver.current = true; closeDay() }
    return open
  }
  const openPost = id => {
    postOpener.current = leaveDay() ? dayOpener.current : document.activeElement
    setPostPopup({ id, open: true })
  }
  const closePost = () => setPostPopup(current => ({ ...current, open: false }))
  const pick = (entry, at) => { leaveDay(); onSchedule(entry, at, dayOpener.current) }

  // Arrow keys move between days, as in a date picker; Tab still reaches every day and post.
  const moveFocus = e => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    const from = e.target?.dataset?.index
    if (!step || from === undefined) return
    e.preventDefault()
    for (let i = Number(from) + step; i >= 0 && i < days.length; i += step) {
      const next = table.current?.querySelector(`[data-index="${i}"]`)
      if (next) return next.focus()
    }
  }

  const day = dayPopup.key ? days.find(d => d.key === dayPopup.key) : null
  const post = postPopup.id ? entries.find(e => e.id === postPopup.id) : null
  const postAt = calendarTime(post)
  const ready = groups.approved
  const readyShown = allReady ? ready : ready.slice(0, READY_SHOWN)

  return (
    <div className="mt-7 grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start">
      <div className="flex min-w-0 flex-col gap-4 xl:order-last">
        {groups.due.length > 0 && (
          <SideSection id="calendar-due" title="Due now" count={groups.due.length} description="Their time has come. Post them, then mark them as posted." className="border-[#F2A900]/40 bg-[#F2A900]/[0.08]">
            <ul className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-1">
              {groups.due.map(entry => (
                <li key={entry.id} className="min-w-0">
                  <PostChip item={{ entry, state: 'due', at: calendarTime(entry) }} formats={formats} onOpen={openPost} large withDay />
                </li>
              ))}
            </ul>
          </SideSection>
        )}
        <SideSection
          id="calendar-ready"
          title="Ready to schedule"
          count={ready.length}
          className="border-bk-line bg-bk-surface"
          description={ready.length ? `Approved and waiting for a time.${gate ? '' : ' Pick a day on the calendar, or schedule one here.'}` : null}
        >
          {ready.length > 0 ? (
            <>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-1">
                {readyShown.map(entry => <ReadyPost key={entry.id} entry={entry} canvas={canvases[entry.canvasId]} onSchedule={() => onSchedule(entry)} />)}
              </ul>
              {ready.length > READY_SHOWN && (
                <button type="button" aria-expanded={allReady} onClick={() => setAllReady(value => !value)} className={appButton('quiet', 'xs', 'mt-2')}>
                  {allReady ? 'Show fewer' : `Show all ${ready.length}`}
                </button>
              )}
            </>
          ) : (
            <p className="mt-1 text-[13px] leading-relaxed text-bk-muted">Nothing is waiting for a time. Approve a post in Creation and it shows up here, ready to schedule.</p>
          )}
        </SideSection>
      </div>

      <section aria-labelledby="calendar-month" className={cn(panelClass, 'min-w-0 overflow-hidden')}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-bk-line px-4 py-3 sm:px-5">
          <h2 id="calendar-month" className="font-bk-display text-[19px] font-bold tracking-[-0.02em] first-letter:uppercase">{monthLabel}</h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => go(0)} className={appButton('outline', 'sm', 'mr-1')}>Today</button>
            <button type="button" onClick={() => go(-1)} aria-label="Previous month" className={appButton('quiet', 'sm', 'px-2')}><ChevronLeft aria-hidden="true" className="size-4" /></button>
            <button type="button" onClick={() => go(1)} aria-label="Next month" className={appButton('quiet', 'sm', 'px-2')}><ChevronRight aria-hidden="true" className="size-4" /></button>
          </div>
        </div>
        <p aria-live="polite" className="sr-only">{announcement}</p>

        <div className="hidden sm:block">
          <table ref={table} onKeyDown={moveFocus} className="w-full table-fixed border-collapse">
            <caption className="sr-only">{monthLabel}. Choose a day to see its posts or to schedule one; the arrow keys move between days.</caption>
            <thead>
              <tr>
                {grid.weeks[0].map(d => (
                  <th key={d.weekday} scope="col" className="bg-bk-alt/50 px-2 py-2 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-bk-muted">
                    <span aria-hidden="true" className="block truncate">{formats.weekday.format(d.date)}</span>
                    <span className="sr-only">{formats.weekdayLong.format(d.date)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.weeks.map((week, w) => (
                <tr key={week[0].key}>
                  {week.map((d, i) => <DayCell key={d.key} day={d} index={w * 7 + i} label={dayLabel(d)} formats={formats} onOpenDay={openDay} onOpenPost={openPost} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Agenda grid={grid} formats={formats} monthLabel={monthLabel} onOpenDay={openDay} onOpenPost={openPost} />

        <div aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1 border-t border-bk-line px-4 py-2.5 text-[12px] text-bk-muted sm:px-5">
          {LEGEND.map(([state, text]) => <span key={state} className="inline-flex items-center gap-1.5"><span className={cn('size-2.5 rounded-full', STATUS[state].swatch)} />{text}</span>)}
        </div>
      </section>

      {day && (
        <Popup
          open={dayPopup.open}
          onOpenChange={value => !value && closeDay()}
          title={`${day.isToday ? 'Today, ' : ''}${formats.day.format(day.date)}`}
          description={day.entries.length ? posts(day.entries.length) : 'Nothing scheduled yet.'}
          onCloseAutoFocus={e => {
            e.preventDefault()
            if (!handingOver.current) refocus(dayOpener.current)
            handingOver.current = false
          }}
        >
          <DayDetails day={day} now={now} formats={formats} ready={ready} canvases={canvases} gate={gate} flowId={flowId} onOpenPost={openPost} onPick={pick} />
        </Popup>
      )}
      {post && (
        <Popup
          open={postPopup.open}
          onOpenChange={value => !value && closePost()}
          title={postAt ? `${formats.day.format(postAt)}, ${formats.time.format(postAt)}` : 'Needs a time'}
          onCloseAutoFocus={e => { e.preventDefault(); refocus(postOpener.current) }}
        >
          <ul>{renderPost(post)}</ul>
        </Popup>
      )}
    </div>
  )
}
