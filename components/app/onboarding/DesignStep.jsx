'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Loader2, RefreshCw, Search } from 'lucide-react'
import GlobalDesignPreview, { designAuthor } from '@/components/GlobalDesignPreview'
import { cn } from '@/lib/utils'
import { appButton } from '../ui'
import { appField } from '../field'
import { stepEyebrow, stepHeading, stepLead } from './styles'

const SAMPLES = [0, 1, 2, 3]

async function readJson(response, fallback) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || fallback)
  return data
}

/**
 * Step 4: the designs this brand's posts use. At least one is required to finish, so every brand starts
 * with a look it chose. Previews use the researched colours, fonts and logo. `onBack` returns to the previous step.
 */
export default function DesignStep({ flowId, brand, eyebrow = 'Step 4 of 4 · Design', doneLabel = 'Continue', onDone, onBack, headingRef }) {
  const [families, setFamilies] = useState(null) // null while loading
  const [selected, setSelected] = useState([])
  const [loadError, setLoadError] = useState('')
  const [reload, setReload] = useState(0)
  const [samples, setSamples] = useState({})
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const errorRef = useRef(null)

  useEffect(() => {
    let live = true
    setFamilies(null)
    setLoadError('')
    Promise.all([
      fetch('/api/global-designs').then(r => readJson(r, 'The designs could not be loaded.')),
      fetch(`/api/global-designs/brand?flowId=${encodeURIComponent(flowId)}`, { cache: 'no-store' }).then(r => readJson(r, 'The designs could not be loaded.')),
    ])
      .then(([published, imported]) => {
        if (!live) return
        const mine = new Map(imported.map(item => [item.family.id, item.family]))
        setFamilies([...published.filter(f => f.library?.usable !== false).map(f => mine.get(f.id) || f), ...imported.filter(item => !published.some(f => f.id === item.family.id)).map(item => item.family)])
        setSelected(imported.map(item => item.family.id))
      })
      .catch(e => { if (live) { setLoadError(e.message); setFamilies([]) } })
    return () => { live = false }
  }, [flowId, reload])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (families || []).filter(f => !q || `${f.name} ${(f.tags || []).join(' ')}`.toLowerCase().includes(q))
  }, [families, query])

  const toggle = id => {
    setError('')
    setSelected(current => (current.includes(id) ? current.filter(x => x !== id) : [...current, id]))
  }

  const finish = async () => {
    const available = families?.length > 0
    if (available && !selected.length) {
      setError('Choose at least one design to continue.')
      requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
      return
    }
    setSaving(true)
    setError('')
    try {
      let next = brand
      if (available) {
        const data = await readJson(await fetch('/api/brand-designs', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flowId, familyIds: selected }),
        }), 'Your designs could not be saved. Please try again.')
        // Only continue once the brand really keeps the selection.
        const saved = (await readJson(await fetch(`/api/global-designs/brand?flowId=${encodeURIComponent(flowId)}`, { cache: 'no-store' }), 'Your designs could not be checked.')).map(item => item.family.id)
        if (!selected.every(id => saved.includes(id))) throw new Error('Your designs were not saved. Please try again.')
        next = { ...brand, designs: data.brandContext?.designs || brand.designs, designLibraryVersion: 1 }
      }
      await onDone(next)
    } catch (e) {
      setError(e.message || 'Your designs could not be saved. Please try again.')
      setSaving(false)
    }
  }

  const count = selected.length
  return (
    <div>
      <p className={stepEyebrow}>{eyebrow}</p>
      <h1 ref={headingRef} tabIndex={-1} className={stepHeading}>Pick your post designs</h1>
      <p className={stepLead}>
        Choose at least one. Each design is a visual style, not a template: layouts adapt to every post, in your colours, fonts and logo. Pick several for more variety.
      </p>

      {families === null ? (
        <ul aria-label="Loading designs" className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map(i => <li key={i} className="aspect-[4/5] rounded-2xl bg-bk-surface motion-safe:animate-pulse" />)}
        </ul>
      ) : loadError ? (
        <div role="alert" className="mt-8 rounded-2xl border border-bk-line bg-bk-surface p-5">
          <p className="text-[15px] font-bold">The designs could not be loaded</p>
          <p className="mt-1 text-[14px] text-bk-muted">{loadError}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => setReload(n => n + 1)} className={appButton('primary', 'md')}><RefreshCw className="size-4" />Try again</button>
            <button type="button" onClick={() => onDone(brand)} className={appButton('outline', 'md')}>Choose later in the brand profile</button>
            {onBack && <button type="button" onClick={onBack} className={appButton('quiet', 'md')}><ArrowLeft className="size-4" />Back</button>}
          </div>
        </div>
      ) : families.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-bk-line bg-bk-surface p-5">
          <p className="text-[15px] font-bold">No designs are published yet</p>
          <p className="mt-1 text-[14px] text-bk-muted">Batkle will use its starter designs for now. You can choose designs later in the brand profile.</p>
        </div>
      ) : (
        <>
          {families.length > 6 && (
            <div className="relative mt-7 max-w-[420px]">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-bk-muted" />
              <input type="search" aria-label="Search designs" placeholder="Search designs or styles" value={query} onChange={e => setQuery(e.target.value)} className={appField('pl-10')} />
            </div>
          )}
          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((family, i) => {
              const on = selected.includes(family.id)
              const sample = samples[family.id] || 0
              return (
                <li key={family.id} className="min-w-0">
                  <div className={cn('rounded-2xl border bg-bk-surface p-2.5 transition-[border-color,box-shadow]', on ? 'border-bk-fg shadow-bk-card ring-1 ring-bk-fg' : 'border-bk-line hover:border-bk-fg/40')}>
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={`${family.name}${on ? ', selected' : ''}`}
                      onClick={() => toggle(family.id)}
                      className="block w-full rounded-xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg"
                    >
                      <span className="relative block overflow-hidden rounded-xl">
                        <GlobalDesignPreview family={family} brand={brand} sample={sample} eager={i < 3} />
                        <span
                          aria-hidden="true"
                          className={cn(
                            'absolute right-2.5 top-2.5 flex size-8 items-center justify-center rounded-full border-2 transition-colors',
                            on ? 'border-bk-butter bg-bk-butter text-bk-ink' : 'border-white/80 bg-black/25 text-transparent',
                          )}
                        >
                          <Check className="size-4" strokeWidth={3} />
                        </span>
                      </span>
                      <span className="mt-3 flex items-center justify-between gap-3 px-1">
                        <span className="min-w-0 truncate text-[15px] font-bold">{family.name}</span>
                        <span className={cn('shrink-0 text-[12.5px] font-semibold', on ? 'text-bk-fg' : 'text-bk-muted')}>{on ? 'Selected' : 'Select'}</span>
                      </span>
                      {(designAuthor(family) || family.tags?.length > 0) && <span className="mt-0.5 block truncate px-1 text-[12.5px] text-bk-muted">{[designAuthor(family), (family.tags || []).join(' · ')].filter(Boolean).join(' · ')}</span>}
                    </button>
                    <div role="group" aria-label={`${family.name}: sample slides`} className="mt-2.5 flex gap-1.5 px-1 pb-1">
                      {SAMPLES.map(n => (
                        <button
                          key={n}
                          type="button"
                          aria-label={`Sample slide ${n + 1}`}
                          aria-pressed={sample === n}
                          onClick={() => setSamples(s => ({ ...s, [family.id]: n }))}
                          className={cn('h-1.5 flex-1 rounded-full transition-colors', sample === n ? 'bg-bk-fg' : 'bg-bk-line hover:bg-bk-field')}
                        />
                      ))}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
          {visible.length === 0 && <p className="mt-6 text-[14px] text-bk-muted">No design matches “{query}”.</p>}
        </>
      )}

      {families !== null && !loadError && (
        <div className="sticky bottom-0 z-10 -mx-5 mt-8 border-t border-bk-line bg-bk-alt/95 px-5 py-4 backdrop-blur sm:-mx-8 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {onBack && (
                <button type="button" onClick={onBack} disabled={saving} className={appButton('quiet', 'md', 'h-11 -ml-2')}>
                  <ArrowLeft className="size-4" />Back
                </button>
              )}
              <p className="text-[14px] font-semibold" aria-live="polite">
                {families.length === 0 ? 'Starter designs' : count ? `${count} design${count === 1 ? '' : 's'} selected` : 'No design selected yet'}
              </p>
            </div>
            <button type="button" onClick={finish} disabled={saving} aria-disabled={families.length > 0 && !count} className={appButton('primary', 'md', cn('h-11 px-5', families.length > 0 && !count && 'opacity-60'))}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {doneLabel}
              {!saving && <ArrowRight className="size-4" />}
            </button>
          </div>
          {error && <p ref={errorRef} role="alert" className="mt-2 text-[14px] font-semibold text-[#C2412F] dark:text-[#F0826F]">{error}</p>}
        </div>
      )}
    </div>
  )
}
