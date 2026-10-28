'use client'
import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Copy, Globe, Loader2, Pencil, Pipette, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import ColorPriority, { reorderColors } from '@/components/ColorPriority'
import { BookSection, EmptyHint, GrowingTextarea, ListEditor, paragraphsOf } from '@/components/brand/ProfileBlocks'
import { Popup } from '@/components/app/popup'
import { appField } from '@/components/app/field'
import { BrandTile, Eyebrow, Notice, appButton, brandLogo, pageShell, panelClass } from '@/components/app/ui'
import UpgradeNotice from '@/components/app/billing/UpgradeNotice'
import { useBilling } from '@/components/app/billing/useBilling'
import { useBrandAccess } from '@/components/app/AppShell'
import { apiError, isBillingCode } from '@/lib/client/billing'
import { loadEnglishProfile } from '@/lib/client/englishProfile'
import { cn } from '@/lib/utils'

const sectionLoading = () => <div role="status" className="h-40 rounded-2xl bg-bk-surface motion-safe:animate-pulse" aria-label="Loading" />
const BrandDesignStudio = dynamic(() => import('@/components/BrandDesignStudio'), { loading: sectionLoading })
const LogoInput = dynamic(() => import('@/components/brand/LogoInput'), { loading: sectionLoading })
const BrandPosts = dynamic(() => import('@/components/brand/BrandPosts'), { loading: sectionLoading })
const RereadReview = dynamic(() => import('@/components/brand/RereadReview'))

function normalizeBrand(bc) {
  if (!bc || !(bc.name || bc.about || bc.colors?.length || bc.fonts?.length)) return null
  return { ...bc, name: bc.name || '', about: bc.about || '', logo: bc.logo || '', logoVariants: bc.logoVariants || null, language: bc.language || '', colors: bc.colors || [], fonts: bc.fonts || [] }
}

// Designs and the brand's own posts are saved the moment they change, and logo versions are made by themselves from
// the logo (again later if they aren't saved), so none of them counts as an unsaved change.
const snapshot = data => (data ? JSON.stringify({ ...data, designs: undefined, designLibraryVersion: undefined, logoVariants: undefined, postExamples: undefined }) : '')

// "Inter-Bold" → "Inter": the family name Google Fonts knows.
const normalizeFontName = fontName => (fontName ? fontName.replace(/-?(Thin|ExtraLight|Light|Regular|Medium|SemiBold|Bold|ExtraBold|Black)/gi, '').replace(/-?(Italic|Oblique)/gi, '').trim() : '')
const listOf = value => (Array.isArray(value) ? value : String(value || '').split('\n').filter(Boolean))
const filled = value => listOf(value).some(item => String(item).trim())
const isHex = value => /^#([a-f\d]{6}|[a-f\d]{3})$/i.test(value || '')
const fullHex = value => { const hex = isHex(value) ? value.slice(1) : 'ffffff'; return hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex }
const luminance = value => {
  const hex = fullHex(value)
  const [r, g, b] = [0, 2, 4].map(o => parseInt(hex.slice(o, o + 2), 16) / 255).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return r * 0.2126 + g * 0.7152 + b * 0.0722
}
/** The website a profile was read from, or ''. */
const websiteOf = data => data?.website || data?.researchSources?.[0]?.url || ''
const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

// "Social Media Management — Content creation…" → name and description.
const splitService = item => { const match = item.match(/^(.{3,100}?)\s+[—–]\s+([\s\S]+)$/); return match ? [match[1], match[2]] : [null, item] }

const GROUPS = [
  ['The business', ['about', 'services', 'projects']],
  ['Audience & voice', ['audience', 'voice', 'posts', 'apart']],
  ['What posts say', ['ctas', 'topics']],
  ['How posts look', ['logo', 'colours', 'type', 'designs']],
]
const TITLES = {
  about: 'About the business', services: 'Services & products', projects: 'Projects & work', audience: 'Ideal customers', voice: 'Voice & tone', posts: 'Your posts',
  apart: 'What sets you apart', ctas: 'Calls to action', topics: 'Content opportunities', logo: 'Logo', colours: 'Colours', type: 'Typography', designs: 'Post designs & language',
}
const ORDER = GROUPS.flatMap(([, ids]) => ids)
const proTag = 'shrink-0 rounded-full bg-bk-butter/60 px-1.5 py-px text-[10px] font-bold leading-4 text-bk-ink'

export default function BrandInfo({ flowId, initialBrandContext, onFlowCreated }) {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [translationError, setTranslationError] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [extractedData, setExtractedData] = useState(() => normalizeBrand(initialBrandContext))
  const [saved, setSaved] = useState(() => snapshot(normalizeBrand(initialBrandContext)))
  const [profileLoading, setProfileLoading] = useState(initialBrandContext === undefined && !!flowId)
  const [loadedFonts, setLoadedFonts] = useState(new Set())
  const [fontLoadingErrors, setFontLoadingErrors] = useState(new Set())
  const [editing, setEditing] = useState({})
  const [aboutExpanded, setAboutExpanded] = useState(false)
  const [activeId, setActiveId] = useState(ORDER[0])
  // A plan limit that stopped saving a new brand (the plan's brand limit), shown with the way to upgrade.
  const [limit, setLimit] = useState(null)
  // The website read again, waiting for the person to choose what to update: { next, pages }.
  const [review, setReview] = useState(null)
  // Your posts is part of Pro and Business: null while the plan loads. If the plan can't be read, the section opens
  // and the server, which checks the plan on every save, answers with the upgrade when needed.
  const { data: billing, error: billingError } = useBilling()
  const postVoice = billing ? Boolean(billing.summary?.features?.postVoice) : billingError ? true : null
  const dirty = useMemo(() => !!extractedData && snapshot(extractedData) !== saved, [extractedData, saved])
  // In a brand shared with this person, the profile is the owner's and its admins' to change: everyone else reads it.
  const { canManage, owner } = useBrandAccess()

  // Server-provided data avoids a second request after hydration.
  useEffect(() => {
    if (!flowId) return
    let active = true
    setTranslationError('')
    setTranslating(false)
    setProfileLoading(initialBrandContext === undefined)
    const load = async () => {
      try {
        let bc = initialBrandContext
        if (bc === undefined) {
          setExtractedData(null)
          const response = await fetch(`/api/flows/${flowId}`)
          if (!response.ok) throw new Error('The brand could not be loaded. Reload the page to try again.')
          bc = (await response.json()).brandContext
        }
        if (!active) return
        const displayed = normalizeBrand(bc)
        setExtractedData(displayed)
        setSaved(snapshot(displayed))
        setProfileLoading(false)
        if (bc?.about && bc.profileLanguage !== 'en') {
          setTranslating(true)
          const translated = normalizeBrand(await loadEnglishProfile(flowId, bc))
          // Never overwrite edits made while the English profile was loading.
          if (active) setExtractedData(current => {
            if (current !== displayed) return current
            setSaved(snapshot(translated))
            return translated
          })
        }
      } catch (error) {
        if (active) setTranslationError(error.message)
      } finally {
        if (active) { setProfileLoading(false); setTranslating(false) }
      }
    }
    load()
    return () => { active = false }
  }, [flowId, initialBrandContext])

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return
    const warn = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const loadGoogleFont = (fontName) => {
    const family = normalizeFontName(fontName)
    if (!family || loadedFonts.has(family) || fontLoadingErrors.has(family)) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@300;400;500;600;700&display=swap`
    const timeoutId = setTimeout(() => setLoadedFonts(prev => new Set([...prev, family])), 2000)
    link.onload = () => { clearTimeout(timeoutId); setLoadedFonts(prev => new Set([...prev, family])) }
    link.onerror = () => {
      clearTimeout(timeoutId)
      setFontLoadingErrors(prev => new Set([...prev, family]))
      setLoadedFonts(prev => new Set([...prev, family]))
    }
    document.head.appendChild(link)
  }

  // The cover and the type specimens use the brand's own fonts.
  useEffect(() => { extractedData?.fonts?.forEach(font => { if (font) loadGoogleFont(font) }) }, [extractedData?.fonts]) // eslint-disable-line react-hooks/exhaustive-deps

  // The contents list follows the chapter being read.
  useEffect(() => {
    if (!extractedData || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible[0]) setActiveId(visible[0].target.id.replace('book-', ''))
    }, { rootMargin: '-15% 0px -70% 0px' })
    ORDER.forEach(id => { const el = document.getElementById(`book-${id}`); if (el) observer.observe(el) })
    return () => observer.disconnect()
  }, [!!extractedData]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleExtract = async () => {
    if (!url.trim()) { toast.error('Enter your website address'); return }
    // A brand with a profile only previews the website: the person then confirms what to update (RereadReview).
    const preview = Boolean(flowId && extractedData)
    setLoading(true)
    try {
      const response = await fetch('/api/extract-business-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), flowId, ...(preview ? { preview: true } : {}) }),
      })
      if (!response.ok) throw apiError(await response.json().catch(() => ({})), response.status, 'The website could not be read')
      const data = await response.json()
      if (data.logoVariantsError) toast.warning(data.logoVariantsError)
      if (data.preview) {
        setImportOpen(false)
        setReview({ next: data.brandContext, pages: data.pagesAnalyzed })
        return
      }
      const next = {
        ...data.flow?.brandContext,
        name: data.name || '',
        about: data.about || '',
        language: data.language || 'unknown',
        logo: data.logo || '',
        logoVariants: data.logoVariants || null,
        colors: data.designSystem?.colors || [],
        fonts: data.designSystem?.fonts || [],
      }
      setExtractedData(next)
      setSaved(snapshot(next))
      onFlowCreated?.(data.flow)
      setImportOpen(false)
      router.refresh()
      toast.success(`Brand updated from ${data.pagesAnalyzed} ${data.pagesAnalyzed === 1 ? 'page' : 'pages'}.`)
    } catch (error) {
      if (isBillingCode(error.code)) { setLimit(error); setImportOpen(false) }
      else toast.error(error.message || 'The website could not be read')
    } finally {
      setLoading(false)
    }
  }

  const change = (field, value) => setExtractedData(prev => ({ ...prev, [field]: value }))
  const handleColorChange = (index, value) => setExtractedData(prev => ({ ...prev, colors: prev.colors.map((c, i) => (i === index ? value : c)) }))
  const addColor = () => setExtractedData(prev => ({ ...prev, colors: [...prev.colors, '#000000'] }))
  const removeColor = index => setExtractedData(prev => ({ ...prev, colors: prev.colors.filter((_, i) => i !== index) }))
  const handleFontChange = (index, value) => {
    setExtractedData(prev => ({ ...prev, fonts: prev.fonts.map((f, i) => (i === index ? value : f)) }))
    if (value) loadGoogleFont(value)
  }
  const addFont = () => setExtractedData(prev => ({ ...prev, fonts: [...prev.fonts, ''] }))
  const removeFont = index => setExtractedData(prev => ({ ...prev, fonts: prev.fonts.filter((_, i) => i !== index) }))
  // No Edit or Add buttons for someone who can't change the profile (BookSection and EmptyHint show them only with these).
  const toggle = id => (canManage ? () => setEditing(prev => ({ ...prev, [id]: !prev[id] })) : undefined)
  const startEditing = id => (canManage ? () => setEditing(prev => ({ ...prev, [id]: true })) : undefined)

  /** Saves `source` (the profile on screen unless given, such as the one confirmed after reading the website again). */
  const handleSave = async (source = extractedData) => {
    if (!source) return false
    // Projects added by hand and left blank are not kept.
    const profile = Array.isArray(source.projects) ? { ...source, projects: source.projects.filter(p => String(p?.name || '').trim() || String(p?.description || '').trim()) } : source
    setSaving(true)
    try {
      let targetFlowId = flowId
      // Without a brand yet, create one named after it.
      if (!targetFlowId) {
        const res = await fetch('/api/flows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: profile.name || `Brand ${Date.now()}` }),
        })
        if (!res.ok) throw apiError(await res.json().catch(() => ({})), res.status, 'The brand could not be created')
        const newFlow = await res.json()
        targetFlowId = newFlow.id
        onFlowCreated?.(newFlow)
      }
      const res = await fetch(`/api/flows/${targetFlowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandContext: {
            ...profile,
            logoVariants: profile.logoVariants?.source === profile.logo ? profile.logoVariants : null,
            designs: profile.designs || [],
          },
          ...(profile.name ? { name: profile.name } : {}),
        }),
      })
      if (!res.ok) throw new Error('Your changes could not be saved')
      onFlowCreated?.(await res.json())
      setExtractedData(profile)
      setSaved(snapshot(profile))
      setEditing({})
      // The sidebar shows the brand name and logo from the server.
      router.refresh()
      toast.success('Brand profile saved')
      return true
    } catch (error) {
      if (isBillingCode(error.code)) setLimit(error)
      else toast.error(error.message || 'Your changes could not be saved')
      return false
    } finally {
      setSaving(false)
    }
  }

  const copyColor = async color => {
    try { await navigator.clipboard.writeText(color); toast.success(`Copied ${color}`) } catch { toast.error('Could not copy') }
  }

  const busy = saving || loading || translating
  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Eyebrow>{extractedData?.name || 'Your brand'} · Brand profile</Eyebrow>
      {extractedData && (canManage ? (
        <button type="button" onClick={() => handleSave()} disabled={busy || !dirty} className={appButton('primary', 'sm')}>
          {saving && <Loader2 className="size-4 animate-spin" />}{saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </button>
      ) : <p className="text-[12.5px] text-bk-muted">Only {owner} and the brand’s admins can change its profile.</p>)}
    </div>
  )

  const site = websiteOf(extractedData)
  const rereading = Boolean(flowId && extractedData)
  const openImport = () => { setUrl(current => current || site); setImportOpen(true) }
  // A profile filled in by hand: an empty one to start from, with the first chapter open.
  const startByHand = () => {
    setExtractedData({ name: '', about: '', logo: '', logoVariants: null, language: '', colors: [], fonts: [], designs: [] })
    setEditing({ about: true })
  }

  const importPopup = (
    <Popup
      open={importOpen}
      onOpenChange={open => !loading && setImportOpen(open)}
      title={rereading ? 'Read your website again' : 'Read your website'}
      description={rereading
        ? 'Batkle reads up to five pages, then shows you what it found. Nothing in your profile changes until you choose what to update.'
        : 'Batkle reads up to five pages and fills in your services, projects, voice, colours and fonts. You can change all of it afterwards.'}
      footer={<>
        <button type="button" onClick={() => setImportOpen(false)} disabled={loading} className={appButton('quiet', 'md')}>Cancel</button>
        <button type="button" onClick={handleExtract} disabled={loading} className={appButton('primary', 'md')}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}{loading ? 'Reading website…' : 'Read website'}
        </button>
      </>}
    >
      <div>
        <label htmlFor="import-website" className="text-[13px] font-bold">Website address</label>
        <input id="import-website" type="url" placeholder="https://your-business.com" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && !loading && handleExtract()} disabled={loading} autoFocus className={appField('mt-2')} />
        {loading && <p role="status" className="mt-3 text-[13px] text-bk-muted">Reading the relevant pages. This can take a minute.</p>}
      </div>
    </Popup>
  )

  // After the website is read again: confirm what to update, then save it.
  const reviewPopup = review && (
    <RereadReview
      open
      current={extractedData}
      next={review.next}
      pages={review.pages}
      applying={saving}
      onCancel={() => setReview(null)}
      onApply={async merged => {
        setExtractedData(merged)
        if (await handleSave(merged)) { setReview(null); router.refresh() }
      }}
    />
  )

  if (!extractedData) {
    return (
      <div className={pageShell}>
        <div className="mx-auto max-w-[1240px]">
          {toolbar}
          {profileLoading && <div role="status" aria-label="Loading brand profile" className="mt-6 h-64 rounded-[28px] bg-bk-surface motion-safe:animate-pulse" />}
          {translationError && <Notice tone="warning" className="mt-5">{translationError}</Notice>}
          <UpgradeNotice error={limit} className="mt-5" />
          {!profileLoading && (
            <div className="mt-6 overflow-hidden rounded-[28px] bg-bk-ink px-6 py-14 text-center text-bk-cream sm:px-10">
              <h1 className="font-bk-display text-[clamp(28px,4vw,44px)] font-bold tracking-[-0.04em]">Start your brand book</h1>
              <p className="mx-auto mt-2 max-w-[480px] text-[15px] text-bk-cream/75">Let Batkle read your website and fill it in, or write it yourself. Either way, you can change every chapter later.</p>
              <div className="mt-7 flex flex-wrap justify-center gap-3">
                <button type="button" onClick={openImport} className={appButton('primary', 'md', 'h-11 px-5')}><Globe className="size-4" />Read my website</button>
                <button type="button" onClick={startByHand} className={appButton('onDark', 'md', 'h-11 px-5')}><Pencil className="size-4" />Fill it in myself</button>
              </div>
              <p className="mt-4 text-[13px] text-bk-cream/60">No website? Fill it in yourself.</p>
            </div>
          )}
        </div>
        {importPopup}
      </div>
    )
  }

  const data = extractedData
  const services = listOf(data.services)
  const projects = Array.isArray(data.projects) ? data.projects : []
  const differentiators = listOf(data.differentiators)
  const ctas = listOf(data.suggestedCtas)
  const topics = listOf(data.contentTopics)
  const usesGlobalDesigns = (data.designs || []).some(d => d.source === 'global')
  const complete = {
    about: !!data.about.trim(), services: filled(data.services), projects: projects.length > 0, audience: !!String(data.targetAudience || '').trim(),
    voice: !!String(data.tone || '').trim(), posts: !!data.postExamples?.posts?.length || data.postExamples?.enabled === false, apart: filled(data.differentiators), ctas: filled(data.suggestedCtas), topics: filled(data.contentTopics),
    logo: !!data.logo, colours: data.colors.length > 0, type: data.fonts.some(Boolean), designs: usesGlobalDesigns && !!data.language,
  }
  // A chapter the plan doesn't include never counts against the profile.
  const locked = id => id === 'posts' && postVoice === false
  const scored = ORDER.filter(id => !locked(id))
  const done = scored.filter(id => complete[id]).length
  const strength = Math.round(done / scored.length * 100)
  const strengthLabel = strength >= 90 ? 'Excellent' : strength >= 70 ? 'Strong' : strength >= 45 ? 'Getting there' : 'Needs detail'
  const numberOf = id => String(ORDER.indexOf(id) + 1).padStart(2, '0')
  const go = id => { document.getElementById(`book-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setActiveId(id) }

  // The cover is printed in the brand's own primary colour and heading font.
  const primary = data.colors.find(isHex) || '#14131A'
  const coverInk = luminance(primary) > 0.42 ? '#14131A' : '#F6F3EA'
  const headingFont = normalizeFontName(data.fonts[0])
  const logo = brandLogo(data)
  // The cover shows the logo's transparent version that reads on its colour, as posts choose it (lib/designs/global/compose.ts).
  const versions = data.logoVariants?.source === data.logo && data.logoVariants?.originalTransparent ? data.logoVariants : null
  const lightCover = coverInk === '#14131A'
  const coverLogo = versions && (lightCover
    ? (versions.lostOnLight < 0.08 ? versions.originalTransparent : versions.darkenedTransparent || versions.blackTransparent || versions.originalTransparent)
    : (versions.lostOnDark < 0.08 ? versions.originalTransparent : versions.reversedTransparent || versions.whiteTransparent || versions.originalTransparent))
  const lead = paragraphsOf(data.about)[0]?.split(/(?<=[.!?])\s/)[0] || ''
  const aboutParagraphs = paragraphsOf(data.about)
  // Where the profile came from. Reading the website is optional: every chapter can be written by hand.
  const websiteCard = (
    <div className={cn(panelClass, 'p-4')}>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-bk-muted">Website</p>
      {site ? (
        <>
          <a href={site} target="_blank" rel="noreferrer" className="mt-1.5 flex items-center gap-1 truncate text-[14px] font-bold hover:underline hover:underline-offset-4">{hostOf(site)}<ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" /></a>
          <p className="mt-0.5 text-[12.5px] text-bk-muted">{data.researchSources?.length ? `${data.researchSources.length} page${data.researchSources.length === 1 ? '' : 's'} read` : 'Not read yet'}</p>
          {canManage && (
            <>
              <button type="button" onClick={openImport} disabled={busy} className={appButton('outline', 'xs', 'mt-3 w-full')}><Globe className="size-3.5" />Read it again</button>
              <p className="mt-2 text-[11.5px] leading-snug text-bk-muted">You choose what to update before anything changes.</p>
            </>
          )}
        </>
      ) : (
        <>
          <p className="mt-1.5 text-[13px] leading-snug text-bk-muted">{canManage ? 'No website yet. Fill in each chapter yourself, or let Batkle read your site.' : 'No website yet.'}</p>
          {canManage && <button type="button" onClick={openImport} disabled={busy} className={appButton('outline', 'xs', 'mt-3 w-full')}><Globe className="size-3.5" />Read a website</button>}
        </>
      )}
    </div>
  )

  return (
    <div className={pageShell}>
      <div className="mx-auto max-w-[1240px]">
        {toolbar}
        {translating && <Notice className="mt-5 flex items-center gap-2.5"><Loader2 className="size-4 shrink-0 animate-spin" />Preparing your English business profile…</Notice>}
        {translationError && <Notice tone="warning" className="mt-5">{translationError}</Notice>}
        <UpgradeNotice error={limit} className="mt-5" />

        <header className="relative mt-5 overflow-hidden rounded-[28px] motion-safe:animate-bk-page" style={{ background: `#${fullHex(primary)}`, color: coverInk }}>
          <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] opacity-70">Brand book</p>
              <h1 className="mt-3 break-words text-[clamp(40px,6.4vw,88px)] font-bold leading-[0.95] tracking-[-0.03em]" style={{ fontFamily: headingFont ? `"${headingFont}", var(--font-bk-display), sans-serif` : 'var(--font-bk-display), sans-serif' }}>
                {data.name || 'Your business'}
              </h1>
              {lead && <p className="mt-5 max-w-[620px] text-[16px] leading-relaxed opacity-85">{lead}</p>}
              <ul className="mt-6 flex flex-wrap gap-2 text-[12.5px] font-semibold">
                <li className="rounded-full px-3 py-1" style={{ boxShadow: `inset 0 0 0 1px ${coverInk}40` }}>Posts in {data.language || 'a language you choose'}</li>
                {services.length > 0 && <li className="rounded-full px-3 py-1" style={{ boxShadow: `inset 0 0 0 1px ${coverInk}40` }}>{services.length} service{services.length === 1 ? '' : 's'}</li>}
                {projects.length > 0 && <li className="rounded-full px-3 py-1" style={{ boxShadow: `inset 0 0 0 1px ${coverInk}40` }}>{projects.length} project{projects.length === 1 ? '' : 's'}</li>}
                {data.researchSources?.length > 0 && <li className="rounded-full px-3 py-1" style={{ boxShadow: `inset 0 0 0 1px ${coverInk}40` }}>{data.researchSources.length} website page{data.researchSources.length === 1 ? '' : 's'} read</li>}
              </ul>
            </div>
            {coverLogo
              ? <img src={coverLogo} alt={`${data.name || 'Brand'} logo`} className="max-h-[112px] w-auto max-w-[min(320px,70vw)] object-contain" />
              : <BrandTile name={data.name} logo={logo.src} logoOnDark={logo.onDark} size={112} className="rounded-3xl shadow-bk-pop" />}
          </div>
          {data.colors.length > 0 && (
            <div className="flex h-4" aria-label="Brand palette">
              {data.colors.map((c, i) => <span key={i} className="h-full flex-1" style={{ background: isHex(c) ? c : 'transparent' }} title={c} />)}
            </div>
          )}
        </header>

        {/* Small screens: the contents become a row of chips under the cover. */}
        <nav aria-label="Brand book contents" className="sticky top-12 z-20 -mx-4 mt-4 flex gap-1.5 overflow-x-auto bg-bk-alt/95 px-4 py-2.5 backdrop-blur [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:hidden">
          {ORDER.map(id => (
            <button key={id} type="button" onClick={() => go(id)} className={cn('flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-semibold transition-colors', activeId === id ? 'border-bk-fg bg-bk-fg text-bk-bg' : 'border-bk-line bg-bk-surface')}>
              {locked(id) ? <span className={proTag}>Pro</span> : <span className={cn('size-1.5 rounded-full', complete[id] ? 'bg-[#1F7A5A]' : 'bg-bk-butter')} />}{TITLES[id]}
            </button>
          ))}
        </nav>

        <div className="mt-6 grid gap-10 lg:mt-10 lg:grid-cols-[230px_minmax(0,1fr)] xl:gap-14">
          <aside className="hidden lg:block">
            <div className="sticky top-8 space-y-7">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-bk-muted">Profile strength</p>
                <p className="mt-1.5 flex items-baseline gap-2"><span className="font-bk-display text-[30px] font-bold tracking-[-0.04em] tabular-nums">{strength}%</span><span className="text-[13px] font-semibold text-bk-muted">{strengthLabel}</span></p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bk-line" role="progressbar" aria-valuenow={strength} aria-valuemin={0} aria-valuemax={100} aria-label="Profile strength">
                  <div className="h-full rounded-full bg-bk-fg transition-[width] duration-500" style={{ width: `${strength}%` }} />
                </div>
                <p className="mt-2 text-[12.5px] leading-snug text-bk-muted">{done === scored.length ? 'Every chapter is filled in.' : `${scored.length - done} chapter${scored.length - done === 1 ? '' : 's'} could use more detail. Specific profiles make better posts.`}</p>
              </div>
              {websiteCard}
              <nav aria-label="Brand book contents" className="space-y-5">
                {GROUPS.map(([group, ids]) => (
                  <div key={group}>
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-bk-muted">{group}</p>
                    <ul className="mt-1.5 space-y-0.5">
                      {ids.map(id => (
                        <li key={id}>
                          <button type="button" onClick={() => go(id)} aria-current={activeId === id ? 'location' : undefined} className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13.5px] transition-colors', activeId === id ? 'bg-bk-surface font-bold shadow-bk-card' : 'text-bk-fg/75 hover:bg-bk-surface/60 hover:text-bk-fg')}>
                            <span className="w-5 font-bk-display text-[11.5px] font-bold tabular-nums text-bk-muted">{numberOf(id)}</span>
                            <span className="min-w-0 flex-1 truncate">{TITLES[id]}</span>
                            {locked(id)
                              ? <span className={proTag} title="Part of Pro and Business">Pro</span>
                              : <span className={cn('size-2 shrink-0 rounded-full', complete[id] ? 'bg-[#1F7A5A]' : 'border-[1.5px] border-bk-field')} title={complete[id] ? 'Filled in' : 'Needs detail'} />}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </nav>
            </div>
          </aside>

          {/* Read-only for someone who can't manage the brand: every control in the chapters is switched off at once. */}
          <fieldset disabled={!canManage} className="min-w-0 space-y-14">
            <BookSection id="about" number={numberOf('about')} title={TITLES.about} complete={complete.about} editing={editing.about} onToggle={toggle('about')}>
              {editing.about ? (
                <div className="space-y-4">
                  <label className="block text-[13px] font-bold">Business name<input aria-label="Business name" value={data.name || ''} onChange={e => change('name', e.target.value)} className={appField('mt-2 h-11')} /></label>
                  <GrowingTextarea label="About the business" value={data.about || ''} onChange={e => change('about', e.target.value)} />
                </div>
              ) : aboutParagraphs.length ? (
                <div className="max-w-[760px] space-y-4">
                  <p className="text-[19px] leading-relaxed tracking-[-0.01em]">{aboutParagraphs[0]}</p>
                  {(aboutExpanded || !canManage ? aboutParagraphs.slice(1) : []).map((p, i) => <p key={i} className="text-[15px] leading-relaxed text-bk-fg/80">{p}</p>)}
                  {aboutParagraphs.length > 1 && canManage && <button type="button" onClick={() => setAboutExpanded(v => !v)} aria-expanded={aboutExpanded} className="text-[13px] font-semibold underline underline-offset-4">{aboutExpanded ? 'Show less' : `Read the full story (${aboutParagraphs.length - 1} more paragraph${aboutParagraphs.length > 2 ? 's' : ''})`}</button>}
                </div>
              ) : <EmptyHint onAdd={startEditing('about')}>Tell Batkle what the business does and why it matters.</EmptyHint>}
            </BookSection>

            <BookSection id="services" number={numberOf('services')} title={TITLES.services} description="What you offer and the value it brings. Posts are built on these." complete={complete.services} editing={editing.services} onToggle={toggle('services')}>
              {editing.services ? <ListEditor label="Service" addLabel="Add service" items={services} onChange={v => change('services', v)} placeholder="Service name — what it does for the customer" /> : services.length ? (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {services.map((item, i) => {
                    const [name, text] = splitService(item)
                    return (
                      <li key={i} className={cn(panelClass, 'flex flex-col p-5')}>
                        <span className="font-bk-display text-[13px] font-bold tabular-nums text-bk-muted">{String(i + 1).padStart(2, '0')}</span>
                        {name && <h3 className="mt-2 text-[16px] font-bold leading-snug">{name}</h3>}
                        <p className={cn('text-[14px] leading-relaxed text-bk-fg/80', name ? 'mt-1.5' : 'mt-2')}>{text}</p>
                      </li>
                    )
                  })}
                </ul>
              ) : <EmptyHint onAdd={startEditing('services')}>List your services so posts can be specific about them.</EmptyHint>}
            </BookSection>

            <BookSection id="projects" number={numberOf('projects')} title={TITLES.projects} description="Real work your posts can point to: projects, case studies, customer stories." complete={complete.projects} editing={editing.projects} onToggle={toggle('projects')}>
              {editing.projects ? (
                <div className="space-y-3">
                  {projects.map((project, i) => {
                    const update = patch => change('projects', projects.map((p, j) => (j === i ? { ...p, ...patch } : p)))
                    return (
                      <div key={i} className={cn(panelClass, 'space-y-2.5 p-4')}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-bk-display text-[13px] font-bold tabular-nums text-bk-muted">Project {String(i + 1).padStart(2, '0')}</span>
                          <button type="button" aria-label={`Remove project ${i + 1}`} onClick={() => change('projects', projects.filter((_, j) => j !== i))} className={appButton('quiet', 'xs', 'size-8 px-0 text-bk-muted hover:text-[#C2412F]')}><Trash2 className="size-4" /></button>
                        </div>
                        <input aria-label={`Project ${i + 1} name`} value={project.name || ''} onChange={e => update({ name: e.target.value })} placeholder="Name, such as Kitchen remodel in Lisbon" className={appField('h-10 text-[14px] font-semibold')} />
                        <GrowingTextarea label={`Project ${i + 1} description`} value={project.description || ''} onChange={e => update({ description: e.target.value })} placeholder="What you did, for whom, and the result" />
                        <input aria-label={`Project ${i + 1} link`} type="url" value={project.sourceUrl || ''} onChange={e => update({ sourceUrl: e.target.value })} placeholder="Link to the project (optional)" className={appField('h-10 text-[13.5px]')} />
                      </div>
                    )
                  })}
                  <button type="button" onClick={() => change('projects', [...projects, { name: '', description: '', sourceUrl: '' }])} className={appButton('outline', 'xs')}><Plus className="size-3.5" />Add project</button>
                </div>
              ) : projects.length ? (
                <ul className="grid gap-3 md:grid-cols-2">
                  {projects.map((project, i) => (
                    <li key={i} className={cn(panelClass, 'flex flex-col overflow-hidden')}>
                      <div className="h-1.5" style={{ background: data.colors[i % Math.max(1, data.colors.length)] || '#FFD84D' }} />
                      <div className="flex flex-1 flex-col p-5">
                        <h3 className="font-bk-display text-[18px] font-bold tracking-[-0.02em]">{project.name || 'Untitled project'}</h3>
                        {project.description && <p className="mt-2 text-[14px] leading-relaxed text-bk-fg/80">{project.description}</p>}
                        {/^https?:\/\//i.test(project.sourceUrl || '') && <a href={project.sourceUrl} target="_blank" rel="noreferrer" className="mt-auto inline-flex items-center gap-1 pt-4 text-[12.5px] font-semibold text-bk-muted hover:text-bk-fg">View project<ArrowUpRight className="size-3.5" /></a>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyHint addLabel="Add project" onAdd={() => { change('projects', [{ name: '', description: '', sourceUrl: '' }]); setEditing(prev => ({ ...prev, projects: true })) }}>
                  Add work your posts can point to: a project, a case study or a customer story.
                </EmptyHint>
              )}
            </BookSection>

            <BookSection id="audience" number={numberOf('audience')} title={TITLES.audience} description="Who you serve and what they need." complete={complete.audience} editing={editing.audience} onToggle={toggle('audience')}>
              {editing.audience ? <GrowingTextarea label={TITLES.audience} value={data.targetAudience || ''} onChange={e => change('targetAudience', e.target.value)} /> : data.targetAudience ? (
                <div className="max-w-[760px] space-y-3 text-[16px] leading-relaxed">{paragraphsOf(data.targetAudience).map((p, i) => <p key={i}>{p}</p>)}</div>
              ) : <EmptyHint onAdd={startEditing('audience')}>Describe the people your posts should speak to.</EmptyHint>}
            </BookSection>

            <BookSection id="voice" number={numberOf('voice')} title={TITLES.voice} description="How your brand should sound in every caption and slide." complete={complete.voice} editing={editing.voice} onToggle={toggle('voice')}>
              {editing.voice ? <GrowingTextarea label={TITLES.voice} value={data.tone || ''} onChange={e => change('tone', e.target.value)} /> : data.tone ? (
                <blockquote className="relative max-w-[820px] border-l-4 border-bk-butter pl-6">
                  <p className="font-bk-display text-[clamp(20px,2.2vw,26px)] font-semibold leading-snug tracking-[-0.025em]">“{data.tone}”</p>
                </blockquote>
              ) : <EmptyHint onAdd={startEditing('voice')}>How should your brand sound: friendly, technical, bold?</EmptyHint>}
            </BookSection>

            <BookSection id="posts" number={numberOf('posts')} title={TITLES.posts} description="Add posts you’ve published, carousels included. Batkle learns how you write from them (how your posts open and end, how your carousels are built, the words you like) and uses it as the base for new posts, stories and ads, never copying them." complete={locked('posts') ? undefined : complete.posts}>
              <BrandPosts flowId={flowId} allowed={postVoice} value={data.postExamples} onChange={postExamples => setExtractedData(prev => ({ ...prev, postExamples }))} />
            </BookSection>

            <BookSection id="apart" number={numberOf('apart')} title={TITLES.apart} description="Specific strengths to bring into your content." complete={complete.apart} editing={editing.apart} onToggle={toggle('apart')}>
              {editing.apart ? <ListEditor label="Strength" addLabel="Add strength" items={differentiators} onChange={v => change('differentiators', v)} /> : differentiators.length ? (
                <ol className="divide-y divide-bk-line">
                  {differentiators.map((item, i) => (
                    <li key={i} className="flex gap-5 py-4 first:pt-0 last:pb-0">
                      <span className="font-bk-display text-[30px] font-bold leading-none tracking-[-0.04em] text-bk-fg/25 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                      <p className="pt-1 text-[17px] leading-relaxed">{item}</p>
                    </li>
                  ))}
                </ol>
              ) : <EmptyHint onAdd={startEditing('apart')}>What do customers get from you that they don’t get elsewhere?</EmptyHint>}
            </BookSection>

            <BookSection id="ctas" number={numberOf('ctas')} title={TITLES.ctas} description="The next steps your posts invite people to take." complete={complete.ctas} editing={editing.ctas} onToggle={toggle('ctas')}>
              {editing.ctas ? <ListEditor label="Call to action" addLabel="Add call to action" items={ctas} onChange={v => change('suggestedCtas', v)} /> : ctas.length ? (
                <ul className="flex flex-wrap gap-2.5">
                  {ctas.map((item, i) => (
                    <li key={i} className="inline-flex items-center gap-2 rounded-full border-2 border-bk-fg px-4 py-2 text-[14px] font-bold">
                      {item}<ArrowUpRight className="size-4" aria-hidden="true" />
                    </li>
                  ))}
                </ul>
              ) : <EmptyHint onAdd={startEditing('ctas')}>Add the actions you want people to take after a post.</EmptyHint>}
            </BookSection>

            <BookSection id="topics" number={numberOf('topics')} title={TITLES.topics} description="Subjects grounded in your business that ideas can explore." complete={complete.topics} editing={editing.topics} onToggle={toggle('topics')}>
              {editing.topics ? <ListEditor label="Topic" addLabel="Add topic" items={topics} onChange={v => change('contentTopics', v)} /> : topics.length ? (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {topics.map((item, i) => (
                    <li key={i} className="flex gap-3 rounded-xl bg-bk-surface px-4 py-3 text-[14px] leading-relaxed">
                      <span className="font-bk-display text-[12.5px] font-bold tabular-nums text-bk-muted">{String(i + 1).padStart(2, '0')}</span>{item}
                    </li>
                  ))}
                </ul>
              ) : <EmptyHint onAdd={startEditing('topics')}>Add subjects your customers care about.</EmptyHint>}
            </BookSection>

            <BookSection id="logo" number={numberOf('logo')} title={TITLES.logo} description="Add your logo and Batkle prepares versions that read on light and dark designs." complete={complete.logo}>
              <LogoInput
                name={data.name}
                value={data.logo}
                variants={data.logoVariants}
                // Versions made from the old logo no longer apply; LogoInput makes the new ones straight away.
                onChange={next => setExtractedData(prev => ({ ...prev, logo: next, logoVariants: prev.logoVariants?.source === next ? prev.logoVariants : null }))}
                onVariants={variants => setExtractedData(prev => (prev.logo === variants.source ? { ...prev, logoVariants: variants } : prev))}
              />
            </BookSection>

            <BookSection id="colours" number={numberOf('colours')} title={TITLES.colours} description="Primary first; use the arrows to change their order. Type a hex value or pick a colour." complete={complete.colours}>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {data.colors.map((color, index) => {
                  const hex = `#${fullHex(color)}`
                  const ink = luminance(color) > 0.179 ? '#14131A' : '#ffffff'
                  return (
                    <li key={index} className="flex min-h-[220px] flex-col overflow-hidden rounded-2xl shadow-bk-card" style={{ backgroundColor: hex, color: ink }}>
                      <div className="flex justify-end gap-0.5 p-2">
                        <label title="Pick a colour" className="relative cursor-pointer rounded-md p-1.5 hover:bg-black/10 focus-within:outline focus-within:outline-2">
                          <Pipette className="size-4" aria-hidden="true" />
                          <input aria-label={`Pick colour ${index + 1}`} type="color" value={hex} onChange={e => handleColorChange(index, e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
                        </label>
                        <button type="button" aria-label={`Copy colour ${index + 1}`} title="Copy hex" onClick={() => copyColor(color)} className="rounded-md p-1.5 hover:bg-black/10"><Copy className="size-4" /></button>
                        <button type="button" aria-label={`Remove colour ${index + 1}`} title="Remove colour" onClick={() => removeColor(index)} className="rounded-md p-1.5 hover:bg-black/10"><X className="size-4" /></button>
                      </div>
                      <div className="mt-auto space-y-1 p-4">
                        <input aria-label={`Colour ${index + 1} hex value`} value={color} onChange={e => handleColorChange(index, e.target.value)} className="w-full rounded-md bg-transparent font-bk-display text-[22px] font-bold uppercase tracking-[-0.02em] outline-none focus:ring-2 focus:ring-current" />
                        <ColorPriority index={index} count={data.colors.length} onMove={(from, to) => setExtractedData(prev => ({ ...prev, colors: reorderColors(prev.colors, from, to) }))} />
                      </div>
                    </li>
                  )
                })}
                <li>
                  <button type="button" onClick={addColor} className="flex size-full min-h-[220px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-bk-field text-[13.5px] font-semibold text-bk-muted transition-colors hover:border-bk-fg hover:text-bk-fg">
                    <Plus className="size-5" />Add colour
                  </button>
                </li>
              </ul>
            </BookSection>

            <BookSection id="type" number={numberOf('type')} title={TITLES.type} description="The typefaces your posts use, headings first." complete={complete.type}>
              <ul className="space-y-3">
                {data.fonts.map((font, index) => {
                  const family = normalizeFontName(font)
                  return (
                    <li key={index} className={cn(panelClass, 'grid items-center gap-5 p-5 md:grid-cols-[120px_minmax(0,1fr)_minmax(0,240px)]')}>
                      <span className="text-[72px] leading-none" style={{ fontFamily: `"${family}", sans-serif` }} aria-hidden="true">Aa</span>
                      <div className="min-w-0" style={{ fontFamily: `"${family}", sans-serif` }}>
                        <p className="truncate text-[28px] leading-tight">{family || 'Your typeface'}</p>
                        <p className="mt-1 truncate text-[15px] text-bk-muted">The quick brown fox jumps over the lazy dog. 0123456789</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-bk-muted">{index === 0 ? 'Headings' : index === 1 ? 'Body' : 'Extra'}</p>
                          <input aria-label={`Font ${index + 1}`} value={font} onChange={e => handleFontChange(index, e.target.value)} placeholder="Font family" className={appField('h-10 text-[14px]')} />
                        </div>
                        <button type="button" aria-label={`Remove font ${index + 1}`} onClick={() => removeFont(index)} className={appButton('quiet', 'sm', 'mt-5 size-10 px-0 text-bk-muted hover:text-[#C2412F]')}><X className="size-4" /></button>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <button type="button" onClick={addFont} className={appButton('outline', 'sm', 'mt-3')}><Plus className="size-4" />Add font</button>
            </BookSection>

            <BookSection id="designs" number={numberOf('designs')} title={TITLES.designs} description="The language posts are written in, and the visual styles they are composed with." complete={complete.designs}>
              <div className={cn(panelClass, 'mb-4 flex flex-wrap items-center justify-between gap-4 p-5')}>
                <div>
                  <p className="text-[15px] font-bold">Post language</p>
                  <p className="mt-0.5 text-[13px] text-bk-muted">Your profile is kept in English; ideas, slides and captions are written in this language.</p>
                </div>
                <input aria-label="Post language" value={data.language} onChange={e => change('language', e.target.value)} className={appField('h-10 w-full max-w-[260px] text-[14px]')} />
              </div>
              <div className="mb-3 flex items-center justify-between gap-3"><p className="text-[15px] font-bold">Visual styles</p>{flowId && <Link href={`/app/${flowId}/design-library`} className="inline-flex items-center gap-1 text-[13px] font-semibold underline underline-offset-4">Browse the Design Library<ArrowUpRight className="size-3.5" /></Link>}</div>
              <BrandDesignStudio bare flowId={flowId} brand={data} onChange={setExtractedData} />
            </BookSection>

            {/* On small screens the side column is hidden, so the website card sits at the end of the book. */}
            <div className="lg:hidden">{websiteCard}</div>
            {data.researchSources?.length > 0 && (
              <details className="rounded-2xl bg-bk-surface px-5 py-4 shadow-bk-card">
                <summary className="cursor-pointer text-[13px] font-semibold text-bk-muted">Sources · {data.researchSources.length} website pages</summary>
                <ul className="mt-3 space-y-2">
                  {data.researchSources.map(page => (
                    <li key={page.url}><a href={page.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 break-all text-[13px] text-bk-fg/80 hover:text-bk-fg">{page.url}<ArrowUpRight className="size-3.5 shrink-0" /></a></li>
                  ))}
                </ul>
              </details>
            )}
            {data.researchWarnings?.map(item => <p key={item.url} className="text-[12.5px] text-[#9A6B00] dark:text-[#F2C14E]">{item.message} {item.url}</p>)}

            {dirty && canManage && (
              <div className="sticky bottom-4 z-20 motion-safe:animate-bk-page">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bk-fg bg-bk-surface p-2.5 pl-4 shadow-bk-pop">
                  <p className="text-[13.5px] font-bold">You have unsaved changes</p>
                  <button type="button" onClick={() => handleSave()} disabled={busy} className={appButton('primary', 'sm')}>
                    {saving && <Loader2 className="size-4 animate-spin" />}{saving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>
            )}
          </fieldset>
        </div>
      </div>
      {importPopup}
      {reviewPopup}
    </div>
  )
}
