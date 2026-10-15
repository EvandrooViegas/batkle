import { handleApiRequest } from '@/lib/developer/api'

// The public REST API: authenticated by API key (see lib/developer/api.ts), not by a signed-in session.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Generating a post with AI images can take a few minutes.
export const maxDuration = 300

const handle = (request, context) => handleApiRequest(request, context.params?.path || [])

export const GET = handle
export const POST = handle
export const DELETE = handle
export const OPTIONS = handle
