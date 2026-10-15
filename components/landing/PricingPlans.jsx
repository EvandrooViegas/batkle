'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Check, Minus } from 'lucide-react'
import { PLANS, PLAN_IDS, pricingRows } from '@/lib/billing/plans'
import { buttonClass, cn, displayClass, liftClass, reveal } from './brand'
import { planCta, planHighlights, priceParts, yearlySavingLabel } from './pricingText'

const INTERVAL_OPTIONS = [
  { id: 'month', label: 'Monthly' },
  { id: 'year', label: 'Yearly' },
]

/** Monthly / Yearly, as a radio group so arrow keys move between the two. */
function IntervalSwitch({ interval, onChange }) {
  const saving = yearlySavingLabel()
  return (
    <fieldset className="shrink-0">
      <legend className="sr-only">Billing period</legend>
      <div className="inline-flex rounded-full border border-bk-field bg-bk-surface p-1">
        {INTERVAL_OPTIONS.map((option) => (
          <label key={option.id} className="cursor-pointer">
            <input
              type="radio"
              name="bk-billing-period"
              value={option.id}
              checked={interval === option.id}
              onChange={() => onChange(option.id)}
              className="peer sr-only"
            />
            <span className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[14px] font-bold text-bk-fg/80 transition-colors hover:text-bk-fg peer-checked:bg-bk-fg peer-checked:text-bk-bg peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-bk-fg min-[380px]:gap-2 min-[380px]:px-4 min-[380px]:text-[15px]">
              {option.label}
              {option.id === 'year' && saving && (
                <span className="rounded-full bg-bk-butter px-1.5 py-0.5 text-[11px] font-bold text-bk-ink min-[380px]:px-2 min-[380px]:text-[12px]">{saving}</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function PlanCard({ plan, interval, startHref, i }) {
  const price = priceParts(plan, interval)
  const cta = planCta(plan, interval, startHref)
  return (
    <div
      {...reveal(i + 2)}
      className={cn(
        'relative flex flex-col rounded-2xl border bg-bk-surface p-6 lg:p-8',
        plan.popular ? 'border-bk-fg shadow-bk-pop' : 'border-bk-line shadow-bk-card',
        liftClass,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-bk-display text-[19px] font-bold tracking-[-0.02em]">{plan.name}</h3>
        {plan.popular && (
          <span className="rounded-full bg-bk-butter px-3 py-1 text-[12px] font-bold text-bk-ink md:absolute md:right-5 md:top-0 md:-translate-y-1/2 lg:static lg:translate-y-0">
            Most popular
          </span>
        )}
      </div>
      <p className="mt-1 text-[15px] text-bk-muted">{plan.tagline}</p>
      <p className="mt-6 flex flex-wrap items-baseline gap-x-2">
        <span className={cn(displayClass, 'text-[40px] leading-none lg:text-[46px]')}>{price.amount}</span>
        {price.unit && <span className="text-[16px] font-bold text-bk-muted">{price.unit}</span>}
      </p>
      <p className="mt-2 text-[14px] text-bk-muted">{price.detail}</p>
      <ul className="mt-6 space-y-3 border-t border-bk-line pt-6 text-[15.5px]">
        {planHighlights(plan).map((line) => (
          <li key={line.text} className={cn('flex gap-2.5', !line.included && 'text-bk-muted')}>
            {line.included ? (
              <Check className="mt-[3px] size-4 shrink-0" strokeWidth={3} aria-hidden="true" />
            ) : (
              <Minus className="mt-[3px] size-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            )}
            {line.text}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-8">
        <Link href={cta.href} className={buttonClass(plan.popular ? 'primary' : 'outline', 'md', 'w-full')}>
          {cta.label}
        </Link>
        <p className="mt-3 text-center text-[13px] text-bk-muted">{cta.note}</p>
      </div>
    </div>
  )
}

function Cell({ value }) {
  if (value === true) {
    return (
      <>
        <Check className="mx-auto size-[18px]" strokeWidth={3} aria-hidden="true" />
        <span className="sr-only">Included</span>
      </>
    )
  }
  if (value === false) {
    return (
      <>
        <Minus className="mx-auto size-[18px] text-bk-muted" aria-hidden="true" />
        <span className="sr-only">Not included</span>
      </>
    )
  }
  return value
}

/**
 * Every plan side by side. On phones the table scrolls sideways inside its card, with the first column pinned. The
 * card is `relative` so the cells' screen-reader text (absolutely positioned) is clipped by it instead of widening
 * the page.
 */
function ComparisonTable({ interval }) {
  const plans = PLAN_IDS.map((id) => PLANS[id])
  return (
    <div {...reveal(2)} className="mt-16 sm:mt-20">
      <h3 id="bk-compare-plans" className="font-bk-display text-[24px] font-bold leading-tight tracking-[-0.02em]">
        Compare plans
      </h3>
      <p className="mt-2 text-[14px] text-bk-muted sm:hidden">Swipe the table sideways to see every plan.</p>
      <div
        role="region"
        aria-labelledby="bk-compare-plans"
        tabIndex={0}
        className="relative mt-6 overflow-x-auto rounded-2xl border border-bk-line bg-bk-surface shadow-bk-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg"
      >
        <table className="w-full min-w-[540px] border-separate border-spacing-0 text-left text-[14px] sm:text-[15px]">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 w-[150px] border-bk-line bg-bk-surface px-4 py-4 max-sm:border-r sm:w-[36%] sm:px-6">
                <span className="sr-only">Feature</span>
              </th>
              {plans.map((plan) => {
                const price = priceParts(plan, interval)
                return (
                  <th key={plan.id} scope="col" className="px-3 py-4 text-center align-bottom sm:px-4">
                    <span className="block font-bk-display text-[17px] font-bold tracking-[-0.02em]">{plan.name}</span>
                    <span className="mt-0.5 block text-[13px] font-normal text-bk-muted">
                      {price.amount}
                      {price.unit && ` ${price.unit}`}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {pricingRows().map((row) => (
              <tr key={row.label}>
                <th scope="row" className="sticky left-0 z-10 border-t border-bk-line bg-bk-surface px-4 py-3.5 font-normal max-sm:border-r sm:px-6">
                  {row.label}
                </th>
                {row.values.map((value, i) => (
                  <td key={PLAN_IDS[i]} className="border-t border-bk-line px-3 py-3.5 text-center tabular-nums sm:px-4">
                    {row.comingSoon && typeof value === 'string' ? <span className="whitespace-nowrap text-[13px] font-semibold text-bk-muted">{value}</span> : <Cell value={value} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** The plan cards and the comparison table, sharing one Monthly / Yearly switch. */
export default function PricingPlans({ startHref, intro }) {
  const [interval, setBillingInterval] = useState('month')
  return (
    <>
      <div {...reveal(2)} className="mt-6 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <p className="max-w-[560px] text-[17px] leading-relaxed text-bk-muted">{intro}</p>
        <IntervalSwitch interval={interval} onChange={setBillingInterval} />
      </div>
      <div className="mt-10 grid gap-5 sm:mt-12 md:grid-cols-3">
        {PLAN_IDS.map((id, i) => (
          <PlanCard key={id} plan={PLANS[id]} interval={interval} startHref={startHref} i={i} />
        ))}
      </div>
      <ComparisonTable interval={interval} />
    </>
  )
}
