import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/services/db/mongo'
import { handleWebhookRequest } from '@/lib/billing/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Stripe's webhook (no session: the middleware lets it through, and Stripe's signature proves who sent it). The
 * signature covers the exact bytes Stripe sent, so the body is read as raw text. A failure answers 500, which makes
 * Stripe send the event again later.
 */
export async function POST(request) {
  const payload = await request.text()
  const { status, body } = await handleWebhookRequest(payload, request.headers.get('stripe-signature'), connectToMongo)
  return NextResponse.json(body, { status })
}
