'use client'

import { useState } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import { researchSummary } from '@/lib/client/onboarding'
import { appButton } from '../ui'
import { appField } from '../field'
import { fieldHint, fieldLabel, stepEyebrow, stepHeading, stepLead } from './styles'

const list = value => (Array.isArray(value) ? value : String(value || '').split('\n')).map(v => String(v).trim()).filter(Boolean)
// "AI Automation — Implementation of…" reads as "AI Automation" in a chip.
const shortName = text => text.split(/\s+[—–-]\s+|:\s/)[0].slice(0, 48)

/** Step 3: confirm the name and post language; everything else is shown and stays editable later. `onBack` returns to the website. */
export default function ReviewStep({ result, choices, onContinue, onOpenProfile, onBack, preview, headingRef }) {
  const { brand } = result
  const [name, setName] = useState(brand.name || '')
  const [language, setLanguage] = useState(choices.selected)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')

  const services = list(brand.services).map(shortName)
  const summary = researchSummary(result)

  const submit = async (target, e) => {
    e?.preventDefault()
    if (!name.trim()) return setError('Give your brand a name.')
    setSaving(target)
    setError('')
    try {
      await (target === 'profile' ? onOpenProfile : onContinue)({ name: name.trim(), languageCode: language })
    } catch (err) {
      setError(err.message || 'Your changes could not be saved. Please try again.')
      setSaving('')
    }
  }

  return (
    <div>
      <p className={stepEyebrow}>Step 3 of 4 · Review</p>
      <h1 ref={headingRef} tabIndex={-1} className={stepHeading}>Here’s what we learned</h1>
      <p className={stepLead}>Check the basics. Services, tone, colours and fonts stay editable in the brand profile.</p>
      {summary && <p className="mt-3 text-[13px] font-semibold text-bk-muted">{summary}</p>}

      {preview && <div className="mt-6 lg:hidden">{preview}</div>}

      <form noValidate onSubmit={e => submit('continue', e)} className="mt-8 space-y-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="review-name" className={fieldLabel}>Brand name</label>
            <input id="review-name" value={name} onChange={e => { setName(e.target.value); setError('') }} aria-invalid={!name.trim()} className={appField('mt-2')} />
          </div>
          <div>
            <label htmlFor="review-language" className={fieldLabel}>Post language</label>
            <select id="review-language" value={language} onChange={e => setLanguage(e.target.value)} className={appField('mt-2 cursor-pointer')}>
              {choices.options.map(option => <option key={option.code} value={option.code}>{option.label}</option>)}
            </select>
            <p className={fieldHint}>Ideas, slides and captions are written in this language.</p>
          </div>
        </div>

        {brand.about && (
          <section className="rounded-2xl border border-bk-line bg-bk-surface p-5">
            <h2 className="text-[14px] font-bold">About the business</h2>
            <p className="mt-2 line-clamp-5 whitespace-pre-line text-[14px] leading-relaxed text-bk-fg/80">{brand.about}</p>
          </section>
        )}

        {services.length > 0 && (
          <section className="rounded-2xl border border-bk-line bg-bk-surface p-5">
            <h2 className="text-[14px] font-bold">Services Batkle will write about</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {services.slice(0, 8).map((service, i) => (
                <li key={`${service}-${i}`} className="rounded-full bg-bk-chip px-3 py-1.5 text-[13px] font-semibold">{service}</li>
              ))}
              {services.length > 8 && <li className="rounded-full px-2 py-1.5 text-[13px] text-bk-muted">+{services.length - 8} more</li>}
            </ul>
          </section>
        )}

        {result.logoWarning && (
          <ul className="space-y-2 rounded-2xl border border-[#F2A900]/40 bg-[#F2A900]/[0.08] p-4 text-[13px] leading-relaxed">
            {result.logoWarning && <li className="flex gap-2"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#9A6B00] dark:text-[#F2C14E]" />Logo versions could not be prepared ({String(result.logoWarning).replace(/\.$/, '')}). You can change the logo in the brand profile.</li>}
          </ul>
        )}

        {error && <p role="alert" className="text-[14px] font-semibold text-[#C2412F] dark:text-[#F0826F]">{error}</p>}

        <div className="flex flex-wrap gap-2 border-t border-bk-line pt-6">
          <button type="submit" disabled={Boolean(saving)} className={appButton('primary', 'md', 'h-11 px-5')}>
            {saving === 'continue' ? <Loader2 className="size-4 animate-spin" /> : null}
            Looks good, continue
            {saving !== 'continue' && <ArrowRight className="size-4" />}
          </button>
          <button type="button" onClick={() => submit('profile')} disabled={Boolean(saving)} className={appButton('outline', 'md', 'h-11')}>
            {saving === 'profile' && <Loader2 className="size-4 animate-spin" />}
            Edit the full profile
          </button>
          {onBack && (
            <button type="button" onClick={onBack} disabled={Boolean(saving)} className={appButton('quiet', 'md', 'h-11 sm:ml-auto')}>
              <ArrowLeft className="size-4" />Back to website
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
