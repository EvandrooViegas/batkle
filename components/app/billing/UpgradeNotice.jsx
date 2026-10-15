'use client'

import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { billingAction } from '@/lib/client/billing'
import { cn } from '@/lib/utils'
import { appButton } from '../ui'

/**
 * What a page shows when a plan limit stopped something: the API's message (written for people) and one button to
 * the plans or credits. `error` is an Error from apiError (lib/client/billing.js) whose `code` is a billing code.
 */
export default function UpgradeNotice({ error, className = '', compact = false }) {
  if (!error) return null
  const action = billingAction(error)
  const external = action.href.startsWith('mailto:')
  const button = cn(appButton('primary', 'sm'), 'shrink-0')
  return (
    <div role="status" className={cn('flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#F2A900]/40 bg-[#F2A900]/[0.08] px-3.5 py-2.5 text-[13px] leading-relaxed text-bk-fg', className)}>
      <p className="flex min-w-0 items-start gap-2">
        {!compact && <Sparkles aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
        <span>{error.message}</span>
      </p>
      {external
        ? <a href={action.href} className={button}>{action.label}</a>
        : <Link href={action.href} className={button}>{action.label}</Link>}
    </div>
  )
}
