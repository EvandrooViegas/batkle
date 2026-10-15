'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowRight, ImagePlus, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ACCEPTED_TYPES, MAX_POST_IMAGES, discardPostImage, imageFiles, uploadPostImage } from '@/lib/client/postImages'
import { billingAction } from '@/lib/client/billing'
import { appButton } from '../ui'
import { AUTO_SETTINGS, PostSettings, languageOption } from './PostSettings'

const STARTERS = ['Before and after of a recent project', 'Explain one of our services', 'Meet the team']
const MAX = 600

/** A concrete example for the placeholder, taken from the brand's own projects or services. */
function exampleFor(brand) {
  const first = list => (Array.isArray(list) ? list.find(Boolean) : null)
  const project = first(brand?.projects)
  const projectName = typeof project === 'string' ? project.split(/\s+[—–-]\s+/)[0] : project?.name
  if (projectName) return `the story behind the ${projectName.trim()} project`
  const service = first(brand?.services)
  if (typeof service === 'string') return `how our ${service.split(/\s+[—–-]\s+/)[0].trim()} works`
  return 'a behind-the-scenes look at a normal working day'
}

let photoKey = 0

/**
 * Photos attached to the next idea: uploaded (and read by the server) as soon as they are added.
 * Photos removed, or left behind when the page closes, are deleted unless an idea already uses them.
 */
function usePostPhotos(brandId) {
  const [photos, setPhotos] = useState([])
  const current = useRef(photos)
  current.current = photos

  useEffect(() => () => {
    for (const photo of current.current) {
      URL.revokeObjectURL(photo.preview)
      if (photo.asset) discardPostImage(photo.asset.id, brandId)
    }
  }, [brandId])

  const update = (key, patch) => setPhotos(list => list.map(p => (p.key === key ? { ...p, ...patch } : p)))

  const add = useCallback(fileList => {
    const files = imageFiles(fileList)
    if (!files.length) return
    const room = MAX_POST_IMAGES - current.current.length
    if (room <= 0) { toast.error(`A post can use up to ${MAX_POST_IMAGES} photos.`); return }
    if (files.length > room) toast.error(`A post can use up to ${MAX_POST_IMAGES} photos, so only ${room} more ${room === 1 ? 'was' : 'were'} added.`)
    const added = files.slice(0, room).map(file => ({ key: ++photoKey, name: file.name, file, preview: URL.createObjectURL(file), status: 'uploading', asset: null, error: null }))
    // Updated now, not on the next render, so two quick additions can never pass the limit.
    current.current = [...current.current, ...added]
    setPhotos(list => [...list, ...added])
    // A plan limit stops every photo of this batch: it is offered once, with the way to more space.
    let limitShown = false
    for (const photo of added) {
      uploadPostImage(photo.file, brandId)
        .then(asset => {
          // Removed while it was uploading: delete it right away.
          if (!current.current.some(p => p.key === photo.key)) { discardPostImage(asset.id, brandId); return }
          update(photo.key, { status: 'ready', asset, file: null })
        })
        .catch(error => {
          update(photo.key, { status: 'error', error: error.message || 'Upload failed' })
          if (!error.code || limitShown) return
          limitShown = true
          const { href, label } = billingAction(error)
          toast.error(error.message, { duration: 12000, action: { label, onClick: () => window.location.assign(href) } })
        })
    }
  }, [brandId])

  const remove = useCallback(key => {
    const photo = current.current.find(p => p.key === key)
    if (!photo) return
    URL.revokeObjectURL(photo.preview)
    if (photo.asset) discardPostImage(photo.asset.id, brandId)
    current.current = current.current.filter(p => p.key !== key)
    setPhotos(list => list.filter(p => p.key !== key))
  }, [brandId])

  /** After an idea took the photos: forget them without deleting (the idea owns them now). */
  const release = useCallback(() => {
    current.current.forEach(p => URL.revokeObjectURL(p.preview))
    current.current = []
    setPhotos([])
  }, [])

  return { photos, add, remove, release }
}

function PhotoTile({ photo, onRemove }) {
  const { status, asset, error } = photo
  const description = asset?.description
  const label = status === 'uploading' ? `${photo.name}: reading the photo` : status === 'error' ? `${photo.name}: ${error}` : description ? `${photo.name}. Batkle sees: ${description}` : `${photo.name}. ${asset?.description_error || 'Ready'}`
  return (
    <li className="group relative motion-safe:animate-bk-pop">
      <div
        className={cn('relative size-[60px] overflow-hidden rounded-lg border bg-bk-chip', status === 'error' ? 'border-[#C2412F]' : 'border-bk-line')}
        title={label}
      >
        <img src={asset?.thumbnail_url || photo.preview} alt="" className="size-full object-cover" />
        {status === 'uploading' && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-bk-ink/60 text-[10px] font-bold text-white">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />Reading…
          </span>
        )}
        {status === 'error' && (
          <span className="absolute inset-0 flex items-center justify-center bg-[#C2412F]/70 text-white"><AlertCircle className="size-5" aria-hidden="true" /></span>
        )}
      </div>
      <span className="sr-only">{label}</span>
      {description && (
        <span role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-64 rounded-lg bg-bk-ink px-3 py-2 text-[12px] leading-snug text-bk-cream shadow-bk-pop group-focus-within:block group-hover:block">
          <span className="font-bold">Batkle sees:</span> {description}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${photo.name}`}
        className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full border border-bk-line bg-bk-surface text-bk-fg shadow-bk-card transition-colors hover:bg-bk-alt focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg"
      >
        <X className="size-3.5" />
      </button>
    </li>
  )
}

/**
 * The user's own idea (or none), up to four photos and the post settings (format, slides, images, design,
 * language). "Create idea" writes a brief from the idea, the photos and the brand profile, then builds the post;
 * "Generate another idea" only suggests one.
 */
export function IdeaComposer({ brandContext, brandId, disabled, busy, hasIdeas, onCreate, onSuggest, className = '' }) {
  const [text, setText] = useState('')
  const [settings, setSettings] = useState(AUTO_SETTINGS)
  // The last image choice is remembered on this device; read after mount so the server render always matches.
  useEffect(() => {
    try { const saved = localStorage.getItem('bk_image_choice'); if (saved === 'on' || saved === 'off') setSettings(s => ({ ...s, imageChoice: saved })) } catch {}
  }, [])
  const changeSettings = next => {
    if (next.imageChoice !== settings.imageChoice) {
      try { localStorage.setItem('bk_image_choice', next.imageChoice) } catch {}
    }
    setSettings(next)
  }
  const [dragging, setDragging] = useState(false)
  const input = useRef(null)
  const picker = useRef(null)
  const { photos, add, remove, release } = usePostPhotos(brandId)

  const ready = photos.filter(p => p.status === 'ready')
  const uploading = photos.some(p => p.status === 'uploading')
  const failed = photos.some(p => p.status === 'error')
  const full = photos.length >= MAX_POST_IMAGES
  const blocked = disabled || !!busy || uploading || failed

  // Grow with the text, up to a limit.
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [text])

  // A single post shows one photo, so several photos switch the format to Auto (which makes a carousel).
  useEffect(() => {
    if (photos.length > 1 && settings.format === 'single') {
      setSettings(s => ({ ...s, format: 'auto' }))
      toast.info('A single post shows one photo, so the format is now Auto.')
    }
  }, [photos.length, settings.format])

  // The settings stay as they are after an idea is made, so several ideas can share them.
  const request = () => ({
    format: settings.format,
    slides: settings.slides,
    imageChoice: settings.imageChoice,
    designId: settings.designId,
    language: languageOption(settings.language),
    images: ready.map(p => p.asset.id),
  })
  const create = async () => {
    if (blocked) return
    const idea = await onCreate({ request: text.trim(), ...request() })
    if (idea) { setText(''); release() }
  }
  const suggest = async () => {
    if (blocked) return
    const idea = await onSuggest(request())
    if (idea) release()
  }
  const addFiles = files => { if (!disabled) add(files) }

  return (
    <div className={className}>
      <div
        className={cn(
          'relative rounded-2xl border bg-bk-surface transition-[box-shadow,border-color] focus-within:shadow-bk-card',
          dragging ? 'border-bk-fg shadow-bk-card' : 'border-bk-field',
          disabled && 'opacity-60',
        )}
        onDragOver={e => { if (!disabled && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
        onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-bk-surface/90 text-[14px] font-bold motion-safe:animate-in motion-safe:fade-in-0">
            Drop photos to add them ({MAX_POST_IMAGES - photos.length} left)
          </div>
        )}
        <label htmlFor="idea-input" className="sr-only">Post idea</label>
        <textarea
          id="idea-input"
          ref={input}
          rows={2}
          maxLength={MAX}
          value={text}
          disabled={disabled}
          onChange={e => setText(e.target.value)}
          onPaste={e => { const files = imageFiles(e.clipboardData?.files); if (files.length) { e.preventDefault(); addFiles(files) } }}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); create() } }}
          placeholder={`Describe a post idea, or leave it empty and let Batkle suggest one. For example: ${exampleFor(brandContext)}.`}
          className="block min-h-[72px] w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-relaxed text-bk-fg outline-none placeholder:text-bk-muted disabled:cursor-not-allowed"
        />

        {photos.length > 0 && (
          <div className="px-4 pt-2.5">
            <ul className="flex flex-wrap gap-3" aria-label={`Photos for this post, ${photos.length} of ${MAX_POST_IMAGES}`}>
              {photos.map(photo => <PhotoTile key={photo.key} photo={photo} onRemove={() => remove(photo.key)} />)}
            </ul>
            <p className="mt-2 text-[11.5px] text-bk-muted" aria-live="polite">
              {failed ? <span className="font-semibold text-[#C2412F] dark:text-[#F0826F]">Remove the photos that could not be uploaded to continue.</span>
                : uploading ? 'Reading your photos…'
                : `Each photo is used once, on the slide it fits. ${photos.length} of ${MAX_POST_IMAGES}.`}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2.5 px-2 pb-2 pt-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <PostSettings value={settings} onChange={changeSettings} brandContext={brandContext} photoCount={photos.length} disabled={disabled} />
            <input
              ref={picker}
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={e => { addFiles(e.target.files); e.target.value = '' }}
            />
            <button
              type="button"
              onClick={() => picker.current?.click()}
              disabled={disabled || full}
              title={full ? `A post can use up to ${MAX_POST_IMAGES} photos` : 'JPEG, PNG or WebP. You can also drop or paste photos.'}
              className={appButton('quiet', 'sm', 'px-2.5 font-semibold')}
            >
              <ImagePlus className="size-4" />
              Add photos
              {photos.length > 0 && <span className="tabular-nums text-bk-muted">{photos.length}/{MAX_POST_IMAGES}</span>}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {text.length > MAX - 100 && <span className="mr-1 text-[12px] tabular-nums text-bk-muted">{MAX - text.length} left</span>}
            <button type="button" onClick={suggest} disabled={blocked} className={appButton('outline', 'md', 'flex-1 sm:flex-none')}>
              {busy === 'suggest' && <Loader2 className="size-3.5 animate-spin" />}
              {busy === 'suggest' ? 'Thinking…' : hasIdeas ? 'Generate another idea' : 'Suggest an idea'}
            </button>
            <button type="button" onClick={create} disabled={blocked} className={appButton('primary', 'md', 'flex-1 sm:flex-none')}>
              {busy === 'create' ? <><Loader2 className="size-3.5 animate-spin" />Writing your idea…</> : <>Create idea<ArrowRight className="size-3.5" /></>}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[12.5px] text-bk-muted">Try:</span>
        {STARTERS.map(s => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => { setText(s); input.current?.focus() }}
            className="h-7 rounded-full border border-bk-line bg-bk-surface/60 px-3 text-[12.5px] font-medium transition-colors hover:border-bk-field hover:bg-bk-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
