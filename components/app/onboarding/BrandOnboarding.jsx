'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'
import { BatkleLogo } from '@/components/landing/brand'
import { apiError, isBillingCode } from '@/lib/client/billing'
import { loadEnglishProfile } from '@/lib/client/englishProfile'
import { languageChoices, normalizeWebsite } from '@/lib/client/onboarding'
import { contentLanguage } from '@/lib/services/contentLanguage'
import { cn } from '@/lib/utils'
import UpgradeNotice from '../billing/UpgradeNotice'
import { usePopup } from '../popup'
import { BrandTile, appButton, appLayer, brandLogo } from '../ui'
import BrandPreview from './BrandPreview'
import DesignStep from './DesignStep'
import ReadyStep from './ReadyStep'
import ResearchStep from './ResearchStep'
import ResumePanel from './ResumePanel'
import ReviewStep from './ReviewStep'
import { ManualStep, WebsiteStep } from './WebsiteStep'

const STEPS = [['website', 'Website'], ['research', 'Research'], ['review', 'Review'], ['design', 'Design']]
const STEP_INDEX = { website: 0, manual: 0, research: 1, review: 2, design: 3, ready: 4 }
const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function readJson(response, fallback) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw apiError(data, response.status, fallback)
  return data
}

const updateFlow = async (flowId, body, fallback) => readJson(await fetch(`/api/flows/${flowId}`, {
  method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body),
}), fallback)

/** Removes a brand this onboarding made and then replaced; a failure only leaves an extra brand to delete by hand. */
const discardBrand = flowId => fetch(`/api/flows/${flowId}`, { method: 'DELETE' }).catch(() => {})

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
 *
 * Until it finishes, the brand records the step it reached (`flow.onboarding`). Coming back with `resume` (the most
 * recent unfinished brand) opens "continue where you left off" first. Going back to an earlier step and choosing a
 * different website, or setting the brand up by hand, replaces the brand made so far rather than adding another
 * (`replaces`, so the replacement needs no free brand slot).
 *
 * When the plan has no room for another brand, the first request that would make one answers 402 limit_reached and
 * the website step shows the upgrade instead. `brandLimit` (that answer's body, when the page already knows) shows
 * it before anything is typed.
 */
export default function BrandOnboarding({ initialWebsite = '', firstBrand = false, resume = null, exitHref = '/app', brandLimit = null }) {
  const router = useRouter()
  const popup = usePopup()
  const heading = useRef(null)
  const mounted = useRef(false)
  const autoStarted = useRef(false)
  const [step, setStep] = useState(resume && !initialWebsite ? 'resume' : 'website')
  const [website, setWebsite] = useState(initialWebsite)
  const [websiteError, setWebsiteError] = useState('')
  const [target, setTarget] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState('reading')
  const [failure, setFailure] = useState('')
  const [result, setResult] = useState(null)
  const [choices, setChoices] = useState(null)
  const [after, setAfter] = useState('ready') // where the design step leads: the ready screen or the brand profile
  const [limit, setLimit] = useState(() => (brandLimit ? apiError(brandLimit, 402) : null)) // a plan limit that stops a new brand

  // Each new step moves focus to its heading, so keyboard and screen-reader users follow along.
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    window.scrollTo({ top: 0 })
    heading.current?.focus({ preventScroll: true })
  }, [step])

  const research = async input => {
    const site = normalizeWebsite(input)
    if (site.error) { setWebsiteError(site.error); setStep('website'); return }
    // Back from the review with the same website: research that brand again instead of making a second one.
    const previous = result
    const reuse = previous && !previous.manual && previous.domain === site.domain ? previous.flowId : null
    setTarget(site)
    setWebsiteError('')
    setFailure('')
    setPhase('reading')
    setAttempt(n => n + 1)
    setStep('research')
    try {
      const data = await readJson(await fetch('/api/extract-business-info', {
        method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ url: site.url, onboarding: true, ...(reuse ? { flowId: reuse } : previous ? { replaces: previous.flowId } : {}) }),
      }), 'The website could not be researched.')
      const flowId = data.flow?.id
      if (!flowId) throw new Error('The brand could not be saved. Please try again.')
      if (previous && previous.flowId !== flowId) discardBrand(previous.flowId)
      let brand = data.flow.brandContext || {}
      setPhase('finishing')
      // Posts are planned from an English profile; if this fails, the brand profile page retries it.
      try { brand = (await loadEnglishProfile(flowId, brand)) || brand } catch {}
      setResult({ flowId, domain: site.domain, website: site.url, brand, pages: data.pagesAnalyzed, logoWarning: data.logoVariantsError })
      setChoices(languageChoices(brand, contentLanguage))
      setLimit(null)
      setPhase('done')
    } catch (error) {
      // No room for another brand on this plan: back to the website step, which offers the upgrade.
      if (isBillingCode(error.code)) { setLimit(error); setStep('website'); return }
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

  /** Saves the reviewed name and language, and records that the brand moved on to the design step. */
  const saveReview = async ({ name, languageCode }, nextAfter) => {
    const { flowId, brand } = result
    const option = choices.options.find(o => o.code === languageCode)
    const languageChanged = languageCode !== choices.selected && option
    const changed = name !== (brand.name || '') || languageChanged
    const next = changed ? { ...brand, name, ...(languageChanged ? { language: option.language, languageVariant: option.languageVariant } : {}) } : brand
    await updateFlow(flowId, {
      ...(changed ? { name, brandContext: next } : {}),
      onboarding: { step: 'design', ...(nextAfter === 'profile' ? { after: 'profile' } : {}) },
    }, 'Your changes could not be saved. Please try again.')
    if (!changed) return
    setResult(current => ({ ...current, brand: next }))
    setChoices(current => ({ ...current, selected: languageCode }))
  }

  const createManually = async ({ name, option }) => {
    const basics = { name, language: option.language, languageVariant: option.languageVariant }
    const onboarding = { step: 'design', manual: true, after: 'profile' }
    let flow
    if (result?.manual) {
      // Back from the design step: the same hand-made brand gets the new name and language.
      flow = await updateFlow(result.flowId, { name, brandContext: { ...result.brand, ...basics }, onboarding }, 'Your changes could not be saved. Please try again.')
    } else {
      try {
        flow = await readJson(await fetch('/api/flows', {
          method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name, brandContext: basics, onboarding, ...(result ? { replaces: result.flowId } : {}) }),
        }), 'The brand could not be created. Please try again.')
      } catch (error) {
        if (!isBillingCode(error.code)) throw error
        setLimit(error)
        setStep('website')
        return
      }
      if (result) discardBrand(result.flowId)
    }
    // A brand typed in by hand still picks its designs, then fills in the rest of its profile.
    setResult({ flowId: flow.id, brand: flow.brandContext || basics, manual: true })
    setAfter('profile')
    setStep('design')
  }

  const finishDesign = async brand => {
    setResult(current => ({ ...current, brand }))
    // The brand is set up now, so it no longer counts as unfinished.
    await fetch(`/api/flows/${result.flowId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ onboarding: null }) }).catch(() => {})
    if (after === 'profile') router.push(`/app/${result.flowId}/brand-information`)
    else setStep('ready')
  }

  const backToWebsite = () => {
    setWebsite(result?.website || target?.url || website)
    setWebsiteError('')
    setStep('website')
  }

  const continueResume = () => {
    const { flowId, brand, manual } = resume
    const site = normalizeWebsite(brand.website || '')
    setResult({ flowId, brand, manual, ...(site.error ? {} : { domain: site.domain, website: site.url }) })
    if (!site.error) setTarget(site)
    setChoices(languageChoices(brand, contentLanguage))
    setAfter(resume.after)
    setStep(resume.step)
    // The research normally prepares the English profile before the review; make sure it exists.
    if (!manual) {
      loadEnglishProfile(flowId, brand)
        .then(english => english && setResult(current => (current?.flowId === flowId ? { ...current, brand: english } : current)))
        .catch(() => {})
    }
  }

  const startOverFromResume = async () => {
    const name = resume.brand.name || 'this brand'
    const removed = await popup.confirm({
      title: `Start over without “${name}”?`,
      description: `This deletes ${name} and what Batkle learned from its website, so you can add a brand from the beginning.`,
      tone: 'danger',
      confirmLabel: 'Delete and start over',
      busyLabel: 'Deleting…',
      action: async () => {
        const res = await fetch(`/api/flows/${resume.flowId}`, { method: 'DELETE' })
        if (!res.ok && res.status !== 404) throw new Error((await res.json().catch(() => ({}))).error || 'The brand could not be deleted. Please try again.')
      },
    })
    if (removed) setStep('website')
  }

  const index = step === 'resume' ? STEP_INDEX[resume.step] : STEP_INDEX[step]
  const manualFlow = step === 'resume' ? resume.manual : result?.manual
  const languageLabel = choices?.options.find(o => o.code === choices.selected)?.label
  const exit = result
    ? { href: `/app/${result.flowId}/creation`, label: 'Go to studio' }
    : firstBrand ? { href: '/', label: 'Back to home' } : { href: exitHref, label: 'Back to studio' }

  const preview = ['resume', 'manual', 'design', 'ready'].includes(step) ? null : (
    <BrandPreview
      domain={step === 'website' ? normalizeWebsite(website).domain : target?.domain}
      brand={step === 'review' ? result.brand : null}
      loading={step === 'research' && !failure}
      languageLabel={step === 'review' ? languageLabel : undefined}
    />
  )

  const resumeName = resume?.brand?.name || 'Your brand'
  const resumeLogo = resume ? brandLogo(resume.brand) : null
  const resumeSite = resume ? normalizeWebsite(resume.brand.website || '') : null

  return (
    <div className={cn(appLayer, 'flex min-h-dvh flex-col bg-bk-alt')}>
      <header className="flex items-center justify-between gap-4 px-5 py-4 sm:px-8 sm:py-5">
        <Link href="/" aria-label="Batkle home" className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bk-fg">
          <BatkleLogo size={30} />
        </Link>
        {index < 4 && !manualFlow && <Stepper index={index} />}
        {/* Choosing a design is required, so the design step has no way out but finishing it or going back. */}
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
          (step === 'ready' || step === 'resume') && 'flex items-center justify-center pb-24',
        )}
      >
        <section key={`${step}-${attempt}`} className={cn('min-w-0 motion-safe:animate-bk-rise', step === 'resume' && 'w-full')}>
          {step === 'resume' && (
            <ResumePanel
              visual={<BrandTile name={resumeName} logo={resumeLogo.src} logoOnDark={resumeLogo.onDark} size={88} className="rounded-2xl shadow-bk-card" />}
              steps={resume.manual ? [['basics', 'Basics'], ['design', 'Design']] : STEPS}
              current={resume.manual ? 1 : STEP_INDEX[resume.step]}
              continueLabel={`Continue with ${resumeName}`}
              onContinue={continueResume}
              startOverLabel="Start over"
              onStartOver={startOverFromResume}
              note={`Starting over deletes ${resumeName}${resume.manual ? '' : ' and its research'}.`}
              headingRef={heading}
            >
              {resume.step === 'review'
                ? <>Batkle already researched {resumeSite?.domain || resumeName}. Review what it learned, then pick your designs.</>
                : <>{resumeName} is saved. Pick the designs its posts use and it’s ready.</>}
            </ResumePanel>
          )}
          {step === 'website' && limit && <UpgradeNotice error={limit} className="mb-6 max-w-[560px]" />}
          {step === 'website' && (
            <WebsiteStep
              firstBrand={firstBrand}
              blocked={Boolean(limit)}
              website={website}
              onWebsiteChange={value => { setWebsite(value); setWebsiteError('') }}
              error={websiteError}
              onSubmit={() => research(website)}
              onManual={() => setStep('manual')}
              replacing={result ? result.brand?.name || 'Your brand' : ''}
              headingRef={heading}
            />
          )}
          {step === 'manual' && (
            <ManualStep
              onBack={() => setStep('website')}
              onCreate={createManually}
              initial={result?.manual ? { name: result.brand?.name || '', language: languageChoices(result.brand, contentLanguage).selected } : undefined}
              headingRef={heading}
            />
          )}
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
              onContinue={async values => { await saveReview(values, 'ready'); setAfter('ready'); setStep('design') }}
              onOpenProfile={async values => { await saveReview(values, 'profile'); setAfter('profile'); setStep('design') }}
              onBack={backToWebsite}
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
              onDone={finishDesign}
              onBack={() => setStep(result.manual ? 'manual' : 'review')}
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
