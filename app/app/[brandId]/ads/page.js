import { notFound } from 'next/navigation'
import { getFlow } from '@/lib/data/flows'
import AdsPage from '@/components/app/ads/AdsPage'

export const metadata = { title: 'Ads · Batkle' }

/** A brand's Facebook and Instagram ads: made from a brief in its design, at every Meta size. */
export default async function BrandAdsPage({ params }) {
  const { brandId } = await params
  const flow = await getFlow(brandId)
  if (!flow) notFound()

  const brand = flow.brandContext || {}
  // Only what the brief form suggests from: the services and the projects' names.
  const projects = (Array.isArray(brand.projects) ? brand.projects : []).map(p => (typeof p === 'string' ? p : p?.name)).filter(Boolean).slice(0, 4)
  return <AdsPage flowId={flow.id} brandName={brand.name || flow.name || 'Your brand'} brandLogo={brand.logo || ''} website={brand.website || ''} brandContext={{ services: brand.services || [], projects }} />
}
