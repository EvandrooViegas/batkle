import { getFlows, finishedOnboarding } from '@/lib/data/flows'
import { requireOnboardedAccount } from '@/lib/auth'
import StandaloneShell from '@/components/app/StandaloneShell'
import BillingSettings from '@/components/app/settings/BillingSettings'
import NotificationSettings from '@/components/app/settings/NotificationSettings'
import Link from 'next/link'
import { PageHeader, appButton, pageInner, pageShell, panelClass } from '@/components/app/ui'

// Reads the account on every request; never prerendered at build time.
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Settings · Batkle' }

// Query parameters worth keeping through sign-up and onboarding: the plan picked on the pricing page.
const KEPT_PARAMS = ['plan', 'interval']

/**
 * /app/settings: the account's plan, credits and billing (#plan, #credits), and how reminders reach the person
 * (#notifications), and a way to the Team page (#team), which is in the studio. Each section loads its own data from the API. `?plan=&interval=` (from the pricing page)
 * survives signing up and onboarding, so the chosen plan is still selected afterwards.
 */
export default async function SettingsPage({ searchParams }) {
  const params = (await searchParams) || {}
  const kept = new URLSearchParams()
  for (const key of KEPT_PARAMS) if (typeof params[key] === 'string' && /^[a-z]{1,20}$/.test(params[key])) kept.set(key, params[key])
  const query = kept.toString()
  const account = await requireOnboardedAccount(`/app/settings${query ? `?${query}` : ''}`)
  const flows = await getFlows()
  const finished = flows.filter(finishedOnboarding)
  const back = finished.length ? { href: `/app/${finished[0].id}/creation`, label: 'Back to the studio' } : { href: '/app', label: 'Back to the app' }
  return (
    <StandaloneShell back={back}>
      <div className={pageShell}>
        <div className={`${pageInner} max-w-[880px]`}>
          <PageHeader eyebrow="Account" title="Settings" description={`Signed in as ${account.email}.`} />
          <div className="mt-8 space-y-10">
            <BillingSettings />
            <NotificationSettings />
            <section id="team" aria-labelledby="team-title" className="scroll-mt-24">
              <h2 id="team-title" className="font-bk-display text-[22px] font-bold tracking-[-0.02em]">Team</h2>
              <div className={`${panelClass} mt-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5`}>
                <p className="min-w-0 flex-1 text-[14px] text-bk-fg/85">Invite the people you work with, and see invitations sent to you, on the Team page.</p>
                <Link href="/app/team" className={appButton('outline', 'sm')}>Open Team</Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </StandaloneShell>
  )
}
