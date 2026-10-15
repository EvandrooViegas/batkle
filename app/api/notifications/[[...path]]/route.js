import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/services/db/mongo'
import { loadAccount, requireUserId } from '@/lib/auth'
import { billingErrorBody } from '@/lib/billing/account'
import { publicMessage } from '@/lib/services/publicError'
import { checkPhoneVerification, notificationsView, removePhone, startPhoneVerification, updateNotifications } from '@/lib/notifications/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * How post reminders reach the signed-in person (lib/notifications/settings.ts):
 *   GET    /api/notifications               settings, phone (masked), what is set up and what the plan includes
 *   PUT    /api/notifications               { email, sms, leadMinutes }
 *   POST   /api/notifications/phone/start   { phone } texts a code (without phone: the saved number)
 *   POST   /api/notifications/phone/check   { phone, code, consent: true } verifies the number
 *   DELETE /api/notifications/phone         forgets the number and turns texts off
 */
async function handle(request, { params }) {
  const route = (params?.path || []).join('/')
  const method = request.method
  try {
    const userId = await requireUserId()
    const db = await connectToMongo()
    // Opens the account record on first use, with the email reminders go to.
    await loadAccount(db, userId)
    const body = method === 'PUT' || method === 'POST' ? await request.json().catch(() => ({})) : null
    if (!route && method === 'GET') return NextResponse.json(await notificationsView(db, userId))
    if (!route && method === 'PUT') return NextResponse.json(await updateNotifications(db, userId, body))
    if (route === 'phone/start' && method === 'POST') return NextResponse.json(await startPhoneVerification(db, userId, body))
    if (route === 'phone/check' && method === 'POST') return NextResponse.json(await checkPhoneVerification(db, userId, body))
    if (route === 'phone' && method === 'DELETE') return NextResponse.json(await removePhone(db, userId))
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (error) {
    const billing = billingErrorBody(error)
    if (billing) return NextResponse.json(billing, { status: error.status || 402 })
    const status = error?.status || 500
    if (status >= 500) console.error('[notifications]', error)
    return NextResponse.json({ error: error?.expose ? error.message : publicMessage(error?.message, status) }, { status })
  }
}

export const GET = handle
export const PUT = handle
export const POST = handle
export const DELETE = handle
