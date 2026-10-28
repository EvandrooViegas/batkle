'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ImageUp, Images, Loader2, Plus, RefreshCw, Trash2, Type, X } from 'lucide-react'
import UpgradeNotice from '@/components/app/billing/UpgradeNotice'
import { Popup } from '@/components/app/popup'
import { appField } from '@/components/app/field'
import { Eyebrow, Notice, appButton, panelClass } from '@/components/app/ui'
import { apiError, isBillingCode } from '@/lib/client/billing'
import { uploadFile } from '@/lib/client/directUpload'
import { cn } from '@/lib/utils'

// As lib/services/brandPosts.ts keeps them.
const MAX_POSTS = 8
const MAX_SLIDES = 10
const CAPTION_LIMIT = 2200
const TYPES = ['image/png', 'image/jpeg', 'image/webp']
const EMPTY = { enabled: true, posts: [], voice: null }
// What a Free account sees: the plan that writes in the voice of its posts.
const UPGRADE = { code: 'upgrade_required', billing: { feature: 'postVoice', requiredPlan: 'pro' }, message: 'Writing in the voice of your own posts is part of Pro and Business.' }
const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^\w-]/g, '')
// A post's slides, in order; posts saved before carousels had one `image`.
const slidesOf = post => (Array.isArray(post?.slides) ? post.slides : post?.image ? [{ image: post.image, text: post.text }] : [])
// What the server keeps of a post: the words read from its slides stay on the server.
const sendable = posts => posts.map(post => ({ id: post.id, images: slidesOf(post).map(slide => slide.image), caption: post.caption }))
// Slides in the order their files are named ("slide-2" before "slide-10"), which is how carousels are exported.
const inOrder = files => [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
const dateOf = value => { try { return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) } catch { return '' } }
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

function Switch({ checked, onChange, disabled, labelledBy, describedBy }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-bk-fg bg-bk-fg' : 'border-bk-field bg-bk-alt',
      )}
    >
      <span aria-hidden="true" className={cn('inline-block size-[18px] rounded-full shadow-sm transition-transform', checked ? 'translate-x-[22px] bg-bk-butter' : 'translate-x-[2px] bg-bk-surface')} />
    </button>
  )
}

const overlayButton = 'flex size-7 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75 disabled:opacity-40'

/**
 * One post: its slides (one for a single post), browsed with the thumbnails under it, and its caption. `locked` (an
 * account without the feature) leaves only removing.
 */
function PostCard({ post, number, locked, adding, caption, onCaption, onCaptionDone, onRemove, onRemoveSlide, onMoveSlide, onAddSlides }) {
  const slides = slidesOf(post)
  const [at, setAt] = useState(0)
  const shown = Math.min(at, Math.max(0, slides.length - 1))
  const slide = slides[shown]
  const carousel = slides.length > 1
  const picker = useRef(null)
  useEffect(() => { if (at > slides.length - 1) setAt(Math.max(0, slides.length - 1)) }, [slides.length, at])
  const move = by => { onMoveSlide(shown, shown + by); setAt(shown + by) }

  return (
    <li className={cn(panelClass, 'flex flex-col overflow-hidden')}>
      <div className="relative aspect-[4/5] bg-bk-alt">
        {slide ? (
          <img src={slide.image} alt={carousel ? `Post ${number}, slide ${shown + 1} of ${slides.length}` : `Post ${number}`} className="size-full object-cover" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-bk-muted">
            <Type className="size-6" aria-hidden="true" />
            <span className="text-[12.5px] font-semibold">Caption only</span>
          </div>
        )}
        {carousel && <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11.5px] font-bold tabular-nums text-white">{shown + 1}/{slides.length}</span>}
        <button type="button" onClick={onRemove} aria-label={`Remove post ${number}`} title="Remove post" className={cn(overlayButton, 'absolute right-2 top-2')}>
          <X className="size-3.5" />
        </button>
        {carousel && (
          <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-1">
            <div className="flex gap-1">
              {!locked && <button type="button" onClick={() => move(-1)} disabled={shown === 0} aria-label={`Move slide ${shown + 1} of post ${number} earlier`} title="Move earlier" className={overlayButton}><ChevronLeft className="size-4" /></button>}
              {!locked && <button type="button" onClick={() => move(1)} disabled={shown === slides.length - 1} aria-label={`Move slide ${shown + 1} of post ${number} later`} title="Move later" className={overlayButton}><ChevronRight className="size-4" /></button>}
            </div>
            <button type="button" onClick={() => onRemoveSlide(shown)} aria-label={`Remove slide ${shown + 1} of post ${number}`} title="Remove this slide" className={overlayButton}><Trash2 className="size-3.5" /></button>
          </div>
        )}
        {adding > 0 && (
          <span role="status" className="absolute inset-0 flex items-center justify-center gap-2 bg-bk-surface/70 text-[13px] font-bold">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />Adding {plural(adding, 'slide')}…
          </span>
        )}
      </div>

      <div className="flex min-h-[44px] items-center gap-1.5 border-b border-bk-line px-2 py-1.5">
        {carousel ? (
          <ul aria-label={`Slides of post ${number}`} className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-0.5 [scrollbar-width:thin]">
            {slides.map((item, i) => (
              <li key={item.image} className="shrink-0">
                <button type="button" onClick={() => setAt(i)} aria-label={`Show slide ${i + 1}`} aria-current={i === shown || undefined} className={cn('block h-8 w-[26px] overflow-hidden rounded-[5px] ring-offset-1 ring-offset-bk-surface', i === shown ? 'ring-2 ring-bk-fg' : 'opacity-70 hover:opacity-100')}>
                  <img src={item.image} alt="" className="size-full object-cover" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <span className="flex-1 text-[12px] text-bk-muted">{slides.length ? 'Single image' : 'No image'}</span>
        )}
        {!locked && slides.length < MAX_SLIDES && (
          <>
            <button type="button" onClick={() => picker.current?.click()} disabled={adding > 0} aria-label={`Add slides to post ${number}`} title={carousel ? 'Add slides' : 'Add slides to make it a carousel'} className={appButton('quiet', 'xs', 'h-7 shrink-0 px-2')}>
              <Plus className="size-3.5" />{carousel ? '' : 'Slides'}
            </button>
            <input ref={picker} type="file" accept={TYPES.join(',')} multiple tabIndex={-1} aria-hidden="true" className="hidden" onChange={e => { onAddSlides(e.target.files); e.target.value = '' }} />
          </>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <textarea
          aria-label={`Caption of post ${number}`}
          placeholder={locked ? 'No caption' : carousel ? 'Paste the carousel’s caption (optional)' : 'Paste its caption (optional)'}
          rows={3}
          maxLength={CAPTION_LIMIT}
          readOnly={locked}
          value={caption ?? post.caption}
          onChange={e => onCaption(e.target.value)}
          onBlur={onCaptionDone}
          className={appField('h-auto min-h-[76px] resize-y py-2 text-[13px] leading-snug read-only:bg-bk-alt/50')}
        />
        {slide?.readError ? (
          <p className="text-[12px] font-semibold text-[#C2412F] dark:text-[#F0826F]">{slide.readError}</p>
        ) : slide?.text ? (
          <p className="line-clamp-2 text-[12px] leading-snug text-bk-muted" title={slide.text}>{carousel ? `Read on slide ${shown + 1}` : 'Read on the image'}: “{slide.text.split('\n').join(' · ')}”</p>
        ) : null}
      </div>
    </li>
  )
}

/**
 * Brand profile → Your posts: posts the brand published (single images, carousels or captions alone), read by Batkle
 * into the voice new posts, stories and ads are written in (lib/services/brandPosts.ts), and the switch that turns
 * that on or off. Everything here is saved the moment it changes, through POST /api/brand-posts, never by the
 * profile's Save. It is part of Pro and Business: `allowed` is false on Free (posts added before a downgrade can still
 * be removed) and null while the plan loads.
 */
export default function BrandPosts({ flowId, value, onChange, allowed }) {
  const examples = { ...EMPTY, ...(value || {}) }
  const posts = examples.posts || []
  const voice = examples.voice
  const [uploading, setUploading] = useState([])
  const [adding, setAdding] = useState({})
  const [captions, setCaptions] = useState({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [limit, setLimit] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [captionOpen, setCaptionOpen] = useState(false)
  const [newCaption, setNewCaption] = useState('')
  // Several images chosen at once, waiting for "one carousel or separate posts?".
  const [choice, setChoice] = useState(null)
  const picker = useRef(null)
  const queue = useRef(Promise.resolve())
  const reorder = useRef(null)
  const latest = useRef(examples)
  latest.current = examples
  useEffect(() => () => clearTimeout(reorder.current), [])
  const locked = allowed === false

  /**
   * One save at a time, each built from the posts as the last one left them, so a removal made while images upload
   * never drops them. `reading` says Batkle reads posts and learns the voice during this one. Resolves to whether it
   * was saved; a plan limit shows the upgrade.
   */
  const save = (change, reading = false) => {
    queue.current = queue.current.then(async () => {
      setBusy(reading ? 'reading' : 'saving'); setError('')
      try {
        const response = await fetch('/api/brand-posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flowId, ...change(latest.current) }) })
        const result = await response.json().catch(() => ({}))
        if (!response.ok || !result.postExamples) throw apiError(result, response.status, 'Your posts could not be saved. Try again.')
        latest.current = result.postExamples
        onChange(result.postExamples)
        return true
      } catch (e) {
        if (isBillingCode(e.code)) setLimit(e)
        else setError(e.message || 'Your posts could not be saved. Try again.')
        return false
      } finally {
        setBusy('')
      }
    })
    return queue.current
  }

  /** Uploads images in order; stops at a plan limit. Returns their addresses. */
  async function uploadAll(files) {
    const stored = []
    for (const file of files) {
      try {
        const result = await uploadFile('/api/uploads', file, { purpose: 'editor' })
        const url = result.relativeUrl || (result.url && new URL(result.url).pathname)
        if (url) stored.push(url)
      } catch (e) {
        if (isBillingCode(e.code)) { setLimit(e); break }
        setError(e.message || `${file.name} could not be uploaded. Try again.`)
      }
    }
    return stored
  }

  const imagesOnly = fileList => {
    const files = inOrder([...(fileList || [])])
    const images = files.filter(file => TYPES.includes(file.type))
    setError(''); setLimit(null)
    if (images.length < files.length) setError(images.length ? 'Only JPEG, PNG and WebP images were added.' : 'Use JPEG, PNG or WebP images.')
    return images
  }

  /** Images dropped or chosen for new posts: one goes straight in; several ask whether they are one carousel. */
  function pickImages(fileList) {
    const images = imagesOnly(fileList)
    if (!images.length) return
    if (posts.length + uploading.length >= MAX_POSTS) { setError(`You can add up to ${MAX_POSTS} posts. Remove one to add another.`); return }
    if (images.length === 1) addPosts(images, false)
    else setChoice({ files: images, previews: images.slice(0, 6).map(file => URL.createObjectURL(file)) })
  }

  function decide(asCarousel) {
    const { files, previews } = choice
    previews.forEach(url => URL.revokeObjectURL(url))
    setChoice(null)
    addPosts(files, asCarousel)
  }

  async function addPosts(files, asCarousel) {
    const room = MAX_POSTS - posts.length - uploading.length
    let groups = asCarousel ? [files.slice(0, MAX_SLIDES)] : files.slice(0, room).map(file => [file])
    if (asCarousel && files.length > MAX_SLIDES) setError(`A carousel keeps up to ${MAX_SLIDES} slides, so the last ${files.length - MAX_SLIDES} were left out.`)
    else if (!asCarousel && files.length > room) setError(`Only ${plural(room, 'more post')} fit, so the rest were left out.`)
    groups = groups.filter(group => group.length)
    const items = groups.map(group => ({ id: newId(), files: group, preview: URL.createObjectURL(group[0]) }))
    setUploading(current => [...current, ...items])
    const added = []
    for (const item of items) {
      const images = await uploadAll(item.files)
      if (images.length) added.push({ id: item.id, images, caption: '' })
      if (images.length < item.files.length) break
    }
    if (added.length) await save(current => ({ posts: [...sendable(current.posts), ...added] }), true)
    setUploading(current => current.filter(item => !items.includes(item)))
    items.forEach(item => URL.revokeObjectURL(item.preview))
  }

  async function addSlides(post, fileList) {
    const images = imagesOnly(fileList)
    const room = MAX_SLIDES - slidesOf(post).length
    if (!images.length || room <= 0) return
    if (images.length > room) setError(`A carousel keeps up to ${MAX_SLIDES} slides, so the last ${images.length - room} were left out.`)
    const chosen = images.slice(0, room)
    setAdding(current => ({ ...current, [post.id]: chosen.length }))
    const stored = await uploadAll(chosen)
    if (stored.length) {
      await save(current => ({ posts: sendable(current.posts).map(p => (p.id === post.id ? { ...p, images: [...p.images, ...stored] } : p)) }), true)
    }
    setAdding(({ [post.id]: _done, ...rest }) => rest)
  }

  const withSlides = (post, slides) => ({ ...latest.current, posts: latest.current.posts.map(p => (p.id === post.id ? { ...p, slides, image: undefined, text: undefined } : p)) })
  const removeSlide = (post, index) => {
    const slides = slidesOf(post).filter((_, i) => i !== index)
    save(current => ({ posts: sendable(withSlides(post, slides).posts.filter(p => p.id !== post.id || slidesOf(p).length || p.caption)) }), true)
  }
  // Moves show at once; the order is saved (and the voice learned again) once the moving stops.
  const moveSlide = (post, from, to) => {
    const slides = [...slidesOf(post)]
    if (to < 0 || to >= slides.length) return
    const [slide] = slides.splice(from, 1)
    slides.splice(to, 0, slide)
    const next = withSlides(post, slides)
    latest.current = next
    onChange(next)
    clearTimeout(reorder.current)
    reorder.current = setTimeout(() => save(current => ({ posts: sendable(current.posts) }), true), 1200)
  }

  const saveCaption = post => {
    const draft = captions[post.id]
    if (draft === undefined || draft.trim() === post.caption) return
    // The draft is dropped once saved, unless more was typed meanwhile; a failed save keeps it in the field.
    save(current => ({ posts: sendable(current.posts.map(p => (p.id === post.id ? { ...p, caption: draft.trim() } : p))) }), true)
      .then(saved => saved && setCaptions(({ [post.id]: now, ...rest }) => (now === draft ? rest : { ...rest, [post.id]: now })))
  }
  const remove = post => save(current => ({ posts: sendable(current.posts.filter(p => p.id !== post.id)) }), !locked)
  const addCaption = () => {
    const caption = newCaption.trim()
    if (!caption) return
    setCaptionOpen(false); setNewCaption('')
    save(current => ({ posts: [...sendable(current.posts), { id: newId(), images: [], caption }] }), true)
  }
  const toggle = enabled => {
    onChange({ ...latest.current, enabled })
    save(() => ({ enabled })).then(saved => { if (!saved) onChange({ ...latest.current, enabled: !enabled }) })
  }

  if (!flowId) return <Notice>Save the profile first, then add posts you’ve published.</Notice>
  if (allowed === null || allowed === undefined) return <div role="status" aria-label="Loading" className="h-40 rounded-2xl bg-bk-surface motion-safe:animate-pulse" />

  const full = posts.length + uploading.length >= MAX_POSTS
  const reading = busy === 'reading'
  const dropProps = {
    onDragEnter: e => { e.preventDefault(); setDragging(true) },
    onDragOver: e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' },
    onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) },
    onDrop: e => { e.preventDefault(); setDragging(false); pickImages(e.dataTransfer.files) },
  }
  const fileInput = <input ref={picker} type="file" accept={TYPES.join(',')} multiple tabIndex={-1} aria-hidden="true" className="hidden" onChange={e => { pickImages(e.target.files); e.target.value = '' }} />
  const pickCaption = (
    <button type="button" onClick={() => setCaptionOpen(true)} disabled={full} className={appButton('quiet', 'sm')}>
      <Type className="size-4" />Paste a caption only
    </button>
  )
  const grid = (posts.length > 0 || uploading.length > 0) && (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {posts.map((post, index) => (
        <PostCard
          key={post.id}
          post={post}
          number={index + 1}
          locked={locked}
          adding={adding[post.id] || 0}
          caption={captions[post.id]}
          onCaption={text => setCaptions(current => ({ ...current, [post.id]: text }))}
          onCaptionDone={() => !locked && saveCaption(post)}
          onRemove={() => remove(post)}
          onRemoveSlide={index => removeSlide(post, index)}
          onMoveSlide={(from, to) => moveSlide(post, from, to)}
          onAddSlides={files => addSlides(post, files)}
        />
      ))}
      {uploading.map(item => (
        <li key={item.id} className={cn(panelClass, 'relative overflow-hidden')}>
          <img src={item.preview} alt="" className="aspect-[4/5] w-full object-cover opacity-50" />
          <span className="absolute inset-0 flex items-center justify-center gap-2 text-[13px] font-bold">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />{item.files.length > 1 ? `Adding ${plural(item.files.length, 'slide')}…` : 'Adding…'}
          </span>
        </li>
      ))}
      {!locked && !full && (
        <li {...dropProps} className={cn('flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-4 text-center transition-colors', dragging ? 'border-bk-fg bg-bk-butter/15' : 'border-bk-field')}>
          <button type="button" onClick={() => picker.current?.click()} className={appButton('outline', 'sm')}><Plus className="size-4" />Add posts</button>
          {pickCaption}
          <span className="text-[12px] text-bk-muted">{posts.length + uploading.length} of {MAX_POSTS}</span>
        </li>
      )}
    </ul>
  )

  if (locked) {
    return (
      <div className="space-y-4">
        <UpgradeNotice error={limit || UPGRADE} />
        {posts.length > 0 && (
          <>
            <p className="text-[13.5px] leading-relaxed text-bk-muted">On your plan Batkle writes in its standard style. The posts you added are kept, and you can remove them.</p>
            {grid}
          </>
        )}
        {error && <p role="alert" className="text-[13px] font-semibold text-[#C2412F] dark:text-[#F0826F]">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className={cn(panelClass, 'flex items-start justify-between gap-4 p-4 sm:p-5')}>
        <div className="min-w-0">
          <p id="brand-posts-switch" className="text-[15px] font-bold">Write like my posts</p>
          <p id="brand-posts-switch-hint" className="mt-1 max-w-[560px] text-[13px] leading-relaxed text-bk-muted">
            {examples.enabled
              ? 'New posts, stories and ads take the voice of your posts as their base, without copying them.'
              : 'Off: Batkle writes in its standard style. Your posts stay here for when you turn it back on.'}
          </p>
        </div>
        <Switch checked={examples.enabled} onChange={toggle} labelledBy="brand-posts-switch" describedBy="brand-posts-switch-hint" />
      </div>

      {grid || (
        <div {...dropProps} className={cn('rounded-2xl border-2 border-dashed px-5 py-9 text-center transition-colors sm:px-8', dragging ? 'border-bk-fg bg-bk-butter/15' : 'border-bk-field bg-bk-surface')}>
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-bk-butter text-bk-ink"><ImageUp className="size-6" aria-hidden="true" /></span>
          <p className="mt-3 font-bk-display text-[19px] font-bold tracking-[-0.02em]">{dragging ? 'Drop to add these posts' : 'Add posts you’ve published'}</p>
          <p className="mx-auto mt-1 max-w-[480px] text-[13.5px] leading-relaxed text-bk-muted">Three to eight recent posts work best: their images (every slide of a carousel), and their captions if you have them.</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={() => picker.current?.click()} className={appButton('primary', 'md')}><ImageUp className="size-4" />Choose images</button>
            {pickCaption}
          </div>
        </div>
      )}
      {fileInput}

      {error && <p role="alert" className="text-[13px] font-semibold text-[#C2412F] dark:text-[#F0826F]">{error}</p>}
      {limit && <UpgradeNotice error={limit} />}

      {(posts.length > 0 || reading) && (
        <section aria-labelledby="brand-posts-voice" aria-busy={reading || undefined} className={cn(panelClass, 'p-5 transition-opacity sm:p-6', !examples.enabled && 'opacity-60')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Eyebrow><span id="brand-posts-voice">How your posts sound</span></Eyebrow>
            {voice && !reading && (
              <button type="button" onClick={() => save(() => ({ retry: true }), true)} disabled={!!busy} className={appButton('quiet', 'xs')}><RefreshCw className="size-3.5" />Read again</button>
            )}
          </div>
          {reading ? (
            <p role="status" className="mt-3 flex items-center gap-2 text-[14px] text-bk-muted"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Reading your posts and learning how you write…</p>
          ) : voice ? (
            <>
              <p className="mt-3 max-w-[760px] font-bk-display text-[clamp(18px,2vw,22px)] font-semibold leading-snug tracking-[-0.02em]">{voice.summary}</p>
              <ul className="mt-4 grid gap-x-6 gap-y-2.5 md:grid-cols-2">
                {(voice.traits || []).map((trait, i) => (
                  <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed"><span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-bk-butter" />{trait}</li>
                ))}
              </ul>
              <p className="mt-4 text-[12.5px] text-bk-muted">
                From {plural(voice.count, 'post')}{voice.updatedAt ? ` · ${dateOf(voice.updatedAt)}` : ''}{examples.enabled ? '' : ' · not used while “Write like my posts” is off'}
              </p>
            </>
          ) : (
            <p className="mt-3 text-[14px] text-bk-muted">Add a caption, or a post with words on its image, and Batkle learns how you write from it.</p>
          )}
          {examples.voiceError && !reading && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p role="alert" className="text-[13px] font-semibold text-[#C2412F] dark:text-[#F0826F]">{examples.voiceError}</p>
              <button type="button" onClick={() => save(() => ({ retry: true }), true)} disabled={!!busy} className={appButton('outline', 'xs')}><RefreshCw className="size-3.5" />Try again</button>
            </div>
          )}
        </section>
      )}

      <Popup
        open={!!choice}
        onOpenChange={open => { if (!open && choice) { choice.previews.forEach(url => URL.revokeObjectURL(url)); setChoice(null) } }}
        title={choice ? `${choice.files.length} images: one carousel or separate posts?` : ''}
        description="A carousel keeps its slides in this order, the first one as its cover. You can move slides afterwards."
        footer={choice && (
          <>
            <button type="button" onClick={() => decide(false)} disabled={full} className={appButton('outline', 'md')}>{choice.files.length} separate posts</button>
            <button type="button" onClick={() => decide(true)} className={appButton('primary', 'md')}><Images className="size-4" />One carousel</button>
          </>
        )}
      >
        {choice && (
          <ol className="flex gap-2 overflow-x-auto pb-1">
            {choice.previews.map((url, i) => (
              <li key={url} className="relative w-[72px] shrink-0">
                <img src={url} alt={`Image ${i + 1}`} className="aspect-[4/5] w-full rounded-lg object-cover" />
                <span className="absolute left-1 top-1 rounded-full bg-black/55 px-1.5 text-[10.5px] font-bold tabular-nums text-white">{i + 1}</span>
              </li>
            ))}
            {choice.files.length > choice.previews.length && <li className="flex w-[72px] shrink-0 items-center justify-center rounded-lg bg-bk-alt text-[12px] font-bold text-bk-muted">+{choice.files.length - choice.previews.length}</li>}
          </ol>
        )}
      </Popup>

      <Popup
        open={captionOpen}
        onOpenChange={setCaptionOpen}
        title="Paste a caption"
        description="A post’s caption on its own is enough for Batkle to learn from."
        footer={(
          <>
            <button type="button" onClick={() => setCaptionOpen(false)} className={appButton('outline', 'md')}>Cancel</button>
            <button type="button" onClick={addCaption} disabled={!newCaption.trim()} className={appButton('primary', 'md')}>Add caption</button>
          </>
        )}
      >
        <textarea aria-label="Caption" autoFocus rows={7} maxLength={CAPTION_LIMIT} value={newCaption} onChange={e => setNewCaption(e.target.value)} className={appField('h-auto resize-y py-2.5 text-[14px] leading-relaxed')} />
      </Popup>
    </div>
  )
}
