'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, Check, Info, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { CAPTION_MAX, HASHTAG_MAX, PLATFORMS, formatWhen, hashtagCount, scheduleProblem, suggestedTime, toInputs, toScheduledAt } from '@/lib/client/schedule'
import { cn } from '@/lib/utils'
import { appField } from '../field'
import { fieldLabel } from '../onboarding/styles'
import { PostThumb } from '../creation/PostThumb'
import UpgradeNotice from '../billing/UpgradeNotice'
import { Eyebrow, appButton, appLayer } from '../ui'
import { PlatformIcon } from './platforms'
import { useSchedulingGate } from './schedulingGate'

/** Quick times offered under the date and time fields, relative to now. */
function quickTimes(now = new Date()) {
  const at = (days, hours) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(hours, 0, 0, 0); return d.toISOString() }
  const nextMonday = (8 - now.getDay()) % 7 || 7
  return [
    { label: 'Tomorrow, 10:00', value: at(1, 10) },
    { label: 'Tomorrow, 18:00', value: at(1, 18) },
    { label: 'Monday, 10:00', value: at(nextMonday, 10) },
  ]
}

/**
 * Schedules an approved post: where it goes (Instagram, TikTok or both), when, and with which caption.
 * `onSave(changes)` saves the entry and throws with a message for people; `onUnschedule` (for a scheduled post)
 * takes the time off again. Scheduling is part of the paid plans: on Free the dialog says so with an upgrade button
 * (from the plan up front, or from the API’s 402 when saving). `defaultAt` (ISO) is where a post without a time
 * starts, such as the day picked on the calendar. The dialog has no trigger to return focus to, so `returnFocus` (an
 * element, such as the button that opened it) is where focus goes on closing, when it is still on the page.
 */
export function ScheduleDialog({ open, onOpenChange, entry, canvas, onSave, onUnschedule, defaultAt = null, returnFocus = null }) {
  const [platforms, setPlatforms] = useState([])
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [caption, setCaption] = useState('')
  const [error, setError] = useState('')
  const [upgrade, setUpgrade] = useState(null)
  const [saving, setSaving] = useState('')
  const gate = useSchedulingGate(open)

  // Each opening starts from what is saved: its time, else the day it was opened for, else tomorrow at 10:00; its
  // platforms, else Instagram.
  useEffect(() => {
    if (!open || !entry) return
    const inputs = toInputs(entry.scheduledAt || defaultAt || suggestedTime())
    setPlatforms(entry.platforms?.length ? entry.platforms : ['instagram'])
    setDate(inputs.date)
    setTime(inputs.time)
    setCaption(entry.caption || '')
    setError('')
    setUpgrade(null)
    setSaving('')
  }, [open, entry?.id, defaultAt]) // eslint-disable-line react-hooks/exhaustive-deps

  const timeZone = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return '' } }, [])
  const quick = useMemo(() => (open ? quickTimes() : []), [open])
  if (!entry) return null

  const scheduled = entry.status === 'scheduled'
  const blocked = upgrade || gate
  const scheduledAt = toScheduledAt(date, time)
  const tags = hashtagCount(caption)
  const today = toInputs(new Date().toISOString()).date

  const toggle = id => {
    setError('')
    setPlatforms(current => (current.includes(id) ? current.filter(p => p !== id) : [...current, id]))
  }

  const save = async e => {
    e.preventDefault()
    const problem = scheduleProblem({ platforms, scheduledAt, caption })
    if (problem) return setError(problem)
    setSaving('save')
    try {
      await onSave({ platforms, scheduledAt, timeZone, caption, status: 'scheduled' })
      toast.success(`Scheduled for ${formatWhen(scheduledAt)}`)
      onOpenChange(false)
    } catch (err) {
      // A plan limit gets the upgrade prompt rather than "try again".
      if (err.billing) setUpgrade(err)
      else setError(err.message)
      setSaving('')
    }
  }

  const unschedule = async () => {
    setSaving('unschedule')
    try {
      await onUnschedule()
      toast.success('Taken off the schedule. It stays approved.')
      onOpenChange(false)
    } catch (err) {
      setError(err.message)
      setSaving('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={value => !saving && onOpenChange(value)}>
      <DialogContent
        onCloseAutoFocus={e => { if (returnFocus?.isConnected) { e.preventDefault(); returnFocus.focus() } }}
        className={cn(appLayer, 'max-h-[92vh] w-[calc(100vw-24px)] max-w-[820px] gap-0 overflow-y-auto p-0 md:grid md:grid-cols-[280px_minmax(0,1fr)] md:overflow-hidden')}
      >
        <div className="hidden flex-col items-center justify-center gap-3 bg-bk-alt p-6 md:flex">
          {canvas ? <PostThumb canvas={canvas} className="w-full rounded-xl shadow-bk-pop" /> : <div className="aspect-[1080/1350] w-full rounded-xl bg-bk-chip" />}
          <p className="text-[12.5px] font-semibold text-bk-muted">{entry.format === 'carousel' ? `Carousel · ${entry.slides} slides` : 'Single post'}</p>
        </div>

        <form noValidate onSubmit={save} className="flex flex-col p-5 sm:p-6 md:max-h-[92vh] md:overflow-y-auto">
          <Eyebrow>{scheduled ? 'Edit schedule' : 'Approved · Schedule it'}</Eyebrow>
          <DialogTitle className="mt-2 pr-8 font-bk-display text-[20px] font-bold leading-snug tracking-[-0.025em]">{entry.topic || 'Your post'}</DialogTitle>
          <DialogDescription className="sr-only">Choose where and when this post goes out, and its caption.</DialogDescription>

          <fieldset className="mt-5">
            <legend className={fieldLabel}>Where</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {PLATFORMS.map(p => {
                const on = platforms.includes(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(p.id)}
                    className={cn(
                      'relative flex h-14 items-center gap-3 rounded-xl border bg-bk-surface px-3.5 text-left text-[14.5px] font-bold transition-[border-color,box-shadow] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg',
                      on ? 'border-bk-fg shadow-[0_0_0_3px_rgb(255_216_77/0.55)]' : 'border-bk-field hover:border-bk-fg/50',
                    )}
                  >
                    <span aria-hidden="true" className={cn('flex size-8 items-center justify-center rounded-lg', on ? 'bg-bk-fg text-bk-bg' : 'bg-bk-alt text-bk-fg')}>
                      <PlatformIcon id={p.id} className="size-[17px]" />
                    </span>
                    {p.label}
                    {on && <Check aria-hidden="true" className="absolute right-3 top-1/2 size-4 -translate-y-1/2" strokeWidth={3} />}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <fieldset className="mt-5">
            <legend className={fieldLabel}>When</legend>
            <div className="mt-2 grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-2">
              <label className="sr-only" htmlFor="schedule-date">Date</label>
              <input id="schedule-date" type="date" min={today} value={date} onChange={e => { setDate(e.target.value); setError('') }} className={appField('cursor-pointer')} />
              <label className="sr-only" htmlFor="schedule-time">Time</label>
              <input id="schedule-time" type="time" step={300} value={time} onChange={e => { setTime(e.target.value); setError('') }} className={appField('cursor-pointer')} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {quick.map(option => {
                const inputs = toInputs(option.value)
                const chosen = inputs.date === date && inputs.time === time
                return (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => { setDate(inputs.date); setTime(inputs.time); setError('') }}
                    className={cn('h-8 rounded-full border px-3 text-[12.5px] font-semibold transition-colors', chosen ? 'border-bk-fg bg-bk-fg text-bk-bg' : 'border-bk-field hover:border-bk-fg/50')}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            {timeZone && <p className="mt-2 text-[12.5px] text-bk-muted">Times are in your time zone ({timeZone.replace(/_/g, ' ')}).</p>}
          </fieldset>

          <div className="mt-5">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="schedule-caption" className={fieldLabel}>Caption</label>
              <span className={cn('text-[12px] tabular-nums', caption.length > CAPTION_MAX || (platforms.includes('instagram') && tags > HASHTAG_MAX) ? 'font-bold text-[#C2412F] dark:text-[#F0826F]' : 'text-bk-muted')}>
                {caption.length.toLocaleString('en-US')} / {CAPTION_MAX.toLocaleString('en-US')}{platforms.includes('instagram') ? ` · ${tags} / ${HASHTAG_MAX} hashtags` : ''}
              </span>
            </div>
            <textarea
              id="schedule-caption"
              rows={6}
              value={caption}
              onChange={e => { setCaption(e.target.value); setError('') }}
              className={appField('mt-2 h-auto resize-y py-2.5 text-[14px] leading-relaxed')}
            />
          </div>

          <p className="mt-4 flex gap-2.5 rounded-xl border border-bk-line bg-bk-alt/60 px-3.5 py-3 text-[12.5px] leading-relaxed text-bk-fg/80">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-bk-muted" />
            <span>
              Batkle doesn’t post for you. At the time you pick, it reminds you with the slides and caption ready to post.{' '}
              <Link href="/app/settings#notifications" className="font-semibold underline decoration-bk-field underline-offset-4 hover:decoration-bk-fg">Reminder settings</Link>
            </span>
          </p>

          {blocked && <UpgradeNotice error={blocked} className="mt-4" />}
          {error && <p role="alert" className="mt-4 text-[14px] font-semibold text-[#C2412F] dark:text-[#F0826F]">{error}</p>}

          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-bk-line pt-5">
            <button type="submit" disabled={Boolean(saving) || Boolean(blocked)} className={appButton('primary', 'md', 'h-11 px-5')}>
              {saving === 'save' ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />}
              {scheduled ? 'Save schedule' : 'Schedule post'}
            </button>
            {scheduled && onUnschedule && (
              <button type="button" onClick={unschedule} disabled={Boolean(saving)} className={appButton('quiet', 'md', 'h-11')}>
                {saving === 'unschedule' && <Loader2 className="size-4 animate-spin" />}
                Unschedule
              </button>
            )}
            <button type="button" onClick={() => onOpenChange(false)} disabled={Boolean(saving)} className={appButton('quiet', 'md', 'h-11 sm:ml-auto')}>
              {scheduled ? 'Cancel' : 'Schedule later'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
