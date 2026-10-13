import { redirect } from 'next/navigation'
import { getFlows } from '@/lib/data/flows'
import GlobalDesignLibrary from '@/components/GlobalDesignLibrary'
import StandaloneShell from '@/components/app/StandaloneShell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Design Library · Batkle' }

/** Opens the library inside the brand used last; without a brand it stands on its own. */
export default async function DesignLibraryPage() {
  const flows = await getFlows()
  if (flows.length) redirect(`/app/${flows[0].id}/design-library`)
  return <StandaloneShell><GlobalDesignLibrary /></StandaloneShell>
}
