'use client'

import { Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { appButton } from '../ui'
import { StageBar } from './StageBar'
import { SlideCarousel } from './SlideCarousel'
import { editorHref } from './PostThumb'

const PHASE_LABEL = { building: 'Building now', ready: 'Post ready', failed: 'Needs attention', idea: 'New idea' }

/** The idea the user is working on: live build progress, its slides, and the next actions. */
export function FeaturedPost({ idea, status, onPreview, onBuild, onRetry, onRebuild, onNewVersion, className = '' }) {
  const { phase, canvas, steps, error, slides } = status
  const building = phase === 'building'
  const href = editorHref(canvas)
  const expected = slides || status.copy?.slides?.length || (idea.format === 'carousel' ? 5 : 1)
  const meta = [PHASE_LABEL[phase], idea.format === 'carousel' ? 'Carousel' : 'Single post', idea.pillar].filter(Boolean).join(' · ')

  return (
    <section
      aria-labelledby="featured-post-title"
      className={cn('overflow-hidden rounded-2xl bg-bk-ink text-bk-cream shadow-bk-pop lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] dark:ring-1 dark:ring-inset dark:ring-white/10', className)}
    >
      {/* Keyed by idea, so switching the featured idea eases in instead of jumping. */}
      <div key={idea.id} className="p-5 motion-safe:animate-bk-page sm:p-7">
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-bk-butter" aria-live="polite">
          <span aria-hidden="true" className={cn('size-1.5 rounded-full bg-bk-butter', building && 'motion-safe:animate-pulse')} />
          {meta}
        </p>
        <h2 id="featured-post-title" className="mt-3 line-clamp-3 font-bk-display text-[clamp(19px,1.7vw,24px)] font-bold leading-[1.15] tracking-[-0.025em]">
          {idea.topic}
        </h2>
        {idea.hook && <p className="mt-2.5 line-clamp-2 text-[13.5px] italic leading-relaxed text-bk-cream/75">“{idea.hook}”</p>}

        {phase !== 'idea' && <StageBar steps={steps} tone="dark" className="mt-5" />}
        {phase === 'failed' && error && <p className="mt-3 line-clamp-3 text-[13px] text-[#F0826F]">{error}</p>}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {phase === 'idea' && (
            <button type="button" onClick={onBuild} className={appButton('primary', 'md')}>Generate post</button>
          )}
          {phase === 'failed' && (
            <button type="button" onClick={onRetry} className={appButton('primary', 'md')}><RefreshCw className="size-3.5" />Retry</button>
          )}
          {phase === 'failed' && href && (
            <a href={href} target="_blank" rel="noopener noreferrer" className={appButton('onDark', 'md')}>Open last post</a>
          )}
          {(phase === 'ready' || phase === 'building') && (
            href
              ? <a href={href} target="_blank" rel="noopener noreferrer" className={appButton('primary', 'md')}>Open in editor</a>
              : <span className={appButton('primary', 'md', 'pointer-events-none opacity-80')}><Loader2 className="size-3.5 animate-spin" />Building…</span>
          )}
          {status.copy && (phase === 'ready' || (building && canvas)) && (
            <button
              type="button"
              onClick={onRebuild}
              disabled={building}
              title="Rebuild the design with the same copy. No new AI writing."
              className={appButton('onDark', 'md')}
            >
              Rebuild design · keep copy
            </button>
          )}
          {canvas && (
            <button
              type="button"
              onClick={onNewVersion}
              disabled={building}
              className="ml-1 text-[13px] font-semibold text-bk-cream/75 underline underline-offset-4 transition-colors hover:text-bk-cream disabled:opacity-40"
            >
              New version
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-center bg-[#0C0B10] px-3 py-5 sm:px-5">
        {canvas || building ? (
          <SlideCarousel canvas={canvas} count={Math.min(expected, 6)} onOpen={onPreview} dimmed={building && !!canvas} />
        ) : (
          <p className="max-w-[220px] rounded-xl border border-dashed border-white/15 px-5 py-7 text-center text-[12.5px] leading-relaxed text-white/45">
            {phase === 'failed' ? 'No post yet. Retry to build it.' : 'Your post preview appears here once it is built.'}
          </p>
        )}
      </div>
    </section>
  )
}
