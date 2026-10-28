'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ImageOff, Loader2, RefreshCw, Search, Sparkles, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAppShell, useBrandAccess } from '@/components/app/AppShell'
import { Popup, usePopup } from '@/components/app/popup'
import { appField } from '@/components/app/field'
import { EmptyState, PageHeader, SegmentedTabs, appButton, pageInner, pageShell, panelClass } from '@/components/app/ui'
import { cn } from '@/lib/utils'

// Cutouts are transparent PNGs, shown whole on a checkerboard so their missing background is visible.
const CHECKERBOARD = { backgroundImage: 'repeating-conic-gradient(rgb(var(--bk-fg) / 0.07) 0% 25%, transparent 0% 50%)', backgroundSize: '16px 16px' }
const previewUrl = asset => asset.subject?.url || asset.thumbnail_url || asset.url
const textareaClass = 'block w-full min-w-0 resize-y rounded-lg border border-bk-field bg-bk-surface px-3 py-2.5 text-[14px] leading-relaxed text-bk-fg outline-none transition-[border-color,box-shadow] placeholder:text-bk-muted/80 focus:border-bk-fg focus:shadow-[0_0_0_4px_rgb(255_216_77/0.45)] disabled:opacity-60'
const SORTS = [['newest', 'Newest'], ['used', 'Most used']]
// A cutout is used once by the post it was made for; every use after that is an image that was not generated again.
const uses = asset => Math.max(1, asset.usage_count || 1)
const shortDate = value => (value ? new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' }) : null)

function useWide() {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)')
    const update = () => setWide(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return wide
}

/** Shown where a cutout's file can no longer be loaded, so the entry can still be opened and deleted. */
function MissingImage({ className }) {
  return (
    <span className={cn('flex size-full flex-col items-center justify-center gap-1.5 text-bk-muted', className)}>
      <ImageOff className="size-6" aria-hidden="true" />
      <span className="text-[12px] font-semibold">Image missing</span>
    </span>
  )
}

/** One tile of the masonry: the cutout at its own shape, selected with a ring. */
function Tile({ asset, selected, onSelect }) {
  const [missing, setMissing] = useState(false)
  const ratio = asset.width && asset.height && !missing ? `${asset.width} / ${asset.height}` : '1 / 1'
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={asset.description || 'Cutout'}
      className={cn(
        'group relative mb-3 block w-full overflow-hidden rounded-xl bg-bk-surface shadow-bk-card transition-[box-shadow,transform] duration-200 [break-inside:avoid] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg',
        selected ? 'ring-2 ring-bk-fg ring-offset-2 ring-offset-bk-alt' : 'can-hover:-translate-y-0.5',
      )}
      style={{ aspectRatio: ratio, ...(missing ? {} : CHECKERBOARD) }}
    >
      {missing ? <MissingImage /> : <img src={previewUrl(asset)} alt="" loading="lazy" onError={() => setMissing(true)} className="size-full object-contain p-3" />}
      {uses(asset) > 1 && <span className="absolute left-2 top-2 rounded-md bg-bk-ink/80 px-1.5 py-0.5 text-[10.5px] font-bold text-bk-cream">Used {uses(asset)}×</span>}
    </button>
  )
}

/**
 * One cutout: preview, facts, what it shows (which decides where it is reused) and delete. Side panel or phone popup.
 * Someone who can only view the brand reads the description and changes nothing.
 */
function Inspector({ asset, onDelete, onSaved, onClose, compact }) {
  const { canEdit } = useBrandAccess()
  const [description, setDescription] = useState(asset.description || '')
  const [saving, setSaving] = useState(false)
  const [missing, setMissing] = useState(false)
  useEffect(() => { setDescription(asset.description || ''); setMissing(false) }, [asset.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveDescription = async () => {
    setSaving(true)
    try {
      const response = await fetch(`/api/assets/${asset.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brand_id: asset.brand_id, description }) })
      const data = await response.json()
      if (!response.ok) throw Error(data.error || 'The description could not be saved')
      onSaved(data)
      toast.success('Description saved')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  const facts = [
    ['Used in posts', `${uses(asset)}×`],
    ['Size', asset.subject?.width && asset.subject?.height ? `${asset.subject.width} × ${asset.subject.height}` : asset.width && asset.height ? `${asset.width} × ${asset.height}` : null],
    ['Last used', shortDate(asset.last_used_at)],
    ['Made', shortDate(asset.created_at)],
  ].filter(([, value]) => value)
  const changed = description.trim() !== (asset.description || '')

  return (
    <div className="space-y-5">
      <div className="flex max-h-[340px] min-h-40 items-center justify-center overflow-hidden rounded-xl bg-bk-alt" style={missing ? undefined : CHECKERBOARD}>
        {missing ? <MissingImage className="py-12" /> : <img src={previewUrl(asset)} alt={asset.description || 'Cutout'} onError={() => setMissing(true)} className="max-h-[340px] max-w-full object-contain p-4" />}
      </div>
      {!compact && (
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-[15px] font-bold">Cutout details</p>
          <button type="button" onClick={onClose} aria-label="Close details" className={appButton('quiet', 'xs', 'size-8 shrink-0 px-0')}><X className="size-4" /></button>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-bk-muted">{label}</dt>
            <dd className="mt-0.5 truncate text-[13.5px] tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <label htmlFor={`cutout-description-${asset.id}`} className="text-[13px] font-bold">What it shows</label>
        <textarea id={`cutout-description-${asset.id}`} value={description} onChange={e => setDescription(e.target.value)} readOnly={!canEdit} maxLength={2000} rows={4} className={cn(textareaClass, 'mt-2')} placeholder="Describe the subject and what it is doing, in any language." />
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-bk-muted">A new slide that needs this subject gets this cutout instead of a newly generated image.</p>
      </div>
      {canEdit && <div className="flex gap-2 border-t border-bk-line pt-4">
        <button type="button" onClick={() => onDelete(asset)} className={appButton('outline', 'md', 'text-[#C2412F] dark:text-[#F0826F]')}><Trash2 className="size-4" />Delete</button>
        <button type="button" onClick={saveDescription} disabled={saving || !changed || !description.trim()} className={appButton('primary', 'md', 'flex-1')}>
          {saving && <Loader2 className="size-4 animate-spin" />}{saving ? 'Saving…' : changed ? 'Save description' : 'Description saved'}
        </button>
      </div>}
    </div>
  )
}

/**
 * The brand gallery: the AI cutouts made for its posts and stories, kept so a later slide that needs the same subject
 * reuses one instead of generating it again. Only clean cutouts are saved (lib/services/generatedAssetLibrary.ts), and
 * nothing is uploaded here: people add their own photos to a post in Posts & stories.
 */
export default function Gallery({ flowId, brandContext }) {
  const brandId = flowId ? `brand_${flowId}` : null
  const brandName = brandContext?.name || 'Your brand'
  const creationHref = flowId ? `/app/${flowId}/creation` : '/app'
  const { setCount } = useAppShell()
  const popup = usePopup()
  const wide = useWide()
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('newest')

  const loadAssets = useCallback(async () => {
    if (!brandId) { setLoading(false); return }
    try {
      const res = await fetch(`/api/assets?brand_id=${encodeURIComponent(brandId)}`)
      const data = await res.json()
      setAssets(Array.isArray(data) ? data : [])
    } catch {
      toast.error('The gallery could not be loaded')
    } finally {
      setLoading(false)
    }
  }, [brandId])

  useEffect(() => { loadAssets() }, [loadAssets])
  useEffect(() => { if (!loading) setCount('gallery', assets.length) }, [loading, assets.length, setCount])

  const handleDelete = async asset => {
    const deleted = await popup.confirm({
      title: 'Delete this cutout?',
      description: 'It leaves the gallery and won’t be reused in new posts. Posts that already show it keep it.',
      tone: 'danger',
      confirmLabel: 'Delete cutout',
      busyLabel: 'Deleting…',
      action: async () => {
        const res = await fetch(`/api/assets/${asset.id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('The cutout could not be deleted. Please try again.')
      },
    })
    if (!deleted) return
    setAssets(prev => prev.filter(a => a.id !== asset.id))
    setSelectedId(null)
    toast.success('Cutout deleted')
  }

  const query = search.trim().toLowerCase()
  const filtered = assets
    .filter(a => !query || [a.description, a.subject_description].some(v => v?.toLowerCase().includes(query)) || a.tags?.some(t => t.toLowerCase().includes(query)))
    .sort((a, b) => (sort === 'used' ? uses(b) - uses(a) : 0) || new Date(b.created_at || 0) - new Date(a.created_at || 0))
  const selected = assets.find(a => a.id === selectedId) || null
  const reuses = assets.reduce((sum, a) => sum + uses(a) - 1, 0)
  const onSaved = asset => setAssets(prev => prev.map(a => (a.id === asset.id ? asset : a)))

  // Arrow keys step through the visible cutouts while one is open.
  useEffect(() => {
    if (!selectedId) return
    const onKey = e => {
      if (e.target.closest?.('input, textarea, [role="dialog"]')) return
      if (e.key === 'Escape') { setSelectedId(null); return }
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      const index = filtered.findIndex(a => a.id === selectedId)
      const next = filtered[index + (e.key === 'ArrowRight' ? 1 : -1)]
      if (next) { e.preventDefault(); setSelectedId(next.id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const overview = (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3">
        {[['Cutouts', assets.length], ['Times reused', reuses]].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-bk-alt px-3.5 py-3">
            <dt className="text-[11.5px] font-semibold text-bk-muted">{label}</dt>
            <dd className="mt-0.5 font-bk-display text-[22px] font-bold tabular-nums tracking-[-0.03em]">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[13px] leading-relaxed text-bk-muted">
        When a slide needs a subject, Batkle looks here first. A cutout that fits is placed again, so no new image is generated. Only clean cutouts are kept: the background fully removed and the subject whole.
      </p>
      <div className="rounded-xl bg-bk-alt px-3.5 py-3">
        <p className="text-[13px] font-bold">Your own photos</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-bk-muted">Add them to a post or story when you write the idea.</p>
        <Link href={creationHref} className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold underline-offset-4 hover:underline">Go to Posts & stories<ArrowRight className="size-3.5" /></Link>
      </div>
    </div>
  )

  return (
    <div className={pageShell}>
      <div className={pageInner}>
        <PageHeader
          eyebrow={`${brandName} · Gallery`}
          title="Gallery"
          description="AI cutouts made for your posts and stories, saved so a matching slide reuses one instead of generating it again."
          actions={(
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <div className="relative min-w-0 flex-1 sm:w-[260px] sm:flex-none">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-bk-muted" aria-hidden="true" />
                <input type="search" aria-label="Search cutouts" placeholder="Search cutouts" value={search} onChange={e => setSearch(e.target.value)} className={appField('h-9 pl-9 text-[14px]')} />
              </div>
              <button type="button" onClick={loadAssets} aria-label="Refresh" title="Refresh" className={appButton('outline', 'sm', 'size-9 px-0')}><RefreshCw className="size-4" /></button>
            </div>
          )}
        />

        {!brandId ? (
          <p className="mt-10 text-center text-[14px] text-bk-muted">Save your brand profile first to use the gallery.</p>
        ) : (
          <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0">
              {assets.length > 1 && <SegmentedTabs items={SORTS} value={sort} onChange={setSort} label="Order" className="mb-4 w-fit" />}
              {loading ? (
                <div aria-label="Loading cutouts" className="columns-2 gap-3 sm:columns-3 xl:columns-4">
                  {[1, 1.3, 0.8, 1.1, 0.9, 1.25, 1, 0.75].map((r, i) => <div key={i} className="mb-3 rounded-xl bg-bk-surface motion-safe:animate-pulse" style={{ aspectRatio: `1 / ${r}` }} />)}
                </div>
              ) : filtered.length > 0 ? (
                <div className="columns-2 gap-3 sm:columns-3 xl:columns-4">
                  {filtered.map(asset => <Tile key={asset.id} asset={asset} selected={asset.id === selectedId} onSelect={() => setSelectedId(asset.id === selectedId ? null : asset.id)} />)}
                </div>
              ) : search ? (
                <EmptyState icon={Search} title="No matching cutouts" action={<button type="button" onClick={() => setSearch('')} className={appButton('outline', 'sm')}>Clear search</button>}>
                  Nothing here matches “{search}”.
                </EmptyState>
              ) : (
                <EmptyState icon={Sparkles} title="No cutouts yet" action={<Link href={creationHref} className={appButton('primary', 'sm')}>Create a post<ArrowRight className="size-3.5" /></Link>}>
                  When a post or story gets an AI image, its cutout is saved here and reused whenever a later slide needs the same subject.
                </EmptyState>
              )}
              {!wide && !loading && <div className={cn(panelClass, 'mt-6 p-5 lg:hidden')}>{overview}</div>}
            </div>

            <aside aria-label={selected ? 'Cutout details' : 'About the gallery'} className={cn(panelClass, 'hidden p-5 lg:sticky lg:top-8 lg:block lg:max-h-[calc(100dvh-64px)] lg:overflow-y-auto')}>
              {selected && wide
                ? <Inspector key={selected.id} asset={selected} onDelete={handleDelete} onSaved={onSaved} onClose={() => setSelectedId(null)} />
                : overview}
            </aside>
          </div>
        )}
      </div>

      {/* Phones and tablets open the details in a popup instead of the side panel. */}
      {selected && !wide && (
        <Popup open onOpenChange={open => !open && setSelectedId(null)} title="Cutout details" size="lg">
          <Inspector key={selected.id} asset={selected} compact onDelete={handleDelete} onSaved={onSaved} onClose={() => setSelectedId(null)} />
        </Popup>
      )}
    </div>
  )
}
