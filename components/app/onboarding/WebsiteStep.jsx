'use client'

import { useState } from 'react'
import { ArrowLeft, ArrowRight, Globe, Loader2, PenLine } from 'lucide-react'
import { POST_LANGUAGES } from '@/lib/client/onboarding'
import { cn } from '@/lib/utils'
import { appButton } from '../ui'
import { appField } from '../field'
import { fieldHint, fieldLabel, stepEyebrow, stepHeading, stepLead } from './styles'

/**
 * Step 1: the website to research. `replacing` names the brand this onboarding already made, when someone came
 * back here from its review: the same site updates it, a different one replaces it.
 */
/** `blocked`: the plan has no room for another brand (the notice above says why), so nothing here can start one. */
export function WebsiteStep({ firstBrand, website, onWebsiteChange, error, onSubmit, onManual, replacing, headingRef, blocked = false }) {
  return (
    <div>
      <p className={stepEyebrow}>Step 1 of 4 · Website</p>
      <h1 ref={headingRef} tabIndex={-1} className={stepHeading}>{firstBrand ? 'Let’s add your first brand' : 'Add a new brand'}</h1>
      <p className={stepLead}>
        Paste your website. Batkle reads up to five pages to learn what you sell, how you speak, and your colours, fonts and logo, then shows you the profile to check.
      </p>

      {replacing && (
        <p className="mt-5 max-w-[560px] rounded-xl border border-bk-line bg-bk-surface px-4 py-3 text-[14px] leading-relaxed text-bk-fg/85">
          <strong className="font-bold">{replacing}</strong> is saved. Researching its own site again refreshes it; a different website replaces it.
        </p>
      )}

      <form noValidate onSubmit={e => { e.preventDefault(); onSubmit() }} className="mt-8">
        <label htmlFor="onboarding-website" className={fieldLabel}>Website address</label>
        <div className={cn(
          'mt-2 flex items-center gap-2 rounded-xl border-2 bg-bk-surface p-1.5 pl-4 transition-shadow focus-within:shadow-[0_0_0_4px_rgb(255_216_77/0.55)]',
          error ? 'border-[#C2412F]' : 'border-bk-fg',
        )}>
          <Globe aria-hidden="true" className="size-5 shrink-0 text-bk-muted" />
          <input
            id="onboarding-website"
            name="website"
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            autoFocus={!blocked}
            disabled={blocked}
            placeholder="yourbrand.com"
            value={website}
            onChange={e => onWebsiteChange(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'onboarding-website-error' : 'onboarding-website-hint'}
            className="h-12 min-w-0 flex-1 bg-transparent text-[17px] text-bk-fg outline-none placeholder:text-bk-muted/80"
          />
          <button type="submit" disabled={blocked} className={appButton('ink', 'md', 'h-12 px-5 text-[15px]')}>
            <span className="hidden sm:inline">Start research</span><span className="sm:hidden">Start</span>
            <ArrowRight className="size-4" />
          </button>
        </div>
        {error
          ? <p id="onboarding-website-error" role="alert" className="mt-2 text-[14px] font-semibold text-[#C2412F] dark:text-[#F0826F]">{error}</p>
          : <p id="onboarding-website-hint" className={fieldHint}>Takes about a minute. Useful photos from your site are added to your gallery.</p>}
      </form>

      <div className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-bk-line pt-6 text-[14px] text-bk-muted">
        No website yet?
        <button type="button" onClick={onManual} disabled={blocked} className="inline-flex items-center gap-1.5 font-bold text-bk-fg underline decoration-bk-field underline-offset-4 hover:decoration-bk-fg disabled:cursor-not-allowed disabled:opacity-50">
          <PenLine className="size-4" />Set up your brand by hand
        </button>
      </div>
    </div>
  )
}

/** Without a website: name and post language now, everything else in the brand profile. `initial` refills it on the way back. */
export function ManualStep({ onBack, onCreate, initial, headingRef }) {
  const [name, setName] = useState(initial?.name || '')
  const [language, setLanguage] = useState(POST_LANGUAGES.some(o => o.code === initial?.language) ? initial.language : 'en-US')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  const submit = async e => {
    e.preventDefault()
    if (!name.trim()) return setError('Give your brand a name.')
    setCreating(true)
    setError('')
    try {
      await onCreate({ name: name.trim(), option: POST_LANGUAGES.find(o => o.code === language) })
    } catch (err) {
      setError(err.message || 'The brand could not be created. Please try again.')
      setCreating(false)
    }
  }

  return (
    <div>
      <p className={stepEyebrow}>Manual setup</p>
      <h1 ref={headingRef} tabIndex={-1} className={stepHeading}>Set up your brand by hand</h1>
      <p className={stepLead}>Add the basics now. You can describe your services, audience, colours and fonts in the brand profile next.</p>

      <form noValidate onSubmit={submit} className="mt-8 max-w-[480px] space-y-5">
        <div>
          <label htmlFor="manual-name" className={fieldLabel}>Brand name</label>
          <input
            id="manual-name"
            autoFocus
            value={name}
            onChange={e => { setName(e.target.value); setError('') }}
            aria-invalid={Boolean(error) && !name.trim()}
            placeholder="Acme Studio"
            className={appField('mt-2')}
          />
        </div>
        <div>
          <label htmlFor="manual-language" className={fieldLabel}>Post language</label>
          <select id="manual-language" value={language} onChange={e => setLanguage(e.target.value)} className={appField('mt-2 cursor-pointer')}>
            {POST_LANGUAGES.map(option => <option key={option.code} value={option.code}>{option.label}</option>)}
          </select>
          <p className={fieldHint}>Ideas, slides and captions are written in this language.</p>
        </div>
        {error && <p role="alert" className="text-[14px] font-semibold text-[#C2412F] dark:text-[#F0826F]">{error}</p>}
        <div className="flex flex-wrap gap-2 pt-2">
          <button type="submit" disabled={creating} className={appButton('primary', 'md', 'h-11 px-5')}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : null}
            {creating ? 'Saving…' : initial ? 'Continue' : 'Create brand'}
          </button>
          <button type="button" onClick={onBack} disabled={creating} className={appButton('quiet', 'md', 'h-11')}>
            <ArrowLeft className="size-4" />Use a website instead
          </button>
        </div>
      </form>
    </div>
  )
}
