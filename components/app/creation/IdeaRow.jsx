'use client'

import { CalendarClock, Check, Image as ImageIcon, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { appButton } from '../ui'
import UpgradeNotice from '../billing/UpgradeNotice'
import { ScheduleLine, approvalAction } from '../schedule/ScheduleStatus'
import { StageBar } from './StageBar'
import { PostThumb, ThumbSkeleton, editorHref } from './PostThumb'
import { useSurfaceWords } from './surface'

/**
 * One idea in the list, with its post thumbnail (click to preview), progress and next action. A ready post shows
 * its approval step (`approval`: { state, entry }): approve, schedule or edit its schedule. A build stopped by a plan
 * limit (`limit`, from useCreation's limitOf) offers the upgrade instead of a retry.
 */
export function IdeaRow({ idea, number, status, approval, onApproval, selecting, selected, onToggle, onPreview, onBuild, onRetry, limit = null, order = 0 }) {
  const w = useSurfaceWords()
  const { phase, canvas, steps, error, slides } = status
  const building = phase === 'building'
  const href = editorHref(canvas)
  const action = phase === 'ready' && approval ? approvalAction(approval.state) : null
  const unapproved = !approval || approval.state === 'unapproved'
  const showThumb = !!canvas || building

  return (
    <li
      className={cn('flex flex-col gap-3 px-4 py-3.5 transition-colors motion-safe:animate-bk-page sm:px-5 md:flex-row md:items-center md:gap-5', selected ? 'bg-bk-butter/10' : 'can-hover:bg-bk-alt/40')}
      style={{ animationDelay: `${Math.min(order, 8) * 35}ms` }}
    >
      <div className="flex items-center gap-3 md:w-9 md:shrink-0">
        {selecting && (
          <button
            type="button"
            onClick={onToggle}
            role="checkbox"
            aria-checked={selected}
            aria-label={`Select idea ${number}`}
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg',
              selected ? 'border-bk-fg bg-bk-fg text-bk-bg' : 'border-bk-field hover:border-bk-fg',
            )}
          >
            {selected && <Check className="size-3.5" strokeWidth={3} />}
          </button>
        )}
        <span className={cn('font-bk-display text-[22px] font-bold leading-none tracking-[-0.03em] text-bk-field tabular-nums', selecting && 'hidden md:inline')}>
          {String(number).padStart(2, '0')}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 gap-3.5 sm:gap-4">
        {showThumb && (
          <div className="w-[72px] shrink-0 sm:w-[92px]">
            {canvas ? (
              <button
                type="button"
                onClick={() => onPreview(0)}
                aria-label={`Preview ${w.noun}: ${idea.topic}`}
                className="block w-full rounded-md transition-transform duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg can-hover:-translate-y-0.5"
              >
                <PostThumb canvas={canvas} className={cn('shadow-bk-card', building && 'opacity-60')} />
              </button>
            ) : (
              <ThumbSkeleton className="bg-bk-chip" />
            )}
            {canvas && (
              <p className="mt-1.5 text-[11px] text-bk-muted">
                {slides > 1 ? `Slide 1 of ${slides}` : w.single}
              </p>
            )}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-[12px] font-semibold text-bk-muted">
            {idea.format === 'carousel' ? 'Carousel' : 'Single'}
            {idea.userRequest && <span className="rounded-full bg-bk-chip px-2 py-0.5 text-[11px] font-bold text-bk-fg/80">Your idea</span>}
            {(idea.imageChoice === 'on' || idea.imageChoice === 'off') && (
              <span className="rounded-full bg-bk-chip px-2 py-0.5 text-[11px] font-bold text-bk-fg/80">{idea.imageChoice === 'on' ? 'With images' : 'No images'}</span>
            )}
            {idea.images?.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-bk-chip px-2 py-0.5 text-[11px] font-bold text-bk-fg/80">
                <ImageIcon className="size-3" aria-hidden="true" />
                {idea.images.length} photo{idea.images.length > 1 ? 's' : ''}
              </span>
            )}
          </p>
          <h3 className="mt-1 font-bk-display text-[15px] font-bold leading-snug tracking-[-0.015em]">{idea.topic}</h3>
          {idea.hook && <p className="mt-1 line-clamp-2 text-[13px] italic leading-relaxed text-bk-muted">“{idea.hook}”</p>}
          <StageBar steps={steps} className="mt-3" />
          {phase === 'ready' && !unapproved && <ScheduleLine state={approval.state} entry={approval.entry} className="mt-2" />}
          {phase === 'failed' && (limit
            ? <UpgradeNotice error={limit} compact className="mt-2" />
            : error && <p className="mt-1.5 line-clamp-2 text-[12px] text-[#C2412F] dark:text-[#F0826F]">{error}</p>)}
        </div>
      </div>

      <div className="flex items-center gap-2.5 md:shrink-0 md:justify-end" aria-live="polite">
        {building && (
          <span className="flex items-center gap-2 text-[13px] font-bold">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />Building…
          </span>
        )}
        {phase === 'ready' && (
          <>
            {unapproved && <span className="text-[12.5px] font-bold text-[#1E8A5A] dark:text-[#4CC38A]">{w.Noun} ready</span>}
            {action && (
              <button type="button" onClick={onApproval} className={appButton(['unapproved', 'changed', 'approved'].includes(approval?.state ?? 'unapproved') ? 'primary' : 'outline', 'md')}>
                {action.kind === 'approve' ? <Check className="size-3.5" strokeWidth={3} /> : <CalendarClock className="size-3.5" />}{action.label}
              </button>
            )}
            {href && <a href={href} target="_blank" rel="noopener noreferrer" className={appButton('outline', 'md')}>Open in editor</a>}
          </>
        )}
        {phase === 'failed' && !limit && (
          <>
            <span className="text-[12.5px] font-bold text-[#C2412F] dark:text-[#F0826F]">Couldn&apos;t finish</span>
            <button type="button" onClick={onRetry} className={appButton('outline', 'md')}><RefreshCw className="size-3.5" />Retry</button>
          </>
        )}
        {phase === 'idea' && (
          <button type="button" onClick={onBuild} className={appButton('primary', 'md')}>Generate {w.noun}</button>
        )}
      </div>
    </li>
  )
}
