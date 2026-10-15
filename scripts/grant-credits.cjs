// Adds developer API credits to an account, until credit packs can be bought:
//   node scripts/grant-credits.cjs <email> <credits> ["note shown in the dashboard"]
// Reads MONGO_URL and DB_NAME from .env.local, or from the environment. The person must have signed in to Batkle once.
const path = require('node:path')
const { randomUUID } = require('node:crypto')
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })
const { MongoClient } = require('mongodb')

const ledgerId = () => 'cr_' + randomUUID().replace(/-/g, '').slice(0, 24)

// Same rule as starterCredits() in lib/developer/pricing.ts.
function starterCredits() {
  const value = Number(process.env.DEVELOPER_FREE_CREDITS)
  return process.env.DEVELOPER_FREE_CREDITS?.trim() && Number.isInteger(value) && value >= 0 ? value : 100
}

async function main() {
  const [email, amount, ...words] = process.argv.slice(2)
  const credits = Number(amount)
  if (!email || !Number.isInteger(credits) || credits <= 0) {
    console.error('Usage: node scripts/grant-credits.cjs <email> <credits> ["note"]')
    process.exit(1)
  }
  if (!process.env.MONGO_URL || !process.env.DB_NAME) throw new Error('Set MONGO_URL and DB_NAME (in .env.local or the environment).')

  const client = new MongoClient(process.env.MONGO_URL, { serverSelectionTimeoutMS: 10000 })
  await client.connect()
  try {
    const db = client.db(process.env.DB_NAME)
    const user = await db.collection('users').findOne({ email: email.trim().toLowerCase() }, { projection: { _id: 0, id: 1, email: 1 } })
    if (!user) throw new Error(`No Batkle account uses ${email}. They need to sign in once first.`)

    const accounts = db.collection('developerAccounts'), ledger = db.collection('creditLedger')
    const now = new Date()
    // An account opened here gets its starter credits too, like one opened by the dashboard or the API.
    if (!await accounts.findOne({ id: user.id })) {
      const starter = starterCredits()
      try {
        await accounts.insertOne({ id: user.id, balance: starter, createdAt: now, updatedAt: now })
        if (starter) await ledger.insertOne({ id: ledgerId(), ownerId: user.id, credits: starter, reason: 'starter', note: 'Starter credits', createdAt: now })
      } catch (error) {
        if (error?.code !== 11000) throw error
      }
    }
    const note = words.join(' ').trim().slice(0, 200) || 'Credits added by the Batkle team'
    const after = await accounts.findOneAndUpdate({ id: user.id }, { $inc: { balance: credits }, $set: { updatedAt: now } }, { returnDocument: 'after' })
    await ledger.insertOne({ id: ledgerId(), ownerId: user.id, credits, reason: 'grant', note, createdAt: now })
    console.log(`Added ${credits} credits to ${user.email}. Balance: ${after.balance}.`)
  } finally {
    await client.close()
  }
}

main().catch(error => { console.error(error.message); process.exit(1) })
