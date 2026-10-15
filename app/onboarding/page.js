import { redirect } from 'next/navigation'
import { getAccount } from '@/lib/auth'
import { safeRedirect } from '@/lib/authRedirect'
import { getFlows } from '@/lib/data/flows'
import AccountOnboarding from '@/components/app/onboarding/AccountOnboarding'

// Reads the account on every request; never prerendered at build time.
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Welcome · Batkle' }

/**
 * /onboarding: the name for a new account, once, before the app. `?next=` is where to go afterwards
 * (the app sends people here with the page they asked for); without it, /app opens the brand onboarding.
 */
export default async function OnboardingPage({ searchParams }) {
  const params = await searchParams
  // Only paths on this site; the origin here is a placeholder for resolving them.
  const next = safeRedirect(typeof params?.next === 'string' ? params.next : '', 'https://batkle.invalid')
  const account = await getAccount()
  if (!account) redirect('/sign-in?redirect_url=%2Fonboarding')
  if (account.onboarded) redirect(next)
  const flows = await getFlows()
  return <AccountOnboarding next={next} initialName={account.profileName} email={account.email} hasBrands={flows.length > 0} draft={account.onboardingDraft} />
}
