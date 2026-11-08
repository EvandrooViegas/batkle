import { redirect } from 'next/navigation'

/** /flow was renamed to /app; old links and bookmarks keep working. */
export default async function FlowRedirect({ params }) {
  const segments = (await params)?.path
  const path = Array.isArray(segments) ? segments.map(encodeURIComponent).join('/') : ''
  redirect(path ? `/app/${path}` : '/app')
}
