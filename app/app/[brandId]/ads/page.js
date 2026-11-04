import { notFound } from 'next/navigation'
import { getFlow } from '@/lib/data/flows'
import AdsPage from '@/components/app/ads/AdsPage'

export const metadata = { title: 'Ads · Batkle' }

// The parts of a brand a design preview draws with.
const LOOK = ['website', 'logo', 'logoVariants', 'logoOnDark', 'colors', 'fonts', 'headingFont', 'bodyFont', 'designTokens', 'primary', 'secondary', 'accent', 'background', 'textPrimary', 'textSecondary', 'onPrimary', 'onAccent', 'onImage', 'overlay']

/** A brand's Facebook and Instagram ads: made from a brief in its design, at every Meta size. */
export default async function BrandAdsPage({ params }) {
  const { brandId } = await params
  const flow = await getFlow(brandId)
  if (!flow) notFound()

  const brand = flow.brandContext || {}
  // What the brief form suggests from (the services and the projects' names), and the brand's look, so the design
  // previews show its own colours, fonts and logo.
  const projects = (Array.isArray(brand.projects) ? brand.projects : []).map(p => (typeof p === 'string' ? p : p?.name)).filter(Boolean).slice(0, 4)
  const look = Object.fromEntries(LOOK.filter(key => brand[key] !== undefined).map(key => [key, brand[key]]))
  return <AdsPage flowId={flow.id} brandName={brand.name || flow.name || 'Your brand'} brandLogo={brand.logo || ''} website={brand.website || ''} brandContext={{ ...look, id: flow.id, name: brand.name || flow.name, services: brand.services || [], projects }} />
}
