import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/services/db/mongo'
import { loadAccount, requireUserId } from '@/lib/auth'
import { getBillingSummary, loadBilling } from '@/lib/billing/account'
import { CREDIT_PACK, NEWSLETTER_DISCOUNT, PLANS, PLAN_IDS, TRIAL } from '@/lib/billing/plans'
import { billingErrorResponse, createCheckoutSession, createPortalSession, paymentsConfigured, readPurchase } from '@/lib/billing/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

/**
 * The signed-in account's plan and payments:
 *   GET  /api/billing            { summary, paymentsConfigured, portal, plans, trial, creditPack, newsletter }
 *   POST /api/billing/checkout   { planId, interval } or { credits: true } → { url } (Checkout, or the Billing
 *                                Portal to confirm a change of plan)
 *   POST /api/billing/portal     → { url } of the Billing Portal
 */
async function handle(request, { params }) {
  const path = params?.path || []
  const method = request.method
  try {
    const userId = await requireUserId()
    const origin = new URL(request.url).origin
    // Payments start from Batkle's own pages only: another site cannot open a checkout with the person's session.
    const from = request.headers.get('origin')
    if (method !== 'GET' && from && from !== origin) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 })
    const db = await connectToMongo()

    if (!path.length && method === 'GET') {
      const summary = await getBillingSummary(db, userId)
      const account = await loadBilling(db, userId)
      const configured = paymentsConfigured()
      return NextResponse.json({
        summary,
        paymentsConfigured: configured,
        // The portal needs a Stripe customer: anyone who has paid before can see invoices and their card.
        portal: configured && Boolean(account.stripeCustomerId),
        plans: PLAN_IDS.map(id => PLANS[id]),
        trial: TRIAL,
        creditPack: { credits: CREDIT_PACK.credits, price: CREDIT_PACK.price },
        newsletter: NEWSLETTER_DISCOUNT,
      }, { headers: noStore })
    }
    if (path.length === 1 && path[0] === 'checkout' && method === 'POST') {
      const purchase = readPurchase(await request.json().catch(() => null))
      const account = await loadAccount(db, userId)
      const result = await createCheckoutSession(db, { userId, email: account.email, name: account.name }, purchase, origin)
      return NextResponse.json(result, { headers: noStore })
    }
    if (path.length === 1 && path[0] === 'portal' && method === 'POST') {
      return NextResponse.json(await createPortalSession(db, userId, origin), { headers: noStore })
    }
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (error) {
    const { status, body } = billingErrorResponse(error)
    return NextResponse.json(body, { status, headers: noStore })
  }
}

export const GET = handle
export const POST = handle
