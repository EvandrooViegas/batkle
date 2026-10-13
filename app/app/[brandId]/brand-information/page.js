import { notFound } from 'next/navigation'
import { getFlow } from '@/lib/data/flows'
import BrandInfo from '@/components/BrandInfo'

export default async function BrandProfilePage({ params }) {
  const { brandId } = await params
  const flow = await getFlow(brandId)
  if (!flow) notFound()

  return <BrandInfo key={flow.id} flowId={flow.id} initialBrandContext={flow.brandContext || null} />
}
