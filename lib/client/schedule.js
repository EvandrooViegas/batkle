// Approving and scheduling posts: platforms, times and how the schedule reads. Pure, so the API, the app and the
// tests share it.

export const PLATFORMS = [
  { id: 'instagram', label: 'Instagram', short: 'IG' },
  { id: 'tiktok', label: 'TikTok', short: 'TikTok' },
]
export const PLATFORM_IDS = PLATFORMS.map(p => p.id)

// Instagram's caption limits; TikTok's are looser, so a caption that fits Instagram fits both.
export const CAPTION_MAX = 2200
export const HASHTAG_MAX = 30

const tag = text => (text.startsWith('#') ? text : `#${text}`)

/** The caption a newly approved post starts with: its written caption, then its hashtags. */
export function startingCaption(copy) {
  const hashtags = (Array.isArray(copy?.hashtags) ? copy.hashtags : []).map(t => String(t).trim()).filter(Boolean).map(tag)
  return [String(copy?.caption || '').trim(), hashtags.join(' ')].filter(Boolean).join('\n\n').slice(0, CAPTION_MAX)
}

export function hashtagCount(text) {
  return (String(text || '').match(/(^|\s)#[^\s#]+/g) || []).length
}

/**
 * Where an idea's post stands: 'unapproved', 'changed' (approved, then rebuilt as a new version), 'approved'
 * (waiting for a time), 'scheduled', 'due' (its time has passed and it isn't marked posted yet) or 'posted'.
 * Pass `canvasId` (the idea's current build) to notice a rebuild; null skips that check.
 */
export function scheduleState(entry, canvasId = null, now = Date.now()) {
  if (!entry) return 'unapproved'
  if (canvasId && entry.canvasId !== canvasId) return 'changed'
  if (entry.status === 'posted') return 'posted'
  if (entry.status === 'scheduled') return entry.scheduledAt && new Date(entry.scheduledAt).getTime() <= now ? 'due' : 'scheduled'
  return 'approved'
}

/** Local date ("2026-10-14") and time ("18:30") inputs as an ISO instant, or null when either is missing. */
export function toScheduledAt(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) return null
  const at = new Date(`${date}T${time}`)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

/** An instant as local date and time input values. */
export function toInputs(iso) {
  const at = new Date(iso)
  if (!iso || Number.isNaN(at.getTime())) return { date: '', time: '' }
  const pad = n => String(n).padStart(2, '0')
  return { date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`, time: `${pad(at.getHours())}:${pad(at.getMinutes())}` }
}

/** The first time offered for a new schedule: tomorrow at 10:00, local time. */
export function suggestedTime(now = new Date()) {
  const at = new Date(now)
  at.setDate(at.getDate() + 1)
  at.setHours(10, 0, 0, 0)
  return at.toISOString()
}

/** What stops this schedule from being saved, in words for people, or null. */
export function scheduleProblem({ platforms, scheduledAt, caption }, now = Date.now()) {
  if (!platforms?.length) return 'Choose where to post it: Instagram, TikTok or both.'
  const at = scheduledAt ? new Date(scheduledAt).getTime() : NaN
  if (Number.isNaN(at)) return 'Choose a date and time.'
  if (at <= now) return 'Choose a time in the future.'
  if (String(caption || '').length > CAPTION_MAX) return `Keep the caption under ${CAPTION_MAX.toLocaleString('en-US')} characters.`
  if (platforms.includes('instagram') && hashtagCount(caption) > HASHTAG_MAX) return `Instagram allows at most ${HASHTAG_MAX} hashtags in a caption.`
  return null
}

/** "Instagram + TikTok". */
export function platformNames(ids = []) {
  return PLATFORMS.filter(p => ids.includes(p.id)).map(p => p.label).join(' + ')
}

/** "Tue 14 Oct, 18:00" in the viewer's own time zone and language. */
export function formatWhen(iso, locale) {
  const at = new Date(iso)
  if (!iso || Number.isNaN(at.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(at)
}

const time = value => (value ? new Date(value).getTime() || 0 : 0)

/**
 * The schedule page's sections: due now (oldest first), waiting for a time (newest approval first), upcoming
 * (soonest first) and posted (latest first).
 */
export function groupSchedule(entries, now = Date.now()) {
  const groups = { due: [], approved: [], upcoming: [], posted: [] }
  for (const entry of entries) {
    const state = scheduleState(entry, null, now)
    groups[state === 'due' ? 'due' : state === 'scheduled' ? 'upcoming' : state === 'posted' ? 'posted' : 'approved'].push(entry)
  }
  groups.due.sort((a, b) => time(a.scheduledAt) - time(b.scheduledAt))
  groups.upcoming.sort((a, b) => time(a.scheduledAt) - time(b.scheduledAt))
  groups.approved.sort((a, b) => time(b.approvedAt) - time(a.approvedAt))
  groups.posted.sort((a, b) => time(b.postedAt) - time(a.postedAt))
  return groups
}

// The calendar. Everything is in the viewer's own time zone, like the list: a post sits on the local day of its time.

/** The day calendar weeks start on: Monday (1), as in Portugal and most of Europe. 0 would be Sunday. */
export const WEEK_STARTS_ON = 1

const pad2 = n => String(n).padStart(2, '0')

/** The local calendar day of an instant (Date, ISO string or milliseconds) as "2026-10-15"; '' when it isn't one. */
export function dayKey(value) {
  if (value === null || value === undefined || value === '') return ''
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? '' : `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`
}

/**
 * Where an entry sits on the calendar, in milliseconds: its scheduled time, or for a post marked posted without
 * one, when it was posted. Null for posts still waiting for a time, which stay off the calendar.
 */
export function calendarTime(entry) {
  if (entry?.status !== 'scheduled' && entry?.status !== 'posted') return null
  const value = entry.scheduledAt || (entry.status === 'posted' ? entry.postedAt : null)
  const at = value ? new Date(value).getTime() : NaN
  return Number.isNaN(at) ? null : at
}

/** The schedule view to open with when the viewer hasn't chosen one: the calendar once something is on it. */
export function defaultScheduleView(entries = []) {
  return entries.some(entry => calendarTime(entry) !== null) ? 'calendar' : 'list'
}

/**
 * A month laid out for the calendar: whole weeks starting on `weekStartsOn` (4 to 6 of them, with the neighbouring
 * months' days at the edges), each day with its scheduled and posted entries in time order as `{ entry, state, at }`
 * (state from scheduleState, so a time that passed without being posted is 'due'). Days carry `key` ("2026-10-15"),
 * `date` (local midnight), `inMonth`, `isToday` and `isPast`. `count` is the number of entries inside the month.
 */
export function calendarMonth(entries = [], monthDate = Date.now(), { weekStartsOn = WEEK_STARTS_ON, now = Date.now() } = {}) {
  const base = new Date(monthDate)
  const first = new Date(base.getFullYear(), base.getMonth(), 1)
  const length = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const lead = (first.getDay() - weekStartsOn + 7) % 7
  const today = dayKey(now)
  const byDay = new Map()
  for (const entry of entries) {
    const at = calendarTime(entry)
    if (at === null) continue
    const key = dayKey(at)
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key).push({ entry, state: scheduleState(entry, null, now), at })
  }
  const weeks = []
  let count = 0
  for (let i = 0; i < Math.ceil((lead + length) / 7) * 7; i++) {
    // From calendar fields rather than adding 24 hours, so days stay whole across daylight-saving changes.
    const date = new Date(first.getFullYear(), first.getMonth(), 1 - lead + i)
    const key = dayKey(date)
    const inMonth = date.getMonth() === first.getMonth()
    const list = (byDay.get(key) || []).sort((a, b) => a.at - b.at)
    if (inMonth) count += list.length
    if (i % 7 === 0) weeks.push([])
    weeks.at(-1).push({ key, date, day: date.getDate(), weekday: date.getDay(), inMonth, isToday: key === today, isPast: key < today, entries: list })
  }
  return { month: first, key: dayKey(first).slice(0, 7), weeks, count }
}

/**
 * The time a new schedule picked on a calendar day (today or later) starts at: 10:00 that day, or when that is
 * less than half an hour away, the next whole hour at least half an hour away. Late in the evening it stays on
 * that day at 23:55.
 */
export function slotOnDay(day, now = Date.now()) {
  const at = new Date(day)
  at.setHours(10, 0, 0, 0)
  const soon = new Date(new Date(now).getTime() + 30 * 60000)
  if (at.getTime() >= soon.getTime()) return at.toISOString()
  if (soon.getMinutes() || soon.getSeconds() || soon.getMilliseconds()) soon.setMinutes(60, 0, 0)
  if (dayKey(soon) === dayKey(at)) return soon.toISOString()
  at.setHours(23, 55, 0, 0)
  return at.toISOString()
}
