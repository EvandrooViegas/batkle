'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Coins, CreditCard, ExternalLink, Loader2, Sparkles } from 'lucide-react'
import { CONTACT, CREDIT_PACK, PAID_PLAN_IDS, PLANS, SLIDES_PER_POST, TRIAL, approxPosts, formatBytes, formatPrice, isComingSoon, isInterval, isPaidPlanId } from '@/lib/billing/plans'
import { contactHref } from '@/lib/client/billing'
import { cn } from '@/lib/utils'
import PlanComparison from '../billing/PlanComparison'
import { announceCreditsChanged, billingRequest, useBilling } from '../billing/useBilling'
import { Eyebrow, Notice, SegmentedTabs, appButton, panelClass } from '../ui'

const RANK = { free: 0, pro: 1, business: 2 }
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`
const dateText = value => (value ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value)) : '')
const freeMonths = plan => Math.max(0, Math.round(12 - plan.price.year / plan.price.month))
const YEARLY_SAVING = Math.min(...PAID_PLAN_IDS.map(id => freeMonths(PLANS[id])))
// Text reminders say nothing about counts while they are "Coming soon" (COMING_SOON in plans.ts).
const TEXTS_SOON = isComingSoon('textReminders')
const TRIAL_TEXTS = TEXTS_SOON ? '' : ` and ${plural(TRIAL.textReminders, 'text reminder')}`

/** What a change to the plan or credits looks like, to notice when the webhook has caught up. */
const signature = summary => JSON.stringify(summary && [summary.plan, summary.status, summary.interval, summary.trial?.active, summary.cancelAtPeriodEnd, summary.hasSubscription, summary.credits?.allowance, summary.credits?.left, summary.credits?.extra])

function priceParts(plan, period) {
  if (period === 'year') return { amount: formatPrice(plan.price.year), unit: 'a year', detail: `≈ ${formatPrice(Math.round((plan.price.year / 12) * 100) / 100)} a month, billed yearly` }
  return { amount: formatPrice(plan.price.month), unit: 'a month', detail: 'Billed monthly' }
}

function highlights(plan) {
  return [
    plural(plan.brands, 'brand'),
    `${plan.credits} credits a month (≈ ${plural(approxPosts(plan.credits), 'post')})`,
    plan.imageQuality === 'high' ? 'High-quality AI images' : 'Standard AI images',
    plan.uploads.maxBytes != null ? `${formatBytes(plan.uploads.maxBytes)} for your own images` : `Up to ${plan.uploads.maxImages} of your own images`,
    plan.scheduling && 'Schedule calendar and email reminders',
    plan.textReminders > 0 && !TEXTS_SOON && `${plural(plan.textReminders, 'text reminder')} a month`,
  ].filter(Boolean)
}

/** The plan card's button: the trial when there is one to start, else an upgrade or a switch. */
function choiceLabel(plan, period, summary) {
  if (summary.plan === plan.id && (summary.interval || 'month') === period) return 'Current plan'
  if (summary.trial.available && plan.trialDays) return `Start ${plan.trialDays}-day free trial`
  if (summary.plan === plan.id) return `Switch to ${period === 'year' ? 'yearly' : 'monthly'}`
  return RANK[plan.id] > RANK[summary.plan] ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`
}

function Section({ id, title, description, actions, children }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 id={`${id}-heading`} className="font-bk-display text-[21px] font-bold tracking-[-0.02em]">{title}</h2>
          {description && <p className="mt-1 text-[13.5px] text-bk-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

function Meter({ value, max, label, className = '' }) {
  const share = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)} className={cn('h-2 overflow-hidden rounded-full bg-bk-alt', className)}>
      <div className={cn('h-full rounded-full transition-[width] duration-500', share >= 100 ? 'bg-[#C2412F]' : 'bg-bk-butter')} style={{ width: `${share}%` }} />
    </div>
  )
}

/** The plan the account is on, with what is about to happen to it. */
function CurrentPlan({ summary }) {
  const plan = PLANS[summary.plan]
  const paid = summary.plan !== 'free'
  const price = paid && formatPrice(plan.price[summary.interval || 'month'])
  const per = summary.interval === 'year' ? 'a year' : 'a month'
  let line = `${plural(plan.brands, 'brand')} and ${plan.credits} credits a month. Upgrade whenever you like.`
  if (summary.trial.active && summary.cancelAtPeriodEnd) line = `Free trial until ${dateText(summary.trial.endsAt)}. You’ve cancelled, so it ends then and nothing is charged.`
  else if (summary.trial.active) line = `Free trial until ${dateText(summary.trial.endsAt)}. Then ${price} ${per}, unless you cancel before.`
  else if (paid && summary.cancelAtPeriodEnd) line = `Ends on ${dateText(summary.currentPeriodEnd)}. You keep ${plan.name} until then.`
  else if (paid) line = `${price} ${per}${summary.currentPeriodEnd ? ` · renews ${dateText(summary.currentPeriodEnd)}` : ''}`
  return (
    <div className={cn(panelClass, 'mt-4 p-5')}>
      <Eyebrow>Current plan</Eyebrow>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-bk-display text-[26px] font-bold leading-tight tracking-[-0.03em]">{plan.name}</p>
        {summary.trial.active && <span className="rounded-full bg-bk-butter px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-bk-ink">Trial</span>}
        {paid && summary.interval && !summary.trial.active && <span className="text-[13px] font-semibold text-bk-muted">{summary.interval === 'year' ? 'Yearly' : 'Monthly'}</span>}
      </div>
      <p className="mt-1 text-[13.5px] text-bk-fg/80">{line}</p>
      {summary.trial.active && <p className="mt-1 text-[12.5px] text-bk-muted">During the trial you have {TRIAL.credits} credits{TRIAL_TEXTS}; the full allowance starts with the first payment.</p>}
      {paid && summary.cancelAtPeriodEnd && <Notice tone="warning" className="mt-3">Your plan is set to end. To keep it, renew it in Manage billing.</Notice>}
      {summary.status === 'past_due' && <Notice tone="warning" className="mt-3">Your last payment didn’t go through. Update your card in Manage billing to keep {plan.name}.</Notice>}
      {summary.status === 'unpaid' && <Notice tone="warning" className="mt-3">Payments for your plan failed, so you’re on Free for now. Update your card in Manage billing to get it back.</Notice>}
      {summary.status === 'incomplete' && <Notice className="mt-3">Your payment is still being confirmed. This page shows your plan as soon as it’s done.</Notice>}
    </div>
  )
}

function PlanCard({ plan, period, summary, picked, disabled, busy, onChoose }) {
  const opening = summary.hasSubscription ? 'Opening billing…' : 'Opening checkout…'
  const { amount, unit, detail } = priceParts(plan, period)
  const label = choiceLabel(plan, period, summary)
  const current = label === 'Current plan'
  const featured = picked || (!summary.hasSubscription && plan.popular)
  return (
    <li id={`plan-${plan.id}`} className={cn(panelClass, 'flex scroll-mt-24 flex-col p-5 transition-shadow', picked ? 'ring-2 ring-bk-fg ring-offset-2 ring-offset-bk-alt' : featured && 'border-bk-fg/40')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bk-display text-[19px] font-bold tracking-[-0.02em]">{plan.name}</h3>
        {picked ? <span className="rounded-full bg-bk-fg px-2 py-0.5 text-[11px] font-bold text-bk-bg">Your pick</span>
          : current ? <span className="rounded-full bg-bk-alt px-2 py-0.5 text-[11px] font-bold text-bk-muted">Your plan</span>
            : plan.popular && <span className="rounded-full bg-bk-butter px-2 py-0.5 text-[11px] font-bold text-bk-ink">Most popular</span>}
      </div>
      <p className="mt-0.5 text-[13px] text-bk-muted">{plan.tagline}</p>
      <p className="mt-4 flex items-baseline gap-1.5">
        <span className="font-bk-display text-[32px] font-bold leading-none tracking-[-0.03em] tabular-nums">{amount}</span>
        <span className="text-[13px] font-semibold text-bk-muted">{unit}</span>
      </p>
      <p className="mt-1 text-[12.5px] text-bk-muted">{detail}</p>
      <ul className="mt-4 flex-1 space-y-1.5 text-[13px]">
        {highlights(plan).map(text => (
          <li key={text} className="flex gap-2"><span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-bk-fg/60" />{text}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onChoose}
        disabled={current || disabled}
        aria-label={current ? `${plan.name} ${period === 'year' ? 'yearly' : 'monthly'} is your current plan` : undefined}
        className={appButton(current ? 'outline' : 'primary', 'md', 'mt-5 h-10 w-full')}
      >
        {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
        {busy ? opening : label}
      </button>
    </li>
  )
}

function UsageTile({ title, value, note, meter }) {
  return (
    <div className={cn(panelClass, 'p-4')}>
      <p className="text-[12px] font-semibold text-bk-muted">{title}</p>
      <p className="mt-1 font-bk-display text-[18px] font-bold tracking-[-0.02em] tabular-nums">{value}</p>
      {meter && <Meter {...meter} className="mt-2.5" />}
      {note && <p className="mt-2 text-[12px] leading-relaxed text-bk-muted">{note}</p>}
    </div>
  )
}

function Usage({ summary }) {
  const { texts, brands, uploads } = summary
  const images = uploads.maxImages != null
    ? { value: `${uploads.images} of ${uploads.maxImages}`, meter: { value: uploads.images, max: uploads.maxImages, label: 'Your images' }, note: 'Images you upload yourself.' }
    : uploads.maxBytes != null
      ? { value: `${formatBytes(uploads.bytes)} of ${formatBytes(uploads.maxBytes)}`, meter: { value: uploads.bytes, max: uploads.maxBytes, label: 'Space for your images' }, note: `${plural(uploads.images, 'image')} you uploaded.` }
      : { value: plural(uploads.images, 'image'), note: 'Images you upload yourself.' }
  return (
    <div className={cn('mt-3 grid gap-3', TEXTS_SOON ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
      {!TEXTS_SOON && (
        <UsageTile
          title="Text reminders"
          value={texts.allowance ? `${texts.left} of ${texts.allowance} left` : 'Not on Free'}
          meter={texts.allowance ? { value: texts.used, max: texts.allowance, label: 'Text reminders used this month' } : null}
          note={texts.allowance ? 'They renew with your credits each month.' : 'Pro and Business include text reminders.'}
        />
      )}
      <UsageTile
        title="Brands"
        value={`${brands.used} of ${brands.max}`}
        meter={{ value: brands.used, max: brands.max, label: 'Brands used' }}
        note={brands.used > brands.max ? 'More than your plan includes: they all keep working, but you can’t add another.' : null}
      />
      <UsageTile title="Your images" {...images} />
    </div>
  )
}

/**
 * The plan, credits and billing part of /app/settings: the current plan (#plan) with Pro and Business to choose,
 * the comparison table, and the credits and usage (#credits). Checkout happens on Stripe's pages; back here with
 * ?checkout=success it waits for the webhook to catch up. The pricing page links here with ?plan=&interval= to
 * preselect a plan; nothing is bought without a click.
 */
export default function BillingSettings() {
  const billing = useBilling()
  const { data } = billing
  const summary = data?.summary || null
  const [period, setPeriod] = useState('month')
  const [picked, setPicked] = useState(null)
  const [checkout, setCheckout] = useState(null)
  const [busy, setBusy] = useState(null)
  const [actionError, setActionError] = useState(null)
  const announced = useRef(null)
  const scrolled = useRef(false)
  const intervalFromUrl = useRef(false)

  // The query the pricing page and Stripe send back with, read once and then taken off the address.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const plan = params.get('plan'), interval = params.get('interval'), result = params.get('checkout')
    if (isPaidPlanId(plan)) setPicked(plan)
    if (isInterval(interval)) { setPeriod(interval); intervalFromUrl.current = true }
    if (result === 'success') setCheckout('updating')
    if (result === 'cancelled') setCheckout('cancelled')
    if (plan || interval || result) {
      for (const key of ['plan', 'interval', 'checkout']) params.delete(key)
      const query = params.toString()
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
    }
  }, [])

  // Show the account's own billing period once known, unless the person came for a particular one.
  const periodSet = useRef(false)
  useEffect(() => {
    if (!summary || periodSet.current) return
    periodSet.current = true
    if (!intervalFromUrl.current && summary.interval) setPeriod(summary.interval)
  }, [summary])

  // Credit meters elsewhere on the page (and in other tabs' sidebars on their next load) follow this one.
  useEffect(() => {
    if (!summary) return
    const key = signature(summary)
    if (announced.current === key) return
    announced.current = key
    announceCreditsChanged()
  }, [summary])

  // Opens the section asked for once there is something to show: the plan picked on the pricing page (whatever the
  // hash; sign-up drops it), else #plan or #credits.
  useEffect(() => {
    if (!data || scrolled.current) return
    scrolled.current = true
    const hash = window.location.hash.slice(1)
    const target = document.getElementById(picked ? `plan-${picked}` : ['plan', 'credits'].includes(hash) ? hash : '')
    if (!target) return
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    requestAnimationFrame(() => target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: picked ? 'center' : 'start' }))
  }, [data, picked])

  // Back from checkout: Stripe tells Batkle a moment later, so look again a few times until the change shows.
  const loaded = Boolean(data)
  useEffect(() => {
    if (checkout !== 'updating' || !loaded) return
    const before = signature(data.summary)
    let tries = 0, timer = null, live = true
    const look = async () => {
      tries += 1
      const next = await billing.load()
      if (!live) return
      if ((next && signature(next.summary) !== before) || tries >= 6) setCheckout('done')
      else timer = setTimeout(look, 2500)
    }
    timer = setTimeout(look, 1500)
    return () => { live = false; clearTimeout(timer) }
  }, [checkout, loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // Coming back from Stripe with the browser's back button restores the page as it was left: busy.
  useEffect(() => {
    const onShow = event => { if (event.persisted) { setBusy(null); billing.load() } }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [billing.load]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = useCallback(async (key, path, body) => {
    setBusy(key)
    setActionError(null)
    try {
      const result = await billingRequest(path, body)
      if (result.url) { window.location.assign(result.url); return }
      if (result.updated) { setCheckout('updating'); await billing.load() }
    } catch (error) {
      setActionError(/failed to fetch|network/i.test(error.message) ? 'Batkle couldn’t reach its server. Check your connection and try again.' : error.message)
    }
    setBusy(null)
  }, [billing])

  const configured = Boolean(data?.paymentsConfigured)
  const disabled = !configured || Boolean(busy)
  const contact = contactHref()
  const manage = data?.portal && (
    <button type="button" onClick={() => act('portal', '/api/billing/portal', {})} disabled={disabled} className={appButton('outline', 'sm')}>
      {busy === 'portal' ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <CreditCard aria-hidden="true" className="size-4" />}
      Manage billing
      <ExternalLink aria-hidden="true" className="size-3.5 text-bk-muted" />
    </button>
  )

  return (
    <div className="space-y-10">
      <Section id="plan" title="Plan & billing" description="Your plan, and what each one includes." actions={manage}>
        <div aria-live="polite" className="space-y-3 [&>*:first-child]:mt-4">
          {checkout === 'updating' && <Notice tone="success" className="flex items-center gap-2"><Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />Payment received, thank you. Updating your plan…</Notice>}
          {checkout === 'done' && <Notice tone="success">Payment received, thank you. You’re all set{summary && summary.plan !== 'free' ? ` on ${summary.planName}` : ''}. If something looks off, refresh in a minute.</Notice>}
          {checkout === 'cancelled' && <Notice>Checkout cancelled. Nothing was charged.</Notice>}
          {actionError && <Notice tone="error">{actionError}</Notice>}
          {data && !configured && <Notice tone="warning">Payments aren’t set up yet, so plans and credits can’t be bought right now. Please try again later.</Notice>}
        </div>

        {billing.error && !data && (
          <Notice tone="error" className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span>{billing.error}</span>
            <button type="button" onClick={billing.load} className={appButton('outline', 'sm')}>Try again</button>
          </Notice>
        )}
        {!data && !billing.error && (
          <div role="status" aria-label="Loading your plan" className="mt-4 space-y-3">
            <div className="h-[120px] rounded-2xl bg-bk-surface motion-safe:animate-pulse" />
            <div className="grid gap-3 sm:grid-cols-2">{[0, 1].map(i => <div key={i} className="h-[340px] rounded-2xl bg-bk-surface motion-safe:animate-pulse" />)}</div>
          </div>
        )}

        {summary && (
          <>
            <CurrentPlan summary={summary} />
            <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-bk-display text-[16px] font-bold tracking-[-0.015em]">{summary.plan === 'free' ? 'Upgrade' : 'Change plan'}</h3>
              <SegmentedTabs
                label="Billing period"
                value={period}
                onChange={setPeriod}
                items={[['month', 'Monthly'], ['year', YEARLY_SAVING ? `Yearly · ${plural(YEARLY_SAVING, 'month')} free` : 'Yearly']]}
              />
            </div>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {PAID_PLAN_IDS.map(id => (
                <PlanCard
                  key={id}
                  plan={PLANS[id]}
                  period={period}
                  summary={summary}
                  picked={picked === id}
                  disabled={disabled}
                  busy={busy === id}
                  onChoose={() => act(id, '/api/billing/checkout', { planId: id, interval: period })}
                />
              ))}
            </ul>
            <p className="mt-3 text-[12.5px] leading-relaxed text-bk-muted">
              {summary.trial.available
                ? `The ${TRIAL.days}-day free trial needs a card and runs once per account, with ${TRIAL.credits} credits${TRIAL_TEXTS}. Unless you cancel before it ends, it becomes the paid plan. `
                : summary.hasSubscription ? 'Changing plan shows the exact amount to confirm first; the difference is prorated. ' : ''}
              Have a discount code? Enter it at checkout.
              {summary.plan !== 'free' && ' To move back to Free, cancel in Manage billing; you keep your plan until the period ends.'}
            </p>

            <h3 className="mt-8 font-bk-display text-[16px] font-bold tracking-[-0.015em]">What each plan includes</h3>
            <PlanComparison current={summary.plan} className="mt-3" />
            <p className="mt-3 text-[12.5px] text-bk-muted">
              {contact ? <a href={contact} className="font-semibold text-bk-fg underline underline-offset-4">{CONTACT.label}</a> : CONTACT.label}
            </p>
          </>
        )}
      </Section>

      <Section
        id="credits"
        title="Credits & usage"
        description="One credit makes one image: a single post costs 1, a carousel 1 per slide."
      >
        {!summary && !billing.error && <div role="status" aria-label="Loading your credits" className="mt-4 h-[180px] rounded-2xl bg-bk-surface motion-safe:animate-pulse" />}
        {summary && (
          <>
            <div className={cn(panelClass, 'mt-4 p-5')}>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="flex items-baseline gap-2">
                    <span className="font-bk-display text-[34px] font-bold leading-none tracking-[-0.03em] tabular-nums">{summary.credits.left}</span>
                    <span className="text-[14px] font-semibold">{summary.credits.left === 1 ? 'credit' : 'credits'} left</span>
                  </p>
                  <p className="mt-1.5 text-[13px] text-bk-muted">≈ {plural(summary.credits.approxPosts, 'post')} of {SLIDES_PER_POST} slides</p>
                </div>
                <button type="button" onClick={() => act('credits', '/api/billing/checkout', { credits: true })} disabled={disabled} className={appButton('primary', 'md')}>
                  {busy === 'credits' ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Coins aria-hidden="true" className="size-4" />}
                  {busy === 'credits' ? 'Opening checkout…' : `Buy ${CREDIT_PACK.credits} credits for ${formatPrice(CREDIT_PACK.price)}`}
                </button>
              </div>
              <Meter value={summary.credits.used} max={summary.credits.allowance} label="This month’s credits used" className="mt-5" />
              {summary.trial.active ? (
                // A trial is capped (TRIAL), which can look like the wrong plan: say so where the number is.
                <p className="mt-2 text-[12.5px] leading-relaxed text-bk-fg/80">
                  {summary.credits.used} of {summary.credits.allowance} trial credits used.{' '}
                  <strong className="font-semibold">Your {PLANS[summary.plan].credits} credits a month start{summary.trial.endsAt ? ` on ${dateText(summary.trial.endsAt)}` : ''}, with the first payment.</strong>
                </p>
              ) : (
                <p className="mt-2 text-[12.5px] text-bk-muted">
                  {summary.credits.used} of {summary.credits.allowance} used this month · renews {dateText(summary.credits.renewsAt)}
                </p>
              )}
              <p className="mt-3 flex gap-2 border-t border-bk-line pt-3 text-[12.5px] leading-relaxed text-bk-fg/80">
                <Sparkles aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-bk-muted" />
                {summary.credits.extra
                  ? `Plus ${plural(summary.credits.extra, 'extra credit')}: they never expire and are used once the month’s credits run out.`
                  : 'Extra credits never expire and are used once the month’s credits run out.'}
              </p>
            </div>
            <Usage summary={summary} />
          </>
        )}
      </Section>
    </div>
  )
}
