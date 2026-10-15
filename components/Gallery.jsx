'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, ImageIcon, ImageOff, Loader2, RefreshCw, Search, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAppShell } from '@/components/app/AppShell'
import { Popup, usePopup } from '@/components/app/popup'
import { appField } from '@/components/app/field'
import { billingAction } from '@/lib/client/billing'
import { DIRECT_MAX_BYTES, uploadFile } from '@/lib/client/directUpload'
import { Eyebrow, appButton, displayClass, pageShell, panelClass } from '@/components/app/ui'
import { cn } from '@/lib/utils'

const uploadKey = file => JSON.stringify([file.name, file.size, file.lastModified])

// Images go straight to storage, up to 25 MB. Where the server cannot take them that way, they travel inside the
// request instead, and uploadFile refuses those over 3 MB (the host's 4.5 MB limit on requests).
const MAX_UPLOAD_MB = DIRECT_MAX_BYTES / 1024 / 1024

// Transparent PNG cutouts are shown whole, on a checkerboard, so their missing background is visible.
const CHECKERBOARD = { backgroundImage: 'repeating-conic-gradient(rgb(var(--bk-fg) / 0.07) 0% 25%, transparent 0% 50%)', backgroundSize: '16px 16px' }
const isCutout = asset => asset.source === 'ai_generated' || !!asset.subject?.url
const previewUrl = asset => asset.subject?.url || asset.thumbnail_url || asset.url
const textareaClass = 'block w-full min-w-0 resize-y rounded-lg border border-bk-field bg-bk-surface px-3 py-2.5 text-[14px] leading-relaxed text-bk-fg outline-none transition-[border-color,box-shadow] placeholder:text-bk-muted/80 focus:border-bk-fg focus:shadow-[0_0_0_4px_rgb(255_216_77/0.45)] disabled:opacity-60'

// Where an image came from decides the filter it is listed under.
const kindOf = asset => (asset.source === 'ai_generated' ? 'cutout' : asset.source === 'website' ? 'website' : asset.source === 'post_upload' ? 'post' : 'upload')
const KINDS = [['all', 'Everything'], ['website', 'From your website'], ['upload', 'Your uploads'], ['post', 'Post photos'], ['cutout', 'AI cutouts']]
const KIND_LABEL = { website: 'From your website', upload: 'Uploaded by you', post: 'Attached to a post', cutout: 'AI cutout' }

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

/** Shown where an image file can no longer be loaded, so the entry can still be opened and deleted. */
function MissingImage({ className }) {
  return (
    <span className={cn('flex size-full flex-col items-center justify-center gap-1.5 text-bk-muted', className)}>
      <ImageOff className="size-6" aria-hidden="true" />
      <span className="text-[12px] font-semibold">Image missing</span>
    </span>
  )
}

/** A local preview of a file waiting to upload; its object URL is released when it leaves. */
function FileThumb({ file }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  return <span className="block size-16 shrink-0 overflow-hidden rounded-lg border border-bk-line bg-bk-alt">{src && <img src={src} alt="" className="size-full object-cover" />}</span>
}

/** One tile of the masonry: the image at its own shape, selected with a ring. */
function Tile({ asset, selected, onSelect }) {
  const cutout = isCutout(asset)
  const [missing, setMissing] = useState(false)
  const ratio = asset.width && asset.height && !missing ? `${asset.width} / ${asset.height}` : '1 / 1'
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={asset.description || asset.filename || 'Image'}
      className={cn(
        'group relative mb-3 block w-full overflow-hidden rounded-xl bg-bk-surface transition-[box-shadow,transform] duration-200 [break-inside:avoid] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg',
        selected ? 'ring-2 ring-bk-fg ring-offset-2 ring-offset-bk-alt' : 'can-hover:-translate-y-0.5 hover:shadow-bk-card',
      )}
      style={{ aspectRatio: ratio, ...(cutout && !missing ? CHECKERBOARD : {}) }}
    >
      {missing ? <MissingImage /> : <img src={previewUrl(asset)} alt="" loading="lazy" onError={() => setMissing(true)} className={cutout ? 'size-full object-contain p-3' : 'size-full object-cover'} />}
      {asset.status !== 'ready' && (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-bk-ink/55 text-[12px] font-semibold text-white">
          {asset.status === 'processing' ? <Loader2 className="size-5 animate-spin" /> : <AlertCircle className="size-5 text-[#F0826F]" />}
          {asset.status === 'processing' ? 'Analysing' : 'Analysis failed'}
        </span>
      )}
      {cutout && asset.usage_count > 1 && <span className="absolute left-2 top-2 rounded-md bg-bk-ink/80 px-1.5 py-0.5 text-[10.5px] font-bold text-bk-cream">Used {asset.usage_count}×</span>}
      {!asset.description && asset.status === 'ready' && !missing && <span className="absolute right-2 top-2 size-2.5 rounded-full bg-bk-butter ring-2 ring-white" title="No description yet" />}
    </button>
  )
}

/** Everything about one image: preview, facts, description and delete. Used in the side panel and the phone popup. */
function Inspector({ asset, onDelete, onSaved, onClose, compact }) {
  const [description, setDescription] = useState(asset.description || '')
  const [saving, setSaving] = useState(false)
  const [missing, setMissing] = useState(false)
  const cutout = isCutout(asset)
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
    ['Source', KIND_LABEL[kindOf(asset)]],
    ['Size', asset.width && asset.height ? `${asset.width} × ${asset.height}` : null],
    ['Orientation', asset.orientation],
    ['Format', cutout ? 'Transparent PNG' : asset.mime_type],
    ['Used in posts', asset.source === 'ai_generated' ? `${asset.usage_count || 1}×` : null],
    ['Added', asset.created_at ? new Date(asset.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' }) : null],
  ].filter(([, value]) => value)
  const changed = description !== (asset.description || '')

  return (
    <div className="space-y-5">
      <div className="flex max-h-[340px] min-h-40 items-center justify-center overflow-hidden rounded-xl bg-bk-alt" style={cutout && !missing ? CHECKERBOARD : undefined}>
        {missing ? <MissingImage className="py-12" /> : <img src={cutout ? previewUrl(asset) : asset.url} alt={asset.description || asset.filename || ''} onError={() => setMissing(true)} className="max-h-[340px] max-w-full object-contain" />}
      </div>
      {!compact && (
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 break-words text-[15px] font-bold">{asset.filename || 'Image'}</p>
          <button type="button" onClick={onClose} aria-label="Close details" className={appButton('quiet', 'xs', 'size-8 shrink-0 px-0')}><X className="size-4" /></button>
        </div>
      )}
      {asset.status !== 'ready' && <p className={cn('flex items-center gap-1.5 text-[12.5px] font-semibold', asset.status === 'processing' ? 'text-[#9A6B00] dark:text-[#F2C14E]' : 'text-[#C2412F] dark:text-[#F0826F]')}>{asset.status === 'processing' ? <Loader2 className="size-3.5 animate-spin" /> : <AlertCircle className="size-3.5" />}{asset.status === 'processing' ? 'Batkle is still reading this image' : 'The image could not be analysed'}</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-bk-muted">{label}</dt>
            <dd className={cn('mt-0.5 truncate text-[13.5px]', label === 'Orientation' && 'capitalize')}>{value}</dd>
          </div>
        ))}
      </dl>
      {asset.source_page && <a href={asset.source_page} target="_blank" rel="noreferrer" className="inline-block text-[13px] font-semibold underline underline-offset-4">View the website page it came from</a>}
      <div>
        <label htmlFor={`asset-description-${asset.id}`} className="text-[13px] font-bold">Description</label>
        <textarea id={`asset-description-${asset.id}`} value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} rows={4} className={cn(textareaClass, 'mt-2')} placeholder="Describe the subject, activity and setting, in any language." />
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-bk-muted">
          {asset.source === 'ai_generated' ? 'Used to decide when this cutout fits a new slide, so posts reuse it instead of generating a new image.' : 'Used to match this image to the right slides. Your wording is kept as written.'}
        </p>
      </div>
      {asset.tags?.length > 0 && (
        <ul aria-label="Tags" className="flex flex-wrap gap-1.5">
          {asset.tags.map(tag => <li key={tag} className="rounded-md bg-bk-chip px-2 py-0.5 text-[12.5px] font-semibold">{tag}</li>)}
        </ul>
      )}
      <div className="flex gap-2 border-t border-bk-line pt-4">
        <button type="button" onClick={() => onDelete(asset)} className={appButton('outline', 'md', 'text-[#C2412F] dark:text-[#F0826F]')}><Trash2 className="size-4" />Delete</button>
        <button type="button" onClick={saveDescription} disabled={saving || !changed} className={appButton('primary', 'md', 'flex-1')}>
          {saving && <Loader2 className="size-4 animate-spin" />}{saving ? 'Saving…' : changed ? 'Save description' : 'Description saved'}
        </button>
      </div>
    </div>
  )
}

/** The brand's images as a media library: a masonry of every image, filtered by where it came from, with an inspector beside it. */
export default function Gallery({ flowId, brandContext }) {
  const brandId = flowId ? `brand_${flowId}` : null
  const brandName = brandContext?.name || 'Your brand'
  const { setCount } = useAppShell()
  const popup = usePopup()
  const wide = useWide()
  const inputRef = useRef(null)
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('all')
  const [pendingFiles, setPendingFiles] = useState([])
  const [uploadDescriptions, setUploadDescriptions] = useState({})

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

  // Analysis can take minutes on a first run: check every 15 s, for at most 20 minutes.
  useEffect(() => {
    const processingIds = assets.filter(a => a.status === 'processing').map(a => a.id)
    if (processingIds.length === 0) return
    let attempts = 0
    const interval = setInterval(async () => {
      attempts++
      const updated = await Promise.all(processingIds.map(id => fetch(`/api/assets/${id}`).then(r => r.json()).catch(() => null)))
      setAssets(prev => {
        let changed = false
        const next = prev.map(a => {
          const u = updated.find(item => item?.id === a.id)
          if (u && u.status !== a.status) { changed = true; return u }
          return a
        })
        return changed ? next : prev
      })
      if (!updated.some(u => u?.status === 'processing') || attempts >= 80) clearInterval(interval)
    }, 15000)
    return () => clearInterval(interval)
  }, [assets.map(a => a.id + a.status).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const chooseFiles = files => {
    const images = [...files].filter(f => f.type.startsWith('image/'))
    if (!images.length) { toast.error('Choose image files (PNG, JPG or WEBP)'); return }
    const valid = images.filter(f => f.size <= MAX_UPLOAD_MB * 1024 * 1024)
    for (const file of images) if (!valid.includes(file)) toast.error(`${file.name} is larger than ${MAX_UPLOAD_MB} MB. Use a smaller image.`)
    if (!valid.length) return
    setPendingFiles(valid)
    setUploadDescriptions({})
    setSelectedId(null)
  }

  const handleFiles = async (files) => {
    if (!brandId) { toast.error('No brand selected'); return }
    setUploading(true)
    let successCount = 0
    for (const file of files) {
      try {
        const asset = await uploadFile('/api/assets', file, { purpose: 'gallery', fields: { filename: file.name, brand_id: brandId, description: uploadDescriptions[uploadKey(file)] || '' } })
        setAssets(prev => [asset, ...prev])
        setPendingFiles(prev => prev.filter(item => item !== file))
        successCount++
      } catch (err) {
        // A plan limit stops the rest too: say so once, with the way to more space.
        if (err.code) {
          const { href, label } = billingAction(err)
          toast.error(err.message, { duration: 12000, action: { label, onClick: () => window.location.assign(href) } })
          break
        }
        toast.error(`${file.name}: ${err.message}`)
      }
    }
    setUploading(false)
    if (successCount > 0) {
      setKind('all')
      toast.success(`${successCount} image${successCount > 1 ? 's' : ''} uploaded. Batkle is reading ${successCount > 1 ? 'them' : 'it'} in the background.`)
    }
  }

  const handleDelete = async asset => {
    const deleted = await popup.confirm({
      title: 'Delete this image?',
      description: 'It is removed from the gallery and will not be used in new posts. Posts that already use it keep it.',
      tone: 'danger',
      confirmLabel: 'Delete image',
      busyLabel: 'Deleting…',
      action: async () => {
        const res = await fetch(`/api/assets/${asset.id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('The image could not be deleted. Please try again.')
      },
    })
    if (!deleted) return
    setAssets(prev => prev.filter(a => a.id !== asset.id))
    setSelectedId(null)
    toast.success('Image deleted')
  }

  const counts = Object.fromEntries(KINDS.map(([key]) => [key, key === 'all' ? assets.length : assets.filter(a => kindOf(a) === key).length]))
  const filtered = assets.filter(a => {
    if (kind !== 'all' && kindOf(a) !== kind) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return [a.filename, a.description, a.environment, a.activity, a.asset_type].some(v => v?.toLowerCase().includes(q))
      || a.tags?.some(t => t.toLowerCase().includes(q)) || a.objects?.some(o => o.toLowerCase().includes(q))
  })
  const selected = assets.find(a => a.id === selectedId) || null
  const processingCount = assets.filter(a => a.status === 'processing').length
  const undescribed = assets.filter(a => a.status === 'ready' && !a.description).length

  // Arrow keys step through the visible images while one is open.
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

  const staging = pendingFiles.length > 0 && (
    <section aria-labelledby="pending-title" className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="pending-title" className="text-[15px] font-bold">Describe your {pendingFiles.length === 1 ? 'image' : `${pendingFiles.length} images`}</h2>
          <p className="mt-0.5 text-[13px] text-bk-muted">Optional. A short description helps Batkle place each photo on the right slide.</p>
        </div>
        <button type="button" onClick={() => setPendingFiles([])} disabled={uploading} aria-label="Cancel upload" className={appButton('quiet', 'xs', 'size-8 shrink-0 px-0')}><X className="size-4" /></button>
      </div>
      <ul className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
        {pendingFiles.map((file, index) => (
          <li key={file.name + index} className="flex gap-3">
            <FileThumb file={file} />
            <label className="min-w-0 flex-1 text-[12.5px] font-semibold">
              <span className="block truncate">{file.name}</span>
              <textarea rows={2} maxLength={2000} disabled={uploading} value={uploadDescriptions[uploadKey(file)] || ''} onChange={e => setUploadDescriptions(prev => ({ ...prev, [uploadKey(file)]: e.target.value }))} placeholder="What does it show?" className={cn(textareaClass, 'mt-1 font-normal')} />
            </label>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => handleFiles([...pendingFiles])} disabled={uploading} className={appButton('primary', 'md', 'w-full')}>
        {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}{uploading ? 'Uploading…' : `Upload ${pendingFiles.length === 1 ? 'image' : `${pendingFiles.length} images`}`}
      </button>
    </section>
  )

  const dropzone = (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      className={cn('flex w-full flex-col items-center rounded-2xl border-2 border-dashed px-5 py-8 text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg', dragging ? 'border-bk-fg bg-bk-butter/15' : 'border-bk-field hover:border-bk-fg/50')}
    >
      <span className="flex size-11 items-center justify-center rounded-2xl bg-bk-butter text-bk-ink"><Upload className="size-5" /></span>
      <span className="mt-3 text-[15px] font-bold">Drop photos anywhere</span>
      <span className="mt-1 text-[12.5px] text-bk-muted">or click to choose. PNG, JPG or WEBP, up to {MAX_UPLOAD_MB} MB each.</span>
    </button>
  )

  const sidePanel = staging || (selected && wide ? (
    <Inspector key={selected.id} asset={selected} onDelete={handleDelete} onSaved={asset => setAssets(prev => prev.map(a => (a.id === asset.id ? asset : a)))} onClose={() => setSelectedId(null)} />
  ) : (
    <div className="space-y-5">
      {dropzone}
      <dl className="grid grid-cols-2 gap-3">
        {[['Images', assets.length], ['AI cutouts', counts.cutout], ['Need a description', undescribed], ['Being read', processingCount]].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-bk-alt px-3.5 py-3">
            <dt className="text-[11.5px] font-semibold text-bk-muted">{label}</dt>
            <dd className="mt-0.5 font-bk-display text-[22px] font-bold tabular-nums tracking-[-0.03em]">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[12.5px] leading-relaxed text-bk-muted">Select an image to see its details and description. Images with a yellow dot have no description yet; describing them helps Batkle use them well.</p>
    </div>
  ))

  return (
    <div
      className={pageShell}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
      onDrop={e => { if (e.dataTransfer.files?.length) { e.preventDefault(); setDragging(false); chooseFiles(e.dataTransfer.files) } }}
    >
      <div className="mx-auto max-w-[1360px]">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>{brandName} · Gallery</Eyebrow>
            <h1 className={cn(displayClass, 'mt-1.5 text-[clamp(26px,2.6vw,34px)] leading-[1.05]')}>Gallery</h1>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:w-[280px] sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-bk-muted" aria-hidden="true" />
              <input type="search" aria-label="Search images" placeholder="Search images" value={search} onChange={e => setSearch(e.target.value)} className={appField('h-9 pl-9 text-[14px]')} />
            </div>
            <button type="button" onClick={loadAssets} aria-label="Refresh" title="Refresh" className={appButton('outline', 'sm', 'size-9 px-0')}><RefreshCw className="size-4" /></button>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading || !brandId} className={appButton('primary', 'sm', 'h-9')}><Upload className="size-4" /><span className="hidden sm:inline">Upload</span></button>
            <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { chooseFiles(e.target.files); e.target.value = '' }} />
          </div>
        </header>

        <div role="tablist" aria-label="Where images came from" className="mt-5 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
          {KINDS.filter(([key]) => key === 'all' || counts[key] > 0).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={kind === key} onClick={() => setKind(key)} className={cn('flex h-9 shrink-0 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors', kind === key ? 'border-bk-fg bg-bk-fg text-bk-bg' : 'border-bk-line bg-bk-surface hover:border-bk-fg/40')}>
              {key === 'cutout' && <Sparkles className="size-3.5" />}{label}<span className={cn('tabular-nums', kind === key ? 'text-bk-bg/70' : 'text-bk-muted')}>{counts[key]}</span>
            </button>
          ))}
        </div>

        {!brandId ? (
          <p className="mt-10 text-center text-[14px] text-bk-muted">Save your brand profile first to use the gallery.</p>
        ) : (
          <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0">
              {!wide && staging && <div className={cn(panelClass, 'mb-5 p-4')}>{staging}</div>}
              {processingCount > 0 && (
                <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-[#9A6B00] dark:text-[#F2C14E]"><Loader2 className="size-4 animate-spin" />Batkle is reading {processingCount} image{processingCount > 1 ? 's' : ''}; this page updates by itself.</p>
              )}
              {loading ? (
                <div aria-label="Loading images" className="columns-2 gap-3 sm:columns-3 xl:columns-4">
                  {[1, 1.3, 0.8, 1.1, 0.9, 1.25, 1, 0.75].map((r, i) => <div key={i} className="mb-3 rounded-xl bg-bk-surface motion-safe:animate-pulse" style={{ aspectRatio: `1 / ${r}` }} />)}
                </div>
              ) : filtered.length > 0 ? (
                <div className="columns-2 gap-3 sm:columns-3 xl:columns-4">
                  {filtered.map(asset => <Tile key={asset.id} asset={asset} selected={asset.id === selectedId} onSelect={() => setSelectedId(asset.id === selectedId ? null : asset.id)} />)}
                </div>
              ) : (
                <div className="flex flex-col items-center rounded-2xl border border-dashed border-bk-field px-6 py-16 text-center">
                  <ImageIcon className="size-6 text-bk-muted" aria-hidden="true" />
                  <p className="mt-2.5 font-bk-display text-[17px] font-bold tracking-[-0.02em]">{search ? 'No matching images' : kind === 'cutout' ? 'No cutouts yet' : 'No images yet'}</p>
                  <p className="mt-1 max-w-[420px] text-[13.5px] text-bk-muted">
                    {search ? `Nothing here matches “${search}”.` : kind === 'cutout' ? 'Transparent cutouts made for this brand’s posts are saved here and reused when they fit a new slide.' : 'Drop photos anywhere on this page, or use Upload.'}
                  </p>
                  {search && <button type="button" onClick={() => setSearch('')} className={appButton('outline', 'sm', 'mt-4')}>Clear search</button>}
                </div>
              )}
            </div>

            <aside aria-label={selected ? 'Image details' : 'Gallery overview'} className={cn(panelClass, 'hidden p-5 lg:sticky lg:top-8 lg:block lg:max-h-[calc(100dvh-64px)] lg:overflow-y-auto')}>
              {sidePanel}
            </aside>
          </div>
        )}
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-3 z-[60] flex items-center justify-center rounded-2xl border-2 border-dashed border-bk-fg bg-bk-butter/15 backdrop-blur-[2px]">
          <div className="rounded-2xl bg-bk-surface px-8 py-6 text-center shadow-bk-pop">
            <Upload className="mx-auto mb-2 size-7" />
            <p className="font-bk-display text-[19px] font-bold tracking-[-0.03em]">Drop to add images</p>
          </div>
        </div>
      )}

      {/* Phones and tablets open the details in a popup instead of the side panel. */}
      {selected && !wide && (
        <Popup open onOpenChange={open => !open && setSelectedId(null)} title={selected.filename || 'Image'} size="lg">
          <Inspector key={selected.id} asset={selected} compact onDelete={handleDelete} onSaved={asset => setAssets(prev => prev.map(a => (a.id === asset.id ? asset : a)))} onClose={() => setSelectedId(null)} />
        </Popup>
      )}
    </div>
  )
}
