'use client'

import { useState } from 'react'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { appButton, appLayer } from '../ui'
import { appField } from '../field'

// As lib/services/postFeedback.ts keeps them.
const REASONS = [['hook', 'Hook'], ['text', 'Text'], ['topic', 'Topic'], ['design', 'Design']]
const NOTE_LIMIT = 240
const same = (a, b) => a?.rating === b?.rating && (a?.note || '') === (b?.note || '') && [...(a?.reasons || [])].sort().join() === [...(b?.reasons || [])].sort().join()

const TONES = {
  light: { idle: 'border border-bk-field text-bk-fg/70 hover:border-bk-fg hover:text-bk-fg', on: 'border border-bk-fg bg-bk-fg text-bk-bg' },
  dark: { idle: 'border border-white/25 text-bk-cream/80 hover:border-white/60 hover:text-bk-cream', on: 'border border-bk-butter bg-bk-butter text-bk-ink' },
}

/**
 * Like or dislike a post Batkle made, so the next ones follow the owner's taste (lib/services/postFeedback.ts). A thumb
 * saves at once and opens a small, optional question: what it was about (the hook, the text, the topic or the design)
 * and a note, saved when it closes. Pressing the same thumb again takes the rating away. `value` is the saved rating
 * ({ rating, reasons, note }) or null; `onRate(value | null)`. `compact` joins the two thumbs into one small control,
 * for rows that already have their own buttons.
 */
export function PostRating({ value, onRate, noun = 'post', tone = 'light', compact = false, className = '' }) {
  const [draft, setDraft] = useState(null)
  const styles = TONES[tone] || TONES.light
  const rating = draft?.rating || value?.rating || null

  const press = next => {
    if (value?.rating === next && !draft) { onRate(null); return }
    const fresh = { rating: next, reasons: [], note: '' }
    setDraft(fresh)
    onRate(fresh)
  }
  const close = () => {
    if (draft && !same(draft, value)) onRate(draft)
    setDraft(null)
  }
  const toggle = reason => setDraft(d => ({ ...d, reasons: d.reasons.includes(reason) ? d.reasons.filter(r => r !== reason) : [...d.reasons, reason] }))
  const thumb = (kind, Icon, label) => (
    <button
      type="button"
      onClick={() => press(kind)}
      aria-pressed={rating === kind}
      aria-label={label}
      title={label}
      className={cn(
        'flex items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-current',
        compact
          ? cn('h-full w-8', rating === kind ? 'bg-bk-fg text-bk-bg' : 'text-bk-fg/60 hover:bg-bk-alt hover:text-bk-fg')
          : cn('size-8 rounded-lg', rating === kind ? styles.on : styles.idle),
      )}
    >
      <Icon className={compact ? 'size-3.5' : 'size-4'} strokeWidth={rating === kind ? 2.5 : 2} aria-hidden="true" />
    </button>
  )

  return (
    <Popover open={!!draft} onOpenChange={open => { if (!open) close() }}>
      <PopoverAnchor asChild>
        <div
          role="group"
          aria-label={`Rate this ${noun}`}
          className={cn(compact ? 'flex h-8 shrink-0 items-stretch divide-x divide-bk-field overflow-hidden rounded-lg border border-bk-field' : 'flex items-center gap-1.5', className)}
        >
          {thumb('like', ThumbsUp, `Like this ${noun}`)}
          {thumb('dislike', ThumbsDown, `Dislike this ${noun}`)}
        </div>
      </PopoverAnchor>
      {/* The popover opens outside the app root, so it brings the app's theme and its own surface (as PostSettings does). */}
      <PopoverContent align="start" sideOffset={8} collisionPadding={16} onOpenAutoFocus={e => e.preventDefault()} className={cn(appLayer, 'w-[min(288px,calc(100vw-32px))] rounded-2xl border-bk-line bg-bk-surface p-4 shadow-bk-pop')}>
        {draft && (
          <>
            <p className="text-[13.5px] font-bold">{draft.rating === 'like' ? 'What did you like?' : 'What missed?'}</p>
            <p className="mt-0.5 text-[12px] leading-snug text-bk-muted">
              Optional. Batkle {draft.rating === 'like' ? `makes more ${noun}s like this one` : `steers away from this in the next ${noun}s`}.
            </p>
            <div role="group" aria-label={draft.rating === 'like' ? 'What you liked' : 'What missed'} className="mt-3 flex flex-wrap gap-1.5">
              {REASONS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggle(id)}
                  aria-pressed={draft.reasons.includes(id)}
                  className={cn('rounded-full border px-3 py-1 text-[12.5px] font-semibold transition-colors', draft.reasons.includes(id) ? 'border-bk-fg bg-bk-fg text-bk-bg' : 'border-bk-field hover:border-bk-fg')}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              aria-label={draft.rating === 'like' ? 'Anything else you liked' : 'What would make it better'}
              placeholder={draft.rating === 'like' ? 'Anything else? (optional)' : 'What would make it better? (optional)'}
              maxLength={NOTE_LIMIT}
              value={draft.note}
              onChange={e => setDraft(d => ({ ...d, note: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') close() }}
              className={appField('mt-3 h-9 text-[13px]')}
            />
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={close} className={appButton('primary', 'sm')}>Done</button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
