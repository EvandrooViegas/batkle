'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, ImageUp, Link2, Loader2, MoreHorizontal, RefreshCw, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import UpgradeNotice from '@/components/app/billing/UpgradeNotice'
import { appField } from '@/components/app/field'
import { appButton, appLayer, panelClass } from '@/components/app/ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { isBillingCode } from '@/lib/client/billing'
import { uploadFile } from '@/lib/client/directUpload'
import { cn } from '@/lib/utils'

// Kept as they are when small enough; anything else (SVG, ICO, a very large image) is drawn into a PNG first, which
// every part of Batkle can read and the logo versions can be made from.
const KEPT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
const KEPT_MAX_BYTES = 1.5 * 1024 * 1024
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,.svg,image/x-icon,.ico'
const isWebAddress = value => /^https?:\/\/\S+$/i.test(value || '')
const isUpload = value => /^(https?:\/\/[^/]+)?\/api\/uploads\/[^/?#\s]+$/i.test(value || '')
const imageFile = list => [...(list || [])].find(f => f.type.startsWith('image/') || /\.(svg|ico)$/i.test(f.name))

// The versions, in the order shown, and the ground each is drawn on. `ground: 'auto'` follows the logo.
const VERSIONS = [
  ['originalTransparent', 'Original', 'auto'],
  ['reversedTransparent', 'For dark backgrounds', 'dark'],
  ['darkenedTransparent', 'For light backgrounds', 'light'],
  ['whiteTransparent', 'All white', 'dark'],
  ['blackTransparent', 'All black', 'light'],
  ['originalOnWhite', 'On white', 'light'],
  ['originalOnBlack', 'On black', 'dark'],
  ['blackOnWhite', 'Black on white', 'light'],
  ['whiteOnBlack', 'White on black', 'dark'],
]
// Below this share of the mark vanishing, the original artwork is used as it is (as in lib/designs/global/compose.ts).
const LOST = 0.08
const DARK_SURFACE = 0.0068
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
const measured = variants => typeof variants?.lostOnDark === 'number' && typeof variants?.lostOnLight === 'number'

/**
 * The version that reads on each ground, as the post designer chooses it: the original when none of it vanishes
 * there, otherwise the version with its outer shapes recoloured for that ground, or its silhouette. Versions made
 * before the per-ground measurements fall back to the average contrast of the mark. Before any versions, the logo.
 */
function previews(logo, variants) {
  if (!variants || variants.source !== logo || !variants.originalTransparent) return { light: logo, dark: logo }
  const original = variants.originalTransparent
  if (measured(variants)) {
    return {
      light: variants.lostOnLight < LOST ? original : variants.darkenedTransparent || variants.blackTransparent || original,
      dark: variants.lostOnDark < LOST ? original : variants.reversedTransparent || variants.whiteTransparent || original,
    }
  }
  const ink = typeof variants.inkLightness === 'number' ? variants.inkLightness : 0.2
  return {
    light: contrast(ink, 1) >= 2 ? original : variants.blackTransparent || original,
    dark: contrast(ink, DARK_SURFACE) >= 2 ? original : variants.whiteTransparent || original,
  }
}

/** An image file as a PNG file, at most `max` pixels on its long side; vector images are drawn at that size. */
async function toPng(file, max = 1600) {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`${file.name} could not be read as an image`))
      img.src = url
    })
    const width = image.naturalWidth || 512, height = image.naturalHeight || 512
    const vector = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)
    const scale = vector ? max / Math.max(width, height) : Math.min(1, max / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error(`${file.name} could not be converted`)
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'logo'}.png`, { type: 'image/png' })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * The drop area of an empty logo. Drags that start on this page (an image or text moved around it) are ignored, so
 * only files and images brought in from outside are taken.
 */
function useDropTarget(onFile, onAddress, disabled) {
  const [dragging, setDragging] = useState(false)
  const fromPage = useRef(false)
  useEffect(() => {
    const start = () => { fromPage.current = true }
    const end = () => { fromPage.current = false }
    window.addEventListener('dragstart', start)
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => { window.removeEventListener('dragstart', start); window.removeEventListener('dragend', end); window.removeEventListener('drop', end) }
  }, [])
  const ignore = () => disabled || fromPage.current
  return {
    dragging,
    props: {
      onDragEnter: e => { e.preventDefault(); if (!ignore()) setDragging(true) },
      onDragOver: e => { e.preventDefault(); e.dataTransfer.dropEffect = ignore() ? 'none' : 'copy' },
      onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) },
      onDrop: e => {
        e.preventDefault()
        setDragging(false)
        if (ignore()) return
        const file = imageFile(e.dataTransfer.files)
        if (file) return onFile(file)
        // An image dragged from another web page arrives as its address.
        const dropped = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').split(/\r?\n/).map(s => s.trim()).find(isWebAddress)
        onAddress(dropped || null)
      },
    },
  }
}

/** One preview: the logo as it shows on light or on dark designs. */
function Surface({ tone, src, name, onBroken }) {
  const dark = tone === 'dark'
  return (
    <figure className="min-w-0">
      <div className={cn('flex h-40 select-none items-center justify-center rounded-xl p-6 shadow-bk-card sm:h-44', dark ? 'bg-[#14131A]' : 'bg-white')}>
        <img key={src} src={src} alt={`${name || 'Brand'} logo on a ${tone} background`} draggable={false} onError={onBroken} className="pointer-events-none max-h-full max-w-full object-contain" />
      </div>
      <figcaption className="mt-1.5 text-[12px] text-bk-muted">On {tone} designs</figcaption>
    </figure>
  )
}

/** Paste or type a link to an image. */
function LinkForm({ value, busy, autoFocus, onUse, onFile, onCancel, className = '' }) {
  const [text, setText] = useState(isUpload(value) ? '' : value || '')
  const [error, setError] = useState('')
  const submit = next => {
    const address = next.trim()
    if (!address) return
    if (!isWebAddress(address)) { setError('Paste the full link to the image, starting with https://'); return }
    setError('')
    onUse(address)
  }
  return (
    <form className={className} noValidate onSubmit={e => { e.preventDefault(); submit(text) }}>
      <label htmlFor="bk-logo-link" className="sr-only">Link to your logo</label>
      <div className="flex gap-2">
        <input
          id="bk-logo-link"
          type="url"
          inputMode="url"
          autoFocus={autoFocus}
          value={text}
          placeholder="https://yoursite.com/logo.png"
          onChange={e => { setText(e.target.value); if (error) setError('') }}
          onKeyDown={e => { if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel() } }}
          onPaste={e => {
            const file = imageFile(e.clipboardData.files)
            if (file) { e.preventDefault(); onFile(file); return }
            const pasted = e.clipboardData.getData('text').trim()
            if (isWebAddress(pasted)) { e.preventDefault(); setText(pasted); submit(pasted) }
          }}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? 'bk-logo-link-error' : undefined}
          className={appField('h-10 min-w-0 flex-1 text-[14px]')}
        />
        <button type="submit" disabled={busy || !text.trim()} className={appButton('ink', 'md', 'h-10')}>Use link</button>
        {onCancel && <button type="button" onClick={onCancel} className={appButton('quiet', 'md', 'h-10')}>Cancel</button>}
      </div>
      {error && <p id="bk-logo-link-error" role="alert" className="mt-1.5 text-left text-[12.5px] font-semibold text-[#C2412F] dark:text-[#F0826F]">{error}</p>}
    </form>
  )
}

const menuClass = cn(appLayer, 'w-56 rounded-xl border-bk-line bg-bk-surface p-1.5 shadow-bk-pop')
const menuItemClass = 'gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold focus:bg-bk-alt focus:text-bk-fg [&_svg]:size-4'

/**
 * The brand's logo. Without one: a drop area, a file button and a link field. With one: how it shows on light and
 * dark designs, a ⋯ menu to upload a new one, use a link or remove it, and the versions Batkle made, to download.
 * Versions are made as soon as a logo is set. Uploaded logos are saved as their /api/uploads/… address.
 */
export default function LogoInput({ name, value, variants, onChange, onVariants }) {
  const picker = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [limit, setLimit] = useState(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [broken, setBroken] = useState(null)
  const [making, setMaking] = useState({ state: 'idle' })
  const attempted = useRef(null)
  const valid = Boolean(value) && variants?.source === value
  // Versions made before the per-ground measurements, or the earlier way (`version` below 2: details filled instead of
  // kept, see lib/services/logoVariants.ts), are made again once, so the previews pick the right one.
  const current = valid && measured(variants) && (variants.version || 1) >= 2

  const set = next => {
    setError(''); setLimit(null); setBroken(null); setLinkOpen(false)
    onChange(next)
  }

  async function upload(file) {
    if (!file || busy) return
    setBusy(true); setError(''); setLimit(null)
    try {
      const ready = KEPT_TYPES.includes(file.type) && file.size <= KEPT_MAX_BYTES ? file : await toPng(file)
      const result = await uploadFile('/api/uploads', ready, { purpose: 'editor' })
      const stored = result.relativeUrl || (result.url && new URL(result.url).pathname)
      if (!stored) throw new Error('The logo could not be uploaded. Please try again.')
      set(stored)
      toast.success('Logo added. Save the profile to keep it.')
    } catch (e) {
      if (isBillingCode(e.code)) setLimit(e)
      else setError(e.message || 'The logo could not be uploaded. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const takeAddress = address => {
    if (!address) { setError('Drop an image file, or an image from another web page.'); return }
    if (address !== value) { set(address); toast.success('Logo added. Save the profile to keep it.') }
    else setLinkOpen(false)
  }

  async function makeVersions(logo) {
    setMaking({ state: 'working' })
    try {
      const response = await fetch('/api/logo-variants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logo }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'The versions could not be made.')
      onVariants(result)
      setMaking({ state: 'idle' })
    } catch (e) {
      setMaking({ state: 'failed', message: e.message })
    }
  }
  useEffect(() => {
    if (!value || current || attempted.current === value) return
    attempted.current = value
    makeVersions(value)
  }, [value, current]) // eslint-disable-line react-hooks/exhaustive-deps

  const drop = useDropTarget(upload, takeAddress, busy)
  const pick = () => picker.current?.click()
  const fileInput = (
    <input ref={picker} type="file" accept={ACCEPT} tabIndex={-1} aria-hidden="true" className="hidden" onChange={e => { upload(imageFile(e.target.files)); e.target.value = '' }} />
  )
  const messages = (
    <>
      {error && <p role="alert" className="text-[13px] font-semibold text-[#C2412F] dark:text-[#F0826F]">{error}</p>}
      {limit && <UpgradeNotice error={limit} />}
      <p className="sr-only" aria-live="polite">{busy ? 'Uploading the logo' : making.state === 'working' ? 'Preparing versions for light and dark designs' : ''}</p>
    </>
  )

  if (!value) {
    return (
      <div className="space-y-3">
        <div {...drop.props} className={cn('relative rounded-2xl border-2 border-dashed px-5 py-9 text-center transition-colors sm:px-8', drop.dragging ? 'border-bk-fg bg-bk-butter/15' : 'border-bk-field bg-bk-surface')}>
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-bk-butter text-bk-ink"><ImageUp className="size-6" aria-hidden="true" /></span>
          <p className="mt-3 font-bk-display text-[19px] font-bold tracking-[-0.02em]">{drop.dragging ? 'Drop to use this logo' : 'Drag your logo here'}</p>
          <p className="mt-1 text-[13.5px] text-bk-muted">A PNG or SVG with a transparent background works best.</p>
          <button type="button" onClick={pick} disabled={busy} className={appButton('primary', 'md', 'mt-4')}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}{busy ? 'Uploading…' : 'Choose a file'}
          </button>
          <div className="mx-auto mt-7 flex max-w-[480px] items-center gap-3 text-[12px] font-semibold text-bk-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-bk-line" />or paste a link<span className="h-px flex-1 bg-bk-line" />
          </div>
          <LinkForm value={value} busy={busy} onUse={takeAddress} onFile={upload} className="mx-auto mt-3 max-w-[480px]" />
          {fileInput}
        </div>
        {messages}
      </div>
    )
  }

  const { light, dark } = previews(value, variants)
  const source = isUpload(value) ? 'Uploaded logo' : (() => { try { return `From ${new URL(value).hostname.replace(/^www\./, '')}` } catch { return 'From a link' } })()
  // The original pasted on a ground it vanishes on is no use, so it is left out.
  const lostOn = { originalOnWhite: 'lostOnLight', originalOnBlack: 'lostOnDark' }
  const versions = valid ? VERSIONS.filter(([key]) => variants[key] && !(measured(variants) && variants[lostOn[key]] >= LOST)) : []
  const groundOf = ground => (ground === 'auto' ? (measured(variants) ? variants.lostOnLight >= LOST : (variants.inkLightness ?? 0) > 0.72) ? 'dark' : 'light' : ground)

  return (
    <div className="space-y-4">
      <div className="relative">
        {broken === value ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#C2412F]/40 bg-[#C2412F]/[0.04] px-4 text-center sm:h-44">
            <p className="text-[14px] font-bold">This logo can’t be shown</p>
            <p className="max-w-[420px] text-[13px] text-bk-muted">The image at its link doesn’t load. Upload the file instead, or use another link.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Surface tone="light" src={light} name={name} onBroken={() => setBroken(value)} />
            <Surface tone="dark" src={dark} name={name} onBroken={() => setBroken(value)} />
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-bk-surface/90 text-[14px] font-bold backdrop-blur-[2px]">
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />Uploading…
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 text-[13px]">
          <p className="truncate font-semibold" title={isUpload(value) ? undefined : value}>{source}</p>
          {making.state === 'working' ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-bk-muted"><Loader2 className="size-3.5 animate-spin" aria-hidden="true" />Preparing versions for light and dark designs…</p>
          ) : making.state === 'failed' ? (
            <p className="mt-0.5 text-bk-muted">
              Light and dark versions couldn’t be made, so the logo is used as it is.{' '}
              <button type="button" onClick={() => makeVersions(value)} className="inline-flex items-center gap-1 font-semibold text-bk-fg underline underline-offset-4"><RefreshCw className="size-3" aria-hidden="true" />Try again</button>
            </p>
          ) : (
            <p className="mt-0.5 text-bk-muted">{versions.length ? 'Posts use the version that reads on each background.' : 'Used as it is on every design.'}</p>
          )}
        </div>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger disabled={busy} aria-label="Logo options" title="Logo options" className={appButton('outline', 'sm', 'w-8 shrink-0 px-0')}>
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={menuClass}>
            <DropdownMenuItem onSelect={pick} className={menuItemClass}><Upload />Upload a new logo</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setLinkOpen(true)} className={menuItemClass}><Link2 />Use a link instead</DropdownMenuItem>
            <DropdownMenuSeparator className="bg-bk-line" />
            <DropdownMenuItem onSelect={() => set('')} className={cn(menuItemClass, 'text-[#C2412F] focus:bg-[#C2412F]/10 focus:text-[#C2412F] dark:text-[#F0826F] dark:focus:text-[#F0826F]')}><Trash2 />Remove logo</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {linkOpen && <LinkForm value={value} busy={busy} autoFocus onUse={takeAddress} onFile={upload} onCancel={() => setLinkOpen(false)} />}
      {fileInput}
      {messages}

      {versions.length > 0 && (
        <section aria-labelledby="bk-logo-versions" className={cn(panelClass, 'p-4')}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="bk-logo-versions" className="text-[14px] font-bold">Versions</h3>
            <p className="text-[12px] text-bk-muted">Click one to download it as a PNG.</p>
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {versions.map(([key, label, ground]) => (
              <li key={key}>
                <a href={variants[key]} download={`logo-${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}.png`} draggable={false} className="group block overflow-hidden rounded-lg bg-bk-surface shadow-bk-card transition-shadow hover:ring-1 hover:ring-bk-fg/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bk-fg">
                  <span className={cn('flex h-20 items-center justify-center p-3', groundOf(ground) === 'dark' ? 'bg-[#14131A]' : 'bg-white')}>
                    <img src={variants[key]} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
                  </span>
                  <span className="flex items-center justify-between gap-1 px-2 py-1.5 text-[11.5px] font-semibold">
                    <span className="truncate">{label}</span>
                    <Download className="size-3 shrink-0 text-bk-muted group-hover:text-bk-fg" aria-hidden="true" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
