import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/services/db/mongo'
import { requireUserId } from '@/lib/auth'
import { publicMessage } from '@/lib/services/publicError'
import { loadActivity, markActivitySeen } from '@/lib/notifications/activity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET: the notification center's activity and unread count. POST: everything up to now has been seen. */
async function handle(request) {
  try {
    const userId = await requireUserId()
    const db = await connectToMongo()
    if (request.method === 'GET') return NextResponse.json(await loadActivity(db, userId), { headers: { 'Cache-Control': 'no-store' } })
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 })
    return NextResponse.json(await markActivitySeen(db, userId))
  } catch (error) {
    const status = error?.status || 500
    if (status >= 500) console.error('[activity]', error)
    return NextResponse.json({ error: publicMessage(error?.message, status) }, { status })
  }
}

export const GET = handle
export const POST = handle
