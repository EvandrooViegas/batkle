'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Coins, Crown } from 'lucide-react'
import { CREDIT_PACK, PLANS, formatBytes, formatPrice } from '@/lib/billing/plans'
import { CREDITS_HREF, billingAction } from '@/lib/client/billing'
import { cn } from '@/lib/utils'
import { appButton } from '../ui'
import { useBilling } from './useBilling'
import FeatureVisual, { visualFor } from './FeatureVisual'
import UpgradeDialog, { upgradeButton } from './UpgradeDialog'

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`
const NEXT = { free: 'pro', pro: 'business' }
// The card goes side by side when its container is at least 540px wide ([@container(min-width:540px)]: classes, written
// out in full so Tailwind finds them); stacked below that (a dialog's side panel, a phone).

// What each feature lets people do: the notice's title and one line, and the dialog's opening words.
const FEATURES = {
  scheduling: ['Schedule your posts', 'Plan the month on a calendar. When a post is due, Batkle reminds you with the slides and caption ready.', 'schedule your posts'],
  emailReminders: ['Get posting reminders', 'An email when each scheduled post is due, with the slides and caption ready to post.', 'get posting reminders'],
  textReminders: ['Get text reminders', 'A text when each scheduled post is due, with a link to the slides and caption.', 'get text reminders'],
  customDesigns: ['Create your own designs', 'Upload examples of a style you like. Batkle turns them into a design for every post, in your brand.', 'create your own designs'],
  // Not plan fields: using a design a member published, and sharing designs with a team (both Pro and Business).
  communityDesigns: ['Use designs made by members', 'Every design Batkle members publish, in your colours, fonts and logo.', 'use designs made by members'],
  teams: ['Share designs with your team', 'Invite people by email. Everyone in the team uses the designs you make.', 'share designs with your team'],
  adDesigns: ['Make Facebook and Instagram ads', 'Your ad in every Meta size, with the text for Ads Manager in a few versions to test.', 'make Facebook and Instagram ads'],
}

/**
 * The plan to suggest: the next one up, so nobody is pushed past what they need. Only when the next plan wouldn't
 * fix this limit (an account already holding as many brands as it allows, a feature it doesn't have) is it the
 * plan the server named.
 */
function suggestedPlan(current, info) {
  const next = PLANS[NEXT[current]]
  const named = PLANS[info.requiredPlan]
  if (!next) return named || null
  if (info.limit === 'brands' && Number.isFinite(info.used) && next.brands < info.used + 1) return named || null
  if (info.feature && info.feature in next && !next[info.feature]) return named || next
  return next
}

/** Title, line and the dialog's eyebrow for this refusal. */
function copyFor(code, info, target) {
  if (code === 'insufficient_credits') return [
    info.available ? `This post needs ${plural(info.needed, 'credit')}. You have ${info.available}.` : 'You’re out of credits for this month.',
    `Top up now and keep going, or get ${target.credits} credits every month with ${target.name}.`,
    'get more credits every month',
  ]
  if (info.limit === 'brands') return [`Add another brand with ${target.name}`, `${target.name} holds ${plural(target.brands, 'brand')}, each with its own profile, designs and posts.`, 'add more brands']
  if (info.limit === 'uploads') return [`More room for your photos with ${target.name}`, `${target.name} holds ${target.uploads.maxBytes ? formatBytes(target.uploads.maxBytes) : plural(target.uploads.maxImages, 'image')} of your own photos.`, 'upload more photos']
  const [title, line, eyebrow] = FEATURES[info.feature] || [`Do more with ${target.name}`, '', `get more from Batkle`]
  return [title, line, eyebrow]
}

/**
 * What a page shows when a plan limit stopped something: a picture of what the next plan unlocks, one line, and one
 * button that opens the upgrade (UpgradeDialog: the plan choice, what it includes, and checkout). Out of credits, the
 * button buys a credit pack and the plan is the alternative. `error` is an Error from apiError (lib/client/billing.js)
 * carrying the API's billing details; `compact` is a one-line version for tight rows.
 */
export default function UpgradeNotice({ error, className = '', compact = false }) {
  const { data } = useBilling()
  const [open, setOpen] = useState(false)
  if (!error) return null
  const info = error.billing || {}
  const code = error.code || info.code
  const summary = data?.summary
  const current = summary?.plan || info.plan || 'free'
  const target = suggestedPlan(current, info)
  const trial = Boolean(target && summary?.trial?.available && target.trialDays)

  // Nothing to move to (the largest plan's limit) or nothing to buy: the API's message and its one action.
  if (!target || code === 'payments_unavailable') {
    const action = billingAction(error)
    return (
      <div role="status" className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl border border-bk-line bg-bk-surface px-4 py-3 text-bk-fg', className)}>
        <p className="min-w-0 text-[13.5px] leading-relaxed">{error.message}</p>
        {code !== 'payments_unavailable' && (action.href.startsWith('mailto:')
          ? <a href={action.href} className={cn(appButton('primary', 'sm'), 'shrink-0')}>{action.label}</a>
          : <Link href={action.href} className={cn(appButton('primary', 'sm'), 'shrink-0')}>{action.label}</Link>)}
      </div>
    )
  }

  const credits = code === 'insufficient_credits'
  const [title, line, eyebrow] = copyFor(code, info, target)
  const cta = trial ? `Try ${target.name} free for ${target.trialDays} days` : `Upgrade to ${target.name}`
  const terms = trial ? `Then ${formatPrice(target.price.month)} a month. Cancel anytime.` : `${formatPrice(target.price.month)} a month. Cancel anytime.`
  const dialog = (
    <UpgradeDialog open={open} onOpenChange={setOpen} info={credits ? {} : info} current={current} target={target} trialAvailable={Boolean(summary?.trial?.available)}
      eyebrow={`Upgrade to ${eyebrow}`} visual={credits ? 'credits' : visualFor(info)} />
  )

  if (compact) {
    return (
      <div role="status" className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[#F2A900]/35 bg-[#FFD84D]/[0.08] px-3 py-2 text-bk-fg', className)}>
        <Crown aria-hidden="true" className="size-4 shrink-0 text-[#E2A100]" />
        <p className="min-w-0 flex-1 text-[13px] font-semibold leading-snug">{title}</p>
        {credits
          ? <Link href={CREDITS_HREF} className={cn(upgradeButton, 'h-8 shrink-0 px-3 text-[12.5px]')}><Coins aria-hidden="true" className="size-3.5" />Buy {CREDIT_PACK.credits} credits</Link>
          : <button type="button" onClick={() => setOpen(true)} className={cn(upgradeButton, 'h-8 shrink-0 px-3 text-[12.5px]')}><Crown aria-hidden="true" className="size-3.5" />{trial ? `Try ${target.name} free` : `Upgrade to ${target.name}`}</button>}
        {dialog}
      </div>
    )
  }

  return (
    <div role="status" className={cn('[container-type:inline-size]', className)}>
      <div className="overflow-hidden rounded-2xl border border-bk-line bg-bk-surface text-bk-fg shadow-bk-card [@container(min-width:540px)]:flex">
        <div aria-hidden="true" className="flex items-center bg-gradient-to-br from-[#FFF4CC] via-[#FDEBD3] to-[#F6E2F0] px-6 py-4 dark:from-[#2B2614] dark:via-[#2A2120] dark:to-[#2A2030] [@container(min-width:540px)]:w-[42%] [@container(min-width:540px)]:shrink-0 [@container(min-width:540px)]:py-6">
          <FeatureVisual name={credits ? 'credits' : visualFor(info)} className="mx-auto max-w-[280px]" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center p-5">
          <p className="text-[15.5px] font-bold leading-snug tracking-[-0.01em]">{title}</p>
          {line && <p className="mt-1 text-[13.5px] leading-relaxed text-bk-muted">{line}</p>}
          {credits ? (
            <>
              <Link href={CREDITS_HREF} className={cn(upgradeButton, 'mt-4 h-11 w-full px-5 text-[14.5px] [@container(min-width:540px)]:w-auto [@container(min-width:540px)]:self-start')}>
                <Coins aria-hidden="true" className="size-4" />Buy {CREDIT_PACK.credits} credits for {formatPrice(CREDIT_PACK.price)}
              </Link>
              <div className="my-3 flex items-center gap-3 text-[12px] text-bk-muted" aria-hidden="true"><span className="h-px flex-1 bg-bk-line" />or<span className="h-px flex-1 bg-bk-line" /></div>
              <button type="button" onClick={() => setOpen(true)} className="rounded-xl border border-bk-line px-4 py-3 text-left transition-colors hover:border-bk-fg/40">
                <span className="flex items-center gap-1.5 text-[14px] font-bold"><Crown aria-hidden="true" className="size-4 text-[#E2A100]" />{target.credits} credits every month with {target.name}</span>
                <span className="mt-0.5 block text-[12.5px] text-bk-muted">{trial ? `Free for ${target.trialDays} days, then ${formatPrice(target.price.month)} a month.` : `${formatPrice(target.price.month)} a month.`}</span>
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setOpen(true)} className={cn(upgradeButton, 'mt-4 h-11 w-full px-5 text-[14.5px] [@container(min-width:540px)]:w-auto [@container(min-width:540px)]:self-start')}>
                <Crown aria-hidden="true" className="size-4" />{cta}
              </button>
              <p className="mt-2 text-[12px] text-bk-muted">{terms}</p>
            </>
          )}
        </div>
      </div>
      {dialog}
    </div>
  )
}
