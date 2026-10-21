'use client'

import { useEffect, useState } from 'react'
import { Check, Globe, Loader2, Lock, LogOut, Plus, Search, Upload, Users, X } from 'lucide-react'
import { COMPOSITION_LABELS, ZoomablePreview, StudySamples } from '@/components/GlobalDesignPreview'
import GlobalDesignPreview from '@/components/GlobalDesignPreview'
import DesignStudyEditor, { imageryLabel } from '@/components/DesignStudyEditor'
import { useBrandDesignSelection } from '@/components/BrandDesignStudio'
import UpgradeNotice from '@/components/app/billing/UpgradeNotice'
import { useBilling } from '@/components/app/billing/useBilling'
import { familyImagery, familyGrammar } from '@/lib/designs/global/study'
import { apiError } from '@/lib/client/billing'
import { shortName, usePopup } from '@/components/app/popup'
import { appField } from '@/components/app/field'
import { Notice, PageHeader, appButton, pageShell, panelClass } from '@/components/app/ui'
import { cn } from '@/lib/utils'

async function api(path = '', method = 'GET', body) {
  const response = await fetch('/api/global-designs' + path, { method, cache: 'no-store', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw apiError(data, response.status, 'The design library could not be loaded')
  return data
}
// Blank lines kept while typing in rule lists are dropped before saving.
const tidy = family => family.study ? { ...family, study: Object.fromEntries(Object.entries(family.study).map(([k, v]) => [k, Array.isArray(v) ? v.map(s => String(s).trim()).filter(Boolean) : v])) } : family
const readFile = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file) })
const fieldLabel = 'block text-[13px] font-bold'
const STATUS_TONE = { published: 'bg-[#1F7A5A]/10 text-[#17583F] dark:text-[#4CC79A]', draft: 'bg-bk-chip text-bk-fg', unpublished: 'bg-[#F2A900]/15 text-[#9A6B00] dark:text-[#F2C14E]' }
// The admin may study up to 30 references; members up to 10 (MEMBER_MAX_REFERENCES on the server).
const MAX_REFERENCES = { admin: 30, member: 10 }
const TABS = [['all', 'All'], ['batkle', 'Batkle'], ['members', 'Members'], ['mine', 'Yours']]
const USE_UPGRADE = { code: 'upgrade_required', billing: { feature: 'communityDesigns', requiredPlan: 'pro' }, message: 'Designs made by Batkle members are part of Pro and Business.' }
const CREATE_UPGRADE = { code: 'upgrade_required', billing: { feature: 'customDesigns', requiredPlan: 'pro' }, message: 'Creating your own designs is part of Pro and Business.' }

/** Where a design comes from, as the admin's raw records need it worked out on the page. */
const recordInfo = record => ({ official: !record.ownerId, author: record.ownerId ? record.author?.name || 'A Batkle member' : 'Batkle', visibility: record.ownerId ? record.visibility || 'private' : 'public', mine: false, team: false, usable: true, upgrade: false })

function Origin({ info, className = '' }) {
  if (!info) return null
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-[12px] text-bk-muted', className)}>
      <span className="truncate">By {info.official ? 'Batkle' : info.mine ? 'you' : info.author}</span>
      {!info.official && info.visibility === 'private' && (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-bk-chip px-1.5 py-px text-[10.5px] font-bold text-bk-fg">
          {info.team ? <Users className="size-3" aria-hidden="true" /> : <Lock className="size-3" aria-hidden="true" />}{info.team ? 'Team' : 'Private'}
        </span>
      )}
    </span>
  )
}

/**
 * Every design Batkle composes posts with: Batkle's own, and the ones members publish (public, or private to their
 * team). Inside a brand, previews use its colours, fonts and logo and each design it may use can be switched on.
 * Pro and Business members study their own references into designs; the admin edits every design.
 */
export default function GlobalDesignLibrary({ flowId, brand, embedded = false }) {
  const popup = usePopup()
  const { data: billing } = useBilling()
  const selection = useBrandDesignSelection(flowId, brand)
  // `accountAdmin`: signed in with an admin account (ADMIN_EMAILS), so there is no key session to sign out of.
  const [admin, setAdmin] = useState(false), [accountAdmin, setAccountAdmin] = useState(false), [login, setLogin] = useState(false), [key, setKey] = useState('')
  const [families, setFamilies] = useState(null), [records, setRecords] = useState([]), [mine, setMine] = useState([]), [active, setActive] = useState(null)
  const [draft, setDraft] = useState(null), [reconstructionId, setReconstructionId] = useState(''), [visibility, setVisibility] = useState('private')
  const [busy, setBusy] = useState(''), [error, setError] = useState(null), [notice, setNotice] = useState(''), [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false), [references, setReferences] = useState([]), [json, setJson] = useState(''), [tab, setTab] = useState('all')
  const [createGate, setCreateGate] = useState(false)
  const plan = billing?.summary?.plan
  const canCreate = admin || plan === 'pro' || plan === 'business'
  const maxReferences = admin ? MAX_REFERENCES.admin : MAX_REFERENCES.member

  const refresh = async isAdmin => {
    const [library, own] = await Promise.all([api(), api('?mine=1').catch(() => [])])
    setFamilies(library)
    setMine(own)
    if (isAdmin) setRecords(await api('?admin=1'))
  }
  useEffect(() => { let live = true; (async () => { try { const session = await api('/session'); if (!live) return; setAdmin(session.admin); setAccountAdmin(!!session.account); await refresh(session.admin) } catch (e) { if (live) { setError(e); setFamilies([]) } } })(); return () => { live = false } }, [])
  const run = async (label, fn) => { setBusy(label); setError(null); setNotice(''); try { await fn() } catch (e) { setError(e) } finally { setBusy('') } }
  const open = record => {
    setActive(record); setDraft(record.draft); setReconstructionId(record.draft.variants?.[0]?.id || ''); setJson(''); setAdding(false); setNotice('')
    setVisibility(record.visibility === 'public' ? 'public' : 'private')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const saveDraft = async () => { const record = await api('/' + draft.id, 'PATCH', { family: tidy(draft), revision: active.revision }); setActive(record); setDraft(record.draft); await refresh(admin); return record }
  const upload = files => run('Uploading references…', async () => {
    if (references.length + files.length > maxReferences) throw Error(`A design can be studied from up to ${maxReferences} references.`)
    const added = []
    for (const file of files) { if (file.size > 6 * 1024 * 1024) throw Error(`${file.name} is larger than 6 MB.`); added.push(await api('/references', 'POST', { name: file.name, data: await readFile(file) })) }
    setReferences(prev => [...prev, ...added])
  })
  const startCreating = () => {
    setNotice(''); setError(null)
    if (!canCreate) { setCreateGate(true); return }
    setCreateGate(false); setAdding(true); setActive(null); setDraft(null); setReferences([])
  }
  // A member's own record is edited like the admin's; Batkle's own designs only by the admin.
  const editing = draft && active && (admin || active.ownerId)
  const official = !active?.ownerId

  const reconstruction = draft?.variants?.find(v => v.id === reconstructionId)
  const own = mine.map(r => ({ family: r.draft, record: r, info: r.library }))
  const listed = admin
    ? records.map(r => ({ family: r.draft, record: r, info: recordInfo(r) }))
    : tab === 'mine' ? own : (families || []).map(family => ({ family, info: family.library }))
  const entries = listed
    .filter(({ info }) => admin || tab === 'all' || tab === 'mine' || (tab === 'batkle' ? info?.official : !info?.official))
    .filter(({ info }) => !admin || tab === 'all' || (tab === 'batkle' ? info.official : tab === 'members' ? !info.official : false))
    .filter(({ family }) => `${family.name} ${(family.tags || []).join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const tabs = TABS.filter(([id]) => id !== 'mine' || (!admin && (mine.length > 0 || canCreate)))
  const previewBrand = brand || {}
  // The design on the stage: the one picked in the list, else the first in use, else the first listed.
  const [featuredId, setFeaturedId] = useState(null)
  const [sample, setSample] = useState(0)
  const featured = entries.find(e => e.family.id === featuredId) || entries.find(e => selection.selected.includes(e.family.id)) || entries[0]
  const emptyText = query ? `No design matches “${query}”.` : tab === 'mine' ? 'You haven’t made a design yet. Create one from examples you like.' : tab === 'members' ? 'No member has published a design yet.' : 'No designs are published yet.'

  const actions = admin ? <>
    <button type="button" disabled={!!busy} onClick={startCreating} className={appButton('primary', 'sm')}><Plus className="size-4" />Add Batkle design</button>
    {!accountAdmin && <button type="button" onClick={() => run('Signing out…', async () => { await api('/session', 'DELETE'); setAdmin(false); setActive(null); setDraft(null); setAdding(false); await refresh(false) })} className={appButton('outline', 'sm')}><LogOut className="size-4" />Sign out</button>}
  </> : <>
    <button type="button" disabled={!!busy} onClick={startCreating} className={appButton('primary', 'sm')}><Plus className="size-4" />Create design</button>
    <button type="button" onClick={() => setLogin(v => !v)} aria-expanded={login} className={appButton('quiet', 'sm', 'text-bk-muted')}><Lock className="size-3.5" />Admin</button>
  </>

  return (
    // `embedded`: inside another page (the admin dashboard), which already has the page padding and its own title.
    <div className={embedded ? '' : pageShell}>
      <div className="mx-auto max-w-[1360px]">
        {embedded ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-[640px] text-[13px] text-bk-muted">Batkle’s own designs and the ones members publish. Batkle designs you add here are open to every member.</p>
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          </div>
        ) : <PageHeader
          eyebrow={brand?.name ? `${brand.name} · Design Library` : 'Batkle · Design Library'}
          title="Design Library"
          description={`Visual styles Batkle composes posts with, always in ${brand?.name ? `${brand.name}’s` : 'each brand’s'} colours, fonts and logo: Batkle’s own and the ones members publish.${flowId ? ' Switch a design on to use it for new posts.' : ''}`}
          actions={actions}
        />}

        {login && !admin && (
          <form className={cn(panelClass, 'mt-5 flex max-w-lg flex-wrap gap-2 p-4')} onSubmit={e => { e.preventDefault(); run('Signing in…', async () => { await api('/session', 'POST', { key }); setKey(''); setAdmin(true); setLogin(false); setTab('all'); await refresh(true) }) }}>
            <input aria-label="Admin key" type="password" autoComplete="current-password" placeholder="Admin key" value={key} onChange={e => setKey(e.target.value)} className={appField('h-10 min-w-[200px] flex-1 text-[14px]')} />
            <button disabled={!!busy || !key} className={appButton('ink', 'md', 'h-10')}>Sign in</button>
          </form>
        )}
        {createGate && !canCreate && <UpgradeNotice error={CREATE_UPGRADE} className="mt-5" />}
        {busy && <Notice className="mt-5 flex items-center gap-2.5"><Loader2 className="size-4 shrink-0 animate-spin" />{busy}</Notice>}
        {error && (error.billing ? <UpgradeNotice error={error} className="mt-5" /> : <Notice tone="error" className="mt-5">{error.message}</Notice>)}
        {notice && <Notice tone="success" className="mt-5">{notice}</Notice>}
        {selection.error && <Notice tone="error" className="mt-5">{selection.error}</Notice>}

        {adding && canCreate && (
          <section className={cn(panelClass, 'mt-6 space-y-4 p-5 sm:p-6')} aria-labelledby="new-design-title">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="new-design-title" className="text-[16px] font-bold">{admin ? 'Study a new Batkle design' : 'Create a design'}</h2>
                <p className="mt-1 max-w-[680px] text-[13px] leading-relaxed text-bk-muted">
                  Upload one example of a style you like, or up to {maxReferences} related ones. They are studied together: what repeats becomes the design’s rules, what changes becomes its variety. Examples are never reused as templates, and posts always use each brand’s own colours, fonts and logo.{admin ? '' : ' You review the result, then publish it for everyone or only for you and your team.'}
                </p>
              </div>
              <button type="button" onClick={() => setAdding(false)} aria-label="Close" className={appButton('quiet', 'sm', 'size-8 px-0')}><X className="size-4" /></button>
            </div>
            <label className={cn('flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-bk-field px-4 py-6 text-[14px] font-semibold transition-colors hover:border-bk-fg/50', busy && 'pointer-events-none opacity-60')}>
              <Upload className="size-4" />Choose example images
              <input aria-label="Upload design examples" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={!!busy} className="sr-only" onChange={e => { upload([...e.target.files]); e.target.value = '' }} />
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
            <button type="button" disabled={!!busy || !references.length} className={appButton('primary', 'md')} onClick={() => run(`Studying ${references.length} example${references.length === 1 ? '' : 's'}… this takes a minute or two.`, async () => { const family = await api('/analyze', 'POST', { referenceImages: references }); const record = await api('', 'POST', family); open(record); if (!admin) setTab('mine'); await refresh(admin); setNotice('Draft created. Review the study and the sample slides, then publish it.') })}>
              Study and create draft
            </button>
          </section>
        )}

        {editing && (
          <section className={cn(panelClass, 'mt-6 grid gap-6 p-5 sm:p-6 lg:grid-cols-[320px_minmax(0,1fr)]')} aria-label="Edit design">
            <div className="space-y-5 lg:sticky lg:top-4 lg:self-start">
              <div>
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-bk-muted">Examples</h3>
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
              <button type="button" disabled={!!busy} className={appButton('outline', 'sm')} onClick={() => run('Studying the examples again…', async () => { const rebuilt = await api('/analyze', 'POST', { referenceImages: draft.referenceImages }); setDraft({ ...rebuilt, id: draft.id, version: draft.version }); setReconstructionId(rebuilt.variants?.[0]?.id || ''); setNotice('Study rebuilt with an automatic name. Review and save to keep these changes; published versions are unchanged.') })}>Study the examples again</button>
              <DesignStudyEditor family={draft} onChange={setDraft} />
              <details className="rounded-xl border border-bk-line p-4">
                <summary className="cursor-pointer text-[13px] font-bold">Advanced: example reconstructions and raw data</summary>
                <p className="my-2 text-[12px] text-bk-muted">Reconstructions show how each example was read. They are evidence for review only; posts are composed from the study above.</p>
                {draft.variants?.length ? (
                  <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
                    <div className="space-y-2">
                      <select aria-label="Example reconstruction" className={appField('h-10 text-[14px]')} value={reconstructionId} onChange={e => setReconstructionId(e.target.value)}>{draft.variants.map((v, i) => <option key={v.id} value={v.id}>Example {i + 1}</option>)}</select>
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
              {!official && (
                <fieldset className="rounded-xl border border-bk-line p-4">
                  <legend className="px-1 text-[13px] font-bold">Who can use it</legend>
                  <div className="mt-1 grid gap-2 sm:grid-cols-2">
                    {[['public', Globe, 'Public', 'Everyone finds it in the library. Members on Pro and Business can use it.'], ['private', Lock, 'Private', 'Only you and the people in your teams.']].map(([value, Icon, label, hint]) => (
                      <label key={value} className={cn('flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors', visibility === value ? 'border-bk-fg bg-bk-alt' : 'border-bk-line hover:border-bk-fg/40')}>
                        <input type="radio" name="design-visibility" value={value} checked={visibility === value} onChange={() => setVisibility(value)} className="mt-1 accent-current" />
                        <span><span className="flex items-center gap-1.5 text-[14px] font-bold"><Icon className="size-3.5" aria-hidden="true" />{label}</span><span className="mt-0.5 block text-[12.5px] leading-relaxed text-bk-muted">{hint}</span></span>
                      </label>
                    ))}
                  </div>
                  {active.status === 'published' && (active.visibility || 'private') !== visibility && <p className="mt-2 text-[12.5px] text-bk-muted">Publish again to apply the change.</p>}
                </fieldset>
              )}
              <div className="flex flex-wrap gap-2 border-t border-bk-line pt-4">
                <button type="button" disabled={!!busy} className={appButton('outline', 'md')} onClick={() => run('Saving draft…', async () => { await saveDraft(); setNotice('Draft saved. Published versions remain unchanged.') })}>Save draft</button>
                <button type="button" disabled={!!busy} className={appButton('primary', 'md')} onClick={() => run('Publishing…', async () => { const saved = await saveDraft(); const result = await api(`/${draft.id}/publish`, 'POST', { revision: saved.revision, ...(official ? {} : { visibility }) }); open(result); await refresh(admin); setNotice(official ? 'Published. Every brand can now use this version.' : visibility === 'public' ? 'Published for everyone. Your name shows as its author.' : 'Published for you and your team.') })}>Publish</button>
                {active.status === 'published' && <button type="button" disabled={!!busy} className={appButton('outline', 'md')} onClick={() => run('Unpublishing…', async () => { await api(`/${draft.id}/unpublish`, 'POST', { revision: active.revision }); open(await api('/' + draft.id)); await refresh(admin) })}>Unpublish</button>}
                <button type="button" disabled={!!busy} className={appButton('outline', 'md', 'ml-auto text-[#C2412F] dark:text-[#F0826F]')} onClick={async () => { if (await popup.confirm({ title: draft.name ? `Delete “${shortName(draft.name)}” from the library?` : 'Delete this design from the library?', description: 'Brands that already use it and posts made with it keep their saved version.', tone: 'danger', confirmLabel: 'Delete design' })) run('Deleting design…', async () => { await api('/' + draft.id, 'DELETE', { revision: active.revision }); setDraft(null); setActive(null); await refresh(admin) }) }}>Delete</button>
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
              <div role="tablist" aria-label="Show designs" className="mb-3 flex gap-1 rounded-xl bg-bk-alt p-1">
                {tabs.map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setFeaturedId(null) }} className={cn('h-8 flex-1 rounded-lg text-[12.5px] font-bold transition-colors', tab === id ? 'bg-bk-surface text-bk-fg shadow-bk-card' : 'text-bk-muted hover:text-bk-fg')}>{label}</button>
                ))}
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-bk-muted" aria-hidden="true" />
                <input type="search" aria-label="Search the design library" placeholder="Search designs or styles" value={query} onChange={e => setQuery(e.target.value)} className={appField('h-10 pl-9 text-[14px]')} />
              </div>
              {flowId && <p className="mt-3 flex items-center gap-2 text-[12.5px] font-semibold text-bk-muted" aria-live="polite">{selection.busy && <Loader2 className="size-3.5 animate-spin" />}{selection.busy ? 'Saving…' : `${selection.selected.length} in use for ${brand?.name || 'this brand'}`}</p>}
              {entries.length === 0 ? (
                <p className="mt-4 text-[13.5px] text-bk-muted">{emptyText}</p>
              ) : (
                <ul className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] lg:max-h-[calc(100dvh-240px)] lg:flex-col lg:overflow-y-auto lg:overflow-x-visible lg:pr-1">
                  {entries.map(({ family, record, info }) => {
                    const current = family.id === featured?.family.id
                    const inUse = selection.selected.includes(family.id)
                    return (
                      <li key={family.id} className="w-[220px] shrink-0 lg:w-auto">
                        <button type="button" onClick={() => { setFeaturedId(family.id); setSample(0) }} aria-current={current ? 'true' : undefined} className={cn('flex w-full items-center gap-3 rounded-xl border p-2 text-left transition-colors', current ? 'border-bk-fg bg-bk-surface shadow-bk-card' : 'border-transparent hover:bg-bk-surface/70')}>
                          <span className="w-12 shrink-0 overflow-hidden rounded-md"><GlobalDesignPreview family={family} brand={previewBrand} sampleLabel={false} /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13.5px] font-bold">{family.name}</span>
                            <Origin info={info} className="w-full" />
                          </span>
                          {inUse && <span className="shrink-0 rounded-md bg-bk-fg px-1.5 py-0.5 text-[10.5px] font-bold text-bk-bg">In use</span>}
                          {!inUse && info?.upgrade && <Lock className="size-3.5 shrink-0 text-bk-muted" aria-label="Needs Pro" />}
                          {record && !inUse && <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-bold capitalize', STATUS_TONE[record.status] || STATUS_TONE.draft)}>{record.status}</span>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </aside>

            {featured && (() => {
              const { family, record, info } = featured
              const published = !record || record.status === 'published'
              const usable = flowId && published && info?.usable !== false
              const inUse = selection.selected.includes(family.id)
              const compositions = familyGrammar(family).compositions
              const editable = record && (admin || info?.mine)
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
                      <Origin info={info} className="mt-2 text-[13px]" />
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
                      {info?.upgrade && !inUse && <UpgradeNotice error={USE_UPGRADE} className="mt-6" />}
                      <div className="mt-auto flex flex-wrap gap-2 pt-7">
                        {usable && (
                          <button type="button" disabled={selection.busy || !selection.ready} aria-pressed={inUse} onClick={() => selection.toggle(family.id)} className={appButton(inUse ? 'outline' : 'primary', 'md', 'h-11 flex-1 px-5')}>
                            {selection.busy ? <Loader2 className="size-4 animate-spin" /> : inUse ? <X className="size-4" /> : <Check className="size-4" />}
                            {inUse ? 'Stop using it' : `Use for ${brand?.name ? shortName(brand.name, 24) : 'this brand'}`}
                          </button>
                        )}
                        {/* Kept from a trial: it can still be switched off. */}
                        {!usable && inUse && flowId && <button type="button" disabled={selection.busy || !selection.ready} onClick={() => selection.toggle(family.id)} className={appButton('outline', 'md', 'h-11 flex-1 px-5')}><X className="size-4" />Stop using it</button>}
                        {editable && <button type="button" onClick={() => open(record)} className={appButton('outline', 'md', 'h-11')}>{admin ? 'Review and edit' : 'Edit'}</button>}
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
