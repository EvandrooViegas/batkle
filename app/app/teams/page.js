import { finishedOnboarding, getFlows } from '@/lib/data/flows'
import { requireOnboardedAccount } from '@/lib/auth'
import StandaloneShell from '@/components/app/StandaloneShell'
import TeamsOverview from '@/components/app/team/TeamsOverview'
import { pageInner, pageShell } from '@/components/app/ui'

// Reads the account on every request; never prerendered at build time.
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Teams & invitations · Batkle' }

/**
 * /app/teams (also the link in invitation emails): every team the account is part of, the invitations waiting for
 * it, and its own brands' teams. A way back to the brand used last.
 */
export default async function TeamsPage() {
  await requireOnboardedAccount('/app/teams')
  const finished = (await getFlows()).filter(finishedOnboarding)
  const back = finished.length ? { href: `/app/${finished[0].id}/creation`, label: 'Back to the studio' } : { href: '/app', label: 'Back to the app' }
  return (
    <StandaloneShell back={back}>
      <div className={pageShell}>
        <div className={`${pageInner} max-w-[880px]`}>
          <TeamsOverview />
        </div>
      </div>
    </StandaloneShell>
  )
}
