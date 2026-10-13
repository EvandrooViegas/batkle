'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Copy, Download, Image as ImageIcon, Layers, Loader2, Plus, Search, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { CanvasPreview } from '@/components/CanvasPreview'
import { Popup, shortName, usePopup } from '@/components/app/popup'
import { appField } from '@/components/app/field'
import { BrandTile, Eyebrow, SegmentedTabs, appButton, brandLogo, displayClass } from '@/components/app/ui'
import { cn } from '@/lib/utils'

const iconButton = 'inline-flex size-8 items-center justify-center rounded-lg text-bk-fg transition-colors hover:bg-bk-alt focus-visible:outline focus-visible:outline-2 focus-visible:outline-bk-fg [&_svg]:size-4'
const UNLINKED = 'unlinked'

// A post belongs to the brand it was made for: saved directly, or kept with its design input.
const brandIdOf = c => c.flowId || c.designInput?.brandContext?.id || c.brandContext?.id || null
const updatedLabel = date => (date ? new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '')

function DesignCard({ canvas, onDuplicate, onExport, onDelete, size = 'md' }) {
  const carousel = canvas.type === 'carousel'
  return (
    <article className="group flex h-full flex-col">
      <Link
        href={`/editor/${canvas.id}`}
        aria-label={`Open ${canvas.name || 'design'}`}
        className="relative block overflow-hidden rounded-xl bg-bk-surface shadow-bk-card transition-transform duration-200 can-hover:-translate-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg"
        style={{ aspectRatio: `${canvas.width || 1080} / ${canvas.height || 1080}` }}
      >
        <CanvasPreview canvas={canvas} />
        {carousel && (
          <>
            {/* A carousel shows the edge of the next slide behind it. */}
            <span aria-hidden="true" className="absolute inset-y-3 -right-1 w-2 rounded-l bg-black/10" />
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-bk-ink/80 px-1.5 py-0.5 text-[11px] font-bold text-bk-cream"><Layers className="size-3" />{canvas.pages?.length || 0}</span>
          </>
        )}
      </Link>
      <div className="mt-2.5 flex min-w-0 items-start gap-1">
        <div className="min-w-0 flex-1">
          <h3 className={cn('line-clamp-2 font-bold leading-snug', size === 'lg' ? 'text-[15px]' : 'text-[13px]')}>{canvas.name?.split(/\s+[—–]\s+/).slice(1).join(' — ') || canvas.name || 'Untitled design'}</h3>
          <p className="mt-0.5 text-[12px] text-bk-muted">{carousel ? `${canvas.pages?.length || 0} slides` : 'Single post'} · {updatedLabel(canvas.updatedAt)}</p>
        </div>
      </div>
      <div className="mt-1 flex items-center opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
        <button type="button" onClick={() => onDuplicate(canvas.id)} aria-label="Duplicate" title="Duplicate" className={iconButton}><Copy /></button>
        <button type="button" onClick={() => onExport(canvas)} aria-label="Export as JSON" title="Export as JSON" className={iconButton}><Download /></button>
        <button type="button" onClick={() => onDelete(canvas.id)} aria-label="Delete" title="Delete" className={cn(iconButton, 'ml-auto text-bk-muted hover:bg-[#C2412F]/10 hover:text-[#C2412F]')}><Trash2 /></button>
      </div>
    </article>
  )
}

/** Every design in the account: recent work first, then a shelf per brand. Search or a filter shows one flat grid. */
export default function StudioBoard({ flows = [] }) {
  const router = useRouter()
  const popup = usePopup()
  const [canvases, setCanvases] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [canvasType, setCanvasType] = useState('single')
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const importFileRef = useRef(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/canvases')
      const data = await res.json()
      setCanvases(Array.isArray(data) ? data : [])
    } catch {
      toast.error('Your designs could not be loaded')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const createCanvas = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/canvases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || 'Untitled design', type: canvasType, width: 1080, height: canvasType === 'carousel' ? 1350 : 1080 }),
      })
      const c = await res.json()
      if (!res.ok || !c.id) throw new Error(c.error || 'The design could not be created')
      setOpen(false); setName(''); setCanvasType('single')
      router.push(`/editor/${c.id}`)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setCreating(false)
    }
  }

  const importCanvas = async (file) => {
    if (!file) return
    setImporting(true)
    try {
      const config = JSON.parse(await file.text())
      const { id: _id, _id: __id, createdAt, updatedAt, ...data } = config
      if (!data.name) data.name = file.name.replace(/\.kand\.json$/i, '').replace(/-/g, ' ') || 'Imported design'
      const createRes = await fetch('/api/canvases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.name, width: data.width, height: data.height, background: data.background }),
      })
      const newCanvas = await createRes.json()
      if (!newCanvas.id) throw new Error('The design could not be created')
      await fetch(`/api/canvases/${newCanvas.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, id: newCanvas.id }),
      })
      toast.success('Design imported')
      router.push(`/editor/${newCanvas.id}`)
    } catch (e) {
      toast.error('Import failed: ' + (e.message || 'the file is not a design export'))
    } finally {
      setImporting(false)
      if (importFileRef.current) importFileRef.current.value = ''
    }
  }

  const exportCanvas = (canvas) => {
    const { _id, createdAt, updatedAt, ...exportData } = canvas
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${(canvas.name || 'canvas').replace(/[^a-z0-9]/gi, '-').toLowerCase()}.kand.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Exported')
  }

  const deleteCanvas = async (id) => {
    const designName = canvases.find(c => c.id === id)?.name
    const deleted = await popup.confirm({
      title: designName ? `Delete “${shortName(designName)}”?` : 'Delete this design?',
      description: 'The design is removed permanently. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete design',
      busyLabel: 'Deleting…',
      action: async () => {
        const res = await fetch(`/api/canvases/${id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('The design could not be deleted. Please try again.')
      },
    })
    if (deleted) { toast.success('Deleted'); load() }
  }

  const duplicateCanvas = async (id) => {
    const res = await fetch(`/api/canvases/${id}/duplicate`, { method: 'POST' })
    if (res.ok) { toast.success('Duplicated'); load() } else toast.error('The design could not be duplicated')
  }

  const sorted = useMemo(() => [...canvases].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)), [canvases])
  const brands = useMemo(() => new Map(flows.map(f => [f.id, f])), [flows])
  const shelves = useMemo(() => {
    const groups = new Map()
    for (const c of sorted) {
      const id = brands.has(brandIdOf(c)) ? brandIdOf(c) : UNLINKED
      if (!groups.has(id)) groups.set(id, [])
      groups.get(id).push(c)
    }
    // Brands in the order they were last used, unlinked designs last.
    return [...flows.map(f => f.id), UNLINKED].filter(id => groups.has(id)).map(id => ({ id, flow: brands.get(id), items: groups.get(id) }))
  }, [sorted, brands, flows])
  const counts = { all: canvases.length, single: canvases.filter(c => c.type !== 'carousel').length, carousel: canvases.filter(c => c.type === 'carousel').length }
  const narrowed = filter !== 'all' || query.trim()
  const results = sorted
    .filter(c => (filter === 'all' ? true : filter === 'carousel' ? c.type === 'carousel' : c.type !== 'carousel'))
    .filter(c => !query.trim() || String(c.name || '').toLowerCase().includes(query.trim().toLowerCase()))
  const cardProps = { onDuplicate: duplicateCanvas, onExport: exportCanvas, onDelete: deleteCanvas }

  return (
    <div>
      <div className="mx-auto max-w-[1240px] px-4 pb-24 pt-8 sm:px-6 lg:pt-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>Batkle · Studio</Eyebrow>
            <h1 className={cn(displayClass, 'mt-1.5 text-[clamp(30px,3.4vw,44px)] leading-[1.02]')}>All your designs</h1>
            <p className="mt-2 max-w-[560px] text-[14px] text-bk-muted">{loading ? 'Loading…' : `${counts.all} designs across ${shelves.filter(s => s.id !== UNLINKED).length} brand${shelves.filter(s => s.id !== UNLINKED).length === 1 ? '' : 's'}. Open one to edit it, or start a blank design.`}</p>
          </div>
          <div className="flex items-center gap-2">
            <input ref={importFileRef} type="file" accept=".json,.kand.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importCanvas(f) }} />
            <button type="button" onClick={() => importFileRef.current?.click()} disabled={importing} className={appButton('outline', 'sm')}>
              {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}{importing ? 'Importing…' : 'Import'}
            </button>
            <button type="button" onClick={() => setOpen(true)} className={appButton('primary', 'sm')}><Plus className="size-4" />New design</button>
          </div>
        </header>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <SegmentedTabs label="Filter designs" value={filter} onChange={setFilter} items={[['all', 'All', counts.all], ['single', 'Single posts', counts.single], ['carousel', 'Carousels', counts.carousel]]} />
          <div className="relative w-full sm:w-[300px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-bk-muted" aria-hidden="true" />
            <input type="search" aria-label="Search designs" placeholder="Search by name" value={query} onChange={e => setQuery(e.target.value)} className={appField('h-10 pl-9 text-[14px]')} />
          </div>
        </div>

        {loading ? (
          <div aria-label="Loading designs" className="mt-8 grid grid-cols-2 gap-5 sm:grid-cols-4">
            {[0, 1, 2, 3].map(i => <div key={i} className="aspect-[4/5] rounded-xl bg-bk-surface motion-safe:animate-pulse" />)}
          </div>
        ) : canvases.length === 0 ? (
          <div className="mt-8 flex flex-col items-center rounded-[28px] bg-bk-ink px-6 py-16 text-center text-bk-cream">
            <ImageIcon className="size-7 opacity-80" />
            <p className="mt-3 font-bk-display text-[26px] font-bold tracking-[-0.03em]">No designs yet</p>
            <p className="mt-1 max-w-[400px] text-[14px] text-bk-cream/70">Generate posts from a brand’s Creation page, or start a blank design.</p>
            <button type="button" onClick={() => setOpen(true)} className={appButton('primary', 'md', 'mt-5')}><Plus className="size-4" />New design</button>
          </div>
        ) : narrowed ? (
          results.length ? (
            <ul className="mt-8 grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-5">
              {results.map(c => <li key={c.id} className="min-w-0"><DesignCard canvas={c} {...cardProps} /></li>)}
            </ul>
          ) : <p className="mt-10 text-center text-[14px] text-bk-muted">Nothing matches. Try another name or filter.</p>
        ) : (
          <>
            <section aria-labelledby="recent-title" className="mt-8">
              <h2 id="recent-title" className="font-bk-display text-[20px] font-bold tracking-[-0.03em]">Continue where you left off</h2>
              <ul className="mt-4 grid grid-cols-2 gap-5 md:grid-cols-4">
                {sorted.slice(0, 4).map(c => <li key={c.id} className="min-w-0"><DesignCard canvas={c} size="lg" {...cardProps} /></li>)}
              </ul>
            </section>

            {shelves.map(({ id, flow, items }) => {
              const brandName = id === UNLINKED ? 'Not linked to a brand' : flow.brandContext?.name || flow.name || 'Brand'
              const logo = flow ? brandLogo(flow.brandContext) : null
              return (
                <section key={id} aria-label={brandName} className="mt-12">
                  <div className="flex items-center justify-between gap-3 border-b border-bk-line pb-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {flow ? <BrandTile name={brandName} logo={logo.src} logoOnDark={logo.onDark} size={36} /> : <span className="flex size-9 items-center justify-center rounded-lg bg-bk-chip text-bk-muted"><ImageIcon className="size-4" /></span>}
                      <h2 className="min-w-0 truncate font-bk-display text-[20px] font-bold tracking-[-0.03em]">{brandName}</h2>
                      <span className="shrink-0 rounded-full bg-bk-chip px-2 py-0.5 text-[12px] font-bold tabular-nums">{items.length}</span>
                    </div>
                    {flow && <Link href={`/app/${id}/creation`} className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold hover:underline hover:underline-offset-4">Open brand<ArrowRight className="size-3.5" /></Link>}
                  </div>
                  <ul className="-mx-4 mt-4 flex snap-x gap-5 overflow-x-auto px-4 pb-3 [scrollbar-width:thin] sm:-mx-6 sm:px-6">
                    {items.map(c => <li key={c.id} className="w-[168px] shrink-0 snap-start sm:w-[190px]"><DesignCard canvas={c} {...cardProps} /></li>)}
                  </ul>
                </section>
              )
            })}
          </>
        )}
      </div>

      <Popup
        open={open}
        onOpenChange={(v) => { setOpen(v); if (!v) { setName(''); setCanvasType('single') } }}
        title="New design"
        description="Pick a format and give the design a name."
        size="sm"
        footer={<>
          <button type="button" onClick={() => setOpen(false)} className={appButton('outline', 'md')}>Cancel</button>
          <button type="button" onClick={createCanvas} disabled={creating} className={appButton('primary', 'md')}>{creating && <Loader2 className="size-4 animate-spin" />}Create design</button>
        </>}
      >
        <div className="space-y-4">
          <div role="radiogroup" aria-label="Format" className="grid grid-cols-2 gap-3">
            {[['single', 'Single post', ImageIcon], ['carousel', 'Carousel', Layers]].map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={canvasType === value}
                onClick={() => setCanvasType(value)}
                className={cn('rounded-xl border-2 p-4 text-[14px] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg', canvasType === value ? 'border-bk-fg bg-bk-alt' : 'border-bk-line hover:border-bk-field')}
              >
                <Icon className="mx-auto mb-2 size-5" />
                {label}
              </button>
            ))}
          </div>
          <input aria-label="Design name" placeholder="Design name" value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && createCanvas()} className={appField()} />
        </div>
      </Popup>
    </div>
  )
}
