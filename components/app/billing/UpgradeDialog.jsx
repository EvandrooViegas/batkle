'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Loader2 } from 'lucide-react'
import { PAID_PLAN_IDS, PLANS, formatPrice } from '@/lib/billing/plans'
import { planHighlights } from '@/components/landing/pricingText'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { appButton } from '../ui'
import FeatureVisual from './FeatureVisual'
import { billingRequest } from './useBilling'

/** The upgrade button: the app's own primary button, as on every page. A gradient with a glow read as a template. */
export const upgradeButton = appButton('primary', 'md')

/** What the person was trying to do, first in the plan's list: the reason they are here. */
const REASONS = {
  scheduling: 'Schedule calendar and email reminders',
  emailReminders: 'Email reminders when each post is due',
  textReminders: 'Text reminders when each post is due',
  customDesigns: 'Create and share your own designs',
  communityDesigns: 'Every design Batkle members publish',
  teams: 'A team that shares your designs',
  adDesigns: 'Facebook and Instagram ads in every size',
  postVoice: 'New posts in the voice of your own posts',
}

/** The plan's lines for the dialog: the reason first, then what the plan includes (the pricing card's lines). */
export function planBenefits(plan, info = {}) {
  const reason = info.limit === 'brands' ? null : REASONS[info.feature]
  const lines = planHighlights(plan).filter(line => line.included).map(line => line.text)
  return [reason, ...lines.filter(line => line !== reason)].filter(Boolean).slice(0, 6)
}

/**
 * The upgrade itself: what the plan unlocks (the reason first), a choice between the plans that unlock it, and the
 * button that opens checkout. Shown from an UpgradeNotice; `info` is the API's billing details (feature or limit).
 */
export default function UpgradeDialog({ open, onOpenChange, info = {}, current = 'free', target, trialAvailable, eyebrow, visual }) {
  // Plans above the current one that unlock what was asked for.
  const options = PAID_PLAN_IDS.map(id => PLANS[id]).filter(plan => {
    if (PAID_PLAN_IDS.indexOf(plan.id) < PAID_PLAN_IDS.indexOf(current)) return false
    if (plan.id === current) return false
    if (info.feature && info.feature in plan && !plan[info.feature]) return false
    if (info.limit === 'brands' && Number.isFinite(info.used) && plan.brands < info.used + 1) return false
    if (info.limit === 'photos' && Number.isFinite(info.wanted) && plan.photosPerPost < info.wanted) return false
    return true
  })
  const [picked, setPicked] = useState(target?.id)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { if (open) { setPicked(target?.id || options[0]?.id); setError('') } }, [open, target?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const plan = PLANS[picked] || target || options[0]
  if (!plan) return null
  const trial = Boolean(trialAvailable && plan.trialDays)

  const start = async () => {
    setBusy(true); setError('')
    try {
      const result = await billingRequest('/api/billing/checkout', { planId: plan.id, interval: 'month' })
      if (result.url) { window.location.assign(result.url); return }
      // A subscription changed in place: the settings page shows the new plan.
      window.location.assign('/app/settings?checkout=success#plan')
    } catch (e) {
      setError(/failed to fetch|network/i.test(e.message) ? 'Batkle couldn’t reach its server. Check your connection and try again.' : e.message)
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[calc(100dvh-32px)] max-w-[920px] gap-0 overflow-hidden p-0 md:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
        <div className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5 pt-7 sm:px-8">
            <p className="text-[13px] font-semibold text-bk-muted">{eyebrow}</p>
            <DialogTitle className="mt-1.5 font-bk-display text-[26px] font-bold leading-[1.15] tracking-[-0.03em]">
              {trial ? `Try ${plan.name} free for ${plan.trialDays} days` : `Upgrade to ${plan.name}`}
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-[13.5px] text-bk-muted">
              {formatPrice(plan.price.month)} a month{trial ? ' after the trial' : ''}. Cancel anytime.
            </DialogDescription>

            {options.length > 1 && (
              <div role="radiogroup" aria-label="Plan" className="mt-5 space-y-2">
                {options.map(option => (
                  <label key={option.id} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-bk-fg', picked === option.id ? 'border-bk-fg bg-bk-alt' : 'border-bk-field hover:border-bk-fg/50')}>
                    <input type="radio" name="upgrade-plan" value={option.id} checked={picked === option.id} onChange={() => setPicked(option.id)} className="sr-only" />
                    <span aria-hidden="true" className={cn('flex size-[18px] shrink-0 items-center justify-center rounded-full border-2', picked === option.id ? 'border-bk-fg' : 'border-bk-field')}>
                      {picked === option.id && <span className="size-2 rounded-full bg-bk-fg" />}
                    </span>
                    <span className="flex-1"><span className="block text-[14.5px] font-bold">{option.name}</span><span className="block text-[12.5px] text-bk-muted">{option.tagline}</span></span>
                    <span className="text-[13px] font-semibold tabular-nums">{formatPrice(option.price.month)}<span className="font-normal text-bk-muted">/month</span></span>
                  </label>
                ))}
              </div>
            )}

            <p className="mt-5 text-[13.5px] font-bold">What you get with {plan.name}</p>
            <ul className="mt-2 space-y-2">
              {planBenefits(plan, info).map(line => (
                <li key={line} className="flex gap-2.5 text-[14px] leading-snug"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-bk-fg/60" strokeWidth={2.5} />{line}</li>
              ))}
            </ul>
            <Link href="/app/settings#plan" onClick={() => onOpenChange(false)} className="mt-4 inline-block text-[13px] font-semibold text-bk-muted underline underline-offset-4 hover:text-bk-fg">Compare every plan</Link>
          </div>

          <div className="border-t border-bk-line bg-bk-surface px-6 py-4 sm:px-8">
            {error && <p role="alert" className="mb-2 text-[13px] font-semibold text-[#C2412F] dark:text-[#F0826F]">{error}</p>}
            <button type="button" onClick={start} disabled={busy} className={appButton('primary', 'md', 'h-11 w-full text-[14.5px]')}>
              {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              {busy ? 'Opening checkout…' : trial ? `Start the free trial` : `Upgrade to ${plan.name}`}
            </button>
            <p className="mt-2 text-center text-[12px] leading-relaxed text-bk-muted">
              {trial
                ? `Free for ${plan.trialDays} days, then ${formatPrice(plan.price.month)} a month. Cancel before the trial ends and you pay nothing.`
                : `${formatPrice(plan.price.month)} a month. Cancel anytime in a few clicks.`}
            </p>
          </div>
        </div>

        {/* What the plan unlocks, as it really looks. */}
        <div className="hidden items-center justify-center bg-bk-alt p-6 md:flex">
          <FeatureVisual name={visual} current={current} target={plan} className="max-w-[420px]" />
        </div>
      </DialogContent>
    </Dialog>
  )
}
