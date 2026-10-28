import { NextResponse } from 'next/server'
import { corsify } from '@/lib/services/middleware'
import { savePostFeedback } from '@/lib/services/postFeedback'

/**
 * A like or dislike on a post Batkle made (lib/services/postFeedback.ts). Takes `{ flowId, rating, reasons?, note?,
 * post }` (`rating: null` takes the rating away) and answers `{ feedback }`, the brand's ratings. The router has
 * already checked the caller may make posts in the brand.
 */
export async function handlePostFeedback(db: any, body: any) {
  const flowId = body?.flowId
  if (typeof flowId !== 'string' || !flowId) return corsify(NextResponse.json({ error: 'Brand ID is required' }, { status: 400 }))
  try {
    return corsify(NextResponse.json({ feedback: await savePostFeedback(db, flowId, body) }))
  } catch (error: any) {
    return corsify(NextResponse.json({ error: error?.message || 'Your rating could not be saved' }, { status: error?.status || 500 }))
  }
}
