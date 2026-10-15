import { cache } from 'react'
import { redirect } from 'next/navigation'
import { auth, currentUser } from '@clerk/nextjs/server'
import { connectToMongo } from '@/lib/services/db/mongo'

/**
 * Accounts. Clerk signs people in (Google, or email and password); each person also has a record in the `users`
 * collection holding the name they gave in onboarding. Brands (`flows`), posts (`canvases`) and galleries carry the
 * owner's Clerk user ID as `ownerId`; everything else (gallery assets, renders) belongs to an account through
 * its brand or post.
 */

export interface Account {
  id: string
  email: string
  emailVerified: boolean
  name: string
  onboardedAt?: Date
  onboardingDraft?: { step: 'about' | 'plans'; answers: Record<string, string> }
  legacyDataClaimedAt?: Date
  /** How post reminders reach this person (lib/notifications/settings.ts); defaults apply when unset. */
  notifications?: { email: boolean; sms: boolean; leadMinutes: 0 | 60 }
  /** Optional mobile number for text reminders, E.164. Never texted before it is verified and agreed to. */
  phone?: { number: string; verifiedAt: Date | null; smsConsentAt: Date | null; optedOutAt: Date | null; consentText?: string }
  createdAt: Date
  updatedAt: Date
}

/** The signed-in person as server components need them. */
export interface SessionAccount {
  userId: string
  email: string
  /** The name to show: the saved name, else the start of the email. */
  name: string
  /** The saved name only (from Google or onboarding); empty for a new email sign-up. */
  profileName: string
  onboarded: boolean
  /** Onboarding answers saved before finishing, or null. */
  onboardingDraft: { step: 'about' | 'plans'; answers: Record<string, string> } | null
}

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })

/** The signed-in Clerk user's ID, or null. */
export async function currentUserId(): Promise<string | null> {
  const { userId } = await auth()
  return userId
}

/** The signed-in Clerk user's ID; for the API, a 401 otherwise. */
export async function requireUserId(): Promise<string> {
  const userId = await currentUserId()
  if (!userId) throw httpError(401, 'Sign in to continue.')
  return userId
}

let indexes: Promise<unknown> | null = null
/** Created once per server process; every account query filters on these fields. */
function ensureIndexes(db: any) {
  indexes ||= Promise.all([
    db.collection('users').createIndex({ id: 1 }, { unique: true }),
    db.collection('flows').createIndex({ ownerId: 1 }),
    db.collection('canvases').createIndex({ ownerId: 1, updatedAt: -1 }),
  ]).catch(error => { indexes = null; console.warn('[auth] could not create indexes:', error?.message) })
  return indexes
}

function clerkProfile(user: any) {
  const primary = user.emailAddresses?.find((e: any) => e.id === user.primaryEmailAddressId) || user.emailAddresses?.[0]
  return {
    email: (primary?.emailAddress || '').toLowerCase(),
    emailVerified: primary?.verification?.status === 'verified',
    name: [user.firstName, user.lastName].filter(Boolean).join(' ').trim(),
  }
}

/**
 * The account record for a Clerk user, created on their first visit. Clerk is only asked for the profile when the
 * record is new or `refresh` is set, so ordinary page loads cost one indexed read.
 */
export async function loadAccount(db: any, userId: string, refresh = false): Promise<Account> {
  await ensureIndexes(db)
  const users = db.collection('users')
  let account = await users.findOne({ id: userId }, { projection: { _id: 0 } })
  if (!account || refresh) {
    const user = await currentUser()
    if (!user || user.id !== userId) throw httpError(401, 'Sign in to continue.')
    const profile = clerkProfile(user)
    const now = new Date()
    const result = await users.findOneAndUpdate(
      { id: userId },
      {
        $set: { email: profile.email, emailVerified: profile.emailVerified, updatedAt: now },
        $setOnInsert: { id: userId, name: profile.name, createdAt: now },
      },
      { upsert: true, returnDocument: 'after', projection: { _id: 0 } },
    )
    // MongoDB driver v5+ returns the document directly; v4 wraps it in { value }
    account = result?.value ?? result
  }
  await claimLegacyData(db, account)
  return account
}

/**
 * Brands, posts and galleries made before sign-in existed have no owner. They move, once, to the account whose
 * verified email is LEGACY_DATA_OWNER_EMAIL. Until then nobody can open them.
 */
async function claimLegacyData(db: any, account: Account) {
  const owner = process.env.LEGACY_DATA_OWNER_EMAIL?.trim().toLowerCase()
  if (!owner || account.legacyDataClaimedAt || !account.emailVerified || account.email !== owner) return
  const unowned = { ownerId: { $exists: false } }
  const set = { $set: { ownerId: account.id } }
  const [flows, canvases, galleries] = await Promise.all([
    db.collection('flows').updateMany(unowned, set),
    // Design Library editor canvases belong to the library admin, not to an account.
    db.collection('canvases').updateMany({ ...unowned, globalDesignEditor: { $exists: false } }, set),
    db.collection('galleries').updateMany(unowned, set),
  ])
  account.legacyDataClaimedAt = new Date()
  await db.collection('users').updateOne({ id: account.id }, { $set: { legacyDataClaimedAt: account.legacyDataClaimedAt } })
  console.log(`[auth] ${account.email} took over ${flows.modifiedCount} brands, ${canvases.modifiedCount} posts and ${galleries.modifiedCount} galleries made before sign-in`)
}

/** The signed-in person for server components, or null. One lookup per request. */
export const getAccount = cache(async (): Promise<SessionAccount | null> => {
  const userId = await currentUserId()
  if (!userId) return null
  const account = await loadAccount(await connectToMongo(), userId)
  return {
    userId,
    email: account.email,
    name: account.name || account.email.split('@')[0] || 'Your account',
    profileName: account.name || '',
    onboarded: Boolean(account.onboardedAt),
    onboardingDraft: account.onboardingDraft ? { step: account.onboardingDraft.step, answers: account.onboardingDraft.answers } : null,
  }
})

/**
 * For app pages: the signed-in account once it has finished onboarding. Anyone else goes to sign in, or to
 * onboarding first and then back to `returnTo`.
 */
export async function requireOnboardedAccount(returnTo = '/app'): Promise<SessionAccount> {
  const account = await getAccount()
  // The middleware sends signed-out visitors to sign in before they get here.
  if (!account) redirect(`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`)
  if (!account.onboarded) redirect(returnTo === '/app' ? '/onboarding' : `/onboarding?next=${encodeURIComponent(returnTo)}`)
  return account
}

/** Throws a 404 unless every one of these brands is the account's own; brands that don't exist pass. */
export async function requireOwnBrands(db: any, userId: string, flowIds: string[]) {
  if (!flowIds.length) return
  const foreign = await db.collection('flows').countDocuments({ id: { $in: flowIds }, ownerId: { $ne: userId } }, { limit: 1 })
  if (foreign) throw httpError(404, 'Brand not found')
}
