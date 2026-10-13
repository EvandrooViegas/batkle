'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'
import { BatkleLogo } from '@/components/landing/brand'
import { loadEnglishProfile } from '@/lib/client/englishProfile'
import { languageChoices, normalizeWebsite } from '@/lib/client/onboarding'
import { contentLanguage } from '@/lib/services/contentLanguage'
import { cn } from '@/lib/utils'
import { appButton, appLayer } from '../ui'
import BrandPreview from './BrandPreview'
import DesignStep from './DesignStep'
import ReadyStep from './ReadyStep'
import ResearchStep from './ResearchStep'
import ReviewStep from './ReviewStep'
import { ManualStep, WebsiteStep } from './WebsiteStep'

const STEPS = [['website', 'Website'], ['research', 'Research'], ['review', 'Review'], ['design', 'Design']]
const STEP_INDEX = { website: 0, manual: 0, research: 1, review: 2, design: 3, ready: 4 }
const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function readJson(response, fallback) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || fallback)
  return data
}

function researchError(error, domain) {
  const message = String(error?.message || '')
  if (/failed to fetch|networkerror|load failed/i.test(message)) return 'Batkle couldn’t reach its server. Check your connection and try again.'
  if (/fetch main page|ENOTFOUND|getaddrinfo|ECONNREFUSED|ECONNRESET|timed? ?out/i.test(message)) return `${domain} didn’t respond. Check that the address is right and the site is online.`
  return message || 'Something went wrong while reading the website.'
}

function Stepper({ index }) {
  return (
    <ol aria-label="Progress" className="hidden items-center gap-2 md:flex">
      {STEPS.map(([key, label], i) => (
        <li key={key} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden="true" className={cn('h-px w-8 transition-colors', i <= index ? 'bg-bk-fg' : 'bg-bk-field')} />}
          <span aria-current={i === index ? 'step' : undefined} className={cn('flex items-center gap-2 text-[13px] font-semibold', i <= index ? 'text-bk-fg' : 'text-bk-muted')}>
            <span
              aria-hidden="true"
              className={cn(
                'flex size-6 items-center justify-center rounded-full text-[12px] font-bold transition-colors',
                i < index ? 'bg-bk-fg text-bk-bg' : i === index ? 'bg-bk-butter text-bk-ink' : 'border border-bk-field text-bk-muted',
              )}
            >
              {i < index ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            {label}
            <span className="sr-only">{i < index ? '(done)' : i === index ? '(current)' : ''}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

/**
 * Brand onboarding: website → research → review → design → ready. With `initialWebsite` (from the home page form)
 * the research starts straight away. The research request itself creates the brand. A brand needs at least one
 * chosen design to finish, whichever way it was created.
 */
export default function BrandOnboarding({ initialWebsite = '', firstBrand = false }) {
  const router = useRouter()
  const heading = useRef(null)
  const mounted = useRef(false)
  const autoStarted = useRef(false)
  const [step, setStep] = useState('website')
  const [website, setWebsite] = useState(initialWebsite)
  const [websiteError, setWebsiteError] = useState('')
  const [target, setTarget] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState('reading')
  const [failure, setFailure] = useState('')
  const [result, setResult] = useState(null)
  const [choices, setChoices] = useState(null)
  const [after, setAfter] = useState('ready') // where the design step leads: the ready screen or the brand profile

  // Each new step moves focus to its heading, so keyboard and screen-reader users follow along.
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    window.scrollTo({ top: 0 })
    heading.current?.focus({ preventScroll: true })
  }, [step])

  const research = async input => {
    const site = normalizeWebsite(input)
    if (site.error) { setWebsiteError(site.error); setStep('website'); return }
    setTarget(site)
    setWebsiteError('')
    setFailure('')
    setPhase('reading')
    setAttempt(n => n + 1)
    setStep('research')
    try {
      const data = await readJson(await fetch('/api/extract-business-info', {
        method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ url: site.url }),
      }), 'The website could not be researched.')
      const flowId = data.flow?.id
      if (!flowId) throw new Error('The brand could not be saved. Please try again.')
      let brand = data.flow.brandContext || {}
      setPhase('finishing')
      // Posts are planned from an English profile; if this fails, the brand profile page retries it.
      try { brand = (await loadEnglishProfile(flowId, brand)) || brand } catch {}
      setResult({ flowId, brand, pages: data.pagesAnalyzed, imageImport: data.imageImport, logoWarning: data.logoVariantsError })
      setChoices(languageChoices(brand, contentLanguage))
      setPhase('done')
    } catch (error) {
      setFailure(researchError(error, site.domain))
    }
  }

  // A website from the home page starts the research at once.
  useEffect(() => {
    if (autoStarted.current || !initialWebsite) return
    autoStarted.current = true
    // Drop ?website= so a refresh or Back never starts a second research run.
    window.history.replaceState(null, '', '/app/new')
    research(initialWebsite)
  }, [initialWebsite]) // eslint-disable-line react-hooks/exhaustive-deps

  const showReview = useCallback(() => setStep('review'), [])

  const saveReview = async ({ name, languageCode }) => {
    const { flowId, brand } = result
    const option = choices.options.find(o => o.code === languageCode)
    const languageChanged = languageCode !== choices.selected && option
    if (name === (brand.name || '') && !languageChanged) return
    const next = { ...brand, name, ...(languageChanged ? { language: option.language, languageVariant: option.languageVariant } : {}) }
    await readJson(await fetch(`/api/flows/${flowId}`, {
      method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ name, brandContext: next }),
    }), 'Your changes could not be saved. Please try again.')
    setResult(current => ({ ...current, brand: next }))
    setChoices(current => ({ ...current, selected: languageCode }))
  }

  const createManually = async ({ name, option }) => {
    const flow = await readJson(await fetch('/api/flows', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ name, brandContext: { name, language: option.language, languageVariant: option.languageVariant } }),
    }), 'The brand could not be created. Please try again.')
    // A brand typed in by hand still picks its designs, then fills in the rest of its profile.
    setResult({ flowId: flow.id, brand: flow.brandContext || { name, language: option.language, languageVariant: option.languageVariant }, manual: true })
    setAfter('profile')
    setStep('design')
  }

  const index = STEP_INDEX[step]
  const languageLabel = choices?.options.find(o => o.code === choices.selected)?.label
  const exit = result
    ? { href: `/app/${result.flowId}/creation`, label: 'Go to studio' }
    : firstBrand ? { href: '/', label: 'Back to home' } : { href: '/app', label: 'Back to studio' }

  const preview = step === 'manual' || step === 'design' || step === 'ready' ? null : (
    <BrandPreview
      domain={step === 'website' ? normalizeWebsite(website).domain : target?.domain}
      brand={step === 'review' ? result.brand : null}
      loading={step === 'research' && !failure}
      languageLabel={step === 'review' ? languageLabel : undefined}
    />
  )

  return (
    <div className={cn(appLayer, 'flex min-h-dvh flex-col bg-bk-alt')}>
      <header className="flex items-center justify-between gap-4 px-5 py-4 sm:px-8 sm:py-5">
        <Link href="/" aria-label="Batkle home" className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bk-fg">
          <BatkleLogo size={30} />
        </Link>
        {index < 4 && !result?.manual && <Stepper index={index} />}
        {/* Choosing a design is required, so the design step has no way out but finishing it. */}
        {step === 'design' ? <span aria-hidden="true" className="w-8" /> : (
          <Link href={exit.href} className={appButton('quiet', 'sm')} aria-label={exit.label}>
            <X className="size-4" /><span className="hidden sm:inline">{exit.label}</span>
          </Link>
        )}
      </header>

      <main
        id="onboarding"
        className={cn(
          'mx-auto w-full max-w-[1120px] flex-1 px-5 pb-16 pt-6 sm:px-8 lg:pt-12',
          preview && 'grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-16',
          step === 'ready' && 'flex items-center justify-center pb-24',
        )}
      >
        <section key={`${step}-${attempt}`} className="min-w-0 motion-safe:animate-bk-rise">
          {step === 'website' && (
            <WebsiteStep
              firstBrand={firstBrand}
              website={website}
              onWebsiteChange={value => { setWebsite(value); setWebsiteError('') }}
              error={websiteError}
              onSubmit={() => research(website)}
              onManual={() => setStep('manual')}
              headingRef={heading}
            />
          )}
          {step === 'manual' && <ManualStep onBack={() => setStep('website')} onCreate={createManually} headingRef={heading} />}
          {step === 'research' && (
            <ResearchStep
              domain={target.domain}
              phase={phase}
              error={failure}
              onRetry={() => research(target.url)}
              onChangeWebsite={() => setStep('website')}
              onManual={() => setStep('manual')}
              onFinished={showReview}
              headingRef={heading}
            />
          )}
          {step === 'review' && (
            <ReviewStep
              result={result}
              choices={choices}
              onContinue={async values => { await saveReview(values); setAfter('ready'); setStep('design') }}
              onOpenProfile={async values => { await saveReview(values); setAfter('profile'); setStep('design') }}
              preview={<BrandPreview compact domain={target?.domain} brand={result.brand} languageLabel={languageLabel} />}
              headingRef={heading}
            />
          )}
          {step === 'design' && (
            <DesignStep
              flowId={result.flowId}
              brand={result.brand}
              eyebrow={result.manual ? 'Last step · Design' : undefined}
              doneLabel={after === 'profile' ? 'Continue to the brand profile' : 'Finish'}
              onDone={brand => {
                setResult(current => ({ ...current, brand }))
                if (after === 'profile') router.push(`/app/${result.flowId}/brand-information`)
                else setStep('ready')
              }}
              headingRef={heading}
            />
          )}
          {step === 'ready' && <ReadyStep flowId={result.flowId} brand={result.brand} languageLabel={languageLabel} headingRef={heading} />}
        </section>
        {preview && <aside className="hidden lg:block" aria-label="Brand preview">{preview}</aside>}
      </main>
    </div>
  )
}
