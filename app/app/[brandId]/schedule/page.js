import { notFound } from 'next/navigation'
import { getFlow } from '@/lib/data/flows'
import SchedulePage from '@/components/app/schedule/SchedulePage'

export const metadata = { title: 'Schedule · Batkle' }

/** Approved posts of a brand and when they go out on Instagram and TikTok. */
export default async function BrandSchedulePage({ params }) {
  const { brandId } = await params
  const flow = await getFlow(brandId)
  if (!flow) notFound()

  return <SchedulePage flowId={flow.id} brandName={flow.brandContext?.name || flow.name || 'Your brand'} />
}
