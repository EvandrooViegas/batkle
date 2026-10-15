import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/services/db/mongo'
import { publicMessage } from '@/lib/services/publicError'
import { subscribeToNewsletter } from '@/lib/billing/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

/** The caller's address: Vercel puts the visitor's IP first in x-forwarded-for. */
function clientIp(request) {
  return (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || ''
}

/**
 * The landing page's newsletter form (public): POST { email, consent: true } → { ok, message }, or { error }.
 * Subscribers get a one-off discount code by email; see subscribeToNewsletter in lib/billing/stripe.ts.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null)
    const db = await connectToMongo()
    const result = await subscribeToNewsletter(db, body, { ip: clientIp(request), origin: new URL(request.url).origin })
    return NextResponse.json(result.body, { status: result.status, headers: noStore })
  } catch (error) {
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500
    if (status >= 500) console.error('[newsletter]', error)
    const message = status >= 500 ? 'The newsletter isn’t available right now. Please try again later.' : error?.expose ? error.message : publicMessage(error?.message, status)
    return NextResponse.json({ error: message }, { status, headers: noStore })
  }
}
