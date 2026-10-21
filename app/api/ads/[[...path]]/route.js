import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/services/db/mongo'
import { requireUserId } from '@/lib/auth'
import { publicMessage } from '@/lib/services/publicError'
import { billingErrorBody } from '@/lib/billing/account'
import { handleBuildAd, handleDeleteAd, handleListAds, handlePlanAd, handleUpdateAdCopy } from '@/lib/handlers/adHandlers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Building several sizes composes each one; the image itself was made in /api/resolve-assets.
export const maxDuration = 120

/**
 * Meta ads for the signed-in account's brands (Business plan):
 *   GET    /api/ads?flowId=   the brand's ads, newest first
 *   POST   /api/ads/plan      { flowId, brief } copy, design and image plan; holds one credit per size (chargeRef)
 *   POST   /api/ads/build     { flowId, brief, ad, copy, resolvedPlan, chargeRef } every size as an editable post
 *   PATCH  /api/ads/:id       { copy } the person's edits to the ad's text
 *   DELETE /api/ads/:id       the ad and its posts
 * Between plan and build the image comes from POST /api/resolve-assets { plan, brand_id, chargeRef }, as for posts.
 */
async function handle(request, { params }) {
  const path = params?.path || []
  const method = request.method
  try {
    const userId = await requireUserId()
    const db = await connectToMongo()
    if (!path.length && method === 'GET') return await handleListAds(db, userId, new URL(request.url).searchParams.get('flowId'))
    if (path[0] === 'plan' && method === 'POST') return await handlePlanAd(db, userId, await request.json())
    if (path[0] === 'build' && method === 'POST') return await handleBuildAd(db, userId, await request.json())
    if (path.length === 1 && method === 'PATCH') return await handleUpdateAdCopy(db, userId, path[0], await request.json())
    if (path.length === 1 && method === 'DELETE') return await handleDeleteAd(db, userId, path[0])
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (error) {
    // Plan limits keep their code, so the page can offer the upgrade.
    const billing = billingErrorBody(error)
    if (billing) return NextResponse.json(billing, { status: error.status || 402 })
    const status = error?.status || 500
    if (status >= 500) console.error('[ads]', error)
    return NextResponse.json({ error: publicMessage(error?.message, status) }, { status })
  }
}

export const GET = handle
export const POST = handle
export const PATCH = handle
export const DELETE = handle
