import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/services/db/mongo'
import { requireUserId } from '@/lib/auth'
import { publicMessage } from '@/lib/services/publicError'
import { billingErrorBody } from '@/lib/billing/account'
import { handleApprovePost, handleDeleteScheduledPost, handleListSchedule, handleUpdateScheduledPost } from '@/lib/handlers/scheduleHandlers'
import { requireBrandAccess, sharedLimitAnswer } from '@/lib/teams'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Whose schedule an entry is on: the brand owner's, which an editor of the brand may change too. */
async function entryOwner(db, userId, id, acting) {
  const entry = await db.collection('scheduledPosts').findOne({ id }, { projection: { _id: 0, ownerId: 1, flowId: 1 } })
  if (!entry || entry.ownerId === userId) return userId
  if ((await requireBrandAccess(db, userId, [entry.flowId], 'editor')) !== entry.ownerId) return userId
  Object.assign(acting, { db, ownerId: entry.ownerId })
  return entry.ownerId
}

/**
 * Approved and scheduled posts of the signed-in account's brands, and of brands shared with it (kept on the brand
 * owner's account; viewers see them, editors and admins change them):
 *   GET    /api/schedule?flowId=   list (one brand, or every brand of the account's own without flowId)
 *   POST   /api/schedule           approve an idea's post: { flowId, ideaId, canvasId, topic, caption }
 *   PATCH  /api/schedule/:id       { platforms, scheduledAt, timeZone, caption, status }; a time needs a paid plan (402)
 *   DELETE /api/schedule/:id       take it off the schedule
 */
async function handle(request, { params }) {
  // A plan limit met in a brand shared with the account (scheduling a time) says whose plan it is.
  const acting = {}
  return sharedLimitAnswer(acting.db, await route(request, (await params)?.path || [], request.method, acting), acting.ownerId)
}

async function route(request, path, method, acting) {
  try {
    const userId = await requireUserId()
    const db = await connectToMongo()
    if (!path.length && method === 'GET') {
      const flowId = new URL(request.url).searchParams.get('flowId')
      return await handleListSchedule(db, (await requireBrandAccess(db, userId, [flowId], 'viewer')) || userId, flowId)
    }
    if (!path.length && method === 'POST') {
      const body = await request.json()
      return await handleApprovePost(db, (await requireBrandAccess(db, userId, [body?.flowId], 'editor')) || userId, body)
    }
    if (path.length === 1 && method === 'PATCH') return await handleUpdateScheduledPost(db, await entryOwner(db, userId, path[0], acting), path[0], await request.json())
    if (path.length === 1 && method === 'DELETE') return await handleDeleteScheduledPost(db, await entryOwner(db, userId, path[0], acting), path[0])
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
