'use client'

import { useEffect, useState } from 'react'
import { Check, CheckCheck, Copy, Download, ExternalLink, ImageIcon, Layers, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Popup, usePopup } from '@/components/app/popup'
import { SegmentedTabs, appButton, panelClass } from '@/components/app/ui'
import { cn } from '@/lib/utils'

const iconButton = 'inline-flex size-8 items-center justify-center rounded-lg text-bk-fg transition-colors hover:bg-bk-alt focus-visible:outline focus-visible:outline-2 focus-visible:outline-bk-fg [&_svg]:size-4'

export function useCopy() {
  const [copied, setCopied] = useState(false)
  const copy = async text => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { toast.error('Could not copy') }
  }
  return [copied, copy]
}

// "Today", "Yesterday", or the date, so the timeline reads like a log.
function dayLabel(date) {
  const day = new Date(date); day.setHours(0, 0, 0, 0)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((today - day) / 86400000)
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

function RenderRow({ render, onApprove, onDelete, origin }) {
  const [preview, setPreview] = useState(false)
  const [copied, copy] = useCopy()
  const [approving, setApproving] = useState(false)
  const carousel = render.type === 'carousel'
  const url = `${origin}/api/rendered/${render.id}${carousel ? '.zip' : ''}`
  const time = new Date(render.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

  return (
    <li className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-bk-alt/50">
      {carousel ? (
        <span className="flex size-14 shrink-0 flex-col items-center justify-center rounded-lg bg-bk-alt text-bk-muted"><Layers className="size-5" /><span className="text-[10.5px] font-bold">{render.pages?.length || 0}</span></span>
      ) : (
        <button type="button" onClick={() => setPreview(true)} aria-label="Preview render" className="size-14 shrink-0 overflow-hidden rounded-lg bg-bk-alt focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg">
          <img src={`/api/rendered/${render.id}`} alt="" loading="lazy" className="size-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-[14px] font-bold">
          {carousel ? `Carousel · ${render.pages?.length || 0} slides` : 'Single post'}
          <span className="rounded-full bg-bk-chip px-2 py-px text-[11px] font-bold text-bk-fg/80">{render.source === 'api' ? 'API' : 'App'}</span>
          <span className="text-[12.5px] font-normal tabular-nums text-bk-muted">{time}</span>
        </p>
        {render.payload && (
          <details className="mt-0.5 text-[12px]">
            <summary className="cursor-pointer select-none text-bk-muted hover:text-bk-fg">Request data</summary>
            <pre className="mt-1.5 max-h-36 overflow-auto rounded-lg bg-bk-ink p-2.5 font-mono text-[11px] leading-relaxed text-bk-cream">{JSON.stringify(render.payload, null, 1)}</pre>
          </details>
        )}
      </div>
      {render.approved ? (
        <span className="hidden shrink-0 items-center gap-1 rounded-full bg-[#1F7A5A]/10 px-2.5 py-1 text-[12px] font-bold text-[#17583F] sm:inline-flex dark:text-[#4CC79A]"><CheckCheck className="size-3.5" />Approved</span>
      ) : (
        <button type="button" disabled={approving} onClick={async () => { setApproving(true); await onApprove(render.id); setApproving(false) }} className={appButton('outline', 'xs', 'h-8 shrink-0')}>
          {approving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}Approve
        </button>
      )}
      <div className="flex shrink-0 items-center">
        <button type="button" onClick={() => copy(url)} aria-label="Copy link" title="Copy link" className={iconButton}>{copied ? <Check /> : <Copy />}</button>
        <a href={url} download aria-label="Download" title="Download" className={iconButton}><Download /></a>
        <button type="button" onClick={() => onDelete(render.id)} aria-label="Delete" title="Delete" className={cn(iconButton, 'text-bk-muted hover:bg-[#C2412F]/10 hover:text-[#C2412F]')}><Trash2 /></button>
      </div>

      <Popup
        open={preview}
        onOpenChange={setPreview}
        title="Render preview"
        size="lg"
        footer={<>
          <button type="button" onClick={() => copy(url)} className={appButton('outline', 'md')}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}Copy link</button>
          <a href={url} target="_blank" rel="noreferrer" className={appButton('primary', 'md')}><ExternalLink className="size-4" />Open</a>
        </>}
      >
        <img src={`/api/rendered/${render.id}`} alt="Rendered post" className="w-full rounded-xl border border-bk-line" />
      </Popup>
    </li>
  )
}

/** Every render of the account's posts downloaded in the editor, as a log by day. */
export default function RenderLog() {
  const popup = usePopup()
  const [renders, setRenders] = useState([])
  const [loading, setLoading] = useState(true)
  const [origin, setOrigin] = useState('')
  const [tab, setTab] = useState('all')

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/renders')
      const data = await res.json()
      setRenders(Array.isArray(data) ? data : [])
    } catch {
      toast.error('The renders could not be loaded')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { setOrigin(window.location.origin); load() }, [])

  const approve = async (id) => {
    const res = await fetch(`/api/renders/${id}/approve`, { method: 'POST' })
    if (!res.ok) { toast.error('The render could not be approved'); return }
    setRenders(prev => prev.map(r => (r.id === id ? { ...r, approved: true } : r)))
    toast.success('Approved')
  }

  const remove = async (id) => {
    const deleted = await popup.confirm({
      title: 'Delete this render?',
      description: 'Its image and links stop working. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete render',
      busyLabel: 'Deleting…',
      action: async () => {
        const res = await fetch(`/api/renders/${id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('The render could not be deleted. Please try again.')
      },
    })
    if (!deleted) return
    setRenders(prev => prev.filter(r => r.id !== id))
    toast.success('Deleted')
  }

  const approved = renders.filter(r => r.approved)
  const waiting = renders.filter(r => !r.approved)
  const shown = tab === 'approved' ? approved : tab === 'waiting' ? waiting : renders
  const days = []
  for (const r of [...shown].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))) {
    const label = dayLabel(r.createdAt)
    if (days.at(-1)?.label !== label) days.push({ label, items: [] })
    days.at(-1).items.push(r)
  }

  return (
    <section aria-labelledby="renders-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="renders-title" className="font-bk-display text-[20px] font-bold tracking-[-0.03em]">Renders</h2>
          <p className="mt-1 text-[13.5px] text-bk-muted">Images of your posts downloaded from the editor. The API sends its images straight back and keeps no copy.</p>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedTabs label="Filter renders" value={tab} onChange={setTab} items={[['all', 'All', renders.length], ['waiting', 'To approve', waiting.length], ['approved', 'Approved', approved.length]]} />
          <button type="button" onClick={load} aria-label="Refresh renders" title="Refresh" className={appButton('outline', 'sm', 'size-10 px-0')}><RefreshCw className="size-4" /></button>
        </div>
      </div>
      <div className="mt-4 space-y-6">
        {loading ? (
          <div aria-label="Loading renders" className={cn(panelClass, 'h-48 motion-safe:animate-pulse')} />
        ) : days.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-bk-field px-6 py-14 text-center">
            {tab === 'approved' ? <CheckCheck className="size-6 text-bk-muted" /> : <ImageIcon className="size-6 text-bk-muted" />}
            <p className="mt-2.5 font-bk-display text-[17px] font-bold tracking-[-0.02em]">{tab === 'approved' ? 'Nothing approved yet' : tab === 'waiting' ? 'Nothing to approve' : 'No renders yet'}</p>
            <p className="mt-1 max-w-[380px] text-[13.5px] text-bk-muted">{tab === 'approved' ? 'Approve a render from the All tab.' : 'Download a post from the editor and it appears here.'}</p>
          </div>
        ) : days.map(day => (
          <section key={day.label} aria-label={day.label}>
            <h3 className="mb-2 flex items-baseline gap-2 text-[13px] font-bold">{day.label}<span className="font-normal text-bk-muted">{day.items.length} render{day.items.length === 1 ? '' : 's'}</span></h3>
            <ul className={cn(panelClass, 'divide-y divide-bk-line overflow-hidden')}>
              {day.items.map(r => <RenderRow key={r.id} render={r} onApprove={approve} onDelete={remove} origin={origin} />)}
            </ul>
          </section>
        ))}
      </div>
    </section>
  )
}
