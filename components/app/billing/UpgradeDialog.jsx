'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Crown, Loader2 } from 'lucide-react'
import { PAID_PLAN_IDS, PLANS, formatPrice } from '@/lib/billing/plans'
import { planHighlights } from '@/components/landing/pricingText'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import FeatureVisual from './FeatureVisual'
import { billingRequest } from './useBilling'

/** The trial button, in Batkle's butter: the one loud thing on an upgrade. */
export const upgradeButton = 'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#FFE27A] via-[#FFD84D] to-[#FFB938] font-bold text-bk-ink shadow-[0_6px_18px_-8px_rgb(242_169_0/0.75)] transition-[filter,transform] hover:brightness-[1.04] active:translate-y-px disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg'

/** What the person was trying to do, first in the plan's list: the reason they are here. */
const REASONS = {
  scheduling: 'Schedule calendar and email reminders',
  emailReminders: 'Email reminders when each post is due',
  textReminders: 'Text reminders when each post is due',
  customDesigns: 'Create and share your own designs',
  communityDesigns: 'Every design Batkle members publish',
  teams: 'A team that shares your designs',
  adDesigns: 'Facebook and Instagram ads in every size',
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
      <DialogContent className="grid max-h-[calc(100dvh-32px)] max-w-[920px] gap-0 overflow-hidden p-0 md:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)]">
        <div className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5 pt-7 sm:px-8">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-bk-fg/80"><Crown aria-hidden="true" className="size-4 text-[#E2A100]" />{eyebrow}</p>
            <DialogTitle className="mt-2 font-bk-display text-[26px] font-bold leading-[1.15] tracking-[-0.03em]">
              {trial ? 'Try ' : 'Upgrade to '}
              <span className="bg-gradient-to-r from-[#E2A100] to-[#ED5125] bg-clip-text text-transparent">Batkle {plan.name}</span>
              {trial ? ' free' : ''}
            </DialogTitle>
            <DialogDescription className="sr-only">Choose a plan and start {trial ? 'the free trial' : 'the upgrade'}.</DialogDescription>

            {options.length > 1 && (
              <div role="radiogroup" aria-label="Plan" className="mt-5 space-y-2">
                {options.map(option => (
                  <label key={option.id} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-bk-fg', picked === option.id ? 'border-[#E2A100] bg-[#FFD84D]/10 ring-1 ring-[#E2A100]' : 'border-bk-line hover:border-bk-fg/40')}>
                    <input type="radio" name="upgrade-plan" value={option.id} checked={picked === option.id} onChange={() => setPicked(option.id)} className="sr-only" />
                    <span aria-hidden="true" className={cn('flex size-[18px] shrink-0 items-center justify-center rounded-full border-2', picked === option.id ? 'border-[#E2A100]' : 'border-bk-field')}>
                      {picked === option.id && <span className="size-2 rounded-full bg-[#E2A100]" />}
                    </span>
                    <span className="flex-1 text-[14.5px] font-bold">Batkle {option.name}</span>
                    <span className="text-right text-[12.5px] text-bk-muted">{option.tagline}<span className="block font-semibold text-bk-fg">{formatPrice(option.price.month)}/month</span></span>
                  </label>
                ))}
              </div>
            )}

            <p className="mt-5 text-[13.5px] font-bold">{plan.name} gives you:</p>
            <ul className="mt-2 space-y-2">
              {planBenefits(plan, info).map(line => (
                <li key={line} className="flex gap-2.5 text-[14px] leading-snug"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#E2A100]" strokeWidth={2.5} />{line}</li>
              ))}
            </ul>
            <Link href="/app/settings#plan" onClick={() => onOpenChange(false)} className="mt-4 inline-block text-[13px] font-semibold text-bk-muted underline underline-offset-4 hover:text-bk-fg">Compare every plan</Link>
          </div>

          <div className="border-t border-bk-line bg-bk-surface px-6 py-4 sm:px-8">
            {error && <p role="alert" className="mb-2 text-[13px] font-semibold text-[#C2412F] dark:text-[#F0826F]">{error}</p>}
            <button type="button" onClick={start} disabled={busy} className={cn(upgradeButton, 'h-12 w-full text-[15px]')}>
              {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Crown aria-hidden="true" className="size-4" />}
              {busy ? 'Opening checkout…' : trial ? `Try ${plan.name} free for ${plan.trialDays} days` : `Upgrade to ${plan.name}`}
            </button>
            <p className="mt-2 text-center text-[12px] leading-relaxed text-bk-muted">
              {trial
                ? `Free for ${plan.trialDays} days, then ${formatPrice(plan.price.month)} a month. Cancel before the trial ends and you pay nothing.`
                : `${formatPrice(plan.price.month)} a month. Cancel anytime in a few clicks.`}
            </p>
          </div>
        </div>

        <div aria-hidden="true" className="relative hidden items-center justify-center overflow-hidden bg-gradient-to-br from-[#FFF4CC] via-[#FDEBD3] to-[#F6E2F0] p-4 dark:from-[#2B2614] dark:via-[#2A2120] dark:to-[#2A2030] md:flex">
          <FeatureVisual name={visual} className="scale-[1.12] drop-shadow-[0_18px_30px_rgba(20,19,26,0.16)]" />
        </div>
      </DialogContent>
    </Dialog>
  )
}
