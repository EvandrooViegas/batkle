'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Coins } from 'lucide-react'
import { CREDIT_PACK, PLANS, formatPrice } from '@/lib/billing/plans'
import { CREDITS_HREF, billingAction } from '@/lib/client/billing'
import { cn } from '@/lib/utils'
import { appButton } from '../ui'
import { useBilling } from './useBilling'
import FeatureVisual, { visualFor } from './FeatureVisual'
import PlanBadge from './PlanBadge'
import UpgradeDialog from './UpgradeDialog'

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`
const NEXT = { free: 'pro', pro: 'business' }
// The card goes side by side when its container is at least 660px wide ([@container(min-width:660px)]: classes, written
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
  postVoice: ['Write like your own posts', 'Add posts you’ve published. Batkle learns how you write, and new posts, stories and ads sound like you.', 'write in the voice of your own posts'],
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
  if (info.limit === 'photos' && Number.isFinite(info.wanted) && next.photosPerPost < info.wanted) return named || null
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
  if (info.limit === 'photos') return [`Add up to ${target.photosPerPost} photos to a post with ${target.name}`, `Each photo gets its own slide, so a longer carousel can tell the whole story.`, 'add more photos to each post']
  const [title, line, eyebrow] = FEATURES[info.feature] || [`Do more with ${target.name}`, '', `get more from Batkle`]
  return [title, line, eyebrow]
}

/** The plan as its badge shows it in the account menu. */
const badgeFor = plan => ({ plan: plan.id, planName: plan.name })

/**
 * What a page shows when a plan limit stopped something: the feature as it really looks (FeatureVisual: real posts,
 * this month's calendar, the plan's numbers), one line, and one button that opens the upgrade (UpgradeDialog: the
 * plan choice, what it includes, and checkout). Out of credits, the button buys a credit pack and the plan is the
 * alternative. Plain app styles only: the yellow button every page uses, no gradients or crowns, which read as a
 * template. `error` is an Error from apiError (lib/client/billing.js) carrying the API's billing details; `compact`
 * is a one-line version for tight rows.
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

  // In a brand shared with this person the limit is the owner's plan: say whose and who to ask (the API's words when
  // it answered, `sharedBy`; for a check made on the page, the shared summary's), with nothing of their own to buy.
  const sharedBy = info.sharedBy || (!error.status && summary?.sharedBy)
  if (sharedBy && code !== 'payments_unavailable') {
    const message = info.sharedBy ? error.message : code === 'insufficient_credits'
      ? `Posts in this brand use ${sharedBy}’s credits, and there aren’t enough left for this. Ask ${sharedBy} to add more.`
      : `This brand runs on ${sharedBy}’s plan, which doesn’t include this. Ask ${sharedBy} to upgrade.`
    return <p role="status" className={cn('rounded-xl bg-bk-surface px-4 py-3 text-[13.5px] leading-relaxed text-bk-fg shadow-bk-card', compact && 'py-2 text-[13px]', className)}>{message}</p>
  }

  // Nothing to move to (the largest plan's limit) or nothing to buy: the API's message and its one action.
  if (!target || code === 'payments_unavailable') {
    const action = billingAction(error)
    return (
      <div role="status" className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl bg-bk-surface px-4 py-3 text-bk-fg shadow-bk-card', className)}>
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
      <div role="status" className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-bk-surface px-3 py-2 text-bk-fg shadow-bk-card', className)}>
        <PlanBadge summary={badgeFor(target)} />
        <p className="min-w-0 flex-1 text-[13px] font-semibold leading-snug">{title}</p>
        {credits
          ? <Link href={CREDITS_HREF} className={appButton('primary', 'xs', 'shrink-0')}><Coins aria-hidden="true" className="size-3.5" />Buy {CREDIT_PACK.credits} credits</Link>
          : <button type="button" onClick={() => setOpen(true)} className={appButton('primary', 'xs', 'shrink-0')}>{trial ? `Try ${target.name} free` : `Upgrade to ${target.name}`}</button>}
        {dialog}
      </div>
    )
  }

  return (
    <div role="status" className={cn('[container-type:inline-size]', className)}>
      <div className="overflow-hidden rounded-2xl bg-bk-surface text-bk-fg shadow-bk-card [@container(min-width:660px)]:flex">
        <div className="bg-bk-alt px-5 py-4 [@container(min-width:660px)]:flex [@container(min-width:660px)]:w-[46%] [@container(min-width:660px)]:shrink-0 [@container(min-width:660px)]:items-center">
          <FeatureVisual name={credits ? 'credits' : visualFor(info)} current={current} target={target} className="mx-auto max-w-[340px]" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center p-5 sm:p-6">
          <p className="flex items-center gap-2 text-[12.5px] font-semibold text-bk-muted"><PlanBadge summary={badgeFor(target)} />{credits ? `${target.credits} credits a month on ${target.name}` : `Included in ${target.name}`}</p>
          <p className="mt-2.5 font-bk-display text-[19px] font-bold leading-tight tracking-[-0.02em]">{title}</p>
          {line && <p className="mt-1.5 text-[13.5px] leading-relaxed text-bk-muted">{line}</p>}
          {credits ? (
            <>
              <Link href={CREDITS_HREF} className={appButton('primary', 'md', 'mt-4 h-10 self-start px-4')}>
                <Coins aria-hidden="true" className="size-4" />Buy {CREDIT_PACK.credits} credits for {formatPrice(CREDIT_PACK.price)}
              </Link>
              <p className="mt-3 text-[13px] text-bk-muted">
                Or get {target.credits} every month: <button type="button" onClick={() => setOpen(true)} className="font-semibold text-bk-fg underline underline-offset-4 hover:no-underline">{trial ? `try ${target.name} free for ${target.trialDays} days` : `upgrade to ${target.name}`}</button>
              </p>
            </>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                <button type="button" onClick={() => setOpen(true)} className={appButton('primary', 'md', 'h-10 px-4')}>{cta}</button>
                <Link href="/app/settings#plan" className="text-[13px] font-semibold text-bk-muted underline-offset-4 hover:text-bk-fg hover:underline">Compare plans</Link>
              </div>
              <p className="mt-2 text-[12px] text-bk-muted">{terms}</p>
            </>
          )}
        </div>
      </div>
      {dialog}
    </div>
  )
}

/**
 * The studio's top bar on the Free plan: the next plan, always in reach. It opens the same dialog as a limit does,
 * with no feature behind it. `summary` is the account's own billing (never a shared brand owner's).
 */
export function UpgradeButton({ summary, className = '' }) {
  const [open, setOpen] = useState(false)
  const current = summary?.plan
  const target = PLANS[NEXT[current]]
  if (!summary || current !== 'free' || !target) return null
  const trial = Boolean(summary.trial?.available && target.trialDays)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={appButton('primary', 'sm', cn('h-9 rounded-full px-4', className))}>
        {trial ? `Try ${target.name} free` : `Upgrade to ${target.name}`}
      </button>
      <UpgradeDialog open={open} onOpenChange={setOpen} current={current} target={target} trialAvailable={Boolean(summary.trial?.available)} eyebrow="You’re on the Free plan" visual="credits" />
    </>
  )
}
