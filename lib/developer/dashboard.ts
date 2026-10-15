import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/services/db/mongo'
import { requireUserId } from '@/lib/auth'
import { createApiKey, revokeApiKey, usageOverview } from './store'
import { readTimeZone } from './validate'

/**
 * The developer dashboard's own API, /api/developer, for the signed-in account (a Clerk session, not an API key):
 *   GET    /api/developer?tz=Europe/Lisbon   balance, keys, usage by day, endpoint and key, latest requests
 *   POST   /api/developer/keys {name}        a new key; the key itself is in this response only
 *   DELETE /api/developer/keys/:id           revokes a key
 */
export async function handleDeveloperRequest(request: Request, path: string[]) {
  try {
    const userId = await requireUserId()
    const method = request.method
    // Changes come from the dashboard only: a page on another site cannot create keys with the person's session.
    const origin = request.headers.get('origin')
    if (method !== 'GET' && origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 })
    const db = await connectToMongo()

    if (!path.length && method === 'GET') {
      const timeZone = readTimeZone(new URL(request.url).searchParams.get('tz'))
      return NextResponse.json(await usageOverview(db, userId, { timeZone }), { headers: { 'Cache-Control': 'no-store' } })
    }
    if (path[0] === 'keys' && path.length === 1 && method === 'POST') {
      const body = await request.json().catch(() => ({}))
      return NextResponse.json(await createApiKey(db, userId, body?.name), { status: 201, headers: { 'Cache-Control': 'no-store' } })
    }
    if (path[0] === 'keys' && path.length === 2 && method === 'DELETE') {
      await revokeApiKey(db, userId, path[1])
      return NextResponse.json({ success: true })
    }
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (error: any) {
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500
    if (status >= 500) console.error('[developer] dashboard API error:', error)
    return NextResponse.json({ error: status >= 500 ? 'Something went wrong on our side. Please try again.' : error.message }, { status })
  }
}
