'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronDown, Loader2, SlidersHorizontal, Sparkles, ZoomIn } from 'lucide-react'
import GlobalDesignPreview, { COMPOSITION_LABELS, SampleLightbox } from '@/components/GlobalDesignPreview'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { familyGrammar, familyImagery } from '@/lib/designs/global/study'
import { POST_LANGUAGES, languageChoices } from '@/lib/client/onboarding'
import { contentLanguage } from '@/lib/services/contentLanguage'
import { cn } from '@/lib/utils'
import { appButton, appLayer } from '../ui'

const FORMATS = [
  { value: 'auto', label: 'Auto', title: 'Batkle picks a carousel or a single post for the idea' },
  { value: 'carousel', label: 'Carousel' },
  { value: 'single', label: 'Single post' },
]
// Whether the generated post uses images: as the design decides, on every slide that can hold one, or none.
const IMAGE_CHOICES = [
  { value: 'auto', label: 'Auto', title: 'The design decides where images go' },
  { value: 'on', label: 'With images', title: 'Add an image to every slide that can hold one (AI cutouts, stock or your gallery)' },
  { value: 'off', label: 'No images', title: 'Typography only: no image search or AI generation. Photos you attach still show.' },
]
const SLIDE_COUNTS = ['auto', 3, 4, 5, 6, 7, 8, 9, 10]

/** Every setting on Auto: Batkle decides the format, length, images, design and (the brand's) language. */
export const AUTO_SETTINGS = { format: 'auto', slides: 'auto', imageChoice: 'auto', designId: 'auto', language: 'auto' }

/** The language sent for a post, or null when the post follows the brand's language. */
export function languageOption(code) {
  if (!code || code === 'auto') return null
  const option = POST_LANGUAGES.find(o => o.code === code)
  return option ? { language: option.language, languageVariant: option.languageVariant } : null
}

/** A small segmented control in the composer's style. */
export function Choice({ label, options, value, onChange, disabled, unavailable = () => false }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap self-start rounded-lg border border-bk-line bg-bk-surface p-0.5">
      {options.map(option => {
        const blocked = unavailable(option.value)
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            disabled={disabled || !!blocked}
            title={blocked || option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-7 min-w-7 rounded-md px-2.5 text-[12.5px] font-bold tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg disabled:cursor-not-allowed disabled:opacity-40',
              value === option.value ? 'bg-bk-fg text-bk-bg' : 'text-bk-fg hover:bg-bk-alt',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function Row({ label, hint, children }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-bk-muted">{label}</p>
      {children}
      {hint && <p className="mt-1.5 text-[11.5px] leading-snug text-bk-muted">{hint}</p>}
    </div>
  )
}

/** The designs selected for the brand, loaded the first time the settings open. */
function useBrandDesigns(flowId, open) {
  const [state, setState] = useState({ status: 'idle', items: [] })
  useEffect(() => { setState({ status: 'idle', items: [] }) }, [flowId])
  useEffect(() => {
    if (!open || !flowId || state.status !== 'idle') return
    setState({ status: 'loading', items: [] })
    fetch(`/api/global-designs/brand?flowId=${encodeURIComponent(flowId)}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Your designs could not be loaded')
        return data
      })
      .then(items => setState({ status: 'ready', items: (Array.isArray(items) ? items : []).filter(item => item?.design?.id && item.family) }))
      .catch(error => setState({ status: 'error', items: [], error: error.message }))
  }, [open, flowId, state.status])
  return [state, () => setState({ status: 'idle', items: [] })]
}

// How a design uses imagery, in plain words.
const IMAGERY_LABELS = {
  none: 'Typography only', background: 'Photo behind the text', fullBleed: 'Full-bleed photos', cutout: 'Cut-out images',
  contained: 'Framed photos', collage: 'Photo collage', mixed: 'Mixed imagery', other: 'Mixed imagery',
}

function DesignTile({ selected, onSelect, onInspect, label, name = label, title, children }) {
  return (
    <div className="relative min-w-0">
      <button
        type="button"
        aria-pressed={selected}
        aria-label={name}
        onClick={onSelect}
        title={title}
        className={cn(
          'group block w-full min-w-0 rounded-lg border p-1 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg',
          selected ? 'border-bk-fg ring-1 ring-bk-fg' : 'border-bk-line hover:border-bk-fg/40',
        )}
      >
        {/* The preview's sample words are decoration; the tile is named by its design. */}
        <span aria-hidden="true" className="relative block overflow-hidden rounded-md">
          {children}
          {selected && <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-bk-fg text-bk-bg"><Check className="size-3" strokeWidth={3} /></span>}
        </span>
        <span className="mt-1 block truncate px-0.5 text-[11.5px] font-semibold">{label}</span>
      </button>
      {onInspect && (
        <button
          type="button"
          onClick={onInspect}
          aria-label={`Inspect ${name}`}
          title="Inspect"
          className="absolute left-2 top-2 flex size-6 items-center justify-center rounded-full bg-black/60 text-white transition-[background-color,transform] hover:scale-110 hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bk-fg"
        >
          <ZoomIn className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/** A design's sample slides, enlarged, with what it does and a way to pick it. */
function DesignInspector({ item, brand, index, onIndex, onClose, selected, onUse }) {
  if (!item) return null
  const { family, design } = item
  const imagery = IMAGERY_LABELS[familyImagery(family).mode] || 'Mixed imagery'
  const layouts = [...new Set(familyGrammar(family).compositions || [])].map(c => COMPOSITION_LABELS[c] || c)
  return (
    <SampleLightbox family={family} brand={brand} index={index} onIndex={onIndex} onClose={onClose}>
      <div className="min-w-0 max-w-[340px] text-[12.5px] leading-snug">
        <p className="font-semibold">{design.name}</p>
        <p className="text-bk-muted">{imagery}{layouts.length ? ` · ${layouts.join(', ')}` : ''}</p>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onClose} className={appButton('quiet', 'sm')}>Close</button>
        <button type="button" disabled={selected} onClick={onUse} className={appButton(selected ? 'outline' : 'primary', 'sm')}>
          {selected ? <><Check className="size-4" />Selected</> : 'Use this design'}
        </button>
      </div>
    </SampleLightbox>
  )
}

/**
 * The composer's post settings: format, number of slides, images, design and language. Each starts on Auto,
 * and the button sums up the ones that are not.
 */
export function PostSettings({ value, onChange, brandContext, photoCount = 0, disabled }) {
  const [open, setOpen] = useState(false)
  const flowId = brandContext?.id
  const [designs, reloadDesigns] = useBrandDesigns(flowId, open)
  const { options: languages, selected: brandLanguage } = useMemo(() => languageChoices(brandContext || {}, contentLanguage), [brandContext])
  const brandLanguageLabel = languages.find(o => o.code === brandLanguage)?.label || 'the brand’s language'
  const set = patch => onChange({ ...value, ...patch })

  const design = designs.items.find(item => item.design.id === value.designId)
  const language = value.language !== 'auto' && POST_LANGUAGES.find(o => o.code === value.language)
  const summary = [
    value.format === 'carousel' && value.slides === 'auto' && 'Carousel',
    value.format === 'single' && 'Single post',
    value.slides !== 'auto' && `${value.slides} slides`,
    value.imageChoice === 'on' && 'With images',
    value.imageChoice === 'off' && 'No images',
    value.designId !== 'auto' && (design?.design.name || 'Chosen design'),
    language && language.label,
  ].filter(Boolean)
  const custom = summary.length > 0
  const textOnly = item => familyImagery(item.family).mode === 'none'
  // The design being inspected and which of its sample slides shows; the panel stays open behind it.
  const [inspecting, setInspecting] = useState(null)
  const keepOpen = e => { if (inspecting) e.preventDefault() }

  return (
    <>
      <DesignInspector
        item={inspecting?.item}
        brand={brandContext || {}}
        index={inspecting ? inspecting.index : null}
        onIndex={index => setInspecting(current => current && { ...current, index })}
        onClose={() => setInspecting(null)}
        selected={!!inspecting && value.designId === inspecting.item.design.id}
        onUse={() => { set({ designId: inspecting.item.design.id }); setInspecting(null) }}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={`Post settings: ${custom ? summary.join(', ') : 'all on Auto'}`}
            className={appButton('outline', 'sm', cn('max-w-full gap-1.5 px-2.5 font-semibold sm:max-w-[340px]', custom && 'border-bk-fg'))}
          >
            <SlidersHorizontal className="size-4 shrink-0" />
            <span>Settings</span>
            <span className={cn('min-w-0 truncate font-medium', custom ? 'text-bk-fg' : 'text-bk-muted')}>{custom ? summary.join(' · ') : 'Auto'}</span>
            <ChevronDown className={cn('size-3.5 shrink-0 text-bk-muted transition-transform', open && 'rotate-180')} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          collisionPadding={16}
          onInteractOutside={keepOpen}
          onFocusOutside={keepOpen}
          className={cn(appLayer, 'max-h-[var(--radix-popover-content-available-height)] w-[min(392px,calc(100vw-32px))] space-y-4 overflow-y-auto rounded-2xl border-bk-line bg-bk-surface p-4 shadow-bk-pop')}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-bk-display text-[16px] font-bold tracking-[-0.02em]">Post settings</p>
              <p className="mt-0.5 text-[12px] leading-snug text-bk-muted">For the ideas you create next. Auto lets Batkle decide.</p>
            </div>
            <button
              type="button"
              disabled={!custom}
              onClick={() => onChange({ ...AUTO_SETTINGS })}
              className="shrink-0 text-[12.5px] font-semibold underline underline-offset-4 disabled:no-underline disabled:opacity-40"
            >
              Reset to Auto
            </button>
          </div>

          <Row label="Format">
            <Choice
              label="Post format"
              options={FORMATS}
              value={value.format}
              onChange={format => set(format === 'single' ? { format, slides: 'auto' } : { format })}
              unavailable={v => v === 'single' && photoCount > 1 && 'A single post shows one photo'}
            />
          </Row>

          <Row label="Slides" hint={value.format === 'single' ? 'A single post has one slide.' : value.slides === 'auto' ? 'Auto fits the length to the idea: 3–4 slides for one insight, up to 10 for a process or story.' : 'Counts the cover and the closing slide.'}>
            <Choice
              label="Number of slides"
              options={SLIDE_COUNTS.map(n => ({ value: n, label: n === 'auto' ? 'Auto' : String(n), title: n === 'auto' ? undefined : `${n} slides` }))}
              value={value.slides}
              disabled={value.format === 'single'}
              // A slide count means a carousel.
              onChange={slides => set(slides === 'auto' ? { slides } : { slides, format: 'carousel' })}
            />
          </Row>

          <Row label="Images">
            <Choice label="Images" options={IMAGE_CHOICES} value={value.imageChoice} onChange={imageChoice => set({ imageChoice })} />
          </Row>

          <Row
            label="Design"
            hint={value.designId !== 'auto' && design && textOnly(design) && (photoCount > 0 || value.imageChoice === 'on')
              ? 'This design is typography only, so it cannot show photos.'
              : null}
          >
            {designs.status === 'loading' || designs.status === 'idle' ? (
              <p role="status" className="flex items-center gap-2 py-2 text-[12.5px] text-bk-muted"><Loader2 className="size-3.5 animate-spin" />Loading your designs…</p>
            ) : designs.status === 'error' ? (
              <p className="text-[12.5px] text-[#C2412F] dark:text-[#F0826F]">
                {designs.error}. <button type="button" onClick={reloadDesigns} className="font-semibold underline underline-offset-4">Try again</button>
              </p>
            ) : (
              <>
                <div role="group" aria-label="Design" className="grid grid-cols-4 gap-1.5">
                  <DesignTile selected={value.designId === 'auto'} onSelect={() => set({ designId: 'auto' })} label="Auto" title="Batkle picks one of your designs for each post">
                    <span className="flex aspect-[4/5] flex-col items-center justify-center gap-1 bg-bk-alt text-bk-muted">
                      <Sparkles className="size-4" aria-hidden="true" />
                    </span>
                  </DesignTile>
                  {designs.items.map(item => (
                    <DesignTile
                      key={item.design.id}
                      selected={value.designId === item.design.id}
                      onSelect={() => set({ designId: item.design.id })}
                      onInspect={() => setInspecting({ item, index: 0 })}
                      label={item.design.name}
                      name={`${item.design.name}${textOnly(item) ? ' (typography only)' : ''}`}
                      title={`${item.design.name}${textOnly(item) ? ' (typography only)' : ''}`}
                    >
                      <GlobalDesignPreview family={item.family} brand={brandContext || {}} sampleLabel={false} />
                    </DesignTile>
                  ))}
                </div>
                {!designs.items.length && (
                  <p className="mt-2 text-[12px] leading-snug text-bk-muted">
                    This brand uses its starter designs.{flowId && <> <Link href={`/app/${flowId}/brand-information`} className="font-semibold text-bk-fg underline underline-offset-4">Choose designs</Link> to pick one here.</>}
                  </p>
                )}
              </>
            )}
          </Row>

          <Row label="Language" hint={value.language === 'auto' ? `Posts are written in ${brandLanguageLabel}, the brand’s language.` : `New ideas are written in ${language?.label || 'this language'}; the brand keeps ${brandLanguageLabel}.`}>
            <div className="relative">
              <select
                aria-label="Post language"
                value={value.language}
                onChange={e => set({ language: e.target.value === brandLanguage ? 'auto' : e.target.value })}
                className="h-8 w-full appearance-none rounded-lg border border-bk-field bg-bk-surface pl-2.5 pr-8 text-[13px] font-medium text-bk-fg transition-colors hover:border-bk-fg/40 focus:border-bk-fg focus:outline-none"
              >
                <option value="auto">Auto · {brandLanguageLabel}</option>
                {POST_LANGUAGES.filter(o => o.code !== brandLanguage).map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-bk-muted" aria-hidden="true" />
            </div>
          </Row>
        </PopoverContent>
      </Popover>
    </>
  )
}
