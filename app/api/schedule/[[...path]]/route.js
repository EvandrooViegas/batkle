import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/services/db/mongo'
import { requireUserId } from '@/lib/auth'
import { publicMessage } from '@/lib/services/publicError'
import { billingErrorBody } from '@/lib/billing/account'
import { handleApprovePost, handleDeleteScheduledPost, handleListSchedule, handleUpdateScheduledPost } from '@/lib/handlers/scheduleHandlers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Approved and scheduled posts, for the signed-in account only:
 *   GET    /api/schedule?flowId=   list (one brand, or every brand without flowId)
 *   POST   /api/schedule           approve an idea's post: { flowId, ideaId, canvasId, topic, caption }
 *   PATCH  /api/schedule/:id       { platforms, scheduledAt, timeZone, caption, status }; a time needs a paid plan (402)
 *   DELETE /api/schedule/:id       take it off the schedule
 */
async function handle(request, { params }) {
  const path = params?.path || []
  const method = request.method
  try {
    const userId = await requireUserId()
    const db = await connectToMongo()
    if (!path.length && method === 'GET') return await handleListSchedule(db, userId, new URL(request.url).searchParams.get('flowId'))
    if (!path.length && method === 'POST') return await handleApprovePost(db, userId, await request.json())
    if (path.length === 1 && method === 'PATCH') return await handleUpdateScheduledPost(db, userId, path[0], await request.json())
    if (path.length === 1 && method === 'DELETE') return await handleDeleteScheduledPost(db, userId, path[0])
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (error) {
    // Plan limits keep their code, so the page can offer the upgrade.
    const billing = billingErrorBody(error)
    if (billing) return NextResponse.json(billing, { status: error.status || 402 })
    const status = error?.status || 500
    if (status >= 500) console.error('[schedule]', error)
    return NextResponse.json({ error: publicMessage(error?.message, status) }, { status })
  }
}

export const GET = handle
export const POST = handle
export const PATCH = handle
export const DELETE = handle
