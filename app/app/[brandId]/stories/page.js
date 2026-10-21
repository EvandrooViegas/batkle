import { notFound } from 'next/navigation'
import { getFlow } from '@/lib/data/flows'
import CreationPage from '@/components/app/creation/CreationPage'

export const metadata = { title: 'Stories · Batkle' }

/** A brand's stories: ideas built as 9:16 Instagram and Facebook stories, the way Creation builds posts. */
export default async function Stories({ params }) {
  const { brandId } = await params
  const flow = await getFlow(brandId)
  if (!flow) notFound()

  return <CreationPage flowId={flow.id} brandContext={flow.brandContext ?? null} surface="story" />
}
