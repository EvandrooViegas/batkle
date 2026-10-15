const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

// The calendar works in the viewer's own time zone. Node re-reads TZ when it changes, so each test picks the zone it
// is about and the results don't depend on the machine running them.
process.env.TZ = 'Europe/Lisbon'
function inZone(zone, run) {
  const before = process.env.TZ
  process.env.TZ = zone
  try { return run() } finally { process.env.TZ = before }
}

const source = fs.readFileSync('lib/client/schedule.js', 'utf8').replace(/^export /gm, '')
const schedule = new Function(source + ';return { WEEK_STARTS_ON, dayKey, calendarTime, defaultScheduleView, calendarMonth, slotOnDay, scheduleState, toInputs }')()
const { calendarMonth, dayKey, slotOnDay } = schedule

const keys = month => month.weeks.flat().map(d => d.key)
const inMonth = month => month.weeks.flat().filter(d => d.inMonth)
const day = (month, key) => month.weeks.flat().find(d => d.key === key)
const ids = d => d.entries.map(item => item.entry.id)

test('weeks start on Monday by default, with the neighbouring months filling the first and last week', () => {
  assert.equal(schedule.WEEK_STARTS_ON, 1)
  // October 2026 starts on a Thursday.
  const october = calendarMonth([], new Date(2026, 9, 15), { now: new Date(2026, 9, 15, 12) })
  assert.equal(october.key, '2026-10')
  assert.equal(october.weeks.length, 5)
  assert.ok(october.weeks.every(week => week.length === 7))
  assert.deepEqual(october.weeks[0].map(d => d.key), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
  assert.deepEqual(october.weeks[0].map(d => d.weekday), [1, 2, 3, 4, 5, 6, 0])
  assert.equal(october.weeks.at(-1).at(-1).key, '2026-11-01')
  assert.deepEqual(october.weeks[0].map(d => d.inMonth), [false, false, false, true, true, true, true])
  assert.equal(inMonth(october).length, 31)

  // The same month from Sunday, for places that count weeks that way.
  const fromSunday = calendarMonth([], new Date(2026, 9, 1), { weekStartsOn: 0 })
  assert.equal(fromSunday.weeks[0][0].key, '2026-09-27')
  assert.equal(fromSunday.weeks[0][4].key, '2026-10-01')

  // June 2026 starts on a Monday: no days from May.
  const june = calendarMonth([], '2026-06-10T12:00:00Z')
  assert.equal(june.weeks[0][0].key, '2026-06-01')
  assert.equal(june.weeks.length, 5)
})

test('a month that spreads over six weeks, and a February that fits in exactly four', () => {
  // November 2026 starts on a Sunday, so with Monday weeks it needs six rows.
  const november = calendarMonth([], new Date(2026, 10, 1))
  assert.equal(november.weeks.length, 6)
  assert.equal(november.weeks[0][0].key, '2026-10-26')
  assert.equal(november.weeks[0][6].key, '2026-11-01')
  assert.equal(november.weeks.at(-1).at(-1).key, '2026-12-06')
  // February 2027 starts on a Monday and has 28 days.
  const february = calendarMonth([], new Date(2027, 1, 20))
  assert.equal(february.weeks.length, 4)
  assert.equal(february.weeks[0][0].key, '2027-02-01')
  assert.equal(february.weeks.at(-1).at(-1).key, '2027-02-28')
  assert.ok(february.weeks.flat().every(d => d.inMonth))
})

test('a leap February has its 29th', () => {
  const leap = calendarMonth([], new Date(2028, 1, 1))
  const days = inMonth(leap)
  assert.equal(days.length, 29)
  assert.equal(days.at(-1).key, '2028-02-29')
  assert.equal(leap.weeks[0][0].key, '2028-01-31')
  assert.equal(leap.weeks.length, 5)
  assert.equal(inMonth(calendarMonth([], new Date(2026, 1, 1))).length, 28)
  // Also across a year boundary.
  assert.equal(calendarMonth([], new Date(2026, 11, 31)).weeks.at(-1).at(-1).key, '2027-01-03')
})

test('days are whole and in order across daylight-saving changes, whatever the zone', () => {
  for (const zone of ['Europe/Lisbon', 'America/New_York', 'America/Santiago', 'Australia/Sydney', 'Asia/Kolkata', 'UTC']) {
    inZone(zone, () => {
      for (let m = 0; m < 12; m++) {
        const month = calendarMonth([], new Date(2026, m, 1))
        const list = keys(month)
        assert.equal(new Set(list).size, list.length, `${zone} ${m + 1}: no day twice`)
        for (let i = 1; i < list.length; i++) {
          assert.equal(Date.parse(`${list[i]}T00:00:00Z`) - Date.parse(`${list[i - 1]}T00:00:00Z`), 86400000, `${zone} ${list[i - 1]} → ${list[i]}: no day skipped`)
        }
        for (const d of month.weeks.flat()) assert.equal(dayKey(d.date), d.key)
      }
    })
  }
})

test('a post lands on the local day of its time, also near midnight', () => {
  const entries = [
    { id: 'late-14th', status: 'scheduled', scheduledAt: '2026-10-14T22:59:00Z' }, // 23:59 in Lisbon (UTC+1 in October)
    { id: 'early-15th', status: 'scheduled', scheduledAt: '2026-10-14T23:30:00Z' }, // 00:30 on the 15th in Lisbon
    { id: 'end-of-month', status: 'scheduled', scheduledAt: '2026-10-31T23:30:00Z' }, // 23:30 on the 31st (UTC+0 by then)
  ]
  const now = Date.parse('2026-10-01T12:00:00Z')
  const lisbon = calendarMonth(entries, new Date(2026, 9, 1), { now })
  assert.deepEqual(ids(day(lisbon, '2026-10-14')), ['late-14th'])
  assert.deepEqual(ids(day(lisbon, '2026-10-15')), ['early-15th'])
  assert.deepEqual(ids(day(lisbon, '2026-10-31')), ['end-of-month'])
  assert.equal(lisbon.count, 3)

  inZone('America/New_York', () => {
    const newYork = calendarMonth(entries, new Date(2026, 9, 1), { now })
    assert.deepEqual(ids(day(newYork, '2026-10-14')), ['late-14th', 'early-15th'])
    assert.deepEqual(ids(day(newYork, '2026-10-31')), ['end-of-month'])
  })
  inZone('Asia/Tokyo', () => {
    const tokyo = calendarMonth(entries, new Date(2026, 9, 1), { now })
    assert.deepEqual(ids(day(tokyo, '2026-10-15')), ['late-14th', 'early-15th'])
    // 08:30 on 1 November in Tokyo: in next month's first week, and not counted in October.
    assert.deepEqual(ids(day(tokyo, '2026-11-01')), ['end-of-month'])
    assert.equal(tokyo.count, 2)
  })
})

test('the night the clocks go back in Lisbon keeps all of its posts on the one day', () => {
  // On 25 October 2026 Lisbon goes from 02:00 summer time back to 01:00, so 01:30 happens twice.
  const entries = [
    { id: 'second-0130', status: 'scheduled', scheduledAt: '2026-10-25T01:30:00Z' },
    { id: 'first-0130', status: 'scheduled', scheduledAt: '2026-10-25T00:30:00Z' },
    { id: 'just-before', status: 'scheduled', scheduledAt: '2026-10-24T22:59:00Z' }, // 23:59 on the 24th
    { id: 'last-minute', status: 'scheduled', scheduledAt: '2026-10-25T23:59:00Z' },
    { id: 'next-day', status: 'scheduled', scheduledAt: '2026-10-26T00:00:00Z' },
  ]
  const month = calendarMonth(entries, new Date(2026, 9, 1), { now: Date.parse('2026-10-01T00:00:00Z') })
  assert.deepEqual(ids(day(month, '2026-10-24')), ['just-before'])
  assert.deepEqual(ids(day(month, '2026-10-25')), ['first-0130', 'second-0130', 'last-minute'])
  assert.deepEqual(ids(day(month, '2026-10-26')), ['next-day'])
  assert.equal(day(month, '2026-10-25').date.toISOString(), '2026-10-24T23:00:00.000Z')
  assert.equal(day(month, '2026-10-26').date.toISOString(), '2026-10-26T00:00:00.000Z')

  // And the spring change, when 01:00 to 02:00 doesn't exist.
  const march = calendarMonth([{ id: 'after-change', status: 'scheduled', scheduledAt: '2026-03-29T01:30:00Z' }], new Date(2026, 2, 1), { now: 0 })
  assert.deepEqual(ids(day(march, '2026-03-29')), ['after-change'])
  assert.equal(day(march, '2026-03-30').date.toISOString(), '2026-03-29T23:00:00.000Z')
})

test('due, scheduled and posted posts show as such, in time order; posts waiting for a time stay off the grid', () => {
  const now = Date.parse('2026-10-15T12:00:00Z') // 13:00 in Lisbon
  const entries = [
    { id: 'later-today', status: 'scheduled', scheduledAt: '2026-10-15T17:00:00Z' },
    { id: 'missed', status: 'scheduled', scheduledAt: '2026-10-15T08:00:00Z' },
    { id: 'posted', status: 'posted', scheduledAt: '2026-10-15T10:00:00Z', postedAt: '2026-10-15T10:20:00Z' },
    { id: 'posted-without-time', status: 'posted', scheduledAt: null, postedAt: '2026-10-10T09:00:00Z' },
    { id: 'waiting', status: 'approved', scheduledAt: null, approvedAt: '2026-10-12T00:00:00Z' },
    { id: 'waiting-old-time', status: 'approved', scheduledAt: '2026-10-20T09:00:00Z' },
    { id: 'broken-time', status: 'scheduled', scheduledAt: 'not a date' },
    { id: 'no-time', status: 'scheduled', scheduledAt: null },
  ]
  const month = calendarMonth(entries, now, { now })
  const today = day(month, '2026-10-15')
  assert.deepEqual(ids(today), ['missed', 'posted', 'later-today'])
  assert.deepEqual(today.entries.map(item => item.state), ['due', 'posted', 'scheduled'])
  assert.equal(today.entries[0].at, Date.parse('2026-10-15T08:00:00Z'))
  assert.deepEqual(ids(day(month, '2026-10-10')), ['posted-without-time'])
  assert.deepEqual(ids(day(month, '2026-10-20')), [])
  const placed = month.weeks.flat().flatMap(ids)
  for (const id of ['waiting', 'waiting-old-time', 'broken-time', 'no-time']) assert.equal(placed.includes(id), false, id)
  assert.equal(month.count, 4)

  assert.deepEqual([schedule.calendarTime(entries[4]), schedule.calendarTime(entries[6]), schedule.calendarTime(null)], [null, null, null])
  assert.equal(schedule.calendarTime(entries[3]), Date.parse('2026-10-10T09:00:00Z'))
})

test('today is marked, earlier days are past, and the neighbouring months know they are outside', () => {
  const now = new Date(2026, 9, 15, 0, 5)
  const month = calendarMonth([], new Date(2026, 9, 3), { now })
  assert.deepEqual(month.weeks.flat().filter(d => d.isToday).map(d => d.key), ['2026-10-15'])
  assert.equal(day(month, '2026-10-14').isPast, true)
  assert.equal(day(month, '2026-10-15').isPast, false)
  assert.equal(day(month, '2026-10-16').isPast, false)
  assert.equal(day(month, '2026-09-28').isPast, true)
  assert.equal(day(month, '2026-11-01').inMonth, false)
  // Another month has no today in it.
  assert.equal(calendarMonth([], new Date(2026, 11, 1), { now }).weeks.flat().some(d => d.isToday), false)
})

test('the calendar opens first once something is scheduled or posted', () => {
  assert.equal(schedule.defaultScheduleView([]), 'list')
  assert.equal(schedule.defaultScheduleView([{ status: 'approved', scheduledAt: null }]), 'list')
  assert.equal(schedule.defaultScheduleView([{ status: 'approved' }, { status: 'scheduled', scheduledAt: '2026-10-20T09:00:00Z' }]), 'calendar')
  assert.equal(schedule.defaultScheduleView([{ status: 'posted', postedAt: '2026-10-01T09:00:00Z' }]), 'calendar')
})

test('a day picked on the calendar starts at 10:00, or at the next sensible hour today', () => {
  const at = iso => schedule.toInputs(iso)
  const now = new Date(2026, 9, 15, 14, 20)
  assert.deepEqual(at(slotOnDay(new Date(2026, 9, 20), now)), { date: '2026-10-20', time: '10:00' })
  assert.deepEqual(at(slotOnDay(new Date(2026, 9, 15), new Date(2026, 9, 15, 8, 0))), { date: '2026-10-15', time: '10:00' })
  assert.deepEqual(at(slotOnDay(new Date(2026, 9, 15), new Date(2026, 9, 15, 9, 45))), { date: '2026-10-15', time: '11:00' })
  assert.deepEqual(at(slotOnDay(new Date(2026, 9, 15), now)), { date: '2026-10-15', time: '15:00' })
  assert.deepEqual(at(slotOnDay(new Date(2026, 9, 15), new Date(2026, 9, 15, 14, 30))), { date: '2026-10-15', time: '15:00' })
  assert.deepEqual(at(slotOnDay(new Date(2026, 9, 15), new Date(2026, 9, 15, 23, 20))), { date: '2026-10-15', time: '23:55' })
  // The slot is always ahead of now on the day it was picked for.
  for (const minutes of [0, 7, 29, 30, 31, 59]) {
    const clock = new Date(2026, 9, 15, 16, minutes)
    assert.ok(Date.parse(slotOnDay(new Date(2026, 9, 15), clock)) - clock.getTime() >= 30 * 60000)
  }
  // On the day the clocks change, 10:00 is still 10:00 on the wall.
  assert.deepEqual(at(slotOnDay(new Date(2026, 9, 25), new Date(2026, 9, 20))), { date: '2026-10-25', time: '10:00' })
  assert.equal(slotOnDay(new Date(2026, 9, 25), new Date(2026, 9, 20)), '2026-10-25T10:00:00.000Z')
  assert.equal(slotOnDay(new Date(2026, 2, 29), new Date(2026, 2, 20)), '2026-03-29T09:00:00.000Z')
})

test('day keys are local dates and empty for anything that is not a time', () => {
  assert.equal(dayKey('2026-10-14T23:30:00Z'), '2026-10-15')
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05')
  assert.equal(dayKey(Date.UTC(2026, 5, 1, 12)), '2026-06-01')
  for (const value of [null, undefined, '', 'soon', NaN]) assert.equal(dayKey(value), '')
})
