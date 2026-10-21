'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Copy, Download, Loader2, PencilLine, Plus, Trash2 } from 'lucide-react'
import { AD_ANGLES, AD_OBJECTIVES, AD_PLACEMENTS, AD_TEXT_LIMITS, DEFAULT_PLACEMENTS, META_CTAS, objectiveById, placementById } from '@/lib/ads/meta'
import { postJson, skippedVisuals, creditsChanged } from '@/lib/client/postGeneration'
import { apiError } from '@/lib/client/billing'
import { cn } from '@/lib/utils'
import UpgradeNotice from '../billing/UpgradeNotice'
import { useBilling } from '../billing/useBilling'
import { PostThumb } from '../creation/PostThumb'
import { StageBar } from '../creation/StageBar'
import { appField } from '../field'
import { usePopup } from '../popup'
import { Notice, PageHeader, SegmentedTabs, appButton, pageInner, pageShell, panelClass } from '../ui'
import AdPreview from './AdPreview'

const MAX = 600
const ADS_UPGRADE = { code: 'upgrade_required', billing: { feature: 'adDesigns', requiredPlan: 'business' }, message: 'Facebook and Instagram ads are part of Business.' }
const EMPTY_BRIEF = { offer: '', incentive: '', audience: '', url: '', objective: 'leads', cta: objectiveById('leads').cta, ctaPicked: false, placements: DEFAULT_PLACEMENTS }
const label = 'text-[11px] font-bold uppercase tracking-[0.12em] text-bk-muted'
const fieldLabel = 'block text-[13.5px] font-bold'
const hint = 'mt-1.5 text-[12px] leading-snug text-bk-muted'
const optional = <span className="font-normal text-bk-muted"> · optional</span>

const fileName = text => (text || 'ad').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 50).toLowerCase() || 'ad'
const ratioName = placement => (placementById(placement)?.ratio || placement).replace(/[.:]/g, 'x')
const ratios = ad => ad.canvases.map(c => placementById(c.placement)?.ratio).filter(Boolean).join(' · ')
const shortDate = date => new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

async function renderPng(canvasId) {
  const res = await fetch('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canva_id: canvasId, data: {} }) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) throw new Error(data.error || 'The image could not be prepared. Please try again.')
  const file = await fetch(new URL(data.url, window.location.origin).pathname)
  if (!file.ok) throw new Error('The image could not be prepared. Please try again.')
  return file.blob()
}

function save(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** The ad's text as Ads Manager asks for it, for the ZIP and the clipboard. */
function adText(ad, copy = ad.copy) {
  const block = (title, values) => `${title}\n${values.filter(Boolean).map((v, i) => (values.length > 1 ? `${i + 1}. ${v}` : v)).join('\n\n')}`
  return [
    block('PRIMARY TEXT', copy.primaryText),
    block('HEADLINE', copy.headlines),
    copy.description && block('DESCRIPTION', [copy.description]),
    block('CALL TO ACTION BUTTON', [copy.cta]),
    ad.brief?.url && block('WEBSITE', [ad.brief.url]),
  ].filter(Boolean).join('\n\n')
}

/** Every size as a PNG, and the text, in one ZIP. */
async function downloadZip(ad, copy) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const name = fileName(ad.creative?.headline || ad.brief?.offer)
  for (const c of ad.canvases) zip.file(`${name}-${ratioName(c.placement)}.png`, await renderPng(c.canvasId))
  zip.file('ad-text.txt', adText(ad, copy))
  save(await zip.generateAsync({ type: 'blob' }), `${name}.zip`)
}

/** Briefs from the brand's own profile: its services by name and its projects; general ones when it lists none. */
function profileBriefs(brand) {
  const name = v => String((typeof v === 'string' ? v : v?.name) || '').split(/\s+[—–-]\s+|:\s/)[0].replace(/\s*\(.*\)\s*$/, '').trim()
  const services = (Array.isArray(brand?.services) ? brand.services : []).map(name).filter(Boolean).slice(0, 4)
  const projects = (Array.isArray(brand?.projects) ? brand.projects : []).map(name).filter(Boolean).slice(0, 2).map(p => `A recent project: ${p}`)
  const briefs = [...services, ...projects]
  return briefs.length ? briefs : ['Our main service, for new customers', 'Get people to ask for a quote', 'Show a recent project']
}

function CopyButton({ value, children, size = 'sm', variant = 'quiet', className = '' }) {
  const [copied, setCopied] = useState(false)
  return (
    <button type="button" aria-label={children ? undefined : 'Copy'} disabled={!value} onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {} }}
      className={appButton(variant, size, cn(!children && 'size-8 shrink-0 px-0', className))}>
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {children && (copied ? 'Copied' : children)}
    </button>
  )
}

/** Counts against Meta's limits: the hard limit, and (in amber, explained on hover) where Meta starts cutting. */
function Count({ value, visible, max }) {
  const over = value.length > max, cut = visible && value.length > visible
  return <span title={cut && !over ? `The Facebook feed shows about the first ${visible} characters` : undefined} className={cn('shrink-0 text-[11.5px] tabular-nums', over ? 'font-bold text-[#C2412F]' : cut ? 'text-[#9A6B00] dark:text-[#F2C14E]' : 'text-bk-muted')}>{value.length}/{max}</span>
}

/** A size as its shape, so 4:5, 1:1, 9:16 and 1.91:1 read at a glance. */
function RatioShape({ placement }) {
  const scale = 20 / Math.max(placement.width, placement.height)
  return <span aria-hidden="true" className="block rounded-[3px] border-[1.5px] border-current" style={{ width: placement.width * scale, height: placement.height * scale }} />
}

/**
 * A new ad's brief, as Ads Manager asks for it: what it promotes (with briefs from the brand's profile), a reason to act
 * now, who it is for, the goal, the button, the link and the sizes. One credit per size.
 */
function NewAdForm({ brand, value, onChange, onCreate, onCancel, error, creditsLeft, waiting }) {
  const set = patch => onChange({ ...value, ...patch })
  const briefs = useMemo(() => profileBriefs(brand), [brand])
  const credits = value.placements.length
  const toggle = id => set({ placements: value.placements.includes(id) ? (value.placements.length > 1 ? value.placements.filter(p => p !== id) : value.placements) : AD_PLACEMENTS.map(p => p.id).filter(p => p === id || value.placements.includes(p)) })
  const submit = event => {
    event?.preventDefault()
    if (!value.offer.trim() || waiting) return
    const { ctaPicked: _picked, ...brief } = value
    onCreate({ ...brief, offer: brief.offer.trim(), incentive: brief.incentive.trim(), audience: brief.audience.trim(), url: brief.url.trim() })
  }
  return (
    <form onSubmit={submit} aria-labelledby="new-ad-title" className={cn(panelClass, 'p-5 motion-safe:animate-bk-page sm:p-6')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="new-ad-title" className="font-bk-display text-[20px] font-bold tracking-[-0.02em]">New ad</h2>
          <p className="mt-1 max-w-[600px] text-[13.5px] leading-relaxed text-bk-muted">Batkle writes three versions of the text, designs the image in your brand at every size you pick and shows it as people will see it in Meta. Nothing is published.</p>
        </div>
        {onCancel && <button type="button" onClick={onCancel} className={appButton('outline', 'sm')}>Cancel</button>}
      </div>

      <div className="mt-6 grid gap-x-8 gap-y-6 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <div>
            <label htmlFor="ad-offer" className={fieldLabel}>What should the ad promote?</label>
            <textarea
              id="ad-offer" rows={4} maxLength={MAX} value={value.offer}
              onChange={e => set({ offer: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e) }}
              placeholder="One service, product or offer, in your own words. The more specific, the stronger the ad."
              className={appField('mt-2 h-auto min-h-[108px] resize-y py-2.5 text-[14.5px] leading-relaxed')}
            />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[12.5px] text-bk-muted">From your profile:</span>
              {briefs.map(b => (
                <button key={b} type="button" onClick={() => { set({ offer: b }); document.getElementById('ad-offer')?.focus() }}
                  className="h-7 rounded-full border border-bk-line bg-bk-surface px-3 text-[12.5px] font-medium transition-colors can-hover:border-bk-field can-hover:bg-bk-alt focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg">
                  {b}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="ad-incentive" className={fieldLabel}>Reason to act now{optional}</label>
            <input id="ad-incentive" maxLength={200} value={value.incentive} onChange={e => set({ incentive: e.target.value })} placeholder="Such as a free first visit, a launch price or a date" className={appField('mt-2 h-10 text-[14px]')} />
            <p className={hint}>Only what you really offer: Batkle never makes one up.</p>
          </div>
          <div>
            <label htmlFor="ad-audience" className={fieldLabel}>Who it’s for{optional}</label>
            <input id="ad-audience" maxLength={300} value={value.audience} onChange={e => set({ audience: e.target.value })} placeholder="Such as owners of older homes in Lisbon" className={appField('mt-2 h-10 text-[14px]')} />
            <p className={hint}>One kind of customer. The ad speaks to them.</p>
          </div>
        </div>

        <div className="space-y-5">
          <fieldset>
            <legend className={fieldLabel}>Goal</legend>
            <div role="radiogroup" aria-label="Goal" className="mt-2 space-y-1.5">
              {AD_OBJECTIVES.map(o => {
                const on = value.objective === o.id
                return (
                  <label key={o.id} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-bk-fg', on ? 'border-[#E2A100] bg-[#FFD84D]/10 ring-1 ring-[#E2A100]' : 'border-bk-line can-hover:border-bk-fg/40')}>
                    <input type="radio" name="ad-goal" value={o.id} checked={on} onChange={() => set({ objective: o.id, ...(value.ctaPicked ? {} : { cta: o.cta }) })} className="sr-only" />
                    <span aria-hidden="true" className={cn('flex size-[16px] shrink-0 items-center justify-center rounded-full border-2', on ? 'border-[#E2A100]' : 'border-bk-field')}>{on && <span className="size-1.5 rounded-full bg-[#E2A100]" />}</span>
                    <span className="min-w-0 text-[13.5px] leading-snug"><span className="font-bold">{o.label}</span><span className="text-bk-muted"> · {o.goal}</span></span>
                  </label>
                )
              })}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ad-cta" className={fieldLabel}>Button</label>
              <select id="ad-cta" value={value.cta} onChange={e => set({ cta: e.target.value, ctaPicked: true })} className={appField('mt-2 h-10 text-[14px]')}>{META_CTAS.map(c => <option key={c} value={c}>{c}</option>)}</select>
            </div>
            <div>
              <label htmlFor="ad-url" className={fieldLabel}>Link{optional}</label>
              <input id="ad-url" type="url" maxLength={300} value={value.url} onChange={e => set({ url: e.target.value })} placeholder="https://" className={appField('mt-2 h-10 text-[14px]')} />
            </div>
          </div>
          <fieldset>
            <legend className={fieldLabel}>Sizes</legend>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {AD_PLACEMENTS.map(p => {
                const on = value.placements.includes(p.id)
                return (
                  <button key={p.id} type="button" aria-pressed={on} title={p.where} onClick={() => toggle(p.id)}
                    className={cn('flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg', on ? 'border-bk-fg bg-bk-fg text-bk-bg' : 'border-bk-line text-bk-fg can-hover:border-bk-fg/40')}>
                    <span className="flex size-6 shrink-0 items-center justify-center"><RatioShape placement={p} /></span>
                    <span className="min-w-0 leading-tight"><span className="block text-[13px] font-bold tabular-nums">{p.ratio}</span><span className={cn('block truncate text-[11.5px]', on ? 'text-bk-bg/70' : 'text-bk-muted')}>{p.label}</span></span>
                  </button>
                )
              })}
            </div>
          </fieldset>
        </div>
      </div>

      {error && (error.billing ? <UpgradeNotice error={error} className="mt-6" /> : <Notice tone="error" className="mt-6">{error.message}</Notice>)}

      <div className="mt-6 flex flex-col gap-3 border-t border-bk-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[12.5px] text-bk-muted">
          {waiting ? 'One ad at a time: this one can start when the ad being made is ready.' : `${credits} credit${credits === 1 ? '' : 's'}, one per size${creditsLeft != null ? ` · ${creditsLeft} left` : ''}.`}
        </p>
        <button type="submit" disabled={!value.offer.trim() || waiting} className={appButton('primary', 'md')}>Create ad<ArrowRight className="size-3.5" /></button>
      </div>
    </form>
  )
}

/** The ad being made: its brief, the three steps, and a frame where it will appear. */
function BuildProgress({ building }) {
  const at = ['copy', 'visuals', 'build'].indexOf(building.stage)
  const steps = ['content', 'visuals', 'build'].map((key, i) => ({ key, state: i < at ? 'done' : i === at ? 'active' : 'pending' }))
  const sizes = building.brief.placements.map(id => placementById(id)?.ratio).join(' · ')
  return (
    <section aria-labelledby="building-title" className={cn(panelClass, 'grid gap-6 p-5 motion-safe:animate-bk-page sm:p-6 md:grid-cols-[minmax(0,1fr)_220px] md:items-center')}>
      <div className="min-w-0" aria-live="polite">
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#9A6B00] dark:text-bk-butter"><Loader2 className="size-3.5 animate-spin" aria-hidden="true" />Making your ad</p>
        <h2 id="building-title" className="mt-2 line-clamp-3 font-bk-display text-[20px] font-bold leading-tight tracking-[-0.02em]">{building.brief.offer}</h2>
        <p className="mt-1.5 text-[13px] text-bk-muted">{objectiveById(building.brief.objective).label} · {sizes}</p>
        <StageBar steps={steps} className="mt-5" />
        <p className="mt-4 text-[13px] leading-relaxed text-bk-muted">This takes about a minute. You can open your other ads meanwhile.</p>
      </div>
      <div aria-hidden="true" className="mx-auto aspect-[4/5] w-full max-w-[220px] rounded-xl bg-bk-alt motion-safe:animate-pulse" />
    </section>
  )
}

/** Every ad of the brand, newest first, with the one being made on top. */
function AdList({ ads, selectedId, building, showingBuild, onOpen, onShowBuild, className = '' }) {
  const row = active => cn('flex w-full items-center gap-3 px-4 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bk-fg', active ? 'bg-bk-butter/15 shadow-[inset_3px_0_0_#E2A100]' : 'can-hover:bg-bk-alt/60')
  return (
    <aside aria-labelledby="ads-list-title" className={cn(panelClass, 'overflow-hidden lg:sticky lg:top-6', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-bk-line px-4 py-3">
        <h2 id="ads-list-title" className="text-[14px] font-bold">Your ads</h2>
        <span className="text-[12.5px] tabular-nums text-bk-muted">{ads.length}</span>
      </div>
      <ul className="divide-y divide-bk-line lg:max-h-[calc(100vh-200px)] lg:overflow-y-auto">
        {building && (
          <li>
            <button type="button" onClick={onShowBuild} aria-current={showingBuild || undefined} className={row(showingBuild)}>
              <span className="flex aspect-[4/5] w-11 shrink-0 items-center justify-center rounded-md bg-bk-alt"><Loader2 className="size-4 animate-spin text-bk-muted" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11.5px] font-bold uppercase tracking-[0.08em] text-[#9A6B00] dark:text-bk-butter">Making now</span>
                <span className="mt-0.5 line-clamp-2 text-[13px] font-semibold leading-snug">{building.brief.offer}</span>
              </span>
            </button>
          </li>
        )}
        {ads.map(ad => {
          const active = ad.id === selectedId && !showingBuild
          return (
            <li key={ad.id}>
              <button type="button" onClick={() => onOpen(ad.id)} aria-current={active || undefined} className={row(active)}>
                <span className="w-11 shrink-0">{ad.canvases[0]?.canvas ? <PostThumb canvas={ad.canvases[0].canvas} /> : <span className="block aspect-[4/5] rounded-md bg-bk-chip" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[13px] font-semibold leading-snug">{ad.brief?.offer}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-bk-muted">{objectiveById(ad.brief?.objective).label} · {ratios(ad)} · {shortDate(ad.createdAt)}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

/** The text that goes into Ads Manager, editable within Meta's limits; the preview beside it follows what is picked. */
function CopyEditor({ draft, setDraft, version, setVersion, headline, setHeadline, onSave, saving, dirty, className = '' }) {
  const primary = draft.primaryText[version] || ''
  const firstLine = primary.split('\n')[0]
  const setPrimary = value => setDraft({ ...draft, primaryText: draft.primaryText.map((t, i) => (i === version ? value : t)) })
  return (
    <section aria-labelledby="ad-text-title" className={cn('min-w-0', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="ad-text-title" className="font-bk-display text-[17px] font-bold tracking-[-0.02em]">Text for Ads Manager</h3>
          <p className="mt-0.5 text-[13px] text-bk-muted">Three versions to test against each other.</p>
        </div>
        {dirty && <button type="button" onClick={onSave} disabled={saving} className={appButton('primary', 'sm')}>{saving && <Loader2 className="size-3.5 animate-spin" />}Save changes</button>}
      </div>

      <div className="mt-5">
        <p className={label}>Primary text</p>
        <SegmentedTabs className="mt-2 w-fit" label="Primary text version" value={version} onChange={setVersion} items={draft.primaryText.map((_, i) => [i, AD_ANGLES[i]?.label || `Version ${i + 1}`])} />
        <div className="mt-2 rounded-xl border border-bk-field bg-bk-surface focus-within:border-bk-fg">
          <textarea aria-label="Primary text" rows={6} value={primary} onChange={e => setPrimary(e.target.value)} className="block w-full resize-y rounded-xl bg-transparent px-3.5 py-3 text-[14px] leading-relaxed outline-none" />
          <div className="flex items-center justify-between gap-2 border-t border-bk-line px-3.5 py-1.5">
            <span className={cn('text-[11.5px]', firstLine.length > AD_TEXT_LIMITS.primaryText ? 'font-bold text-[#9A6B00] dark:text-[#F2C14E]' : 'text-bk-muted')}>
              {firstLine.length > AD_TEXT_LIMITS.primaryText ? `The first line is cut after ${AD_TEXT_LIMITS.primaryText} characters` : `The first ${AD_TEXT_LIMITS.primaryText} characters show before “See more”`}
            </span>
            <span className="flex items-center gap-1"><Count value={primary} max={AD_TEXT_LIMITS.primaryTextMax} /><CopyButton value={primary} /></span>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <p className={label}>Headline <span className="font-semibold normal-case tracking-normal">· pick the one to preview; the feed shows about {AD_TEXT_LIMITS.headlineVisible} characters</span></p>
        <ul className="mt-2 divide-y divide-bk-line overflow-hidden rounded-xl border border-bk-field">
          {draft.headlines.map((h, i) => (
            <li key={i} className={cn('flex items-center gap-2.5 px-3 py-1', headline === i && 'bg-bk-butter/10')}>
              <input type="radio" name="ad-headline" aria-label={`Preview headline ${i + 1}`} checked={headline === i} onChange={() => setHeadline(i)} className="accent-current" />
              <input aria-label={`Headline ${i + 1}`} value={h} onChange={e => setDraft({ ...draft, headlines: draft.headlines.map((t, j) => (j === i ? e.target.value : t)) })} className="h-9 min-w-0 flex-1 bg-transparent text-[14px] font-semibold outline-none" />
              <Count value={h} visible={AD_TEXT_LIMITS.headlineVisible} max={AD_TEXT_LIMITS.headline} />
              <CopyButton value={h} />
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_170px]">
        <div>
          <p className={label}>Description</p>
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-bk-field px-3 py-0.5 focus-within:border-bk-fg">
            <input aria-label="Description" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} className="h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none" />
            <Count value={draft.description} max={AD_TEXT_LIMITS.description} />
            <CopyButton value={draft.description} />
          </div>
        </div>
        <div>
          <p className={label}>Button</p>
          <select aria-label="Button" value={draft.cta} onChange={e => setDraft({ ...draft, cta: e.target.value })} className={appField('mt-2 h-10 text-[14px]')}>{META_CTAS.map(c => <option key={c} value={c}>{c}</option>)}</select>
        </div>
      </div>
    </section>
  )
}

/**
 * One ad to review and finish: what it promotes and the downloads on top; below, the ad as people will see it in each
 * placement beside its text for Ads Manager, so every edit shows at once.
 */
function AdWorkspace({ ad, brand, website, draft, setDraft, view, setView, version, setVersion, headline, setHeadline, dirty, saving, onSave, busy, error, onDownload, onDownloadSize, onDelete }) {
  const size = ad.canvases.find(c => c.placement === view.placement) || ad.canvases[0]
  const placement = size?.placement
  const feed = placement === 'feed-portrait' || placement === 'feed-square'
  return (
    <article id="ad-workspace" aria-labelledby="ad-title" className={cn(panelClass, 'scroll-mt-6 overflow-hidden motion-safe:animate-bk-page')}>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-bk-line p-5 sm:px-6">
        <div className="min-w-0 max-w-[620px]">
          <p className="text-[12px] font-semibold text-bk-muted">{objectiveById(ad.brief?.objective).label} · {ratios(ad)} · {shortDate(ad.createdAt)}</p>
          <h2 id="ad-title" className="mt-1 line-clamp-2 font-bk-display text-[20px] font-bold leading-tight tracking-[-0.02em]">{ad.brief?.offer}</h2>
          {ad.creative?.headline && <p className="mt-1 line-clamp-1 text-[13px] text-bk-muted">On the image: <span className="italic">“{ad.creative.headline}”</span></p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={!!busy} onClick={onDownload} className={appButton('primary', 'md')}>{busy === 'zip' ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}Download all</button>
          <CopyButton value={adText(ad, draft)} variant="outline" size="md">Copy text</CopyButton>
          <button type="button" onClick={onDelete} aria-label="Delete ad" title="Delete ad" className={appButton('outline', 'md', 'w-9 px-0')}><Trash2 className="size-4" /></button>
        </div>
      </header>
      {(error || ad.failed?.length > 0) && (
        <div className="space-y-2 px-5 pt-4 sm:px-6">
          {error && <Notice tone="error">{error.message}</Notice>}
          {ad.failed?.length > 0 && <Notice>{ad.failed.map(f => placementById(f.placement)?.label).join(', ')}: the words did not fit, so {ad.failed.length === 1 ? 'that size was' : 'those sizes were'} left out and the credit returned.</Notice>}
        </div>
      )}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-label="Preview" className="border-b border-bk-line bg-bk-alt/50 p-5 sm:p-6 xl:border-b-0 xl:border-r">
          <div className="xl:sticky xl:top-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SegmentedTabs label="Size" value={placement} onChange={p => setView({ ...view, placement: p })} items={ad.canvases.map(c => [c.placement, placementById(c.placement)?.ratio])} />
              {feed && <SegmentedTabs label="Show on" value={view.network} onChange={network => setView({ ...view, network })} items={[['facebook', 'Facebook'], ['instagram', 'Instagram']]} />}
            </div>
            <p className="mt-2 text-[12px] text-bk-muted">{placementById(placement)?.where}.</p>
            <div className="mt-4 flex justify-center">
              <div className={cn('w-full', placement === 'story' ? 'max-w-[260px]' : 'max-w-[380px]')}>
                <AdPreview placement={placement} network={view.network} safe={view.safe} brand={brand} canvas={size?.canvas}
                  primary={draft.primaryText[version] || ''} headline={draft.headlines[headline] || ''} description={draft.description} cta={draft.cta} link={ad.brief?.url || website} />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {size && <Link href={`/editor/${size.canvasId}`} className={appButton('outline', 'sm')}><PencilLine className="size-3.5" />Edit image</Link>}
              {size && <button type="button" disabled={!!busy} onClick={() => onDownloadSize(size)} className={appButton('outline', 'sm')}>{busy === 'png' ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}This size</button>}
              {placement === 'story' && (
                <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-bk-fg/80">
                  <input type="checkbox" checked={view.safe} onChange={e => setView({ ...view, safe: e.target.checked })} className="accent-[#E2A100]" />Show where Meta covers the image
                </label>
              )}
            </div>
          </div>
        </section>
        <CopyEditor className="p-5 sm:p-6" draft={draft} setDraft={setDraft} version={version} setVersion={setVersion} headline={headline} setHeadline={setHeadline} onSave={onSave} saving={saving} dirty={dirty} />
      </div>
    </article>
  )
}

/**
 * Facebook and Instagram ads for a brand (Business): the brand's ads on the left; on the right the one open, with its
 * preview in each placement beside its text, or a new ad's brief, or the ad being made. Nothing is published: people
 * download the images and paste the text into Meta's Ads Manager.
 */
export default function AdsPage({ flowId, brandName, brandLogo = '', website = '', brandContext = null }) {
  const popup = usePopup()
  const { data: billing } = useBilling()
  const [ads, setAds] = useState(null), [loadError, setLoadError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  // `mode`: what the workspace shows: an ad ('ad'), a new ad's brief ('new') or the ad being made ('building').
  const [mode, setMode] = useState('ad')
  const [brief, setBrief] = useState(EMPTY_BRIEF)
  const [view, setView] = useState({ placement: 'feed-portrait', network: 'facebook', safe: false })
  const [version, setVersion] = useState(0), [headline, setHeadline] = useState(0)
  const [draft, setDraft] = useState(null), [saving, setSaving] = useState(false)
  const [building, setBuilding] = useState(null), [createError, setCreateError] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState('')
  const modeRef = useRef(mode)
  useEffect(() => { modeRef.current = mode }, [mode])
  const allowed = billing ? Boolean(billing.summary?.features?.adDesigns) : null
  const creditsLeft = billing?.summary?.credits?.left ?? null
  const brand = { name: brandName, logo: brandLogo }

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const res = await fetch(`/api/ads?flowId=${encodeURIComponent(flowId)}`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw apiError(data, res.status)
      setAds(data.ads)
      setSelectedId(current => current || data.ads[0]?.id || null)
      if (!data.ads.length) setMode('new')
    } catch (e) { setLoadError(e.message); setAds([]) }
  }, [flowId])
  useEffect(() => { load() }, [load])

  const ad = useMemo(() => ads?.find(a => a.id === selectedId) || null, [ads, selectedId])
  // A fresh draft of the text for each ad, so edits never leak between ads.
  useEffect(() => {
    if (!ad) { setDraft(null); return }
    setDraft({ ...ad.copy, primaryText: [...ad.copy.primaryText], headlines: [...ad.copy.headlines] })
    setVersion(0); setHeadline(0); setError(null)
    if (!ad.canvases.some(c => c.placement === view.placement)) setView(v => ({ ...v, placement: ad.canvases[0]?.placement || 'feed-portrait' }))
  }, [ad?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = Boolean(ad && draft && JSON.stringify(draft) !== JSON.stringify(ad.copy))

  // Leaving an ad with unsaved text asks first.
  const leave = async () => !dirty || mode !== 'ad' || popup.confirm({ title: 'Discard your changes?', description: 'The edits to this ad’s text are not saved.', confirmLabel: 'Discard' })
  const show = async next => {
    if (!(await leave())) return
    next()
    if (window.innerWidth < 1024) requestAnimationFrame(() => document.getElementById('ads-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const open = id => show(() => { setSelectedId(id); setMode('ad') })

  const create = async value => {
    setCreateError(null)
    setBuilding({ brief: value, stage: 'copy' }); setMode('building')
    try {
      const planned = await postJson('/api/ads/plan', { flowId, brief: value })
      creditsChanged()
      let resolved = skippedVisuals(planned.plan)
      if (planned.needsVisuals) {
        setBuilding({ brief: value, stage: 'visuals' })
        resolved = await postJson('/api/resolve-assets', { plan: planned.plan, brand_id: `brand_${flowId}`, chargeRef: planned.chargeRef })
      }
      setBuilding({ brief: value, stage: 'build' })
      const built = await postJson('/api/ads/build', { flowId, brief: planned.brief, ad: planned.ad, copy: planned.copy, resolvedPlan: resolved, chargeRef: planned.chargeRef })
      setAds(prev => [built.ad, ...(prev || [])])
      setBrief(EMPTY_BRIEF)
      // The new ad opens when its progress is on screen; otherwise it waits at the top of the list.
      if (modeRef.current === 'building' || !selectedId) {
        setSelectedId(built.ad.id); setMode('ad')
        setView(v => ({ ...v, placement: built.ad.canvases[0]?.placement || 'feed-portrait' }))
      }
    } catch (err) {
      // The brief stays as it was, with what went wrong, to try again.
      setCreateError(err); setMode('new')
    } finally { setBuilding(null); creditsChanged() }
  }

  const saveCopy = async () => {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/ads/${ad.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ copy: draft }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw apiError(data, res.status)
      setAds(prev => prev.map(a => (a.id === ad.id ? { ...a, copy: data.copy } : a)))
      setDraft({ ...data.copy, primaryText: [...data.copy.primaryText], headlines: [...data.copy.headlines] })
    } catch (e) { setError(e) } finally { setSaving(false) }
  }

  const remove = async () => {
    if (!(await popup.confirm({ title: 'Delete this ad?', description: 'Its images and text are deleted. Ads already running in Meta are not affected.', tone: 'danger', confirmLabel: 'Delete ad' }))) return
    try {
      const res = await fetch(`/api/ads/${ad.id}`, { method: 'DELETE' })
      if (!res.ok) throw apiError(await res.json().catch(() => ({})), res.status)
      const rest = ads.filter(a => a.id !== ad.id)
      setAds(rest); setSelectedId(rest[0]?.id || null)
      if (!rest.length) setMode('new')
    } catch (e) { setError(e) }
  }

  const run = async (key, task) => { setBusy(key); setError(null); try { await task() } catch (e) { setError(e) } finally { setBusy('') } }
  const listed = Boolean(ads && (ads.length || building))
  const showing = mode === 'building' && building ? 'building' : mode === 'new' || !ad || !draft ? 'new' : 'ad'

  return (
    <div className={pageShell}>
      <div className={pageInner}>
        <PageHeader
          eyebrow={`${brandName} · Ads`} title="Ads" description="Facebook and Instagram ads in your brand’s design, ready for Ads Manager."
          actions={allowed && listed && showing !== 'new' ? <button type="button" onClick={() => show(() => setMode('new'))} className={appButton('primary', 'md')}><Plus className="size-4" />New ad</button> : null}
        />

        {allowed === false && <UpgradeNotice error={ADS_UPGRADE} className="mt-6" />}
        {loadError && <Notice tone="error" className="mt-6">{loadError}</Notice>}

        {allowed && (ads === null ? (
          <div role="status" aria-label="Loading your ads" className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className={cn(panelClass, 'hidden h-[420px] motion-safe:animate-pulse lg:block')} />
            <div className={cn(panelClass, 'h-[560px] motion-safe:animate-pulse')} />
          </div>
        ) : (
          <div className={cn('mt-6 grid items-start gap-6', listed && 'lg:grid-cols-[280px_minmax(0,1fr)]')}>
            {listed && (
              <AdList className="order-last lg:order-first" ads={ads} selectedId={selectedId} building={building} showingBuild={showing === 'building'}
                onOpen={open} onShowBuild={() => show(() => setMode('building'))} />
            )}
            <div id="ads-workspace" className="min-w-0 scroll-mt-6">
              {showing === 'building' ? <BuildProgress building={building} /> : showing === 'new' ? (
                <NewAdForm brand={brandContext} value={brief} onChange={setBrief} onCreate={create} error={createError} creditsLeft={creditsLeft} waiting={Boolean(building)}
                  onCancel={ad ? () => { setCreateError(null); setMode(building ? 'building' : 'ad') } : null} />
              ) : (
                <AdWorkspace
                  ad={ad} brand={brand} website={website} draft={draft} setDraft={setDraft} view={view} setView={setView}
                  version={Math.min(version, draft.primaryText.length - 1)} setVersion={setVersion} headline={Math.min(headline, draft.headlines.length - 1)} setHeadline={setHeadline}
                  dirty={dirty} saving={saving} onSave={saveCopy} busy={busy} error={error}
                  onDownload={() => run('zip', () => downloadZip(ad, draft))}
                  onDownloadSize={s => run('png', async () => save(await renderPng(s.canvasId), `${fileName(ad.creative?.headline)}-${ratioName(s.placement)}.png`))}
                  onDelete={remove}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
