import { getFlows } from '@/lib/data/flows'
import { requireOnboardedAccount } from '@/lib/auth'
import StandaloneShell from '@/components/app/StandaloneShell'
import StudioBoard from '@/components/StudioBoard'

// Reads the brand list on every request; never prerendered at build time.
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Studio · Batkle' }

/** Every design in the account, grouped by the brand it belongs to. */
export default async function StudioPage() {
  await requireOnboardedAccount('/studio')
  const flows = await getFlows()
  return (
    <StandaloneShell>
      <StudioBoard flows={flows} />
    </StandaloneShell>
  )
}
