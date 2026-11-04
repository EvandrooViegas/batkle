'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, Lock, LogOut, Plus, Search, Upload, X } from 'lucide-react'
import { COMPOSITION_LABELS, ZoomablePreview } from '@/components/GlobalDesignPreview'
import GlobalDesignPreview from '@/components/GlobalDesignPreview'
import { Byline, Origin } from '@/components/DesignByline'
import { imageryLabel } from '@/components/DesignStudyEditor'
import DesignStudyWorkspace, { StatusPill } from '@/components/DesignStudyWorkspace'
import { toast } from 'sonner'
import { useBrandDesignSelection } from '@/components/BrandDesignStudio'
import UpgradeNotice from '@/components/app/billing/UpgradeNotice'
import { useBilling } from '@/components/app/billing/useBilling'
import { useBrandAccess } from '@/components/app/AppShell'
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
// The admin may study up to 30 references; members up to 10 (MEMBER_MAX_REFERENCES on the server).
const MAX_REFERENCES = { admin: 30, member: 10 }
const REFERENCE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const TABS = [['all', 'All'], ['batkle', 'Batkle'], ['members', 'Members'], ['mine', 'Yours']]
const USE_UPGRADE = { code: 'upgrade_required', billing: { feature: 'communityDesigns', requiredPlan: 'pro' }, message: 'Designs made by Batkle members are part of Pro and Business.' }
const CREATE_UPGRADE = { code: 'upgrade_required', billing: { feature: 'customDesigns', requiredPlan: 'pro' }, message: 'Creating your own designs is part of Pro and Business.' }

/**
 * Every design Batkle composes posts with: Batkle's own, and the ones members publish (public, or private to their
 * team). Inside a brand, previews use its colours, fonts and logo and each design it may use can be switched on.
 * Pro and Business members study their own references into designs; the admin edits every design.
 */
// The open brand uses this design for its new posts: the one highlighted pill (a design's own status is a quiet one).
const inUsePill = 'inline-flex shrink-0 items-center gap-1 rounded-full bg-bk-butter px-2 py-0.5 text-[11.5px] font-bold text-bk-ink'

export default function GlobalDesignLibrary({ flowId, brand, embedded = false }) {
  const popup = usePopup()
  const { data: billing } = useBilling()
  const selection = useBrandDesignSelection(flowId, brand)
  // Which designs a brand uses is part of its profile: in a brand shared with this person, the owner's and admins' call.
  const { canManage } = useBrandAccess()
  // `accountAdmin`: signed in with an admin account (ADMIN_EMAILS), so there is no key session to sign out of.
  const [admin, setAdmin] = useState(false), [accountAdmin, setAccountAdmin] = useState(false), [login, setLogin] = useState(false), [key, setKey] = useState('')
  const [families, setFamilies] = useState(null), [records, setRecords] = useState([]), [mine, setMine] = useState([]), [active, setActive] = useState(null)
  const [draft, setDraft] = useState(null), [visibility, setVisibility] = useState('private')
  const [busy, setBusy] = useState(''), [error, setError] = useState(null), [query, setQuery] = useState('')
  // What an action did is a toast; an error stays on the page. Clearing (an empty text) has nothing to clear.
  const setNotice = text => { if (text) toast.success(text) }
  const [adding, setAdding] = useState(false), [references, setReferences] = useState([]), [tab, setTab] = useState('all')
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
    setActive(record); setDraft(record.draft); setAdding(false); setNotice('')
    setVisibility(record.visibility === 'public' ? 'public' : 'private')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const saveDraft = async () => { const record = await api('/' + draft.id, 'PATCH', { family: tidy(draft), revision: active.revision }); setActive(record); setDraft(record.draft); await refresh(admin); return record }
  // Example images dropped on the upload box, as well as chosen with it.
  const [dragging, setDragging] = useState(false)
  const upload = list => run('Uploading references…', async () => {
    // Whatever else was dragged along (a PDF, a folder) is left out.
    const files = [...list].filter(file => REFERENCE_TYPES.includes(file.type))
    if (!files.length) throw Error('Examples must be PNG, JPEG or WebP images.')
    if (references.length + files.length > maxReferences) throw Error(`A design can be studied from up to ${maxReferences} references.`)
    const added = []
    for (const file of files) { if (file.size > 6 * 1024 * 1024) throw Error(`${file.name} is larger than 6 MB.`); added.push(await api('/references', 'POST', { name: file.name, data: await readFile(file) })) }
    setReferences(prev => [...prev, ...added])
  })
  // A design saved before bylines were kept is credited to the brand the library is open in, by its maker.
  const credit = id => run('Saving who made it…', async () => { await api(`/${id}/credit`, 'POST', { flowId }); await refresh(admin); setNotice(`${brand.name} now shows as the brand that made it.`) })
  const startCreating = () => {
    setNotice(''); setError(null)
    if (!canCreate) { setCreateGate(true); return }
    setCreateGate(false); setAdding(true); setActive(null); setDraft(null); setReferences([])
  }
  // A member's own record is edited like the admin's; Batkle's own designs only by the admin.
  const editing = draft && active && (admin || active.ownerId)
  const official = !active?.ownerId
  const dirty = !!(editing && JSON.stringify(tidy(draft)) !== JSON.stringify(active.draft))
  const own = mine.map(r => ({ family: r.draft, record: r, info: r.library }))
  const listed = admin
    ? records.map(r => ({ family: r.draft, record: r, info: r.library }))
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
          description={`Visual styles Batkle composes posts with, always in ${brand?.name ? `${brand.name}’s` : 'each brand’s'} colours, fonts and logo: Batkle’s own and the ones members publish.${flowId && canManage ? ' Switch a design on to use it for new posts.' : ''}`}
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
            <label
              onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
              onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
              onDrop={e => { e.preventDefault(); setDragging(false); if (!busy) upload(e.dataTransfer.files) }}
              className={cn('flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-6 text-center transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-bk-fg', dragging ? 'border-bk-fg bg-bk-alt' : 'border-bk-field hover:border-bk-fg/50', busy && 'pointer-events-none opacity-60')}>
              <span className="flex items-center gap-2 text-[14px] font-semibold"><Upload className="size-4" />{dragging ? 'Drop to add them' : 'Drop example images here, or choose them'}</span>
              <span className="text-[12px] text-bk-muted">PNG, JPEG or WebP, up to 6 MB each{references.length ? ` · ${references.length} of ${maxReferences} added` : ''}</span>
              <input aria-label="Upload design examples" type="file" accept={REFERENCE_TYPES.join(',')} multiple disabled={!!busy} className="sr-only" onChange={e => { upload([...e.target.files]); e.target.value = '' }} />
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
            <button type="button" disabled={!!busy || !references.length} className={appButton('primary', 'md')} onClick={() => run(`Studying ${references.length} example${references.length === 1 ? '' : 's'}… this takes a minute or two.`, async () => { const family = await api('/analyze', 'POST', { referenceImages: references }); const record = await api(flowId ? `?flowId=${encodeURIComponent(flowId)}` : '', 'POST', family); open(record); if (!admin) setTab('mine'); await refresh(admin); setNotice('Draft created. Review the study and the sample slides, then publish it.') })}>
              Study and create draft
            </button>
          </section>
        )}

        {editing && (
          <DesignStudyWorkspace
            family={draft} record={active} brand={previewBrand} official={official} busy={busy} dirty={dirty}
            visibility={visibility} onVisibility={setVisibility} onChange={setDraft}
            onClose={async () => { if (!dirty || await popup.confirm({ title: 'Leave without saving?', description: 'Your changes to this design are lost.', confirmLabel: 'Leave', tone: 'danger' })) { setDraft(null); setActive(null) } }}
            onSave={() => run('Saving draft…', async () => { await saveDraft(); setNotice('Draft saved. Published versions remain unchanged.') })}
            onPublish={() => run('Publishing…', async () => { const saved = await saveDraft(); const result = await api(`/${draft.id}/publish`, 'POST', { revision: saved.revision, ...(official ? {} : { visibility }) }); open(result); await refresh(admin); setNotice(official ? 'Published. Every brand can now use this version.' : visibility === 'public' ? 'Published for everyone, with your name, photo and brand on it.' : 'Published for you and your team.') })}
            onUnpublish={() => run('Unpublishing…', async () => { await api(`/${draft.id}/unpublish`, 'POST', { revision: active.revision }); open(await api('/' + draft.id)); await refresh(admin) })}
            onDelete={async () => { if (await popup.confirm({ title: draft.name ? `Delete “${shortName(draft.name)}” from the library?` : 'Delete this design from the library?', description: 'Brands that already use it and posts made with it keep their saved version.', tone: 'danger', confirmLabel: 'Delete design' })) run('Deleting design…', async () => {
              const name = draft.name ? `“${shortName(draft.name)}”` : 'The design'
              await api('/' + draft.id, 'DELETE', { revision: active.revision }); setDraft(null); setActive(null); await refresh(admin)
              setNotice(`${name} was deleted from the library. Brands that use it and posts made with it keep their saved version.`)
            }) }}
            // A fresh study replaces the settings, never the name, description and categories the person chose.
            onRestudy={async () => { if (dirty && !await popup.confirm({ title: 'Study the example again?', description: 'Batkle reads your example from scratch. Changes you haven’t saved are replaced.', confirmLabel: 'Study again' })) return; run('Studying your example again… this takes a minute or two.', async () => { const rebuilt = await api('/analyze', 'POST', { referenceImages: draft.referenceImages }); setDraft({ ...rebuilt, id: draft.id, version: draft.version, name: draft.name, description: draft.description, tags: draft.tags }); setNotice('Studied again. Compare the samples with your example, then save to keep it; published versions are unchanged.') }) }}
            onApplyGrammar={json => run('Applying the settings…', async () => { const { grammarSchema } = await import('@/lib/designs/global/types'); const grammar = grammarSchema.parse(JSON.parse(json)); setDraft({ ...draft, study: { ...(draft.study || {}), imagery: familyImagery(draft), grammar } }) })}
          />
        )}

        {/* While a design is open, the page is its workspace; closing it returns to the library. */}
        {!editing && (families === null ? (
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
                            <Origin info={info} ring={current ? 'ring-bk-surface' : 'ring-bk-bg'} className="mt-1 w-full" />
                          </span>
                          {inUse && <span title={`New ${brand?.name || 'brand'} posts use this design`} className={inUsePill}><Check className="size-3" strokeWidth={3} aria-hidden="true" />In use</span>}
                          {!inUse && info?.upgrade && <Lock className="size-3.5 shrink-0 text-bk-muted" aria-label="Needs Pro" />}
                          {record && !inUse && record.status !== 'published' && <StatusPill record={record} official={info?.official} short />}
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
              // Its maker can name the brand of a design saved before bylines: the member, or the admin for Batkle's.
              const maker = info?.maker
              const creditable = flowId && brand?.name && info && !maker?.brand && (maker?.person ? maker.person.you : admin && info.official)
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
                        {inUse && <span className={inUsePill}><Check className="size-3.5" strokeWidth={3} aria-hidden="true" />In use for {brand?.name ? shortName(brand.name, 24) : 'this brand'}</span>}
                        {record && <StatusPill record={record} official={info?.official} />}
                        {/* One of Batkle's own that names its maker: free for every plan, unlike a member's. */}
                        {info?.official && maker && <span className="rounded-full bg-bk-chip px-2.5 py-0.5 text-[12px] font-bold">Batkle design</span>}
                      </div>
                      <h2 id="featured-design" className="mt-3 font-bk-display text-[clamp(28px,3vw,40px)] font-bold leading-[1.02] tracking-[-0.04em]">{family.name}</h2>
                      <Byline info={info} className="mt-4" />
                      {creditable && (
                        <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-bk-muted">
                          Saved before designs showed who made them.
                          <button type="button" disabled={!!busy} onClick={() => credit(family.id)} className="font-semibold text-bk-fg underline underline-offset-4 disabled:opacity-60">Credit {shortName(brand.name, 24)}{maker?.person ? '' : ' and you'}</button>
                        </p>
                      )}
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
                      {info?.upgrade && !inUse && canManage && <UpgradeNotice error={USE_UPGRADE} className="mt-6" />}
                      <div className="mt-auto flex flex-wrap gap-2 pt-7">
                        {usable && canManage && (
                          <button type="button" disabled={selection.busy || !selection.ready} aria-pressed={inUse} onClick={() => selection.toggle(family.id)} className={appButton(inUse ? 'outline' : 'primary', 'md', 'h-11 flex-1 px-5')}>
                            {selection.busy ? <Loader2 className="size-4 animate-spin" /> : inUse ? <X className="size-4" /> : <Check className="size-4" />}
                            {inUse ? 'Stop using it' : `Use for ${brand?.name ? shortName(brand.name, 24) : 'this brand'}`}
                          </button>
                        )}
                        {/* Kept from a trial: it can still be switched off. */}
                        {!usable && inUse && flowId && canManage && <button type="button" disabled={selection.busy || !selection.ready} onClick={() => selection.toggle(family.id)} className={appButton('outline', 'md', 'h-11 flex-1 px-5')}><X className="size-4" />Stop using it</button>}
                        {editable && <button type="button" onClick={() => open(record)} className={appButton('outline', 'md', 'h-11')}>{admin ? 'Review and edit' : 'Edit'}</button>}
                      </div>
                    </div>
                  </div>
                </section>
              )
            })()}
          </div>
        ))}
      </div>
    </div>
  )
}
