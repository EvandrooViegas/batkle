import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/services/db/mongo'
import { requireUserId } from '@/lib/auth'
import { publicMessage } from '@/lib/services/publicError'
import { billingErrorBody } from '@/lib/billing/account'
import { getBaseUrl } from '@/lib/services/middleware'
import { handleTeamRequest } from '@/lib/handlers/teamHandlers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Teams that share private designs (lib/teams.ts); the routes are listed on handleTeamRequest. */
async function handle(request, { params }) {
  try {
    const userId = await requireUserId()
    const origin = request.headers.get('origin')
    if (request.method !== 'GET' && origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 })
    return await handleTeamRequest(await connectToMongo(), request, userId, params?.path || [], getBaseUrl(request))
  } catch (error) {
    // Plan limits keep their code, so the page can offer the upgrade.
    const billing = billingErrorBody(error)
    if (billing) return NextResponse.json(billing, { status: error.status || 402 })
    const status = error?.status || 500
    if (status >= 500) console.error('[teams]', error)
    return NextResponse.json({ error: publicMessage(error?.message, status) }, { status })
  }
}

export const GET = handle
export const POST = handle
export const PATCH = handle
export const DELETE = handle
