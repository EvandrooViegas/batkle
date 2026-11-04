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

const SIZES = {
  // The post settings popover: four to a row.
  sm: { card: 'rounded-xl p-1', preview: 'rounded-lg', row: 'px-0.5 pt-1', name: 'truncate text-[11.5px] font-semibold' },
  // A dialog.
  md: { card: 'rounded-2xl p-1.5', preview: 'rounded-xl', row: 'gap-2 px-1 pb-0.5 pt-2', name: 'line-clamp-2 text-[13px] font-semibold leading-snug' },
  // A page.
  lg: { card: 'rounded-2xl p-2', preview: 'rounded-xl', row: 'gap-2.5 px-1 pb-1 pt-3', name: 'line-clamp-2 text-[14.5px] font-bold leading-snug' },
}

/** A radio dot, a tick box or a plus, in the yellow of the app's choice cards. */
function Mark({ kind, on }) {
  const yellow = 'border-[#E2A100] dark:border-bk-butter'
  if (kind === 'add') return <span aria-hidden="true" className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full bg-bk-fg text-bk-bg"><Plus className="size-3" strokeWidth={3} /></span>
  return (
    <span aria-hidden="true" className={cn('mt-px flex size-[18px] shrink-0 items-center justify-center border-2', kind === 'checkbox' ? 'rounded-[5px]' : 'rounded-full', on ? yellow : 'border-bk-field', on && kind === 'checkbox' && 'bg-[#E2A100] text-white dark:bg-bk-butter dark:text-bk-ink')}>
      {on && (kind === 'checkbox' ? <Check className="size-3" strokeWidth={3.5} /> : <span className="size-2 rounded-full bg-[#E2A100] dark:bg-bk-butter" />)}
    </span>
  )
}

/**
 * One design to choose: its preview (children), its name and a line under it (`meta`). `kind` is 'radio' (one of
 * several), 'checkbox' (any number) or 'add' (adds it to the brand). `surface` is 'raised' on a page and 'tint' inside
 * a dialog or popover. `overlay` sits over the card (an inspect button); `footer` goes under the name (sample dots).
 */
export function DesignCard({ kind = 'radio', selected = false, onSelect, name, label = name, meta, title, size = 'md', surface = 'tint', disabled, busy, overlay, footer, children }) {
  const s = SIZES[size]
  return (
    <div className={cn('relative min-w-0 transition-[box-shadow,background-color]', s.card, surface === 'raised' ? 'bg-bk-surface shadow-bk-card' : 'bg-bk-alt', selected ? 'bg-[#FFD84D]/10 ring-2 ring-[#E2A100] dark:bg-bk-butter/[0.07] dark:ring-bk-butter' : 'ring-bk-fg/25 can-hover:ring-1')}>
      <button
        type="button" onClick={onSelect} disabled={disabled} title={title} aria-label={label}
        {...(kind === 'add' ? {} : { role: kind, 'aria-checked': selected })}
        className={cn('block w-full min-w-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg disabled:cursor-not-allowed', s.preview, busy && 'disabled:cursor-wait')}
      >
        {/* The preview's sample words are decoration; the card is named by its design. */}
        <span aria-hidden="true" className={cn('relative block overflow-hidden', s.preview)}>
          {children}
          {busy && <span className="absolute inset-0 flex items-center justify-center bg-black/40"><Loader2 className="size-5 animate-spin text-white" /></span>}
        </span>
        <span className={cn('flex items-start', s.row)}>
          {size !== 'sm' && <Mark kind={kind} on={selected} />}
          <span className="min-w-0 flex-1">
            <span className={cn('block', s.name)}>{name}</span>
            {meta && size !== 'sm' && <span className="mt-1 block min-w-0">{meta}</span>}
          </span>
        </span>
      </button>
      {overlay}
      {footer}
    </div>
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
    <div role="group" aria-label={`${name}: sample slides`} className="mt-1 flex gap-1.5 px-1 pb-1">
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

/** The way into the library: two of the designs that could be added, stacked, with a plus. */
function AddPreview({ families, brand }) {
  return (
    <span className="relative block aspect-[4/5] overflow-hidden bg-bk-chip">
      {families[1] && <span className="absolute right-[9%] top-[8%] w-[60%] overflow-hidden rounded-md opacity-60"><GlobalDesignPreview family={families[1]} brand={brand} sampleLabel={false} /></span>}
      {families[0] && <span className="absolute bottom-[8%] left-[9%] w-[60%] overflow-hidden rounded-md shadow-bk-pop"><GlobalDesignPreview family={families[0]} brand={brand} sampleLabel={false} /></span>}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex size-9 items-center justify-center rounded-full bg-bk-butter text-bk-ink shadow-bk-pop"><Plus className="size-4" strokeWidth={2.5} /></span>
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
 * manages the brand (`canAdd`) can also add a design from the Design Library here: it joins the brand's designs and is
 * picked at once. `designs` is useBrandDesigns' state and `reload` its reload. With `requireDesign` (ads), a brand without
 * designs of its own opens on the library; posts keep Auto, which then uses the starter designs.
 */
export function DesignPicker({ flowId, brand = {}, designs, reload, value, onChange, canAdd = false, requireDesign = false, size = 'md', columns = 'grid-cols-2 sm:grid-cols-4', autoHint = 'Batkle picks the best fit', onInspect, emptyText }) {
  const [view, setView] = useState('mine')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(''), [pending, setPending] = useState('')
  const [library, reloadLibrary] = useLibrary(canAdd && designs.status === 'ready')
  const selection = useBrandDesignSelection(canAdd ? flowId : null, brand)
  const items = designs.items
  // Who made each design comes with the library; the brand's own copies don't carry it.
  const byId = useMemo(() => new Map(library.families.map(f => [f.id, f])), [library.families])
  const have = new Set([...items.map(item => item.family.id), ...selection.selected])
  const addable = library.families.filter(f => !have.has(f.id))
  const found = addable.filter(f => `${f.name} ${(f.tags || []).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
  const s = size
  // Something that needs a design, for a brand without one, starts in the library.
  const first = requireDesign && !items.length
  const showLibrary = canAdd && (view === 'library' || (first && designs.status === 'ready' && library.status !== 'error'))

  // A design just added is picked once the brand's designs come back with it.
  useEffect(() => {
    if (!pending) return
    const item = items.find(i => i.family.id === pending)
    if (item) { onChange(item.design.id); setPending('') }
  }, [items, pending]) // eslint-disable-line react-hooks/exhaustive-deps

  // Adding saves the brand's whole list, so it waits for that list, and never saves one missing a design it has.
  const listed = selection.ready && items.every(item => selection.selected.includes(item.family.id))
  const add = async family => {
    if (!listed) return
    setAdding(family.id)
    const brandName = brand?.name ? `${brand.name}’s` : 'the brand’s'
    const saved = await selection.toggle(family.id, `“${family.name}” is now one of ${brandName} designs.`)
    setAdding('')
    if (!saved) return
    setPending(family.id); setView('mine'); setQuery('')
    reload()
  }

  if (designs.status === 'loading' || designs.status === 'idle') {
    return (
      <div role="status" aria-label="Loading your designs" className={cn('grid gap-3', columns)}>
        {[0, 1, 2, 3].map(i => <span key={i} className={cn('block aspect-[4/5.6] bg-bk-alt motion-safe:animate-pulse', SIZES[s].card)} />)}
      </div>
    )
  }

  if (showLibrary) {
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {!first && <button type="button" onClick={() => { setView('mine'); setQuery('') }} className={appButton('quiet', 'sm', '-ml-2 text-bk-muted')}><ArrowLeft className="size-4" />Your designs</button>}
          {addable.length > 6 && (
            <div className="relative min-w-0 flex-1 sm:max-w-[280px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-bk-muted" aria-hidden="true" />
              <input type="search" aria-label="Search the Design Library" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search designs or styles" className={appField('h-9 pl-9 text-[13.5px]')} />
            </div>
          )}
        </div>
        <p className="mt-2 text-[12.5px] leading-snug text-bk-muted">{first ? (emptyText || 'This brand has no designs yet.') + ' ' : ''}Pick one from the Design Library to add it to the brand. Its posts and ads can use it from then on.</p>
        {selection.error && <p role="alert" className="mt-2 text-[12.5px] font-semibold text-[#C2412F] dark:text-[#F0826F]">{selection.error}</p>}
        {library.status === 'error' ? (
          <p className="mt-3 text-[12.5px] text-[#C2412F] dark:text-[#F0826F]">{library.error} <button type="button" onClick={reloadLibrary} className="font-semibold underline underline-offset-4">Try again</button></p>
        ) : library.status !== 'ready' ? (
          <div role="status" aria-label="Loading the Design Library" className={cn('mt-3 grid gap-3', columns)}>{[0, 1, 2, 3].map(i => <span key={i} className={cn('block aspect-[4/5.6] bg-bk-alt motion-safe:animate-pulse', SIZES[s].card)} />)}</div>
        ) : found.length ? (
          <ul className={cn('mt-3 grid gap-3', columns)}>
            {found.map(family => (
              <li key={family.id} className="min-w-0">
                <DesignCard kind="add" size={s} name={family.name} label={`Add ${family.name}`} title={family.name} meta={<DesignMeta family={family} size={s} />} busy={adding === family.id} disabled={!!adding || selection.busy || !listed} onSelect={() => add(family)}>
                  <GlobalDesignPreview family={family} brand={brand} sampleLabel={false} />
                </DesignCard>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-[13px] text-bk-muted">{query ? `No design matches “${query}”.` : 'The brand already has every design in the library.'}</p>}
      </div>
    )
  }

  return (
    <div role="radiogroup" aria-label="Design" className={cn('grid gap-3', columns, s === 'sm' && 'gap-1.5')}>
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
      {canAdd && library.status === 'ready' && listed && addable.length > 0 && (
        <DesignCard kind="add" size={s} name="Add from the library" title="Add a design from the Design Library" meta={<span className="block text-[12px] text-bk-muted">{addable.length} more design{addable.length === 1 ? '' : 's'}</span>} onSelect={() => setView('library')}>
          <AddPreview families={addable} brand={brand} />
        </DesignCard>
      )}
      {pending && <span role="status" className="sr-only">Adding the design…</span>}
    </div>
  )
}
