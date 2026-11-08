import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/services/db/mongo'
import { recordVisit } from '@/lib/analytics/visits'
import { clientIp, overLimit } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HOUR = 60 * 60 * 1000
// A person's browser sends one visit per half hour (recordVisit), an office behind one address a few more. Past these,
// visits are not stored, so a script calling this public endpoint cannot fill the database.
const PER_ADDRESS_PER_HOUR = 30
const PER_DAY = 20_000

/**
 * POST /api/track: one visit to a public page, sent with navigator.sendBeacon by the visit tracker. Public (the
 * middleware lets it through); it stores only campaign tags, the sending site and the page, and always answers 204
 * so it tells a caller nothing. The caller's address is only counted (rateLimits), never stored with the visit.
 */
export async function POST(request) {
  try {
    const text = await request.text()
    if (text.length > 4000) return new NextResponse(null, { status: 204 })
    const db = await connectToMongo()
    if (await overLimit(db, `track:${clientIp(request)}`, PER_ADDRESS_PER_HOUR, HOUR)) return new NextResponse(null, { status: 204 })
    if (await overLimit(db, 'track:all', PER_DAY, 24 * HOUR)) return new NextResponse(null, { status: 204 })
    await recordVisit(db, JSON.parse(text))
  } catch (error) {
    console.warn('[track] visit not stored:', error?.message)
  }
  return new NextResponse(null, { status: 204 })
}
