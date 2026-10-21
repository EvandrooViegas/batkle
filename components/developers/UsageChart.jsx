'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

const PLOT = 168
const number = n => new Intl.NumberFormat().format(n)
// Series dates are calendar days (YYYY-MM-DD); read them at noon UTC so no time zone moves them a day.
const dateLabel = (date, options) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' })

/** Clean axis ticks from 0 to at least `max`: steps of 1, 2 or 5 times a power of ten, never below 1. */
function ticksFor(max) {
  if (max <= 0) return [0]
  const rough = max / 4
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = Math.max(1, [1, 2, 5, 10].map(m => m * power).find(s => s >= rough))
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step)
}

// What a day of API use shows: its credits, and in the tooltip and table its requests and failures.
const CREDIT_COLUMNS = [
  { key: 'credits', label: 'Credits', one: 'credit', many: 'credits' },
  { key: 'requests', label: 'Requests', one: 'request', many: 'requests' },
  { key: 'errors', label: 'Failed', one: 'failed', many: 'failed', hideZero: true },
]

/**
 * One number per day as columns: credits used by default, or any `field` of the series. Hover a day, or focus the
 * chart and use the arrow keys, to read it; `columns` are what the tooltip and the table below it show for each day.
 * Bar colours are gold steps validated against both surfaces.
 */
export default function UsageChart({ series, field = 'credits', title = 'Credits used per day', emptyText = 'No credits used in this period.', columns = CREDIT_COLUMNS }) {
  const [active, setActive] = useState(null)
  const ticks = ticksFor(Math.max(0, ...series.map(d => d[field])))
  const top = ticks.at(-1) || 1
  const empty = series.every(d => d[field] === 0)
  const peak = empty ? -1 : series.reduce((best, d, i) => (d[field] > series[best][field] ? i : best), 0)
  const shown = d => columns.filter(c => !c.hideZero || d[c.key])
  const day = active != null ? series[active] : null
  const last = series.length - 1
  const labelled = [0, Math.round(last / 2), last]

  const onKeyDown = e => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }
    if (!(e.key in moves)) return
    e.preventDefault()
    setActive(i => Math.min(last, Math.max(0, (i ?? last) + moves[e.key])))
  }

  return (
    <div>
      <div className="flex gap-3">
        <div aria-hidden="true" className="relative w-8 shrink-0 text-right text-[11px] tabular-nums text-bk-muted" style={{ height: PLOT }}>
          {ticks.map(t => (
            <span key={t} className="absolute right-0 leading-none" style={{ bottom: `${(t / top) * 100}%`, transform: 'translateY(50%)' }}>{number(t)}</span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div
            role="group"
            tabIndex={0}
            aria-label={`${title} for the last ${series.length} days. Use the arrow keys to read each day.`}
            onKeyDown={onKeyDown}
            onFocus={() => setActive(i => i ?? last)}
            onBlur={() => setActive(null)}
            onMouseLeave={() => setActive(null)}
            className="relative rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bk-fg"
            style={{ height: PLOT }}
          >
            {ticks.map(t => (
              <span key={t} aria-hidden="true" className="absolute inset-x-0 h-px bg-bk-line" style={{ bottom: `${(t / top) * 100}%` }} />
            ))}
            <div className="absolute inset-0 flex items-end gap-[2px]">
              {series.map((d, i) => {
                const height = d[field] ? Math.max(2, (d[field] / top) * PLOT) : 0
                return (
                  <div key={d.date} onMouseEnter={() => setActive(i)} className="relative flex h-full min-w-0 flex-1 items-end justify-center">
                    {i === peak && active == null && (
                      <span aria-hidden="true" className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold tabular-nums text-bk-fg/80" style={{ bottom: height + 4 }}>{number(d[field])}</span>
                    )}
                    <span
                      aria-hidden="true"
                      className={cn('block w-full max-w-[24px] rounded-t-[4px] bg-[#B07A00] transition-opacity duration-150 dark:bg-[#B88A08]', active != null && active !== i && 'opacity-35')}
                      style={{ height }}
                    />
                  </div>
                )
              })}
            </div>
            {empty && (
              <p className="absolute inset-0 flex items-center justify-center text-[13px] text-bk-muted">{emptyText}</p>
            )}
            {day && (
              <div
                role="presentation"
                className="pointer-events-none absolute bottom-full z-10 mb-2 w-max rounded-lg bg-bk-ink px-3 py-2 text-[12px] text-bk-cream shadow-bk-pop dark:bg-bk-chip dark:text-bk-fg"
                style={{ left: `${((active + 0.5) / series.length) * 100}%`, transform: `translateX(${active < 4 ? '-12%' : active > last - 4 ? '-88%' : '-50%'})` }}
              >
                <p className="font-bold">{dateLabel(day.date, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                <p className="mt-0.5 tabular-nums">{shown(day).map(c => `${number(day[c.key])} ${day[c.key] === 1 ? c.one : c.many}`).join(' · ')}</p>
              </div>
            )}
          </div>
          <div aria-hidden="true" className="relative mt-2 h-4 text-[11px] text-bk-muted">
            {labelled.map(i => series[i] && (
              <span key={i} className="absolute whitespace-nowrap" style={i === 0 ? { left: 0 } : i === last ? { right: 0 } : { left: `${((i + 0.5) / series.length) * 100}%`, transform: 'translateX(-50%)' }}>
                {i === last ? 'Today' : dateLabel(series[i].date, { day: 'numeric', month: 'short' })}
              </span>
            ))}
          </div>
          <p className="sr-only" aria-live="polite">{day ? `${dateLabel(day.date, { weekday: 'long', day: 'numeric', month: 'long' })}: ${shown(day).map(c => `${day[c.key]} ${day[c.key] === 1 ? c.one : c.many}`).join(', ')}.` : ''}</p>
        </div>
      </div>

      <details className="mt-4 text-[13px]">
        <summary className="cursor-pointer select-none font-semibold text-bk-muted hover:text-bk-fg">Show as a table</summary>
        <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-bk-line">
          <table className="w-full text-left text-[12.5px]">
            <thead className="sticky top-0 bg-bk-surface text-bk-muted">
              <tr><th className="px-3 py-2 font-semibold">Day</th>{columns.map(c => <th key={c.key} className="px-3 py-2 text-right font-semibold">{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-bk-line">
              {[...series].reverse().map(d => (
                <tr key={d.date}>
                  <td className="px-3 py-1.5">{dateLabel(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                  {columns.map(c => <td key={c.key} className="px-3 py-1.5 text-right tabular-nums">{number(d[c.key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
