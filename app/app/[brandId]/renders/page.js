import { notFound } from 'next/navigation'
import { getFlow } from '@/lib/data/flows'
import RendersBoard from '@/components/RendersBoard'

export const metadata = { title: 'Renders & API · Batkle' }

export default async function BrandRendersPage({ params }) {
  const { brandId } = await params
  const flow = await getFlow(brandId)
  if (!flow) notFound()

  return <RendersBoard brandName={flow.brandContext?.name || flow.name} flowId={flow.id} />
}
