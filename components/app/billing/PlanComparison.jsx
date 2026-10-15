import { Check, Minus } from 'lucide-react'
import { PLANS, PLAN_IDS, pricingRows } from '@/lib/billing/plans'
import { cn } from '@/lib/utils'

function Cell({ value }) {
  if (value === true) return <><Check aria-hidden="true" className="size-4" strokeWidth={2.5} /><span className="sr-only">Included</span></>
  if (value === false) return <><Minus aria-hidden="true" className="size-4 text-bk-muted" /><span className="sr-only">Not included</span></>
  return <span>{value}</span>
}

/** What each plan includes, as on the pricing page, with the account's own plan marked. */
export default function PlanComparison({ current = null, className = '' }) {
  const mine = id => id === current && 'bg-bk-butter/15'
  // `relative` keeps the cells' screen-reader text (absolutely positioned) inside this scroller: without it, that text
  // is placed against the page and makes the whole page scroll sideways on phones.
  return (
    <div className={cn('relative overflow-x-auto rounded-2xl border border-bk-line bg-bk-surface', className)}>
      <table className="w-full min-w-[580px] border-collapse text-left text-[13px] leading-snug">
        <caption className="sr-only">What each plan includes</caption>
        <thead>
          <tr className="border-b border-bk-line">
            <th scope="col" className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-bk-muted">Compare plans</th>
            {PLAN_IDS.map(id => (
              <th key={id} scope="col" className={cn('w-[22%] px-4 py-3 font-bk-display text-[14.5px] font-bold tracking-[-0.01em]', mine(id))}>
                {PLANS[id].name}
                {id === current && <span className="ml-1.5 align-middle text-[11px] font-semibold text-bk-muted">(yours)</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pricingRows().map(row => (
            <tr key={row.label} className="border-b border-bk-line last:border-0">
              <th scope="row" className="px-4 py-2.5 font-semibold">
                {row.label}
              </th>
              {row.values.map((value, i) => (
                <td key={PLAN_IDS[i]} className={cn('px-4 py-2.5 tabular-nums', mine(PLAN_IDS[i]))}>{row.comingSoon && typeof value === 'string' ? <span className="whitespace-nowrap font-semibold text-bk-muted">{value}</span> : <Cell value={value} />}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
