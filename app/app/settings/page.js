import { getFlows, finishedOnboarding } from '@/lib/data/flows'
import { requireOnboardedAccount } from '@/lib/auth'
import StandaloneShell from '@/components/app/StandaloneShell'
import BillingSettings from '@/components/app/settings/BillingSettings'
import NotificationSettings from '@/components/app/settings/NotificationSettings'
import { PageHeader, pageInner, pageShell } from '@/components/app/ui'

// Reads the account on every request; never prerendered at build time.
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Settings · Batkle' }

// Query parameters worth keeping through sign-up and onboarding: the plan picked on the pricing page.
const KEPT_PARAMS = ['plan', 'interval']

/**
 * /app/settings: the account's plan, credits and billing (#plan, #credits), and how reminders reach the person
 * (#notifications). Each section loads its own data from the API. `?plan=&interval=` (from the pricing page)
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
          </div>
        </div>
      </div>
    </StandaloneShell>
  )
}
