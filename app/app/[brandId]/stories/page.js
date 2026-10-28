import { redirect } from 'next/navigation'

/** Stories now live with posts: /stories (an older link) opens Posts & stories. */
export default async function Stories({ params }) {
  const { brandId } = await params
  redirect(`/app/${brandId}/creation`)
}
