import { redirect } from 'next/navigation'
import { getFlows } from '@/lib/data/flows'
import RendersBoard from '@/components/RendersBoard'
import StandaloneShell from '@/components/app/StandaloneShell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Renders & API · Batkle' }

/** Opens the renders inside the brand used last; without a brand they stand on their own. */
export default async function RendersPage() {
  const flows = await getFlows()
  if (flows.length) redirect(`/app/${flows[0].id}/renders`)
  return <StandaloneShell><RendersBoard /></StandaloneShell>
}
