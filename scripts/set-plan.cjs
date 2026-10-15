// Puts an account on a plan without Stripe, for the owner and for testing:
//   node scripts/set-plan.cjs <email> <free|pro|business> [month|year]
// The account starts a fresh credit month (nothing used) from now. Reads MONGO_URL and DB_NAME from .env.local, or
// from the environment. The person must have signed in to Batkle once.
const fs = require('node:fs')
const path = require('node:path')
const { stripTypeScriptTypes } = require('node:module')
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local'), quiet: true })
const { MongoClient } = require('mongodb')

/** lib/billing/plans.ts, loaded the way the tests load it. */
function loadPlans() {
  const source = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '..', 'lib/billing/plans.ts'), 'utf8')).replace(/^export /gm, '')
  return new Function(`${source};return { PLANS, PLAN_IDS }`)()
}

async function main() {
  const { PLANS, PLAN_IDS } = loadPlans()
  const [email, planId, interval = 'month'] = process.argv.slice(2)
  if (!email || !PLAN_IDS.includes(planId) || !['month', 'year'].includes(interval)) {
    console.error(`Usage: node scripts/set-plan.cjs <email> <${PLAN_IDS.join('|')}> [month|year]`)
    process.exit(1)
  }
  if (!process.env.MONGO_URL || !process.env.DB_NAME) throw new Error('Set MONGO_URL and DB_NAME (in .env.local or the environment).')

  const client = new MongoClient(process.env.MONGO_URL, { serverSelectionTimeoutMS: 10000 })
  await client.connect()
  try {
    const db = client.db(process.env.DB_NAME)
    const user = await db.collection('users').findOne({ email: email.trim().toLowerCase() }, { projection: { _id: 0, id: 1, email: 1 } })
    if (!user) throw new Error(`No Batkle account uses ${email}. They need to sign in once first.`)

    const free = planId === 'free'
    const now = new Date()
    // The same fields lib/billing/account.ts opens an account with; a fresh credit month starts now.
    const after = await db.collection('billingAccounts').findOneAndUpdate(
      { id: user.id },
      {
        $set: {
          plan: planId, status: free ? 'none' : 'active', interval: free ? null : interval,
          cancelAtPeriodEnd: false, currentPeriodEnd: null, trialEnd: null,
          creditAnchor: now, creditPeriodStart: now, creditsUsed: 0, textsUsed: 0, updatedAt: now,
        },
        $setOnInsert: { id: user.id, extraCredits: 0, createdAt: now },
      },
      { upsert: true, returnDocument: 'after', projection: { _id: 0 } },
    )
    const account = after?.value ?? after
    const plan = PLANS[planId]
    console.log(`${user.email} is now on ${plan.name}${free ? '' : ` (${interval === 'year' ? 'yearly' : 'monthly'})`}: ${plan.credits} credits this month, ${account.extraCredits || 0} extra, ${plan.brands} brand${plan.brands === 1 ? '' : 's'}.`)
    if (account.stripeSubscriptionId) {
      console.log(`Note: this account has a Stripe subscription (${account.stripeSubscriptionId}). Stripe's next update to it sets the plan again.`)
    }
  } finally {
    await client.close()
  }
}

main().catch(error => { console.error(error.message); process.exit(1) })
