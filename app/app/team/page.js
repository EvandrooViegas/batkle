import { redirect } from 'next/navigation'
import { finishedOnboarding, getFlows } from '@/lib/data/flows'
import { requireOnboardedAccount } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/** /app/team (the link in invitation emails): the Team page of the brand used last, or onboarding without one. */
export default async function TeamLink() {
  await requireOnboardedAccount('/app/team')
  const finished = (await getFlows()).filter(finishedOnboarding)
  redirect(finished.length ? `/app/${finished[0].id}/team` : '/app/new')
}
