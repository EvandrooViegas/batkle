import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/services/db/mongo'
import { requireUserId } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin'
import { loadMetrics } from '@/lib/analytics/metrics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PERIODS = [7, 30, 90]

/**
 * The admin dashboard's data, for admin accounts only (ADMIN_EMAILS); anyone else gets a 404.
 *   GET /api/admin/metrics?days=7|30|90
 */
export async function GET(request, { params }) {
  try {
    const userId = await requireUserId()
    const db = await connectToMongo()
    await requireAdmin(db, userId)
    const path = params?.path || []
    if (path[0] === 'metrics' && path.length === 1) {
      const asked = Number(new URL(request.url).searchParams.get('days'))
      return NextResponse.json(await loadMetrics(db, { days: PERIODS.includes(asked) ? asked : 30 }), { headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (error) {
    const status = error?.status || 500
    if (status >= 500) console.error('[admin]', error)
    return NextResponse.json({ error: status === 404 ? 'Not found' : status === 401 ? 'Sign in to continue.' : 'The dashboard could not be loaded.' }, { status })
  }
}
