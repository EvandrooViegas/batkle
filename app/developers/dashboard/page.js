import { requireOnboardedAccount } from '@/lib/auth'
import StandaloneShell from '@/components/app/StandaloneShell'
import DeveloperDashboard from '@/components/developers/DeveloperDashboard'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'API & usage · Batkle' }

/** The signed-in account's API keys, credits, usage and renders. */
export default async function DeveloperDashboardPage() {
  const account = await requireOnboardedAccount('/developers/dashboard')
  return (
    <StandaloneShell>
      <DeveloperDashboard account={{ name: account.name, email: account.email }} />
    </StandaloneShell>
  )
}
