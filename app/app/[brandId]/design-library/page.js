import { notFound } from 'next/navigation'
import { getFlow } from '@/lib/data/flows'
import GlobalDesignLibrary from '@/components/GlobalDesignLibrary'

export const metadata = { title: 'Design Library · Batkle' }

/** The Design Library inside a brand: previews in its look, and each design can be switched on for it. */
export default async function BrandDesignLibraryPage({ params }) {
  const { brandId } = await params
  const flow = await getFlow(brandId)
  if (!flow) notFound()

  return <GlobalDesignLibrary flowId={flow.id} brand={{ ...(flow.brandContext || {}), id: flow.id, name: flow.brandContext?.name || flow.name }} />
}
