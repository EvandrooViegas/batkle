import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/services/db/mongo'
import { requireUserId } from '@/lib/auth'
import { publicMessage } from '@/lib/services/publicError'
import { billingErrorBody } from '@/lib/billing/account'
import { handleAdIdea, handleBuildAd, handleDeleteAd, handleListAds, handlePlanAd, handleUpdateAdCopy } from '@/lib/handlers/adHandlers'
import { requireBrandAccess, sharedLimitAnswer } from '@/lib/teams'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Building several sizes composes each one; the image itself was made in /api/resolve-assets.
export const maxDuration = 120

/**
 * Meta ads for the signed-in account's brands (Business plan):
 *   GET    /api/ads?flowId=   the brand's ads, newest first
 *   POST   /api/ads/idea      { flowId, from, avoid } a new brief idea from one item of the profile (no credits)
 *   POST   /api/ads/plan      { flowId, brief } copy, design and image plan; holds one credit per size (chargeRef)
 *   POST   /api/ads/build     { flowId, brief, ad, copy, resolvedPlan, chargeRef } every size as an editable post
 *   PATCH  /api/ads/:id       { copy } the person's edits to the ad's text
 *   DELETE /api/ads/:id       the ad and its posts
 * Between plan and build the image comes from POST /api/resolve-assets { plan, brand_id, chargeRef }, as for posts.
 */
async function handle(request, { params }) {
  const path = params?.path || []
  const method = request.method
  // In a brand shared with the account, ads are the brand owner's and made on the owner's plan and credits; a plan
  // limit met there says whose plan it is (sharedLimitAnswer).
  const acting = {}
  return sharedLimitAnswer(acting.db, await route(request, path, method, acting), acting.ownerId)
}

async function route(request, path, method, acting) {
  try {
    const userId = await requireUserId()
    const db = await connectToMongo()
    const brandOwner = async (flowId, need) => {
      const owner = (await requireBrandAccess(db, userId, [flowId], need)) || userId
      if (owner !== userId) Object.assign(acting, { db, ownerId: owner })
      return owner
    }
    const adOwner = async id => {
      const ad = await db.collection('ads').findOne({ id }, { projection: { _id: 0, ownerId: 1, flowId: 1 } })
      return ad && ad.ownerId !== userId && (await brandOwner(ad.flowId, 'editor')) === ad.ownerId ? ad.ownerId : userId
    }
    if (!path.length && method === 'GET') {
      const flowId = new URL(request.url).searchParams.get('flowId')
      return await handleListAds(db, await brandOwner(flowId, 'viewer'), flowId)
    }
    if (path[0] === 'idea' && method === 'POST') {
      const body = await request.json()
      return await handleAdIdea(db, await brandOwner(body?.flowId, 'editor'), body)
    }
    if ((path[0] === 'plan' || path[0] === 'build') && method === 'POST') {
      const body = await request.json()
      const owner = await brandOwner(body?.flowId, 'editor')
      return await (path[0] === 'plan' ? handlePlanAd(db, owner, body) : handleBuildAd(db, owner, body))
    }
    if (path.length === 1 && method === 'PATCH') return await handleUpdateAdCopy(db, await adOwner(path[0]), path[0], await request.json())
    if (path.length === 1 && method === 'DELETE') return await handleDeleteAd(db, await adOwner(path[0]), path[0])
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
