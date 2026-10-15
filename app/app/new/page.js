import { finishedOnboarding, getFlows, getUnfinishedBrand } from '@/lib/data/flows'
import { requireOnboardedAccount } from '@/lib/auth'
import { billingErrorBody, requireBrandSlot } from '@/lib/billing/account'
import { connectToMongo } from '@/lib/services/db/mongo'
import BrandOnboarding from '@/components/app/onboarding/BrandOnboarding'

// Reads the brand list on every request; never prerendered at build time.
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Add a brand · Batkle' }

/**
 * /app/new: the brand onboarding. `?website=` (from the home page form) starts the research straight away;
 * otherwise a brand left halfway through is offered first, to continue where it stopped. An account already at its
 * plan's brand limit sees why before typing a website (continuing an unfinished brand is never limited).
 */
export default async function NewBrandPage({ searchParams }) {
  const params = await searchParams
  const website = typeof params?.website === 'string' ? params.website.slice(0, 500) : ''
  const account = await requireOnboardedAccount(website ? `/app/new?website=${encodeURIComponent(website)}` : '/app/new')
  const [flows, unfinished] = await Promise.all([getFlows(), getUnfinishedBrand()])
  const finished = flows.filter(finishedOnboarding)
  const brandLimit = unfinished ? null : await requireBrandSlot(await connectToMongo(), account.userId).then(() => null, error => {
    const body = billingErrorBody(error)
    if (!body) throw error
    return body
  })
  // Leaving goes to a finished brand, never to /app, which would bring an unfinished brand straight back here.
  const exitHref = finished.length ? `/app/${finished[0].id}/creation` : '/'
  return <BrandOnboarding initialWebsite={website} firstBrand={finished.length === 0} resume={unfinished} exitHref={exitHref} brandLimit={brandLimit} />
}
