'use client'

import { useEffect, useState } from 'react'
import { CalendarClock, Check, ChevronLeft, ChevronRight, Copy, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { appButton, appLayer, Eyebrow } from '../ui'
import { PostThumb, editorHref } from './PostThumb'
import { ScheduleLine, approvalAction } from '../schedule/ScheduleStatus'

const tag = t => (String(t).startsWith('#') ? t : `#${t}`)

/**
 * Full preview of a generated post: every slide, the caption and hashtags, and the post actions.
 * Shows the latest saved canvas, so edits made in the editor appear here too.
 */
export function PostPreview({ open, onOpenChange, idea, status, approval, onApproval, initialPage = 0, onRebuild, onNewVersion }) {
  const stored = status?.canvas || null
  const [latest, setLatest] = useState(null)
  const [page, setPage] = useState(initialPage)

  useEffect(() => { if (open) setPage(initialPage) }, [open, initialPage])

  useEffect(() => {
    if (!open || !stored?.id) return
    let cancelled = false
    fetch(`/api/canvases/${stored.id}`)
      .then(r => (r.ok ? r.json() : null))
      .then(canvas => { if (!cancelled && canvas?.id) setLatest(canvas) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [open, stored?.id])

  if (!idea || !status) return null
  const canvas = latest?.id === stored?.id ? latest : stored
  const total = canvas?.type === 'carousel' ? canvas.pages?.length || 1 : 1
  const current = Math.min(page, total - 1)
  const copy = status.copy
  const hashtags = Array.isArray(copy?.hashtags) ? copy.hashtags.map(tag) : []
  const href = editorHref(canvas, current)
  const building = status.phase === 'building'
  const action = status.phase === 'ready' && approval ? approvalAction(approval.state) : null
  const go = delta => setPage(p => Math.max(0, Math.min(total - 1, p + delta)))

  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText([copy?.caption, hashtags.join(' ')].filter(Boolean).join('\n\n'))
      toast.success('Caption copied')
    } catch {
      toast.error('Could not copy the caption')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={e => {
          if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
          if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
        }}
        className={cn(appLayer, 'max-h-[92vh] w-[calc(100vw-24px)] max-w-[960px] gap-0 overflow-y-auto rounded-2xl border-bk-line bg-bk-surface p-0 sm:rounded-2xl md:grid md:grid-cols-[minmax(0,1fr)_340px] md:overflow-hidden [&>button:last-child]:hidden')}
      >
        <DialogClose className={appButton('outline', 'xs', 'absolute right-3 top-3 z-10 size-9 rounded-full px-0')} aria-label="Close preview">
          <X className="size-4" />
        </DialogClose>
        <div className="flex flex-col items-center justify-center gap-4 bg-bk-alt px-5 pb-5 pt-14 sm:px-8 sm:pb-8">
          <div className="relative w-full max-w-[min(400px,calc((92vh_-_180px)*0.8))]">
            {canvas
              ? <PostThumb canvas={canvas} page={current} className="rounded-xl shadow-bk-pop" />
              : <div className="flex aspect-[1080/1350] items-center justify-center rounded-xl border border-dashed border-bk-field text-[14px] text-bk-muted">No post yet</div>}
            {total > 1 && (
              <>
                <button type="button" onClick={() => go(-1)} disabled={current === 0} aria-label="Previous slide" className={appButton('outline', 'xs', 'absolute left-2 top-1/2 size-10 -translate-y-1/2 rounded-full px-0 shadow-bk-card active:-translate-y-1/2')}>
                  <ChevronLeft className="size-5" />
                </button>
                <button type="button" onClick={() => go(1)} disabled={current === total - 1} aria-label="Next slide" className={appButton('outline', 'xs', 'absolute right-2 top-1/2 size-10 -translate-y-1/2 rounded-full px-0 shadow-bk-card active:-translate-y-1/2')}>
                  <ChevronRight className="size-5" />
                </button>
              </>
            )}
          </div>
          {total > 1 && (
            <>
              <p className="text-[13px] font-semibold text-bk-muted" aria-live="polite">Slide {current + 1} of {total}</p>
              <ul className="flex max-w-full gap-2 overflow-x-auto p-1" aria-label="Slides">
                {Array.from({ length: total }, (_, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => setPage(i)}
                      aria-label={`Slide ${i + 1}`}
                      aria-current={i === current ? 'true' : undefined}
                      className={cn('block w-12 rounded-[5px] transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg', i === current ? 'opacity-100 ring-2 ring-bk-fg ring-offset-2 ring-offset-bk-alt' : 'opacity-60 hover:opacity-100')}
                    >
                      <PostThumb canvas={canvas} page={i} className="rounded-[5px]" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="flex flex-col p-5 sm:p-6 md:max-h-[92vh] md:overflow-y-auto">
          <Eyebrow>{[idea.format === 'carousel' ? 'Carousel' : 'Single post', idea.pillar].filter(Boolean).join(' · ')}</Eyebrow>
          <DialogTitle className="mt-2 pr-6 font-bk-display text-[19px] font-bold leading-snug tracking-[-0.025em]">{idea.topic}</DialogTitle>
          <DialogDescription className={cn('mt-1.5 text-[13.5px] italic leading-relaxed text-bk-muted', !idea.hook && 'sr-only')}>
            {idea.hook ? `“${idea.hook}”` : 'Post preview'}
          </DialogDescription>
          {idea.userRequest && (
            <p className="mt-4 rounded-lg bg-bk-chip px-3 py-2 text-[13px] text-bk-fg/80"><span className="font-bold">Your idea:</span> {idea.userRequest}</p>
          )}
          {idea.images?.length > 0 && (
            <section className="mt-4" aria-labelledby="preview-photos">
              <h3 id="preview-photos" className="text-[12px] font-bold uppercase tracking-[0.14em] text-bk-muted">Your photos</h3>
              <ul className="mt-2 space-y-2">
                {idea.images.map(image => (
                  <li key={image.id} className="flex gap-3">
                    <img src={image.thumbnail_url || image.url} alt="" className="size-12 shrink-0 rounded-md border border-bk-line object-cover" />
                    <p className="line-clamp-3 text-[12px] leading-snug text-bk-muted">{image.description || 'Photo supplied by you.'}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(copy?.caption || hashtags.length > 0) && (
            <section className="mt-6 border-t border-bk-line pt-5" aria-labelledby="preview-caption">
              <div className="flex items-center justify-between gap-3">
                <h3 id="preview-caption" className="text-[12px] font-bold uppercase tracking-[0.14em] text-bk-muted">Caption</h3>
                <button type="button" onClick={copyCaption} className={appButton('quiet', 'xs', 'h-7 px-2 font-semibold')}>
                  <Copy className="size-3.5" />Copy
                </button>
              </div>
              {copy?.caption && <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed">{copy.caption}</p>}
              {hashtags.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Hashtags">
                  {hashtags.map(h => <li key={h} className="rounded-md bg-bk-chip px-2 py-0.5 text-[13px]">{h}</li>)}
                </ul>
              )}
            </section>
          )}

          <div className="mt-auto flex flex-col gap-2.5 pt-7">
            {building && (
              <p className="flex items-center gap-2 text-[14px] font-bold"><Loader2 className="size-4 animate-spin" />Building a new version…</p>
            )}
            {status.phase === 'ready' && approval && <ScheduleLine state={approval.state} entry={approval.entry} className="mb-1" />}
            {action && (
              <button type="button" onClick={onApproval} className={appButton('primary', 'md', 'w-full')}>
                {action.kind === 'approve' ? <Check className="size-4" strokeWidth={3} /> : <CalendarClock className="size-4" />}{action.label}
              </button>
            )}
            {href && <a href={href} target="_blank" rel="noopener noreferrer" className={appButton(action ? 'outline' : 'primary', 'md', 'w-full')}>Open in editor</a>}
            {copy && (
              <button type="button" onClick={onRebuild} disabled={building} title="Rebuild the design with the same copy. No new AI writing." className={appButton('outline', 'md', 'w-full')}>
                Rebuild design · keep copy
              </button>
            )}
            <button type="button" onClick={onNewVersion} disabled={building} className={appButton('quiet', 'md', 'w-full')}>
              New version
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
