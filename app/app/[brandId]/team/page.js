import { requireOnboardedAccount } from '@/lib/auth'
import TeamPage from '@/components/app/team/TeamPage'

export const metadata = { title: 'Team · Batkle' }

/** The account's team, inside the studio: the same team whichever brand is open. */
export default async function Team({ params }) {
  const { brandId } = await params
  const account = await requireOnboardedAccount(`/app/${encodeURIComponent(brandId)}/team`)
  return <TeamPage account={{ name: account.name, email: account.email }} />
}
