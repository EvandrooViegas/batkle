import { redirect } from 'next/navigation'
import { finishedOnboarding, getFlows } from '@/lib/data/flows'
import { requireOnboardedAccount } from '@/lib/auth'

// Reads the brand list on every request; never prerendered at build time.
export const dynamic = 'force-dynamic'

/**
 * /app: a website from the home page form (/app?website=...) goes straight into onboarding.
 * Otherwise open the first brand's Creation page, or the onboarding when there is no brand yet or one is unfinished.
 */
export default async function AppHome({ searchParams }) {
  const params = await searchParams
  const website = typeof params?.website === 'string' ? params.website.trim() : ''
  // A new account answers a few questions first, then comes back here with the same website.
  await requireOnboardedAccount(website ? `/app?website=${encodeURIComponent(website.slice(0, 500))}` : '/app')
  if (website) redirect(`/app/new?website=${encodeURIComponent(website.slice(0, 500))}`)
  const flows = await getFlows()
  // A brand left halfway through its onboarding comes first: /app/new offers to continue where it stopped.
  const finished = flows.filter(finishedOnboarding)
  redirect(finished.length === flows.length && finished.length > 0 ? `/app/${finished[0].id}/creation` : '/app/new')
}
