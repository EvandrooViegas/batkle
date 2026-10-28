import { NextResponse } from 'next/server'
import { corsify } from '@/lib/services/middleware'
import { hasFeature, requireFeature } from '@/lib/billing/account'
import { onlyRemoves, updateBrandPosts } from '@/lib/services/brandPosts'

/**
 * The brand's own posts on the Brand profile: saved here the moment they change, like designs, and never by the
 * profile's Save (handleUpdateFlow keeps what is stored). Takes `{ flowId, posts?, enabled?, retry? }` and answers
 * `{ postExamples }`. The router has already checked that the brand is the caller's own.
 *
 * Learning from posts is part of Pro and Business: other plans are refused with upgrade_required (402), except for
 * taking posts away, so an account that moved to Free can still clear the images it added.
 */
export async function handleBrandPosts(db: any, body: any, userId: string) {
  const flowId = body?.flowId
  if (typeof flowId !== 'string' || !flowId) return corsify(NextResponse.json({ error: 'Brand ID is required' }, { status: 400 }))
  if (body.posts !== undefined && !Array.isArray(body.posts)) return corsify(NextResponse.json({ error: 'posts must be a list' }, { status: 400 }))
  const allowed = await hasFeature(db, userId, 'postVoice')
  if (!allowed) {
    const flow = await db.collection('flows').findOne({ id: flowId }, { projection: { _id: 0, 'brandContext.postExamples.posts': 1 } })
    // Outside any try: the route answers a billing error with 402 and its code.
    if (!onlyRemoves(body, flow?.brandContext?.postExamples?.posts || [])) await requireFeature(db, userId, 'postVoice')
  }
  try {
    return corsify(NextResponse.json({ postExamples: await updateBrandPosts(db, flowId, body, userId, { learn: allowed }) }))
  } catch (error: any) {
    return corsify(NextResponse.json({ error: error?.message || 'Your posts could not be saved' }, { status: error?.status || 500 }))
  }
}
