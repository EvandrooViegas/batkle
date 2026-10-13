'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, Lock, LogOut, Plus, Search, Upload, X } from 'lucide-react'
import { COMPOSITION_LABELS, ZoomablePreview, StudySamples } from '@/components/GlobalDesignPreview'
import GlobalDesignPreview from '@/components/GlobalDesignPreview'
import DesignStudyEditor, { imageryLabel } from '@/components/DesignStudyEditor'
import { useBrandDesignSelection } from '@/components/BrandDesignStudio'
import { familyImagery, familyGrammar } from '@/lib/designs/global/study'
import { shortName, usePopup } from '@/components/app/popup'
import { appField } from '@/components/app/field'
import { Notice, PageHeader, appButton, pageShell, panelClass } from '@/components/app/ui'
import { cn } from '@/lib/utils'

async function api(path = '', method = 'GET', body) {
  const response = await fetch('/api/global-designs' + path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  if (!response.ok) throw Error(data.error || 'The design library could not be loaded')
  return data
}
// Blank lines kept while typing in rule lists are dropped before saving.
const tidy = family => family.study ? { ...family, study: Object.fromEntries(Object.entries(family.study).map(([k, v]) => [k, Array.isArray(v) ? v.map(s => String(s).trim()).filter(Boolean) : v])) } : family
const readFile = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file) })
const fieldLabel = 'block text-[13px] font-bold'
const STATUS_TONE = { published: 'bg-[#1F7A5A]/10 text-[#17583F] dark:text-[#4CC79A]', draft: 'bg-bk-chip text-bk-fg', unpublished: 'bg-[#F2A900]/15 text-[#9A6B00] dark:text-[#F2C14E]' }

/**
 * Every design Batkle composes posts with. Inside a brand, previews use its colours, fonts and logo and each
 * design can be switched on for it. Admins also study new references, edit studies and publish them.
 */
export default function GlobalDesignLibrary({ flowId, brand }) {
  const popup = usePopup()
  const selection = useBrandDesignSelection(flowId, brand)
  const [admin, setAdmin] = useState(false), [login, setLogin] = useState(false), [key, setKey] = useState('')
  const [families, setFamilies] = useState(null), [records, setRecords] = useState([]), [active, setActive] = useState(null)
  const [draft, setDraft] = useState(null), [reconstructionId, setReconstructionId] = useState('')
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false), [references, setReferences] = useState([]), [json, setJson] = useState('')
  const refresh = async isAdmin => {
    setFamilies(await api())
    if (isAdmin) setRecords(await api('?admin=1'))
  }
  useEffect(() => { let live = true; (async () => { try { const session = await api('/session'); if (!live) return; setAdmin(session.admin); await refresh(session.admin) } catch (e) { if (live) { setError(e.message); setFamilies([]) } } })(); return () => { live = false } }, [])
  const run = async (label, fn) => { setBusy(label); setError(''); setNotice(''); try { await fn() } catch (e) { setError(e.message) } finally { setBusy('') } }
  const open = record => { setActive(record); setDraft(record.draft); setReconstructionId(record.draft.variants?.[0]?.id || ''); setJson(''); setAdding(false); setNotice(''); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const saveDraft = async () => { const record = await api('/' + draft.id, 'PATCH', { family: tidy(draft), revision: active.revision }); setActive(record); setDraft(record.draft); await refresh(true); return record }
  const upload = files => run('Uploading references…', async () => {
    if (references.length + files.length > 30) throw Error('A design can be studied from up to 30 references.')
    const added = []
    for (const file of files) { if (file.size > 6 * 1024 * 1024) throw Error(`${file.name} is larger than 6 MB.`); added.push(await api('/references', 'POST', { name: file.name, data: await readFile(file) })) }
    setReferences(prev => [...prev, ...added])
  })
  const reconstruction = draft?.variants?.find(v => v.id === reconstructionId)
  const entries = (admin ? records.map(r => ({ family: r.draft, record: r })) : (families || []).map(family => ({ family })))
    .filter(({ family }) => `${family.name} ${(family.tags || []).join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const previewBrand = brand || {}
  // The design on the stage: the one picked in the list, else the first in use, else the first listed.
  const [featuredId, setFeaturedId] = useState(null)
  const [sample, setSample] = useState(0)
  const featured = entries.find(e => e.family.id === featuredId) || entries.find(e => selection.selected.includes(e.family.id)) || entries[0]

  return (
    <div className={pageShell}>
      <div className="mx-auto max-w-[1360px]">
        <PageHeader
          eyebrow={brand?.name ? `${brand.name} · Design Library` : 'Batkle · Design Library'}
          title="Design Library"
          description={`Visual styles Batkle composes posts with, always in ${brand?.name ? `${brand.name}’s` : 'each brand’s'} colours, fonts and logo.${flowId ? ' Switch a design on to use it for new posts.' : ''}`}
          actions={admin ? <>
            <button type="button" disabled={!!busy} onClick={() => { setAdding(true); setActive(null); setDraft(null); setReferences([]) }} className={appButton('primary', 'sm')}><Plus className="size-4" />Add design</button>
            <button type="button" onClick={() => run('Signing out…', async () => { await api('/session', 'DELETE'); setAdmin(false); setActive(null); setDraft(null); setAdding(false) })} className={appButton('outline', 'sm')}><LogOut className="size-4" />Sign out</button>
          </> : (
            <button type="button" onClick={() => setLogin(v => !v)} aria-expanded={login} className={appButton('quiet', 'sm', 'text-bk-muted')}><Lock className="size-3.5" />Admin</button>
          )}
        />

        {login && !admin && (
          <form className={cn(panelClass, 'mt-5 flex max-w-lg flex-wrap gap-2 p-4')} onSubmit={e => { e.preventDefault(); run('Signing in…', async () => { await api('/session', 'POST', { key }); setKey(''); setAdmin(true); setLogin(false); await refresh(true) }) }}>
            <input aria-label="Admin key" type="password" autoComplete="current-password" placeholder="Admin key" value={key} onChange={e => setKey(e.target.value)} className={appField('h-10 min-w-[200px] flex-1 text-[14px]')} />
            <button disabled={!!busy || !key} className={appButton('ink', 'md', 'h-10')}>Sign in</button>
          </form>
        )}
        {busy && <Notice className="mt-5 flex items-center gap-2.5"><Loader2 className="size-4 shrink-0 animate-spin" />{busy}</Notice>}
        {error && <Notice tone="error" className="mt-5">{error}</Notice>}
        {notice && <Notice tone="success" className="mt-5">{notice}</Notice>}
        {selection.error && <Notice tone="error" className="mt-5">{selection.error}</Notice>}

        {adding && admin && (
          <section className={cn(panelClass, 'mt-6 space-y-4 p-5 sm:p-6')} aria-labelledby="new-design-title">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="new-design-title" className="text-[16px] font-bold">Study a new design</h2>
                <p className="mt-1 max-w-[680px] text-[13px] leading-relaxed text-bk-muted">Upload one example, or several related ones. They are studied together: what repeats becomes recurring rules, what changes becomes flexible rules. References are never reused as templates. The style is named for you; rename it afterwards.</p>
              </div>
              <button type="button" onClick={() => setAdding(false)} aria-label="Close" className={appButton('quiet', 'sm', 'size-8 px-0')}><X className="size-4" /></button>
            </div>
            <label className={cn('flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-bk-field px-4 py-6 text-[14px] font-semibold transition-colors hover:border-bk-fg/50', busy && 'pointer-events-none opacity-60')}>
              <Upload className="size-4" />Choose reference images
              <input aria-label="Upload design references" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={!!busy} className="sr-only" onChange={e => { upload([...e.target.files]); e.target.value = '' }} />
            </label>
            {references.length > 0 && (
              <ul className="flex flex-wrap gap-3">
                {references.map(ref => (
                  <li key={ref.id} className="w-28">
                    <img src={ref.url} alt={ref.name} className="h-32 w-full rounded-lg border border-bk-line object-contain" />
                    <button type="button" className="mt-1 text-[12px] font-semibold underline underline-offset-4" onClick={() => setReferences(prev => prev.filter(r => r.id !== ref.id))}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" disabled={!!busy || !references.length} className={appButton('primary', 'md')} onClick={() => run(`Studying ${references.length} reference${references.length === 1 ? '' : 's'}…`, async () => { const family = await api('/analyze', 'POST', { referenceImages: references }); const record = await api('', 'POST', family); open(record); await refresh(true); setNotice('Draft created. Review the study and the sample compositions before publishing.') })}>
              Analyse and create draft
            </button>
          </section>
        )}

        {draft && admin && (
          <section className={cn(panelClass, 'mt-6 grid gap-6 p-5 sm:p-6 lg:grid-cols-[320px_minmax(0,1fr)]')} aria-label="Edit design">
            <div className="space-y-5 lg:sticky lg:top-4 lg:self-start">
              <div>
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-bk-muted">References</h3>
                <div className="flex flex-wrap gap-2">{draft.referenceImages.map(ref => <a key={ref.id} href={ref.url} target="_blank" rel="noreferrer"><img src={ref.url} alt={ref.name} className="h-24 rounded-lg border border-bk-line" /></a>)}</div>
              </div>
              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-bk-muted">Sample compositions</h3>
                <p className="mb-2 mt-1 text-[12px] text-bk-muted">Built from the study with sample copy. Layouts vary; the language stays. Click one to enlarge.</p>
                <StudySamples family={draft} brand={previewBrand} />
              </div>
            </div>
            <div className="min-w-0 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <h2 className="flex items-center gap-2 text-[16px] font-bold">Edit design <span className={cn('rounded-md px-2 py-0.5 text-[11.5px] font-bold capitalize', STATUS_TONE[active.status] || STATUS_TONE.draft)}>{active.status}</span></h2>
                <button type="button" onClick={() => { setDraft(null); setActive(null) }} className={appButton('quiet', 'sm')}><X className="size-4" />Close</button>
              </div>
              <label className={fieldLabel}>Name<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className={appField('mt-1.5 h-10 text-[14px]')} /></label>
              <label className={fieldLabel}>Description<input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} className={appField('mt-1.5 h-10 text-[14px]')} /></label>
              <label className={fieldLabel}>Categories, separated by commas<input value={draft.tags.join(', ')} onChange={e => setDraft({ ...draft, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} className={appField('mt-1.5 h-10 text-[14px]')} /></label>
              <button type="button" disabled={!!busy} className={appButton('outline', 'sm')} onClick={() => run('Studying the references again…', async () => { const rebuilt = await api('/analyze', 'POST', { referenceImages: draft.referenceImages }); setDraft({ ...rebuilt, id: draft.id, version: draft.version }); setReconstructionId(rebuilt.variants?.[0]?.id || ''); setNotice('Study rebuilt with an automatic name. Review and save to keep these changes; published versions are unchanged.') })}>Rebuild from references</button>
              <DesignStudyEditor family={draft} onChange={setDraft} />
              <details className="rounded-xl border border-bk-line p-4">
                <summary className="cursor-pointer text-[13px] font-bold">Advanced: reference reconstructions and raw data</summary>
                <p className="my-2 text-[12px] text-bk-muted">Reconstructions show how the importer read each reference. They are evidence for review only; generation composes from the study above.</p>
                {draft.variants?.length ? (
                  <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
                    <div className="space-y-2">
                      <select aria-label="Reference reconstruction" className={appField('h-10 text-[14px]')} value={reconstructionId} onChange={e => setReconstructionId(e.target.value)}>{draft.variants.map((v, i) => <option key={v.id} value={v.id}>Reference {i + 1}</option>)}</select>
                      {reconstruction && <GlobalDesignPreview family={draft} reconstruction={reconstruction} />}
                    </div>
                    <p className="whitespace-pre-line text-[12px] text-bk-muted">{draft.analysis}</p>
                  </div>
                ) : <p className="text-[13px] text-bk-muted">No reconstructions stored.</p>}
                <details className="mt-3" onToggle={e => { if (e.currentTarget.open) setJson(JSON.stringify(familyGrammar(draft), null, 2)) }}>
                  <summary className="cursor-pointer text-[13px] font-semibold">Grammar JSON</summary>
                  <textarea aria-label="Design grammar JSON" value={json} onChange={e => setJson(e.target.value)} className="mt-2 h-64 w-full rounded-lg border border-bk-field bg-bk-surface p-3 font-mono text-[12px] outline-none focus:border-bk-fg" />
                  <button type="button" className={appButton('outline', 'xs', 'mt-2')} onClick={() => run('Applying grammar…', async () => { const { grammarSchema } = await import('@/lib/designs/global/types'); const grammar = grammarSchema.parse(JSON.parse(json)); setDraft({ ...draft, study: { ...(draft.study || {}), imagery: familyImagery(draft), grammar } }) })}>Apply grammar</button>
                </details>
              </details>
              <div className="flex flex-wrap gap-2 border-t border-bk-line pt-4">
                <button type="button" disabled={!!busy} className={appButton('outline', 'md')} onClick={() => run('Saving draft…', async () => { await saveDraft(); setNotice('Draft saved. Published versions remain unchanged.') })}>Save draft</button>
                <button type="button" disabled={!!busy} className={appButton('primary', 'md')} onClick={() => run('Publishing reviewed design…', async () => { const saved = await saveDraft(); const result = await api(`/${draft.id}/publish`, 'POST', { revision: saved.revision }); open(result); await refresh(true); setNotice('Published. Brands can now use this version.') })}>Publish</button>
                {active.status === 'published' && <button type="button" disabled={!!busy} className={appButton('outline', 'md')} onClick={() => run('Unpublishing…', async () => { await api(`/${draft.id}/unpublish`, 'POST', { revision: active.revision }); open(await api('/' + draft.id)); await refresh(true) })}>Unpublish</button>}
                <button type="button" disabled={!!busy} className={appButton('outline', 'md', 'ml-auto text-[#C2412F] dark:text-[#F0826F]')} onClick={async () => { if (await popup.confirm({ title: draft.name ? `Delete “${shortName(draft.name)}” from the library?` : 'Delete this design from the library?', description: 'Existing brand imports and posts keep their saved version.', tone: 'danger', confirmLabel: 'Delete design' })) run('Deleting design…', async () => { await api('/' + draft.id, 'DELETE', { revision: active.revision }); setDraft(null); setActive(null); await refresh(true) }) }}>Delete</button>
              </div>
            </div>
          </section>
        )}

        {families === null ? (
          <div aria-label="Loading designs" className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
            <div className="h-[420px] rounded-2xl bg-bk-surface motion-safe:animate-pulse" />
            <div className="h-[520px] rounded-[28px] bg-bk-surface motion-safe:animate-pulse" />
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
            <aside aria-label="Designs" className="min-w-0 lg:sticky lg:top-8">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-bk-muted" aria-hidden="true" />
                <input type="search" aria-label="Search the design library" placeholder="Search designs or styles" value={query} onChange={e => setQuery(e.target.value)} className={appField('h-10 pl-9 text-[14px]')} />
              </div>
              {flowId && <p className="mt-3 flex items-center gap-2 text-[12.5px] font-semibold text-bk-muted" aria-live="polite">{selection.busy && <Loader2 className="size-3.5 animate-spin" />}{selection.busy ? 'Saving…' : `${selection.selected.length} in use for ${brand?.name || 'this brand'}`}</p>}
              {entries.length === 0 ? (
                <p className="mt-4 text-[13.5px] text-bk-muted">{query ? `No design matches “${query}”.` : 'No designs are published yet.'}</p>
              ) : (
                <ul className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] lg:max-h-[calc(100dvh-200px)] lg:flex-col lg:overflow-y-auto lg:overflow-x-visible lg:pr-1">
                  {entries.map(({ family, record }) => {
                    const current = family.id === featured?.family.id
                    const inUse = selection.selected.includes(family.id)
                    return (
                      <li key={family.id} className="w-[220px] shrink-0 lg:w-auto">
                        <button type="button" onClick={() => { setFeaturedId(family.id); setSample(0) }} aria-current={current ? 'true' : undefined} className={cn('flex w-full items-center gap-3 rounded-xl border p-2 text-left transition-colors', current ? 'border-bk-fg bg-bk-surface shadow-bk-card' : 'border-transparent hover:bg-bk-surface/70')}>
                          <span className="w-12 shrink-0 overflow-hidden rounded-md"><GlobalDesignPreview family={family} brand={previewBrand} sampleLabel={false} /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13.5px] font-bold">{family.name}</span>
                            <span className="block truncate text-[12px] text-bk-muted">{imageryLabel(familyImagery(family).mode)} imagery</span>
                          </span>
                          {inUse && <span className="shrink-0 rounded-md bg-bk-fg px-1.5 py-0.5 text-[10.5px] font-bold text-bk-bg">In use</span>}
                          {record && !inUse && <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-bold capitalize', STATUS_TONE[record.status] || STATUS_TONE.draft)}>{record.status}</span>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </aside>

            {featured && (() => {
              const { family, record } = featured
              const usable = flowId && (!record || record.status === 'published')
              const inUse = selection.selected.includes(family.id)
              const compositions = familyGrammar(family).compositions
              return (
                <section key={family.id} aria-labelledby="featured-design" className="min-w-0 overflow-hidden rounded-[28px] bg-bk-surface shadow-bk-card motion-safe:animate-bk-page">
                  <div className="grid gap-0 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
                    <div className="bg-bk-alt p-5 sm:p-8">
                      <div className="mx-auto max-w-[440px]">
                        <ZoomablePreview family={family} brand={previewBrand} sample={sample} className="shadow-bk-pop" />
                        <div role="group" aria-label="Sample slides" className="mt-4 grid grid-cols-4 gap-2">
                          {[0, 1, 2, 3].map(i => (
                            <button key={i} type="button" onClick={() => setSample(i)} aria-label={`Sample slide ${i + 1}`} aria-pressed={sample === i} className={cn('overflow-hidden rounded-lg transition-[opacity,box-shadow]', sample === i ? 'ring-2 ring-bk-fg ring-offset-2 ring-offset-bk-alt' : 'opacity-60 hover:opacity-100')}>
                              <GlobalDesignPreview family={family} brand={previewBrand} sample={i} sampleLabel={false} />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col p-6 sm:p-8">
                      <div className="flex flex-wrap items-center gap-2">
                        {inUse && <span className="inline-flex items-center gap-1 rounded-full bg-bk-fg px-2.5 py-0.5 text-[12px] font-bold text-bk-bg"><Check className="size-3.5" />In use for {brand?.name ? shortName(brand.name, 24) : 'this brand'}</span>}
                        {record && <span className={cn('rounded-full px-2.5 py-0.5 text-[12px] font-bold capitalize', STATUS_TONE[record.status] || STATUS_TONE.draft)}>{record.status}</span>}
                      </div>
                      <h2 id="featured-design" className="mt-3 font-bk-display text-[clamp(28px,3vw,40px)] font-bold leading-[1.02] tracking-[-0.04em]">{family.name}</h2>
                      {family.description && <p className="mt-3 text-[15px] leading-relaxed text-bk-fg/80">{family.description}</p>}
                      {family.study?.personality && (
                        <blockquote className="mt-5 border-l-4 border-bk-butter pl-4 text-[14.5px] italic leading-relaxed text-bk-fg/80">{family.study.personality}</blockquote>
                      )}
                      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-bk-line pt-5">
                        <div>
                          <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-bk-muted">Imagery</dt>
                          <dd className="mt-1 text-[14px] font-semibold">{imageryLabel(familyImagery(family).mode)}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-bk-muted">Layouts</dt>
                          <dd className="mt-1 text-[14px] font-semibold">{compositions.length} ways to lay out a slide</dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-bk-muted">Slide types</dt>
                          <dd className="mt-1.5 flex flex-wrap gap-1.5">{compositions.map(c => <span key={c} className="rounded-md bg-bk-chip px-2 py-0.5 text-[12.5px] font-semibold">{COMPOSITION_LABELS[c] || c}</span>)}</dd>
                        </div>
                        {family.tags?.length > 0 && (
                          <div className="col-span-2">
                            <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-bk-muted">Style</dt>
                            <dd className="mt-1 text-[13.5px] text-bk-fg/80">{family.tags.join(' · ')}</dd>
                          </div>
                        )}
                      </dl>
                      <div className="mt-auto flex flex-wrap gap-2 pt-7">
                        {usable && (
                          <button type="button" disabled={selection.busy || !selection.ready} aria-pressed={inUse} onClick={() => selection.toggle(family.id)} className={appButton(inUse ? 'outline' : 'primary', 'md', 'h-11 flex-1 px-5')}>
                            {selection.busy ? <Loader2 className="size-4 animate-spin" /> : inUse ? <X className="size-4" /> : <Check className="size-4" />}
                            {inUse ? 'Stop using it' : `Use for ${brand?.name ? shortName(brand.name, 24) : 'this brand'}`}
                          </button>
                        )}
                        {admin && record && <button type="button" onClick={() => open(record)} className={appButton('outline', 'md', 'h-11')}>Review and edit</button>}
                      </div>
                      {selection.notice && <p className="mt-3 text-[12.5px] font-semibold text-[#17583F] dark:text-[#4CC79A]" aria-live="polite">{selection.notice}</p>}
                    </div>
                  </div>
                </section>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
