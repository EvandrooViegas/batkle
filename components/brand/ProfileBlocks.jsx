'use client'

import { useEffect, useRef } from 'react'
import { Check, Pencil, Plus, X } from 'lucide-react'
import { appButton } from '@/components/app/ui'
import { cn } from '@/lib/utils'

/* Building blocks of the brand book: numbered sections, growing text fields and list editors. */

export const textareaClass = 'w-full min-w-0 resize-none rounded-xl border border-bk-field bg-bk-surface px-3.5 py-3 text-[15px] leading-relaxed text-bk-fg outline-none transition-[border-color,box-shadow] placeholder:text-bk-muted/80 focus:border-bk-fg focus:shadow-[0_0_0_4px_rgb(255_216_77/0.45)]'

export function GrowingTextarea({ value, onChange, label, className, ...props }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) { ref.current.style.height = 'auto'; ref.current.style.height = `${ref.current.scrollHeight}px` } }, [value])
  return <textarea ref={ref} aria-label={label} value={value} onChange={onChange} rows={2} className={cn(textareaClass, className)} {...props} />
}

export const paragraphsOf = text => String(text || '').split(/\n\s*\n|\n/).map(p => p.trim()).filter(Boolean)

/** One numbered chapter of the brand book. `onToggle` adds the Edit / Done switch. */
export function BookSection({ id, number, title, description, complete, editing, onToggle, children }) {
  return (
    <section id={`book-${id}`} aria-labelledby={`book-${id}-title`} className="scroll-mt-24 lg:scroll-mt-8">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-bk-line pb-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="font-bk-display text-[13px] font-bold tabular-nums text-bk-muted">{number}</span>
          <h2 id={`book-${id}-title`} className="font-bk-display text-[24px] font-bold leading-tight tracking-[-0.035em]">{title}</h2>
          {complete === false && <span className="shrink-0 rounded-full bg-bk-butter/40 px-2 py-0.5 text-[11.5px] font-bold text-bk-fg">Needs detail</span>}
        </div>
        {onToggle && (
          <button type="button" onClick={onToggle} aria-label={`${editing ? 'Done editing' : 'Edit'} ${title}`} className={appButton(editing ? 'ink' : 'outline', 'xs', 'h-7 px-2.5')}>
            {editing ? <Check className="size-3.5" /> : <Pencil className="size-3.5" />}{editing ? 'Done' : 'Edit'}
          </button>
        )}
      </div>
      {description && <p className="mt-2 max-w-[620px] text-[13.5px] leading-relaxed text-bk-muted">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

/** Editable list of short texts: one field per item, remove buttons and an Add button. */
export function ListEditor({ items, onChange, label, addLabel = 'Add item', placeholder }) {
  return (
    <div className="space-y-2.5">
      {items.map((item, index) => (
        <div key={index} className="flex items-start gap-2">
          <span className="mt-3.5 w-6 shrink-0 text-right font-bk-display text-[13px] font-bold tabular-nums text-bk-muted">{String(index + 1).padStart(2, '0')}</span>
          <GrowingTextarea label={`${label} ${index + 1}`} value={item} placeholder={placeholder} onChange={e => onChange(items.map((value, i) => (i === index ? e.target.value : value)))} />
          <button type="button" aria-label={`Remove ${label} ${index + 1}`} onClick={() => onChange(items.filter((_, i) => i !== index))} className={appButton('quiet', 'xs', 'mt-2 size-9 px-0 text-bk-muted hover:text-[#C2412F]')}><X className="size-4" /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, ''])} className={appButton('outline', 'xs', 'ml-8')}><Plus className="size-3.5" />{addLabel}</button>
    </div>
  )
}

/** What an empty section says, with a way to start filling it. */
export function EmptyHint({ children, onAdd, addLabel = 'Add details' }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-bk-field px-5 py-4">
      <p className="text-[14px] text-bk-muted">{children}</p>
      {onAdd && <button type="button" onClick={onAdd} className={appButton('outline', 'xs')}><Plus className="size-3.5" />{addLabel}</button>}
    </div>
  )
}
