import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/services/db/mongo'
import { getBaseUrl } from '@/lib/services/middleware'
import { cronAuthProblem, runReminders } from '@/lib/notifications/reminders'
import { releaseStaleCharges } from '@/lib/billing/account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET or POST /api/cron/reminders: sends the post reminders that are due (lib/notifications/reminders.ts), and
 * settles the credits of posts left half-made hours ago (releaseStaleCharges), so one scheduled job does both.
 * An external scheduler calls it every few minutes with "Authorization: Bearer <CRON_SECRET>". Without CRON_SECRET
 * it answers 503 and does nothing, so it is never open to anyone.
 */
async function handle(request) {
  const problem = cronAuthProblem(request.headers.get('authorization'), process.env.CRON_SECRET)
  if (problem) return NextResponse.json({ error: problem.error }, { status: problem.status })
  try {
    const db = await connectToMongo()
    const result = await runReminders(db, { baseUrl: getBaseUrl(request) })
    if (result.reminded || result.failed) console.log('[reminders]', JSON.stringify(result))
    // A failure here must not hide the reminders' result: the next run tries again.
    const charges = await releaseStaleCharges(db).catch(error => { console.error('[reminders] stale charges:', error?.message); return null })
    if (charges?.refunded || charges?.settled) console.log('[reminders] stale charges', JSON.stringify(charges))
    return NextResponse.json({ ...result, charges })
  } catch (error) {
    console.error('[reminders]', error)
    return NextResponse.json({ error: 'The reminders could not run.' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
