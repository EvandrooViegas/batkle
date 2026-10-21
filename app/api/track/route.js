import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/services/db/mongo'
import { recordVisit } from '@/lib/analytics/visits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/track: one visit to a public page, sent with navigator.sendBeacon by the visit tracker. Public (the
 * middleware lets it through); it stores only campaign tags, the sending site and the page, and always answers 204
 * so it tells a caller nothing.
 */
export async function POST(request) {
  try {
    const text = await request.text()
    if (text.length <= 4000) await recordVisit(await connectToMongo(), JSON.parse(text))
  } catch (error) {
    console.warn('[track] visit not stored:', error?.message)
  }
  return new NextResponse(null, { status: 204 })
}
