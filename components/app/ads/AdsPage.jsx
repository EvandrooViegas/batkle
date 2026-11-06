'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Check, Copy, Download, GalleryHorizontalEnd, Lightbulb, Loader2, Megaphone, PencilLine, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { AD_ANGLES, AD_OBJECTIVES, AD_PLACEMENTS, AD_TEXT_LIMITS, AD_VARIATIONS_MAX, CAROUSEL_CARDS, META_CTAS, adCredits, defaultPlacements, objectiveById, placementById, placementsFor } from '@/lib/ads/meta'
import { cheapestPlanForAdVariations } from '@/lib/billing/plans'
import { postJson, skippedVisuals, creditsChanged, giveCreditsBack } from '@/lib/client/postGeneration'
import { apiError } from '@/lib/client/billing'
import { cn } from '@/lib/utils'
import UpgradeNotice from '../billing/UpgradeNotice'
import { useBilling } from '../billing/useBilling'
import { PostThumb } from '../creation/PostThumb'
import { StageBar } from '../creation/StageBar'
import { appField } from '../field'
import { usePopup } from '../popup'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { DesignPicker } from '../DesignPicker'
import { EmptyState, Notice, PageHeader, SegmentedTabs, appButton, pageInner, pageShell, panelClass } from '../ui'
import { Choice, useBrandDesigns } from '../creation/PostSettings'
import AdPreview from './AdPreview'
import { useBrandAccess } from '../AppShell'

const MAX = 600
const ADS_UPGRADE = { code: 'upgrade_required', billing: { feature: 'adDesigns', requiredPlan: 'pro' }, message: 'Facebook and Instagram ads are part of Pro and Business.' }
// `variations` 0 is not picked yet: a new ad starts with as many as the plan makes, up to three (startVariations).
const EMPTY_BRIEF = { offer: '', incentive: '', audience: '', url: '', objective: 'leads', cta: objectiveById('leads').cta, ctaPicked: false, format: 'single', cards: CAROUSEL_CARDS.default, placements: defaultPlacements('single'), placementsPicked: false, variations: 0, designId: 'auto' }
const CARD_COUNTS = Array.from({ length: CAROUSEL_CARDS.max - CAROUSEL_CARDS.min + 1 }, (_, i) => CAROUSEL_CARDS.min + i).map(n => ({ value: n, label: String(n), title: `${n} cards` }))
const VARIATION_COUNTS = Array.from({ length: AD_VARIATIONS_MAX }, (_, i) => ({ value: i + 1, label: String(i + 1), title: i ? `${i + 1} variations` : 'The ad alone' }))
const startVariations = max => Math.max(1, Math.min(max || 1, 3))
/** Variation A is the ad itself; B, C… test other hooks and pictures. */
const letter = variation => String.fromCharCode(64 + (variation || 1))
const variationOf = canvas => canvas.variation || 1
const variationCount = ad => Math.max(1, ad.variations?.length || 0, ...ad.canvases.map(variationOf))
const FORMATS = [
  ['single', 'Single image', 'One image with the hook, the offer and the action'],
  ['carousel', 'Carousel', '2 to 10 cards people swipe: the hook, the reasons to buy, then the offer'],
]
const label = 'text-[11px] font-bold uppercase tracking-[0.12em] text-bk-muted'
const fieldLabel = 'block text-[13.5px] font-bold'
const hint = 'mt-1.5 text-[12px] leading-snug text-bk-muted'
const optional = <span className="font-normal text-bk-muted"> · optional</span>

const fileName = text => (text || 'ad').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 50).toLowerCase() || 'ad'
const ratioName = placement => (placementById(placement)?.ratio || placement).replace(/[.:]/g, 'x')
/** The sizes an ad was made at, each once (every variation has the same ones). */
const placementsOf = ad => [...new Set(ad.canvases.map(c => c.placement))]
const ratios = ad => placementsOf(ad).map(id => placementById(id)?.ratio).filter(Boolean).join(' · ')
const shortDate = date => new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
const isCarousel = brief => brief?.format === 'carousel'
const formatName = brief => (isCarousel(brief) ? `Carousel · ${brief.cards} cards` : 'Single image')
/** "Today", "Yesterday", else the date. */
const madeOn = date => { const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86400000); return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : shortDate(date) }

/** A size's images as PNGs: its one image, or a carousel's cards in order (the render answers with a ZIP of them). */
async function renderImages(canvasId) {
  const failed = 'The image could not be prepared. Please try again.'
  const res = await fetch('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canva_id: canvasId, data: {} }) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) throw new Error(data.error || failed)
  const file = await fetch(new URL(data.url, window.location.origin).pathname)
  if (!file.ok) throw new Error(failed)
  const blob = await file.blob()
  if (data.type !== 'carousel') return [blob]
  const { default: JSZip } = await import('jszip')
  // The render names the cards by position, so name order is card order.
  const pages = Object.values((await JSZip.loadAsync(blob)).files).filter(f => !f.dir && /\.png$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name))
  if (!pages.length) throw new Error(failed)
  return Promise.all(pages.map(page => page.async('blob')))
}

/** A size's file name: the ad's, its variation's letter when it has several, and the ratio. */
const sizeName = (ad, name, size) => `${name}${variationCount(ad) > 1 ? `-${letter(variationOf(size)).toLowerCase()}` : ''}-${ratioName(size.placement)}`

/** Adds a size's images to the ZIP: one PNG per size, or one per card. */
async function addSize(zip, name, size) {
  const images = await renderImages(size.canvasId)
  images.forEach((blob, i) => zip.file(`${name}${images.length > 1 ? `-card-${i + 1}` : ''}.png`, blob))
}

function save(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** The ad's text as Ads Manager asks for it, for the ZIP and the clipboard: a carousel has a headline per card. */
function adText(ad, copy = ad.copy) {
  const block = (title, values) => `${title}\n${values.filter(Boolean).map((v, i) => (values.length > 1 ? `${i + 1}. ${v}` : v)).join('\n\n')}`
  return [
    block('PRIMARY TEXT', copy.primaryText),
    ...(copy.cards
      ? copy.cards.map((c, i) => `CARD ${i + 1}\nHeadline: ${c.headline}${c.description ? `\nDescription: ${c.description}` : ''}`)
      : [block('HEADLINE', copy.headlines), copy.description && block('DESCRIPTION', [copy.description])]),
    block('CALL TO ACTION BUTTON', [copy.cta]),
    ad.brief?.url && block('WEBSITE', [ad.brief.url]),
  ].filter(Boolean).join('\n\n')
}

/** Every variation at every size as PNGs (a carousel's cards each), and the text, in one ZIP. */
async function downloadZip(ad, copy) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const name = fileName(ad.creative?.headline || ad.brief?.offer)
  for (const c of ad.canvases) await addSize(zip, sizeName(ad, name, c), c)
  zip.file('ad-text.txt', adText(ad, copy))
  save(await zip.generateAsync({ type: 'blob' }), `${name}.zip`)
}

/** One size of one variation: its PNG, or a ZIP of a carousel's cards. */
async function downloadSize(ad, size) {
  const name = sizeName(ad, fileName(ad.creative?.headline || ad.brief?.offer), size)
  if (!isCarousel(ad.brief)) return save((await renderImages(size.canvasId))[0], `${name}.png`)
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  await addSize(zip, name, size)
  save(await zip.generateAsync({ type: 'blob' }), `${name}.zip`)
}

/** The ad's text as the editor holds it: every field it shows, even on an ad saved without one. */
const draftOf = copy => (copy?.cards
  ? { primaryText: [...(copy.primaryText || [])], cards: copy.cards.map(c => ({ headline: c.headline || '', description: c.description || '' })), cta: copy.cta || 'Learn More' }
  : { ...copy, description: copy?.description || '', cta: copy?.cta || 'Learn More', primaryText: [...(copy?.primaryText || [])], headlines: [...(copy?.headlines || [])] })

/**
 * What an ad idea can start from: each service, recent project and thing that sets the brand apart, from its profile;
 * general starting points when it lists none.
 */
function profileSeeds(brand) {
  const name = v => String((typeof v === 'string' ? v : v?.name) || '').split(/\s+[—–-]\s+|:\s/)[0].replace(/\s*\(.*\)\s*$/, '').trim()
  const list = key => (Array.isArray(brand?.[key]) ? brand[key] : []).map(name).filter(Boolean)
  const seeds = [...new Set([...list('services'), ...list('projects').map(p => `A recent project: ${p}`), ...list('differentiators').map(d => `Why choose us: ${d}`)])]
  return seeds.length ? seeds : ['Our main service, for new customers', 'Get people to ask for a quote', 'Show a recent project']
}
const SHOWN = 4

/**
 * Ideas from the profile, as chips: each click has the AI write a new brief from that item (never the same one twice
 * in a row) and swaps the chip for another item, so the ideas keep changing.
 */
function ProfileIdeas({ flowId, brand, value, onChange }) {
  const seeds = useMemo(() => profileSeeds(brand), [brand])
  // Which items show starts somewhere different each time the form opens.
  const [shown, setShown] = useState(() => { const start = Math.floor(Math.random() * seeds.length); return Array.from({ length: Math.min(SHOWN, seeds.length) }, (_, i) => seeds[(start + i) % seeds.length]) })
  const [writing, setWriting] = useState(''), [failed, setFailed] = useState('')
  const given = useRef([]), lastAudience = useRef('')
  const others = list => seeds.filter(s => !list.includes(s))
  const swap = used => setShown(list => { const pool = others(list); return pool.length ? list.map(s => (s === used ? pool[Math.floor(Math.random() * pool.length)] : s)) : list })
  const more = () => setShown(list => { const pool = others(list); return pool.length ? [...pool, ...list].slice(0, Math.min(SHOWN, seeds.length)) : list })
  const write = async seed => {
    setWriting(seed); setFailed('')
    try {
      const idea = await postJson('/api/ads/idea', { flowId, from: seed, avoid: [...given.current, value.offer].filter(Boolean).slice(-6) })
      given.current = [...given.current, idea.offer].slice(-6)
      // The audience is filled in only when it is empty or came from an earlier idea, never over the person's own.
      const ownAudience = value.audience.trim() && value.audience !== lastAudience.current
      onChange({ ...value, offer: idea.offer, ...(ownAudience || !idea.audience ? {} : { audience: idea.audience }) })
      lastAudience.current = idea.audience || ''
      swap(seed)
      document.getElementById('ad-offer')?.focus()
    } catch (e) { setFailed(e.message || 'No idea could be written. Please try again.') } finally { setWriting('') }
  }
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12.5px] text-bk-muted">Ideas from your profile:</span>
        {shown.map(seed => (
          <button key={seed} type="button" disabled={!!writing} title={seed} onClick={() => write(seed)}
            className="inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-full border border-bk-line bg-bk-surface px-3 text-[12.5px] font-medium transition-colors can-hover:border-bk-field can-hover:bg-bk-alt disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg">
            {writing === seed ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <Lightbulb className="size-3.5 shrink-0 text-bk-muted" />}
            <span className="truncate">{seed}</span>
          </button>
        ))}
        {seeds.length > shown.length && (
          <button type="button" disabled={!!writing} onClick={more} className={appButton('quiet', 'xs', 'h-7 text-bk-muted')}><RefreshCw className="size-3.5" />Other ideas</button>
        )}
      </div>
      <p aria-live="polite" className={cn(hint, failed && 'text-[#C2412F] dark:text-[#F0826F]')}>{writing ? 'Writing an idea…' : failed || 'Each click writes a new idea from that part of your profile.'}</p>
    </div>
  )
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
function Count({ value = '', visible, max }) {
  const over = value.length > max, cut = visible && value.length > visible
  return <span title={cut && !over ? `The Facebook feed shows about the first ${visible} characters` : undefined} className={cn('shrink-0 text-[11.5px] tabular-nums', over ? 'font-bold text-[#C2412F]' : cut ? 'text-[#9A6B00] dark:text-[#F2C14E]' : 'text-bk-muted')}>{value.length}/{max}</span>
}

/** A size as its shape, so 4:5, 1:1, 9:16 and 1.91:1 read at a glance. */
function RatioShape({ placement }) {
  const scale = 20 / Math.max(placement.width, placement.height)
  return <span aria-hidden="true" className="block rounded-[3px] border-[1.5px] border-current" style={{ width: placement.width * scale, height: placement.height * scale }} />
}

const STEPS = [['promote', 'What to promote'], ['design', 'Design'], ['goal', 'Goal and button'], ['format', 'Format and sizes']]

/**
 * How the credits add up, before the total: images per size × sizes. A carousel's further variations each add a first
 * card; a single image alone shows only the total.
 */
function creditSum(brief, variations) {
  const sizes = `${brief.placements.length} size${brief.placements.length === 1 ? '' : 's'}`
  if (isCarousel(brief)) return variations > 1 ? `(${brief.cards} cards + ${variations - 1} first card${variations === 2 ? '' : 's'}) × ${sizes} = ` : `${brief.cards} cards × ${sizes} = `
  return variations > 1 ? `${variations} variations × ${sizes} = ` : ''
}

/** A format as its shape: one image, or cards side by side. */
function FormatShape({ format }) {
  const card = 'block h-5 rounded-[3px] border-[1.5px] border-current'
  return (
    <span aria-hidden="true" className="flex h-6 shrink-0 items-center gap-[3px]">
      <span className={cn(card, 'w-4')} />
      {format === 'carousel' && <><span className={cn(card, 'w-4 opacity-60')} /><span className={cn(card, 'w-2 rounded-r-none border-r-0 opacity-35')} /></>}
    </span>
  )
}

/**
 * A new ad's brief, as Ads Manager asks for it, one step at a time in a popup: what it promotes (with AI ideas from the
 * brand's profile), the design, the goal and button, then the format (one image or a carousel of cards) and the sizes,
 * with a summary. One credit per image: per size, or per card at each size.
 */
function NewAdDialog({ open, onOpenChange, flowId, brand, value, onChange, onCreate, error, creditsLeft, waiting, variationsMax = 1, planName = '' }) {
  const set = patch => onChange({ ...value, ...patch })
  const [step, setStep] = useState(0)
  // A brief that came back with an error reopens on its last step, where the error shows; a new one starts at the top.
  useEffect(() => { if (open) setStep(error ? STEPS.length - 1 : 0) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const [designs, reloadDesigns] = useBrandDesigns(flowId, open)
  const design = designs.items.find(item => item.design.id === value.designId)
  // An admin or the owner can add a design from the library without leaving the ad.
  const { canManage } = useBrandAccess()
  // The ad and its further variations (each its own hook and picture), never more than the plan makes.
  const variations = Math.min(value.variations || startVariations(variationsMax), Math.max(1, variationsMax))
  const bigger = cheapestPlanForAdVariations(variationsMax + 1)
  const credits = adCredits({ ...value, variations })
  const carousel = isCarousel(value)
  const ready = value.offer.trim().length > 0
  const last = step === STEPS.length - 1
  const sizes = AD_PLACEMENTS.filter(p => placementsFor(value.format).includes(p.id))
  const toggle = id => set({ placementsPicked: true, placements: value.placements.includes(id) ? (value.placements.length > 1 ? value.placements.filter(p => p !== id) : value.placements) : AD_PLACEMENTS.map(p => p.id).filter(p => p === id || value.placements.includes(p)) })
  // Each format starts on its own sizes (a carousel on square); sizes picked by hand stay where the format allows them.
  const setFormat = format => {
    if (format === value.format) return
    const kept = value.placementsPicked ? value.placements.filter(p => placementsFor(format).includes(p)) : []
    set({ format, placements: kept.length ? kept : defaultPlacements(format) })
  }
  const submit = () => {
    if (!ready || waiting) return
    const { ctaPicked: _picked, placementsPicked: _sizes, ...brief } = value
    onCreate({ ...brief, variations, offer: brief.offer.trim(), incentive: brief.incentive.trim(), audience: brief.audience.trim(), url: brief.url.trim(), designId: brief.designId === 'auto' ? undefined : brief.designId })
  }
  const next = event => { event?.preventDefault(); if (last) submit(); else if (ready) setStep(step + 1) }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-32px)] w-[calc(100vw-24px)] max-w-[760px] flex-col gap-0 overflow-hidden p-0">
        <form onSubmit={next} className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-bk-line px-5 pb-4 pt-5 sm:px-6">
            <DialogTitle className="font-bk-display text-[20px] font-bold tracking-[-0.02em]">New ad</DialogTitle>
            <DialogDescription className="mt-1 text-[13px] leading-relaxed text-bk-muted">Batkle writes the text to sell, in three versions to test, and designs a single image or a carousel in your brand at every size you pick. Nothing is published.</DialogDescription>
            <ol aria-label="Steps" className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
              {STEPS.map(([key, title], i) => (
                <li key={key}>
                  <button type="button" disabled={i > step && !ready} onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined}
                    className={cn('flex items-center gap-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed', i === step ? 'text-bk-fg' : 'text-bk-muted can-hover:text-bk-fg')}>
                    <span className={cn('flex size-6 items-center justify-center rounded-full text-[12px] font-bold', i < step ? 'bg-bk-fg text-bk-bg' : i === step ? 'bg-bk-butter text-bk-ink' : 'border border-bk-field')}>
                      {i < step ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                    </span>
                    {title}
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            {step === 0 && (
              <div className="space-y-5">
                <div>
                  <label htmlFor="ad-offer" className={fieldLabel}>What should the ad promote?</label>
                  <textarea
                    id="ad-offer" rows={4} maxLength={MAX} value={value.offer} autoFocus
                    onChange={e => set({ offer: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) next(e) }}
                    placeholder="One service, product or offer, in your own words. The more specific, the stronger the ad."
                    className={appField('mt-2 h-auto min-h-[108px] resize-y py-2.5 text-[14.5px] leading-relaxed')}
                  />
                  <ProfileIdeas flowId={flowId} brand={brand} value={value} onChange={onChange} />
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="ad-incentive" className={fieldLabel}>Reason to act now{optional}</label>
                    <input id="ad-incentive" maxLength={200} value={value.incentive} onChange={e => set({ incentive: e.target.value })} placeholder="Such as a free first visit or a date" className={appField('mt-2 h-10 text-[14px]')} />
                    <p className={hint}>Only what you really offer: Batkle never makes one up.</p>
                  </div>
                  <div>
                    <label htmlFor="ad-audience" className={fieldLabel}>Who it’s for{optional}</label>
                    <input id="ad-audience" maxLength={300} value={value.audience} onChange={e => set({ audience: e.target.value })} placeholder="Such as owners of older homes in Lisbon" className={appField('mt-2 h-10 text-[14px]')} />
                    <p className={hint}>One kind of customer. The ad speaks to them.</p>
                  </div>
                </div>
              </div>
            )}

            {step === 1 && (
              designs.status === 'error' || (designs.status === 'ready' && !designs.items.length && !canManage) ? (
                <div>
                  <p className={fieldLabel}>Which design should the ad use?</p>
                  {designs.status === 'error'
                    ? <Notice tone="error" className="mt-3">{designs.error}</Notice>
                    : <Notice className="mt-3">Ads use the Design Library, and this brand has no designs yet. Ask the brand’s owner or an admin to add one in the <Link href={`/app/${flowId}/design-library`} className="font-semibold underline underline-offset-4">Design Library</Link>.</Notice>}
                </div>
              ) : (
                <DesignPicker
                  title="Which design should the ad use?" hint="The image is made in this design, at every size, in your brand’s colours and fonts."
                  flowId={flowId} brand={brand || {}} designs={designs} reload={reloadDesigns} value={value.designId} onChange={designId => set({ designId })}
                  canAdd={canManage} requireDesign emptyText="Ads use the Design Library, and this brand has no designs yet."
                />
              )
            )}

            {step === 2 && (
              <div className="space-y-5">
                <fieldset>
                  <legend className={fieldLabel}>Goal</legend>
                  <div role="radiogroup" aria-label="Goal" className="mt-2 space-y-1.5">
                    {AD_OBJECTIVES.map(o => {
                      const on = value.objective === o.id
                      return (
                        <label key={o.id} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-bk-fg', on ? 'border-[#E2A100] bg-[#FFD84D]/10 ring-1 ring-[#E2A100]' : 'border-bk-field can-hover:border-bk-fg/40')}>
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
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5">
                <fieldset>
                  <legend className={fieldLabel}>Format</legend>
                  <div role="radiogroup" aria-label="Format" className="mt-2 grid gap-2 sm:grid-cols-2">
                    {FORMATS.map(([id, title, note]) => {
                      const on = value.format === id
                      return (
                        <button key={id} type="button" role="radio" aria-checked={on} onClick={() => setFormat(id)}
                          className={cn('flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg', on ? 'border-bk-fg bg-bk-fg text-bk-bg' : 'border-bk-field text-bk-fg can-hover:border-bk-fg/40')}>
                          <FormatShape format={id} />
                          <span className="min-w-0 leading-tight"><span className="block text-[13.5px] font-bold">{title}</span><span className={cn('mt-0.5 block text-[12px] leading-snug', on ? 'text-bk-bg/70' : 'text-bk-muted')}>{note}</span></span>
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
                {carousel && (
                  <div>
                    <p className={fieldLabel}>Cards</p>
                    <div className="mt-2"><Choice label="Number of cards" options={CARD_COUNTS} value={value.cards} onChange={cards => set({ cards })} /></div>
                    <p className={hint}>Each card gets its own image, its own words on it and a headline under it. The first stops the right person, the last asks for the action.</p>
                  </div>
                )}
                <div>
                  <p className={fieldLabel}>Variations</p>
                  <div className="mt-2">
                    <Choice label="Number of variations" options={VARIATION_COUNTS} value={variations} onChange={n => set({ variations: n })}
                      unavailable={n => n > variationsMax && (cheapestPlanForAdVariations(n) ? `${cheapestPlanForAdVariations(n).name} makes up to ${cheapestPlanForAdVariations(n).adVariations} variations` : 'Not on your plan')} />
                  </div>
                  <p className={hint}>
                    {carousel ? 'Each variation opens the carousel with its own first card: another hook and picture.' : 'Each variation is the image with another hook and picture.'} Run them side by side in Ads Manager to see which one people stop for; the text above the ad is shared.
                    {bigger && ` ${planName ? `Your ${planName} plan makes up to ${variationsMax}; ` : ''}${bigger.name} makes up to ${bigger.adVariations}.`}
                  </p>
                </div>
                <fieldset>
                  <legend className={fieldLabel}>Sizes</legend>
                  <p className={hint}>{carousel ? `Every card has the same shape, and Meta recommends square. One credit for each card at each size${variations > 1 ? ', and one for each further variation’s first card' : ''}.` : variations > 1 ? 'One credit for each variation at each size.' : 'One credit for each size.'}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {sizes.map(p => {
                      const on = value.placements.includes(p.id)
                      return (
                        <button key={p.id} type="button" aria-pressed={on} title={p.where} onClick={() => toggle(p.id)}
                          className={cn('flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg', on ? 'border-bk-fg bg-bk-fg text-bk-bg' : 'border-bk-field text-bk-fg can-hover:border-bk-fg/40')}>
                          <span className="flex size-6 shrink-0 items-center justify-center"><RatioShape placement={p} /></span>
                          <span className="min-w-0 leading-tight"><span className="block text-[13.5px] font-bold tabular-nums">{p.ratio}</span><span className={cn('block truncate text-[12px]', on ? 'text-bk-bg/70' : 'text-bk-muted')}>{p.label}</span></span>
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
                <dl className="grid gap-x-6 gap-y-2.5 rounded-xl bg-bk-alt p-4 text-[13px] sm:grid-cols-[120px_minmax(0,1fr)]">
                  <dt className="text-bk-muted">Promotes</dt><dd className="line-clamp-2 font-semibold">{value.offer.trim() || '—'}</dd>
                  <dt className="text-bk-muted">Design</dt><dd className="font-semibold">{value.designId === 'auto' ? 'Auto' : design?.design.name || 'Chosen design'}</dd>
                  <dt className="text-bk-muted">Goal</dt><dd className="font-semibold">{objectiveById(value.objective).label} · “{value.cta}” button</dd>
                  <dt className="text-bk-muted">Format</dt><dd className="font-semibold">{formatName(value)}</dd>
                  <dt className="text-bk-muted">Variations</dt><dd className="font-semibold">{variations === 1 ? 'The ad alone' : `${variations}, each with its own hook and picture`}</dd>
                  <dt className="text-bk-muted">Sizes</dt><dd className="font-semibold tabular-nums">{value.placements.map(id => placementById(id)?.ratio).join(' · ')}</dd>
                </dl>
                {error && (error.billing ? <UpgradeNotice error={error} /> : <Notice tone="error">{error.message}</Notice>)}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-bk-line px-5 py-4 sm:px-6">
            <p className="text-[12.5px] text-bk-muted">
              {last
                ? waiting ? 'One ad at a time: this one can start when the ad being made is ready.' : `${creditSum(value, variations)}${credits} credit${credits === 1 ? '' : 's'}${creditsLeft != null ? ` · ${creditsLeft} left` : ''}`
                : `Step ${step + 1} of ${STEPS.length}`}
            </p>
            <div className="flex gap-2">
              {step > 0 && <button type="button" onClick={() => setStep(step - 1)} className={appButton('outline', 'md')}><ArrowLeft className="size-3.5" />Back</button>}
              <button type="submit" disabled={!ready || (last && waiting)} className={appButton('primary', 'md')}>{last ? 'Create ad' : 'Next'}<ArrowRight className="size-3.5" /></button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The ad being made, across the top of the ads: a placeholder where its image will be, its brief and the three steps. */
function BuildProgress({ building }) {
  const at = ['copy', 'visuals', 'build'].indexOf(building.stage)
  const steps = ['content', 'visuals', 'build'].map((key, i) => ({ key, state: i < at ? 'done' : i === at ? 'active' : 'pending' }))
  const sizes = building.brief.placements.map(id => placementById(id)?.ratio).join(' · ')
  return (
    <section aria-labelledby="building-title" className={cn(panelClass, 'flex items-center gap-5 p-4 motion-safe:animate-bk-page sm:p-5')}>
      <div aria-hidden="true" className="flex aspect-[4/5] w-16 shrink-0 items-center justify-center rounded-lg bg-bk-alt motion-safe:animate-pulse sm:w-20"><Loader2 className="size-5 animate-spin text-bk-muted" /></div>
      <div className="min-w-0 flex-1" aria-live="polite">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#9A6B00] dark:text-bk-butter">Making your ad</p>
        <h2 id="building-title" className="mt-1 line-clamp-2 font-bk-display text-[17px] font-bold leading-tight tracking-[-0.02em]">{building.brief.offer}</h2>
        <p className="mt-1 text-[12.5px] text-bk-muted">{objectiveById(building.brief.objective).label} · {formatName(building.brief)}{building.brief.variations > 1 ? ` · ${building.brief.variations} variations` : ''} · {sizes} · {isCarousel(building.brief) || building.brief.variations > 1 ? 'a minute or two' : 'about a minute'}; it opens here when it’s ready</p>
        <StageBar steps={steps} className="mt-3 max-w-[560px]" />
      </div>
    </section>
  )
}

/** The brand's ads as a wall of their images, newest first. Each opens on its own page. */
function AdGrid({ ads, onOpen }) {
  return (
    <section aria-labelledby="ads-grid-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="ads-grid-title" className="text-[15px] font-bold">Your ads</h2>
        <span className="text-[12.5px] tabular-nums text-bk-muted">{ads.length}</span>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {ads.map(ad => (
          <li key={ad.id} className="min-w-0">
            <button type="button" onClick={() => onOpen(ad.id)} className={cn(panelClass, 'group block w-full overflow-hidden text-left transition-shadow can-hover:shadow-bk-pop focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg')}>
              <span className="relative block">
                {ad.canvases[0]?.canvas ? <PostThumb canvas={ad.canvases[0].canvas} className="rounded-none" /> : <span className="block aspect-[4/5] bg-bk-chip" />}
                {isCarousel(ad.brief) && <span title={formatName(ad.brief)} className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[11.5px] font-bold tabular-nums text-white"><GalleryHorizontalEnd className="size-3.5" aria-hidden="true" /><span className="sr-only">Carousel of </span>{ad.brief.cards}<span className="sr-only"> cards</span></span>}
                {variationCount(ad) > 1 && <span className="absolute left-2 top-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[11.5px] font-bold text-white">{variationCount(ad)} variations</span>}
              </span>
              <span className="block space-y-2 p-3.5">
                <span className="line-clamp-2 text-[14px] font-semibold leading-snug">{ad.brief?.offer}</span>
                <span className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 rounded-md bg-bk-chip px-1.5 py-0.5 text-[11.5px] font-bold">{objectiveById(ad.brief?.objective).label}</span>
                    <span className="flex items-center gap-1 text-bk-muted" title={ratios(ad)} aria-label={`Sizes: ${ratios(ad)}`}>
                      {placementsOf(ad).map(placementById).filter(Boolean).map(p => <span key={p.id} className="flex size-4 items-center justify-center [&>span]:scale-[0.7]"><RatioShape placement={p} /></span>)}
                    </span>
                  </span>
                  <span className="shrink-0 text-[12px] text-bk-muted">{madeOn(ad.createdAt)}</span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The text that goes into Ads Manager, editable within Meta's limits; the preview beside it follows what is picked. A
 * carousel has a headline and description per card instead of headlines to test.
 */
function CopyEditor({ draft, setDraft, version, setVersion, headline, setHeadline, card, setCard, onSave, saving, dirty, className = '' }) {
  // Someone who can only view the brand reads and copies the text; changing it is for editors.
  const { canEdit } = useBrandAccess()
  const primary = draft.primaryText[version] || ''
  const firstLine = primary.split('\n')[0]
  const setPrimary = value => setDraft({ ...draft, primaryText: draft.primaryText.map((t, i) => (i === version ? value : t)) })
  const setCardText = (index, key, value) => setDraft({ ...draft, cards: draft.cards.map((c, i) => (i === index ? { ...c, [key]: value } : c)) })
  const button = (
    <div>
      <p className={label}>Button</p>
      <select aria-label="Button" value={draft.cta} disabled={!canEdit} onChange={e => setDraft({ ...draft, cta: e.target.value })} className={appField('mt-2 h-10 text-[14px]')}>{META_CTAS.map(c => <option key={c} value={c}>{c}</option>)}</select>
    </div>
  )
  return (
    <section aria-labelledby="ad-text-title" className={cn('min-w-0', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="ad-text-title" className="font-bk-display text-[17px] font-bold tracking-[-0.02em]">Text for Ads Manager</h3>
          <p className="mt-0.5 text-[13px] text-bk-muted">{draft.cards ? 'Three versions of the primary text to test, and a headline under each card.' : 'Three versions to test against each other.'}</p>
        </div>
        {dirty && canEdit && <button type="button" onClick={onSave} disabled={saving} className={appButton('primary', 'sm')}>{saving && <Loader2 className="size-3.5 animate-spin" />}Save changes</button>}
      </div>

      <div className="mt-5">
        <p className={label}>Primary text</p>
        <SegmentedTabs className="mt-2 w-fit" label="Primary text version" value={version} onChange={setVersion} items={draft.primaryText.map((_, i) => [i, AD_ANGLES[i]?.label || `Version ${i + 1}`])} />
        <div className="mt-2 rounded-xl border border-bk-field bg-bk-surface focus-within:border-bk-fg">
          <textarea aria-label="Primary text" rows={6} value={primary} onChange={e => setPrimary(e.target.value)} readOnly={!canEdit} className="block w-full resize-y rounded-xl bg-transparent px-3.5 py-3 text-[14px] leading-relaxed outline-none" />
          <div className="flex items-center justify-between gap-2 border-t border-bk-line px-3.5 py-1.5">
            <span className={cn('text-[11.5px]', firstLine.length > AD_TEXT_LIMITS.primaryText ? 'font-bold text-[#9A6B00] dark:text-[#F2C14E]' : 'text-bk-muted')}>
              {firstLine.length > AD_TEXT_LIMITS.primaryText ? `The first line is cut after ${AD_TEXT_LIMITS.primaryText} characters` : `The first ${AD_TEXT_LIMITS.primaryText} characters show before “See more”`}
            </span>
            <span className="flex items-center gap-1"><Count value={primary} max={AD_TEXT_LIMITS.primaryTextMax} /><CopyButton value={primary} /></span>
          </div>
        </div>
      </div>

      {draft.cards ? <>
        <div className="mt-5">
          <p className={label}>Cards <span className="font-semibold normal-case tracking-normal">· a headline and a description under each; pick a card to preview it</span></p>
          <ol className="mt-2 divide-y divide-bk-line overflow-hidden rounded-xl border border-bk-field">
            {draft.cards.map((c, i) => (
              <li key={i} className={cn('px-3 py-1.5', card === i && 'bg-bk-butter/10')}>
                <div className="flex items-center gap-2.5">
                  <button type="button" onClick={() => setCard(i)} aria-pressed={card === i} aria-label={`Preview card ${i + 1}`}
                    className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg', card === i ? 'bg-bk-fg text-bk-bg' : 'border border-bk-field can-hover:border-bk-fg/50')}>{i + 1}</button>
                  <input aria-label={`Card ${i + 1} headline`} placeholder="Headline" value={c.headline} readOnly={!canEdit} onFocus={() => setCard(i)} onChange={e => setCardText(i, 'headline', e.target.value)} className="h-9 min-w-0 flex-1 bg-transparent text-[14px] font-semibold outline-none" />
                  <Count value={c.headline} visible={AD_TEXT_LIMITS.headlineVisible} max={AD_TEXT_LIMITS.headline} />
                  <CopyButton value={c.headline} />
                </div>
                <div className="flex items-center gap-2.5 pl-[34px]">
                  <input aria-label={`Card ${i + 1} description`} placeholder={canEdit ? 'Description (optional)' : ''} value={c.description} readOnly={!canEdit} onFocus={() => setCard(i)} onChange={e => setCardText(i, 'description', e.target.value)} className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-bk-fg/80 outline-none" />
                  <Count value={c.description} max={AD_TEXT_LIMITS.cardDescription} />
                  <CopyButton value={c.description} />
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="mt-5 sm:max-w-[240px]">{button}</div>
      </> : <>
      <div className="mt-5">
        <p className={label}>Headline <span className="font-semibold normal-case tracking-normal">· pick the one to preview; the feed shows about {AD_TEXT_LIMITS.headlineVisible} characters</span></p>
        <ul className="mt-2 divide-y divide-bk-line overflow-hidden rounded-xl border border-bk-field">
          {draft.headlines.map((h, i) => (
            <li key={i} className={cn('flex items-center gap-2.5 px-3 py-1', headline === i && 'bg-bk-butter/10')}>
              <input type="radio" name="ad-headline" aria-label={`Preview headline ${i + 1}`} checked={headline === i} onChange={() => setHeadline(i)} className="accent-current" />
              <input aria-label={`Headline ${i + 1}`} value={h} readOnly={!canEdit} onChange={e => setDraft({ ...draft, headlines: draft.headlines.map((t, j) => (j === i ? e.target.value : t)) })} className="h-9 min-w-0 flex-1 bg-transparent text-[14px] font-semibold outline-none" />
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
            <input aria-label="Description" value={draft.description} readOnly={!canEdit} onChange={e => setDraft({ ...draft, description: e.target.value })} className="h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none" />
            <Count value={draft.description} max={AD_TEXT_LIMITS.description} />
            <CopyButton value={draft.description} />
          </div>
        </div>
        {button}
      </div>
      </>}
    </section>
  )
}

/**
 * One ad to review and finish: what it promotes and the downloads on top; below, the ad as people will see it in each
 * placement beside its text for Ads Manager, so every edit shows at once.
 */
function AdWorkspace({ ad, brand, website, draft, setDraft, view, setView, version, setVersion, headline, setHeadline, card, setCard, dirty, saving, onSave, busy, error, onDownload, onDownloadSize, onDelete }) {
  // Variation A is the ad itself; each further one has its own hook and picture at the same sizes.
  const count = variationCount(ad)
  const variation = Math.min(view.variation || 1, count)
  const ofVariation = ad.canvases.filter(c => variationOf(c) === variation)
  const shown = ofVariation.length ? ofVariation : ad.canvases
  const size = shown.find(c => c.placement === view.placement) || shown[0]
  const placement = size?.placement
  const feed = placement === 'feed-portrait' || placement === 'feed-square'
  const { canEdit } = useBrandAccess()
  const carousel = isCarousel(ad.brief)
  const onImage = ad.variations?.[variation - 1]?.creative || ad.creative
  const named = f => `${placementById(f.placement)?.label}${count > 1 ? ` (${letter(f.variation)})` : ''}`
  // An image that could not be made gave back its credits: the ad's own one per card, a further variation's one.
  const returned = (ad.failed || []).reduce((n, f) => n + (variationOf(f) === 1 && carousel ? ad.brief.cards : 1), 0)
  const asked = ad.variationsAsked || 1
  return (
    <article id="ad-workspace" aria-labelledby="ad-title" className={cn(panelClass, 'scroll-mt-6 overflow-hidden motion-safe:animate-bk-page')}>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-bk-line p-5 sm:px-6">
        <div className="min-w-0 max-w-[620px]">
          <p className="text-[12px] font-semibold text-bk-muted">{[objectiveById(ad.brief?.objective).label, carousel && formatName(ad.brief), ratios(ad), shortDate(ad.createdAt)].filter(Boolean).join(' · ')}</p>
          <h2 id="ad-title" className="mt-1 line-clamp-2 font-bk-display text-[20px] font-bold leading-tight tracking-[-0.02em]">{ad.brief?.offer}</h2>
          {onImage?.headline && <p className="mt-1 line-clamp-1 text-[13px] text-bk-muted">On the image{count > 1 ? ` (${letter(variation)})` : ''}: <span className="italic">“{onImage.headline}”</span></p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={!!busy || !ad.canvases.length} onClick={onDownload} className={appButton('primary', 'md')}>{busy === 'zip' ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}Download all</button>
          <CopyButton value={adText(ad, draft)} variant="outline" size="md">Copy text</CopyButton>
          {canEdit && <button type="button" onClick={onDelete} aria-label="Delete ad" title="Delete ad" className={appButton('outline', 'md', 'w-9 px-0')}><Trash2 className="size-4" /></button>}
        </div>
      </header>
      {(error || ad.failed?.length > 0 || asked > count) && (
        <div className="space-y-2 px-5 pt-4 sm:px-6">
          {error && <Notice tone="error">{error.message}</Notice>}
          {asked > count && <Notice>{count} of the {asked} variations asked for could be written within Meta’s rules and the facts in your profile, so the ad has {count === 1 ? 'just the one' : count}. You were only charged for {count === 1 ? 'it' : 'those'}.</Notice>}
          {ad.failed?.length > 0 && <Notice>{ad.failed.map(named).join(', ')}: the words did not fit, so {ad.failed.length === 1 ? 'that size was' : 'those sizes were'} left out, and {returned === 1 ? 'its credit was' : `${returned} credits were`} given back.</Notice>}
        </div>
      )}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-label="Preview" className="border-b border-bk-line bg-bk-alt/50 p-5 sm:p-6 xl:border-b-0 xl:border-r">
          <div className="xl:sticky xl:top-6">
            {count > 1 && (
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className={label}>Variation</span>
                <SegmentedTabs label="Variation" value={variation} onChange={v => setView({ ...view, variation: v })} items={Array.from({ length: count }, (_, i) => [i + 1, letter(i + 1)])} />
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SegmentedTabs label="Size" value={placement} onChange={p => setView({ ...view, placement: p })} items={shown.map(c => [c.placement, placementById(c.placement)?.ratio])} />
              {feed && <SegmentedTabs label="Show on" value={view.network} onChange={network => setView({ ...view, network })} items={[['facebook', 'Facebook'], ['instagram', 'Instagram']]} />}
            </div>
            <p className="mt-2 text-[12px] text-bk-muted">{placementById(placement)?.where}.</p>
            <div className="mt-4 flex justify-center">
              {size?.canvas ? (
                <div className={cn('w-full', placement === 'story' ? 'max-w-[260px]' : 'max-w-[380px]')}>
                  <AdPreview placement={placement} network={view.network} safe={view.safe} brand={brand} canvas={size.canvas}
                    primary={draft.primaryText[version] || ''} headline={draft.headlines?.[headline] || ''} description={draft.description || ''} cta={draft.cta} link={ad.brief?.url || website}
                    cards={draft.cards || null} card={card} onCard={setCard} />
                </div>
              ) : (
                // Its images were deleted (from the Gallery or the editor): the text is still here to copy.
                <p className="max-w-[280px] rounded-xl border border-dashed border-bk-field px-5 py-8 text-center text-[13px] leading-relaxed text-bk-muted">This ad’s images were deleted. Its text is still here; make the ad again for new images.</p>
              )}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {size && canEdit && <Link href={carousel && card > 0 ? `/editor/${size.canvasId}?slide=${card + 1}` : `/editor/${size.canvasId}`} className={appButton('outline', 'sm')}><PencilLine className="size-3.5" />{carousel ? `Edit card ${card + 1}` : 'Edit image'}</Link>}
              {size && <button type="button" disabled={!!busy} onClick={() => onDownloadSize(size)} className={appButton('outline', 'sm')}>{busy === 'png' ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}This size</button>}
              {placement === 'story' && (
                <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-bk-fg/80">
                  <input type="checkbox" checked={view.safe} onChange={e => setView({ ...view, safe: e.target.checked })} className="accent-[#E2A100]" />Show where Meta covers the image
                </label>
              )}
            </div>
          </div>
        </section>
        <CopyEditor className="p-5 sm:p-6" draft={draft} setDraft={setDraft} version={version} setVersion={setVersion} headline={headline} setHeadline={setHeadline} card={card} setCard={setCard} onSave={onSave} saving={saving} dirty={dirty} />
      </div>
    </article>
  )
}

/**
 * Facebook and Instagram ads for a brand (Pro and Business), one screen at a time: the brand's ads as a wall of their images
 * (with the ad being made across the top), one ad on its own page (its preview in each placement beside its text), or a
 * new ad's brief. Nothing is published: people download the images and paste the text into Meta's Ads Manager.
 */
export default function AdsPage({ flowId, brandName, brandLogo = '', website = '', brandContext = null }) {
  const popup = usePopup()
  const { data: billing } = useBilling()
  const { canEdit, owner } = useBrandAccess()
  const [ads, setAds] = useState(null), [loadError, setLoadError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  // `screen`: the ads ('library', with the ad being made on top) or one ad ('ad'). A new ad's brief is a popup over them.
  const [screen, setScreen] = useState('library'), [composing, setComposing] = useState(false)
  const [brief, setBrief] = useState(EMPTY_BRIEF)
  const [view, setView] = useState({ placement: 'feed-portrait', network: 'facebook', safe: false, variation: 1 })
  const [version, setVersion] = useState(0), [headline, setHeadline] = useState(0), [card, setCard] = useState(0)
  const [draft, setDraft] = useState(null), [saving, setSaving] = useState(false)
  const [building, setBuilding] = useState(null), [createError, setCreateError] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState('')
  const screenRef = useRef(screen)
  useEffect(() => { screenRef.current = screen }, [screen])
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
    } catch (e) { setLoadError(e.message); setAds([]) }
  }, [flowId])
  useEffect(() => { load() }, [load])

  const ad = useMemo(() => ads?.find(a => a.id === selectedId) || null, [ads, selectedId])
  // A fresh draft of the text for each ad, so edits never leak between ads.
  useEffect(() => {
    if (!ad) { setDraft(null); return }
    setDraft(draftOf(ad.copy))
    setVersion(0); setHeadline(0); setCard(0); setError(null)
    // Each ad opens on its own image (variation A), at the size shown before when it has one.
    setView(v => ({ ...v, variation: 1, ...(ad.canvases.some(c => c.placement === v.placement) ? {} : { placement: ad.canvases[0]?.placement || 'feed-portrait' }) }))
  }, [ad?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = Boolean(ad && draft && (draft.cards ? ['primaryText', 'cards', 'cta'] : ['primaryText', 'headlines', 'description', 'cta']).some(k => JSON.stringify(draft[k]) !== JSON.stringify(draftOf(ad.copy)[k])))

  // Leaving an ad with unsaved text asks first.
  const leave = async () => !dirty || screen !== 'ad' || popup.confirm({ title: 'Discard your changes?', description: 'The edits to this ad’s text are not saved.', confirmLabel: 'Discard' })
  const show = async next => {
    if (!(await leave())) return
    next()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const open = id => show(() => { setSelectedId(id); setScreen('ad') })

  const create = async value => {
    setCreateError(null)
    setBuilding({ brief: value, stage: 'copy' }); setComposing(false); setScreen('library')
    let planned = null
    try {
      planned = await postJson('/api/ads/plan', { flowId, brief: value })
      creditsChanged()
      let resolved = skippedVisuals(planned.plan)
      if (planned.needsVisuals) {
        setBuilding({ brief: value, stage: 'visuals' })
        resolved = await postJson('/api/resolve-assets', { plan: planned.plan, brand_id: `brand_${flowId}`, chargeRef: planned.chargeRef })
      }
      setBuilding({ brief: value, stage: 'build' })
      const built = await postJson('/api/ads/build', { flowId, brief: planned.brief, ad: planned.ad, copy: planned.copy, resolvedPlan: resolved, chargeRef: planned.chargeRef, variationsAsked: planned.variationsAsked })
      setAds(prev => [built.ad, ...(prev || [])])
      setBrief(EMPTY_BRIEF)
      // The new ad opens when its progress is on screen; otherwise it waits first among the ads.
      if (screenRef.current === 'library') {
        setSelectedId(built.ad.id); setScreen('ad')
        setView(v => ({ ...v, variation: 1, placement: built.ad.canvases[0]?.placement || 'feed-portrait' }))
      }
    } catch (err) {
      // Past the plan, the ad's credits come back: nothing is charged for an ad that was not made.
      if (planned?.chargeRef) await giveCreditsBack(err, planned.chargeRef, { flowId, credits: planned.credits?.charged })
      // The brief stays as it was, with what went wrong, to try again.
      setCreateError(err); setComposing(true)
    } finally { setBuilding(null); creditsChanged() }
  }

  const saveCopy = async () => {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/ads/${ad.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ copy: draft }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw apiError(data, res.status)
      setAds(prev => prev.map(a => (a.id === ad.id ? { ...a, copy: data.copy } : a)))
      setDraft(draftOf(data.copy))
    } catch (e) { setError(e) } finally { setSaving(false) }
  }

  const remove = async () => {
    if (!(await popup.confirm({ title: 'Delete this ad?', description: 'Its images and text are deleted. Ads already running in Meta are not affected.', tone: 'danger', confirmLabel: 'Delete ad' }))) return
    try {
      const res = await fetch(`/api/ads/${ad.id}`, { method: 'DELETE' })
      if (!res.ok) throw apiError(await res.json().catch(() => ({})), res.status)
      const rest = ads.filter(a => a.id !== ad.id)
      setAds(rest); setSelectedId(null)
      setScreen('library')
    } catch (e) { setError(e) }
  }

  const run = async (key, task) => { setBusy(key); setError(null); try { await task() } catch (e) { setError(e) } finally { setBusy('') } }
  const showing = screen === 'ad' && ad && draft ? 'ad' : 'library'
  const startAd = () => show(() => { setCreateError(null); setComposing(true) })
  const back = <button type="button" onClick={() => show(() => setScreen('library'))} className={appButton('quiet', 'sm', '-ml-3 text-bk-muted')}><ArrowLeft className="size-4" />All ads</button>

  return (
    <div className={pageShell}>
      <div className={pageInner}>
        <PageHeader
          eyebrow={`${brandName} · Ads`} title="Ads" description="Facebook and Instagram ads in your brand’s design, ready for Ads Manager."
          actions={allowed && canEdit && ads?.length ? <button type="button" onClick={startAd} className={appButton('primary', 'md')}><Plus className="size-4" />New ad</button> : null}
        />

        {allowed === false && <UpgradeNotice error={ADS_UPGRADE} className="mt-6" />}
        {loadError && <Notice tone="error" className="mt-6">{loadError}</Notice>}

        {allowed && (ads === null ? (
          <div role="status" aria-label="Loading your ads" className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map(i => <div key={i} className={cn(panelClass, 'aspect-[4/5.6] motion-safe:animate-pulse')} />)}
          </div>
        ) : showing === 'ad' ? (
          <div className="mt-6 space-y-3">
            {back}
            <AdWorkspace
              ad={ad} brand={brand} website={website} draft={draft} setDraft={setDraft} view={view} setView={setView}
              version={Math.max(0, Math.min(version, draft.primaryText.length - 1))} setVersion={setVersion} headline={Math.max(0, Math.min(headline, (draft.headlines?.length || 1) - 1))} setHeadline={setHeadline}
              card={Math.max(0, Math.min(card, (draft.cards?.length || 1) - 1))} setCard={setCard}
              dirty={dirty} saving={saving} onSave={saveCopy} busy={busy} error={error}
              onDownload={() => run('zip', () => downloadZip(ad, draft))}
              onDownloadSize={s => run('png', () => downloadSize(ad, s))}
              onDelete={remove}
            />
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            {building && <BuildProgress building={building} />}
            {ads.length > 0 ? <AdGrid ads={ads} onOpen={open} /> : !building && (
              <EmptyState icon={Megaphone} title="No ads yet" action={canEdit ? <button type="button" onClick={startAd} className={appButton('primary', 'md')}><Plus className="size-4" />New ad</button> : null}>
                {canEdit ? 'Say what to promote, pick a design and the sizes. Batkle writes the text and makes the image, ready for Ads Manager.' : `Ask ${owner} for the Editor role to make ads for this brand.`}
              </EmptyState>
            )}
          </div>
        ))}

        {canEdit && (
          <NewAdDialog open={composing} onOpenChange={setComposing} flowId={flowId} brand={brandContext} value={brief} onChange={setBrief} onCreate={create}
            error={createError} creditsLeft={creditsLeft} waiting={Boolean(building)}
            variationsMax={billing?.summary?.adVariations ?? 1} planName={billing?.summary?.planName || ''} />
        )}
      </div>
    </div>
  )
}
