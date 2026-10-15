import { handleDeveloperRequest } from '@/lib/developer/dashboard'

// The developer dashboard's API, for the signed-in account: usage, credits and API keys.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const handle = (request, context) => handleDeveloperRequest(request, context.params?.path || [])

export const GET = handle
export const POST = handle
export const DELETE = handle
