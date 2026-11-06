'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, Loader2, Plus, Search, Shuffle, ZoomIn } from 'lucide-react'
import GlobalDesignPreview from '@/components/GlobalDesignPreview'
import { Origin } from '@/components/DesignByline'
import { useBrandDesignSelection } from '@/components/BrandDesignStudio'
import { familyImagery } from '@/lib/designs/global/study'
import { cn } from '@/lib/utils'
import { appField } from './field'
import { appButton } from './ui'

/**
 * Choosing designs, the same way everywhere: the ad's design step, the post settings, the brand profile and the
 * onboarding. A design is a card with its sample slide, its name and who made it; a picked one is ringed in yellow
 * with a filled radio or tick, like the app's other choice cards. `DesignPicker` picks one design (or Auto) and can add
 * a design from the Design Library without leaving.
 */

// How a design uses imagery, in plain words.
export const IMAGERY_LABELS = {
  none: 'Typography only', background: 'Photo behind the text', fullBleed: 'Full-bleed photos', cutout: 'Cut-out images',
  contained: 'Framed photos', collage: 'Photo collage', mixed: 'Mixed imagery', other: 'Mixed imagery',
}

// A card is the sample slide edge to edge on top, then its name and maker. `info` pads the words, `footer` the sample
// dots under them, and `tile` is the add tile's inside.
const SIZES = {
  // The post settings popover: four to a row.
  sm: { card: 'rounded-xl', info: 'px-2 py-1.5', name: 'truncate text-[11.5px] font-semibold', footer: 'px-2 pb-2', tile: 'gap-1.5 p-2' },
  // A dialog.
  md: { card: 'rounded-2xl', info: 'gap-2 px-3 pb-3 pt-2.5', name: 'line-clamp-2 text-[13.5px] font-bold leading-snug', footer: '-mt-1 px-3 pb-3', tile: 'gap-2 p-4' },
  // A page.
  lg: { card: 'rounded-2xl', info: 'gap-2.5 px-3.5 pb-3.5 pt-3', name: 'line-clamp-2 text-[14.5px] font-bold leading-snug', footer: '-mt-1.5 px-3.5 pb-3.5', tile: 'gap-2.5 p-5' },
}
const picked = 'bg-[#FFD84D]/10 dark:bg-bk-butter/[0.07]'
// Drawn inside the card's edge: the card clips anything outside it.
const focusInside = 'focus-visible:[outline-style:solid] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bk-fg'

/** A radio dot or a tick box, in the yellow of the app's choice cards. */
function Mark({ kind, on }) {
  const yellow = 'border-[#E2A100] dark:border-bk-butter'
  return (
    <span aria-hidden="true" className={cn('mt-px flex size-[18px] shrink-0 items-center justify-center border-2', kind === 'checkbox' ? 'rounded-[5px]' : 'rounded-full', on ? yellow : 'border-bk-field', on && kind === 'checkbox' && 'bg-[#E2A100] text-white dark:bg-bk-butter dark:text-bk-ink')}>
      {on && (kind === 'checkbox' ? <Check className="size-3" strokeWidth={3.5} /> : <span className="size-2 rounded-full bg-[#E2A100] dark:bg-bk-butter" />)}
    </span>
  )
}

/**
 * One design to choose, as a raised card: its preview (children) edge to edge on top, then a radio or tick with its
 * name and a line under it (`meta`). `kind` is 'radio' (one of several) or 'checkbox' (any number); a picked one is
 * ringed in yellow. `overlay` sits over the card (an inspect button); `footer` goes under the name (sample dots).
 */
export function DesignCard({ kind = 'radio', selected = false, onSelect, name, label = name, meta, title, size = 'md', disabled, busy, overlay, footer, children }) {
  const s = SIZES[size]
  return (
    <div className={cn('relative flex min-w-0 flex-col overflow-hidden bg-bk-surface shadow-bk-card transition-[box-shadow]', s.card, selected ? 'ring-2 ring-[#E2A100] dark:ring-bk-butter' : 'can-hover:shadow-bk-pop')}>
      <button
        type="button" onClick={onSelect} disabled={disabled} title={title} aria-label={label} role={kind} aria-checked={selected}
        className={cn('flex w-full min-w-0 flex-1 flex-col text-left disabled:cursor-not-allowed', s.card, focusInside, busy && 'disabled:cursor-wait')}
      >
        {/* The preview's sample words are decoration; the card is named by its design. */}
        <span aria-hidden="true" className="relative block w-full overflow-hidden bg-bk-chip">
          {children}
          {busy && <span className="absolute inset-0 flex items-center justify-center bg-black/40"><Loader2 className="size-5 animate-spin text-white" /></span>}
        </span>
        <span className={cn('flex w-full flex-1 items-start', s.info, selected && picked)}>
          {size !== 'sm' && <Mark kind={kind} on={selected} />}
          <span className="min-w-0 flex-1">
            <span className={cn('block', s.name)}>{name}</span>
            {meta && size !== 'sm' && <span className="mt-1 block min-w-0">{meta}</span>}
          </span>
        </span>
      </button>
      {overlay}
      {footer && <div className={cn(s.footer, selected && picked)}>{footer}</div>}
    </div>
  )
}

/**
 * The way into the Design Library, as a dashed tile the size of a design card. It shows no designs, so it is there
 * at once instead of loading previews in one by one.
 */
function AddTile({ size, count, onClick }) {
  const s = SIZES[size]
  return (
    <button type="button" onClick={onClick} title="Add a design from the Design Library"
      className={cn('group relative min-w-0 border-2 border-dashed border-bk-field text-center transition-colors can-hover:border-bk-fg/40 can-hover:bg-bk-alt/60', s.card, focusInside)}>
      {/* As tall as a card even alone on its row: the preview's 4:5 and the line of words under it. */}
      <span aria-hidden="true" className={cn('block w-full', size === 'sm' ? 'aspect-[4/5.4]' : 'aspect-[4/5.8]')} />
      <span className={cn('absolute inset-0 flex flex-col items-center justify-center', s.tile)}>
        <span className={cn('flex items-center justify-center rounded-full bg-bk-butter text-bk-ink transition-transform can-hover:group-hover:scale-105', size === 'sm' ? 'size-7' : 'size-10')}>
          <Plus className={size === 'sm' ? 'size-3.5' : 'size-5'} strokeWidth={2.5} aria-hidden="true" />
        </span>
        <span className={cn('font-bold leading-tight', size === 'sm' ? 'text-[11px]' : size === 'lg' ? 'text-[14.5px]' : 'text-[13.5px]')}>Add from the library</span>
        {size !== 'sm' && <span className="text-[12px] text-bk-muted">{count} more design{count === 1 ? '' : 's'}</span>}
      </span>
    </button>
  )
}

/** The line under a design's name: who made it (with the brand's logo and their photo), else how it uses imagery. */
export function DesignMeta({ family, info = family?.library, size = 'md' }) {
  const text = size === 'lg' ? 'text-[12.5px]' : 'text-[12px]'
  if (info) return <Origin info={info} className={text} />
  return <span className={cn('block truncate text-bk-muted', text)}>{IMAGERY_LABELS[familyImagery(family).mode] || (family?.tags || []).join(' · ')}</span>
}

/** Dots under a design card to flip through its four sample slides. */
export function SampleDots({ name, value, onChange }) {
  return (
    <div role="group" aria-label={`${name}: sample slides`} className="flex gap-1.5">
      {[0, 1, 2, 3].map(n => (
        <button key={n} type="button" aria-label={`Sample slide ${n + 1}`} aria-pressed={value === n} onClick={() => onChange(n)} className={cn('h-1.5 flex-1 rounded-full transition-colors', value === n ? 'bg-bk-fg' : 'bg-bk-line hover:bg-bk-field')} />
      ))}
    </div>
  )
}

/** Auto, as what it picks from: the brand's own designs, four sample slides of them. */
function AutoPreview({ families, brand }) {
  const cells = families.length ? Array.from({ length: 4 }, (_, k) => ({ family: families[k % families.length], sample: Math.floor(k / families.length) % 4 })) : []
  return (
    <span className="relative block aspect-[4/5] bg-bk-chip">
      {cells.length > 0 && (
        <span className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-[3px] p-[3px]">
          {cells.map((cell, k) => <span key={k} className="min-h-0 overflow-hidden rounded-[5px]"><GlobalDesignPreview family={cell.family} brand={brand} sample={cell.sample} sampleLabel={false} /></span>)}
        </span>
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex size-9 items-center justify-center rounded-full bg-bk-surface text-bk-fg shadow-bk-pop"><Shuffle className="size-4" /></span>
      </span>
    </span>
  )
}

/** Published designs the account may use, with who made each (`library`), loaded once when `enabled`. */
function useLibrary(enabled) {
  const [state, setState] = useState({ status: 'idle', families: [] })
  useEffect(() => {
    if (!enabled || state.status !== 'idle') return
    setState({ status: 'loading', families: [] })
    fetch('/api/global-designs')
      .then(async res => { const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || 'The Design Library could not be loaded.'); return data })
      .then(items => setState({ status: 'ready', families: (Array.isArray(items) ? items : []).filter(f => f?.id && f.library?.usable !== false) }))
      .catch(error => setState({ status: 'error', families: [], error: error.message }))
  }, [enabled, state.status])
  return [state, () => setState({ status: 'idle', families: [] })]
}

/**
 * Picks the design for one post or ad: Auto (Batkle picks among the brand's designs) or one of them. Someone who
 * manages the brand (`canAdd`) can also add a design from the Design Library here, in two steps: picking one in the
 * library only selects it, so its sample slides can be looked through, and "Add and use it" adds it to the brand and
 * picks it. `designs` is useBrandDesigns' state and `reload` its reload. `title` and `hint` head the picker, with the way
 * into the library beside them. With `requireDesign` (ads), a brand without designs of its own opens on the library;
 * posts keep Auto, which then uses the starter designs.
 */
export function DesignPicker({ flowId, brand = {}, designs, reload, value, onChange, canAdd = false, requireDesign = false, size = 'md', columns = 'grid-cols-2 sm:grid-cols-3', autoHint = 'Batkle picks the best fit', onInspect, emptyText, title, hint }) {
  const [view, setView] = useState('mine')
  const [query, setQuery] = useState('')
  const [choice, setChoice] = useState(''), [samples, setSamples] = useState({})
  const [adding, setAdding] = useState(false), [pending, setPending] = useState('')
  const [library, reloadLibrary] = useLibrary(canAdd && designs.status === 'ready')
  const selection = useBrandDesignSelection(canAdd ? flowId : null, brand)
  const items = designs.items
  // Who made each design comes with the library; the brand's own copies don't carry it.
  const byId = useMemo(() => new Map(library.families.map(f => [f.id, f])), [library.families])
  const have = new Set([...items.map(item => item.family.id), ...selection.selected])
  const addable = library.families.filter(f => !have.has(f.id))
  const found = addable.filter(f => `${f.name} ${(f.tags || []).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
  const chosen = addable.find(f => f.id === choice)
  const s = size
  // Raised cards need room for their shadows and the picked one's ring.
  const gaps = s === 'sm' ? 'gap-2' : 'gap-4'
  const brandName = brand?.name || 'the brand'
  // Something that needs a design, for a brand without one, starts in the library.
  const first = requireDesign && !items.length
  const showLibrary = canAdd && (view === 'library' || (first && designs.status === 'ready' && library.status !== 'error'))
  // Adding saves the brand's whole list, so it waits for that list, and never saves one missing a design it has.
  const listed = selection.ready && items.every(item => selection.selected.includes(item.family.id))
  const canOpenLibrary = canAdd && library.status === 'ready' && listed && addable.length > 0

  // A design just added is picked once the brand's designs come back with it.
  useEffect(() => {
    if (!pending) return
    const item = items.find(i => i.family.id === pending)
    if (item) { onChange(item.design.id); setPending('') }
  }, [items, pending]) // eslint-disable-line react-hooks/exhaustive-deps

  const openLibrary = () => { setChoice(''); setQuery(''); setView('library') }
  const closeLibrary = () => { setChoice(''); setQuery(''); setView('mine') }
  const add = async () => {
    if (!listed || !chosen) return
    setAdding(true)
    const saved = await selection.toggle(chosen.id, `“${chosen.name}” is now one of ${brand?.name ? `${brand.name}’s` : 'the brand’s'} designs.`)
    setAdding(false)
    if (!saved) return
    setPending(chosen.id); closeLibrary()
    reload()
  }

  // The picker's heading (on its own only where it was given one), with an action on the right.
  const head = (text, note, action) => (text || action) && (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2', s === 'sm' ? 'mb-2' : 'mb-3')}>
      <div className="min-w-0 flex-1 basis-[260px]">
        {text && <p className="text-[13.5px] font-bold">{text}</p>}
        {note && <p className={cn('text-[12px] leading-snug text-bk-muted', text && 'mt-1.5')}>{note}</p>}
      </div>
      {action}
    </div>
  )
  const skeleton = label => (
    <div role="status" aria-label={label} className={cn('grid', gaps, columns)}>
      {[0, 1, 2, 3].map(i => <span key={i} className={cn('block aspect-[4/5.8] bg-bk-alt motion-safe:animate-pulse', SIZES[s].card)} />)}
    </div>
  )

  if (designs.status === 'loading' || designs.status === 'idle') return <div>{head(title, hint)}{skeleton('Loading your designs')}</div>

  if (showLibrary) {
    const note = `${first ? `${emptyText || 'This brand has no designs yet.'} ` : ''}Pick one to look through its slides, then add it. It becomes one of ${brandName}’s designs, for its posts and ads.`
    return (
      <div>
        {!first && <button type="button" onClick={closeLibrary} className={appButton('quiet', 'xs', '-ml-2 mb-1 text-bk-muted')}><ArrowLeft className="size-3.5" />Your designs</button>}
        {head(s === 'sm' ? '' : 'Add a design from the Design Library', note, addable.length > 6 && (
          <div className="relative w-full min-w-0 sm:w-[240px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-bk-muted" aria-hidden="true" />
            <input type="search" aria-label="Search the Design Library" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search designs or styles" className={appField('h-9 pl-9 text-[13.5px]')} />
          </div>
        ))}
        {selection.error && <p role="alert" className="mb-2 text-[12.5px] font-semibold text-[#C2412F] dark:text-[#F0826F]">{selection.error}</p>}
        {library.status === 'error' ? (
          <p className="text-[12.5px] text-[#C2412F] dark:text-[#F0826F]">{library.error} <button type="button" onClick={reloadLibrary} className="font-semibold underline underline-offset-4">Try again</button></p>
        ) : library.status !== 'ready' ? skeleton('Loading the Design Library') : found.length ? (
          <div role="radiogroup" aria-label="Designs in the library" className={cn('grid', gaps, columns)}>
            {found.map(family => (
              <DesignCard
                key={family.id} size={s} name={family.name} title={family.name} meta={<DesignMeta family={family} size={s} />}
                selected={choice === family.id} disabled={adding} onSelect={() => setChoice(family.id)}
                footer={s !== 'sm' && <SampleDots name={family.name} value={samples[family.id] || 0} onChange={n => { setSamples(prev => ({ ...prev, [family.id]: n })); setChoice(family.id) }} />}
              >
                <GlobalDesignPreview family={family} brand={brand} sample={samples[family.id] || 0} sampleLabel={false} />
              </DesignCard>
            ))}
          </div>
        ) : <p className="text-[13px] text-bk-muted">{query ? `No design matches “${query}”.` : 'The brand already has every design in the library.'}</p>}
        {/* Nothing changes for the brand until this button: the pick above only shows a design. */}
        {library.status === 'ready' && addable.length > 0 && (
          <div className="sticky bottom-0 z-10 -mx-1 mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-bk-line bg-bk-surface px-1 pb-1 pt-3">
            <p aria-live="polite" className="min-w-0 flex-1 basis-[180px] text-[12.5px] leading-snug text-bk-muted">
              {chosen ? <><span className="font-semibold text-bk-fg">{chosen.name}</span> joins {brandName}’s designs.</> : 'Pick a design to add.'}
            </p>
            <div className="flex gap-2">
              {!first && <button type="button" onClick={closeLibrary} disabled={adding} className={appButton('outline', 'sm')}>Cancel</button>}
              <button type="button" onClick={add} disabled={!chosen || adding || selection.busy || !listed} className={appButton('primary', 'sm')}>
                {adding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}Add and use it
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {head(title, hint, title && canOpenLibrary && <button type="button" onClick={openLibrary} className={appButton('outline', 'sm', 'shrink-0')}><Plus className="size-3.5" />Add from the library</button>)}
      <div role="radiogroup" aria-label="Design" className={cn('grid', gaps, columns)}>
        <DesignCard size={s} name="Auto" meta={<span className="block text-[12px] text-bk-muted">{autoHint}</span>} title={autoHint} selected={value === 'auto'} onSelect={() => onChange('auto')}>
          <AutoPreview families={items.map(item => item.family)} brand={brand} />
        </DesignCard>
        {items.map(item => (
          <DesignCard
            key={item.design.id} size={s} name={item.design.name || item.family.name} title={item.design.name || item.family.name}
            meta={<DesignMeta family={item.family} info={byId.get(item.family.id)?.library || item.family.library} size={s} />}
            selected={value === item.design.id} onSelect={() => onChange(item.design.id)}
            overlay={onInspect && (
              <button type="button" onClick={() => onInspect(item)} aria-label={`Inspect ${item.design.name}`} title="Inspect" className="absolute left-2 top-2 flex size-6 items-center justify-center rounded-full bg-black/60 text-white transition-[background-color,transform] hover:scale-110 hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bk-fg">
                <ZoomIn className="size-3.5" aria-hidden="true" />
              </button>
            )}
          >
            <GlobalDesignPreview family={item.family} brand={brand} sampleLabel={false} />
          </DesignCard>
        ))}
        {canOpenLibrary && <AddTile size={s} count={addable.length} onClick={openLibrary} />}
        {pending && <span role="status" className="sr-only">Adding the design…</span>}
      </div>
    </div>
  )
}
