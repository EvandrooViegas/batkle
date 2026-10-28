'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Popup } from '@/components/app/popup'
import { appButton } from '@/components/app/ui'
import { applyReread, rereadChanges, summary } from '@/lib/client/reread'
import { cn } from '@/lib/utils'

function Value({ kind, value, muted }) {
  if (kind === 'colours') {
    const colours = (Array.isArray(value) ? value : []).filter(Boolean)
    return colours.length ? (
      <span className="flex flex-wrap gap-1">{colours.map((c, i) => <span key={i} title={c} className="size-5 rounded-md border border-black/10" style={{ background: c }} />)}</span>
    ) : <span className="text-bk-muted">Nothing yet</span>
  }
  if (kind === 'logo') {
    return value ? <span className="flex h-9 w-24 items-center justify-center rounded-md border border-bk-line bg-white p-1"><img src={value} alt="" className="max-h-full max-w-full object-contain" /></span> : <span className="text-bk-muted">Nothing yet</span>
  }
  const text = summary(kind, value)
  return <span className={cn('min-w-0', muted && 'text-bk-muted', !text && 'italic')}>{text || 'Nothing yet'}</span>
}

/**
 * The confirmation screen after reading the website again: each chapter the website would change, what the profile
 * has now and what the website says, ticked to update. Nothing changes until the person confirms.
 */
export default function RereadReview({ open, current, next, pages, applying, onCancel, onApply }) {
  const changes = useMemo(() => rereadChanges(current, next), [current, next])
  const [chosen, setChosen] = useState([])
  useEffect(() => { if (open) setChosen(changes.map(c => c.id)) }, [open, changes])
  const toggle = id => setChosen(list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))
  const all = chosen.length === changes.length

  return (
    <Popup
      open={open}
      onOpenChange={value => { if (!value && !applying) onCancel() }}
      size="lg"
      title={changes.length ? 'Choose what to update' : 'Your profile already matches your website'}
      description={changes.length
        ? `Batkle read ${pages || 'your'} ${pages === 1 ? 'page' : 'pages'} of your website. Tick the chapters to update from it; the others stay exactly as they are.`
        : 'Batkle read your website again and found nothing new to add.'}
      footer={changes.length ? <>
        <button type="button" onClick={onCancel} disabled={applying} className={appButton('quiet', 'md')}>Keep my profile</button>
        <button type="button" onClick={() => onApply(applyReread(current, next, chosen))} disabled={applying || !chosen.length} className={appButton('primary', 'md')}>
          {applying && <Loader2 className="size-4 animate-spin" />}{applying ? 'Updating…' : chosen.length ? `Update ${chosen.length} chapter${chosen.length === 1 ? '' : 's'}` : 'Choose a chapter'}
        </button>
      </> : <button type="button" onClick={onCancel} className={appButton('primary', 'md')}>Close</button>}
    >
      {changes.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-3 text-[13px]">
            <p className="text-bk-muted">{chosen.length} of {changes.length} chapters ticked</p>
            <button type="button" onClick={() => setChosen(all ? [] : changes.map(c => c.id))} className="font-semibold underline underline-offset-4">{all ? 'Untick all' : 'Tick all'}</button>
          </div>
          <ul className="divide-y divide-bk-line rounded-xl bg-bk-surface shadow-bk-card">
            {changes.map(change => {
              const ticked = chosen.includes(change.id)
              return (
                <li key={change.id}>
                  <label className={cn('flex cursor-pointer gap-3 px-4 py-3.5 transition-colors', ticked ? 'bg-bk-butter/10' : 'hover:bg-bk-alt/60')}>
                    <input type="checkbox" checked={ticked} onChange={() => toggle(change.id)} className="sr-only" />
                    <span aria-hidden="true" className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border', ticked ? 'border-bk-fg bg-bk-fg text-bk-bg' : 'border-bk-field bg-bk-surface')}>{ticked && <Check className="size-3.5" strokeWidth={3} />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-[14px] font-bold">
                        {change.title}
                        {change.added && <span className="rounded-full bg-[#1F7A5A]/10 px-2 py-0.5 text-[11px] font-bold text-[#17583F] dark:text-[#4CC79A]">New</span>}
                      </span>
                      <span className="mt-1.5 grid gap-1 text-[13px] leading-snug sm:grid-cols-[96px_minmax(0,1fr)]">
                        {!change.added && <><span className="text-bk-muted">Now</span><Value kind={change.kind} value={change.now} muted /></>}
                        <span className="text-bk-muted">From website</span><Value kind={change.kind} value={change.fresh} />
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Popup>
  )
}
