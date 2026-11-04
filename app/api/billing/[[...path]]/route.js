import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/services/db/mongo'
import { loadAccount, requireUserId } from '@/lib/auth'
import { getBillingSummary, loadBilling, releaseCharge } from '@/lib/billing/account'
import { CREDIT_PACK, NEWSLETTER_DISCOUNT, PLANS, PLAN_IDS, TRIAL } from '@/lib/billing/plans'
import { billingErrorResponse, createCheckoutSession, createPortalSession, paymentsConfigured, readPurchase } from '@/lib/billing/stripe'
import { brandRole } from '@/lib/teams'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

async function ownerName(db, userId) {
  const user = await db.collection('users').findOne({ id: userId }, { projection: { _id: 0, name: 1, email: 1 } })
  return user?.name || String(user?.email || '').split('@')[0] || 'The brand’s owner'
}

/**
 * The signed-in account's plan and payments:
 *   GET  /api/billing            { summary, paymentsConfigured, portal, plans, trial, creditPack, newsletter }
 *   POST /api/billing/checkout   { planId, interval } or { credits: true } → { url } (Checkout, or the Billing
 *                                Portal to confirm a change of plan)
 *   POST /api/billing/portal     → { url } of the Billing Portal
 *   POST /api/billing/release    { chargeRef, flowId? } → { status }: a post or ad that failed gives its credits back
 *                                ('refunded'; 'settled' when it was made after all). In a brand shared with the
 *                                account (`flowId`), the charge is the brand owner's.
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
      // Inside a brand shared with the account (?flowId=), posts are made on the brand owner's plan and credits: the
      // summary is the owner's, without their admin rights, with `sharedBy` naming them. Paying stays the account's own.
      const flowId = new URL(request.url).searchParams.get('flowId')
      const access = flowId ? await brandRole(db, userId, flowId) : null
      const shared = access && access.role !== 'owner'
      const summary = shared
        ? { ...(await getBillingSummary(db, access.ownerId)), admin: false, sharedBy: await ownerName(db, access.ownerId), role: access.role }
        : await getBillingSummary(db, userId)
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
    if (path.length === 1 && path[0] === 'release' && method === 'POST') {
      const body = await request.json().catch(() => null)
      const access = typeof body?.flowId === 'string' && body.flowId ? await brandRole(db, userId, body.flowId) : null
      return NextResponse.json({ status: await releaseCharge(db, access?.ownerId || userId, body?.chargeRef) }, { headers: noStore })
    }
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (error) {
    const { status, body } = billingErrorResponse(error)
    return NextResponse.json(body, { status, headers: noStore })
  }
}

export const GET = handle
export const POST = handle
