import { notFound } from 'next/navigation'
import { getFlow } from '@/lib/data/flows'
import TeamPage from '@/components/app/team/TeamPage'

export const metadata = { title: 'Team · Batkle' }

/** The open brand's team: who works on it and with which role. */
export default async function Team({ params }) {
  const { brandId } = await params
  const flow = await getFlow(brandId)
  if (!flow) notFound()
  return <TeamPage flowId={flow.id} brandName={flow.brandContext?.name || flow.name || 'This brand'} />
}
