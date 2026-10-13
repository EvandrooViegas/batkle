'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Check, Loader2, Search } from 'lucide-react'
import GlobalDesignPreview from '@/components/GlobalDesignPreview'
import { appField } from '@/components/app/field'
import { Notice, panelClass } from '@/components/app/ui'
import { cn } from '@/lib/utils'

const read = async r => { const data = await r.json(); if (!r.ok) throw Error(data.error); return data }
const brandDesignsUrl = flowId => `/api/global-designs/brand?flowId=${encodeURIComponent(flowId)}`

/**
 * The designs a brand uses, with a toggle that saves at once and then checks the save, so what shows as
 * selected is always what the brand keeps. `imported` holds the brand's pinned versions of each design.
 */
export function useBrandDesignSelection(flowId, brand, onChange = () => {}) {
  const [selected, setSelected] = useState([]), [imported, setImported] = useState([])
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')

  useEffect(() => {
    if (!flowId) { setReady(true); return }
    let active = true
    fetch(brandDesignsUrl(flowId)).then(read)
      .then(items => { if (active) { setImported(items); setSelected(items.map(item => item.family.id)) } })
      .catch(e => { if (active) setError(e.message) })
      .finally(() => { if (active) setReady(true) })
    return () => { active = false }
  }, [flowId])

  const save = async familyIds => {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/brand-designs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flowId, familyIds }) })
      const data = await response.json()
      if (!response.ok) throw Error(data.error)
      const verifyResponse = await fetch(brandDesignsUrl(flowId), { cache: 'no-store' })
      const items = await verifyResponse.json()
      if (!verifyResponse.ok) throw Error(items.error || 'The saved designs could not be checked.')
      const savedIds = items.map(item => item.family.id)
      if (familyIds.some(id => !savedIds.includes(id)) || savedIds.length !== familyIds.length) throw Error('The design selection was not kept. Reload and try again.')
      setImported(items)
      setSelected(savedIds)
      onChange({ ...brand, designs: data.brandContext.designs, designLibraryVersion: 1 })
      setNotice(savedIds.length ? `Saved. New posts use ${savedIds.length === 1 ? 'this design' : `these ${savedIds.length} designs`}.` : 'No designs selected. New posts use your starter designs.')
    } catch (e) {
      setError(e.message)
      // Show the selection that is actually saved, never an unsaved one.
      try { const r = await fetch(brandDesignsUrl(flowId), { cache: 'no-store' }); if (r.ok) setSelected((await r.json()).map(item => item.family.id)) } catch {}
    } finally { setBusy(false) }
  }

  const toggle = familyId => {
    setNotice(''); setError('')
    const next = selected.includes(familyId) ? selected.filter(id => id !== familyId) : [...selected, familyId]
    setSelected(next)
    void save(next)
  }

  return { selected, imported, ready, busy, error, notice, toggle }
}

/** The brand's chosen designs, picked from every published design. */
export default function BrandDesignStudio({ flowId, brand, onChange, bare = false }) {
  const { selected, imported, ready, busy, error: selectionError, notice, toggle: toggleFamily } = useBrandDesignSelection(flowId, brand, onChange)
  const [published, setPublished] = useState(null), [loadError, setLoadError] = useState('')
  const [samples, setSamples] = useState({}), [query, setQuery] = useState('')

  useEffect(() => {
    let active = true
    fetch('/api/global-designs').then(read)
      .then(items => { if (active) setPublished(items) })
      .catch(e => { if (active) { setLoadError(e.message); setPublished([]) } })
    return () => { active = false }
  }, [])

  // The brand keeps its pinned version of each design; designs it uses that were unpublished still show.
  const pinned = new Map(imported.map(item => [item.family.id, item.family]))
  const families = published ? [...published.map(f => pinned.get(f.id) || f), ...imported.filter(item => !published.some(f => f.id === item.family.id)).map(item => item.family)] : []
  const loading = published === null || !ready
  const error = loadError || selectionError
  const visible = families.filter(f => `${f.name} ${(f.tags || []).join(' ')}`.toLowerCase().includes(query.toLowerCase()))

  return (
    <section className={cn(!bare && panelClass, !bare && 'p-5 sm:p-6')} aria-labelledby={bare ? undefined : 'brand-designs-title'} aria-label={bare ? 'Your post designs' : undefined}>
      {!bare && (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="brand-designs-title" className="text-[16px] font-bold tracking-[-0.01em]">Your post designs</h2>
            <p className="mt-1 max-w-[620px] text-[13px] leading-relaxed text-bk-muted">Each design is a visual style: layouts adapt to every post, in your colours, fonts and logo. Pick several for more variety. Changes save at once.</p>
          </div>
          {flowId && <Link href={`/app/${flowId}/design-library`} className="inline-flex items-center gap-1 text-[13px] font-semibold underline underline-offset-4">Design Library<ArrowUpRight className="size-3.5" /></Link>}
        </div>
      )}

      <div className={cn('flex flex-wrap items-center gap-3', !bare && 'mt-5')}>
        <div className="relative min-w-0 flex-1 sm:max-w-[360px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-bk-muted" aria-hidden="true" />
          <input type="search" aria-label="Search designs" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search designs or styles" className={appField('h-10 pl-9 text-[14px]')} />
        </div>
        <p className="flex items-center gap-2 text-[13px] font-semibold" aria-live="polite">
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {busy ? 'Saving…' : `${selected.length} selected`}
        </p>
      </div>

      {error && <Notice tone="error" className="mt-4">{error}</Notice>}
      {notice && <Notice tone="success" className="mt-4">{notice}</Notice>}

      {loading ? (
        <ul aria-label="Loading designs" className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map(i => <li key={i} className="aspect-[4/5] rounded-2xl bg-bk-alt motion-safe:animate-pulse" />)}
        </ul>
      ) : (
        <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((family, i) => {
            const on = selected.includes(family.id)
            const sample = samples[family.id] || 0
            return (
              <li key={family.id} className="min-w-0">
                <div className={cn('rounded-2xl border bg-bk-surface p-2.5 transition-[border-color,box-shadow]', on ? 'border-bk-fg shadow-bk-card ring-1 ring-bk-fg' : 'border-bk-line hover:border-bk-fg/40')}>
                  <button type="button" disabled={busy} aria-pressed={on} aria-label={`${family.name}${on ? ', selected' : ''}`} onClick={() => toggleFamily(family.id)} className="block w-full rounded-xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg disabled:cursor-wait">
                    <span className="relative block overflow-hidden rounded-xl">
                      <GlobalDesignPreview family={family} brand={brand} sample={sample} eager={i < 3} />
                      <span aria-hidden="true" className={cn('absolute right-2.5 top-2.5 flex size-8 items-center justify-center rounded-full border-2 transition-colors', on ? 'border-bk-butter bg-bk-butter text-bk-ink' : 'border-white/80 bg-black/25 text-transparent')}>
                        <Check className="size-4" strokeWidth={3} />
                      </span>
                    </span>
                    <span className="mt-3 flex items-center justify-between gap-3 px-1">
                      <span className="min-w-0 truncate text-[14.5px] font-bold">{family.name}</span>
                      <span className={cn('shrink-0 text-[12.5px] font-semibold', on ? 'text-bk-fg' : 'text-bk-muted')}>{on ? 'Selected' : 'Select'}</span>
                    </span>
                    {family.tags?.length > 0 && <span className="mt-0.5 block truncate px-1 text-[12.5px] text-bk-muted">{family.tags.join(' · ')}</span>}
                  </button>
                  <div role="group" aria-label={`${family.name}: sample slides`} className="mt-2.5 flex gap-1.5 px-1 pb-1">
                    {[0, 1, 2, 3].map(n => (
                      <button key={n} type="button" aria-label={`Sample slide ${n + 1}`} aria-pressed={sample === n} onClick={() => setSamples(prev => ({ ...prev, [family.id]: n }))} className={cn('h-1.5 flex-1 rounded-full transition-colors', sample === n ? 'bg-bk-fg' : 'bg-bk-line hover:bg-bk-field')} />
                    ))}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {!loading && !visible.length && <p className="mt-5 text-[13.5px] text-bk-muted">{query ? `No design matches “${query}”.` : 'No designs are published yet.'}</p>}
    </section>
  )
}
