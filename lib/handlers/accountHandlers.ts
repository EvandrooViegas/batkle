import { NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { corsify } from '@/lib/services/middleware'
import { loadAccount } from '@/lib/auth'
import { parseOnboarding, parseOnboardingDraft } from '@/lib/onboardingOptions'
import { unverifiedPhone } from '@/lib/notifications/settings'

/** Keeps answers typed but not yet submitted on the account, so someone who leaves finds them filled in. */
export async function handleSaveOnboardingDraft(db: any, userId: string, body: any) {
  await db.collection('users').updateOne({ id: userId, onboardedAt: { $exists: false } }, { $set: { onboardingDraft: parseOnboardingDraft(body), updatedAt: new Date() } })
  return corsify(NextResponse.json({ success: true }))
}

/** Start over: forget the unfinished answers. */
export async function handleClearOnboardingDraft(db: any, userId: string) {
  await db.collection('users').updateOne({ id: userId }, { $unset: { onboardingDraft: '' } })
  return corsify(NextResponse.json({ success: true }))
}

/**
 * Saves the name (and the optional phone number, unverified until it is checked in Settings) and marks the account
 * ready for the app.
 */
export async function handleCompleteOnboarding(db: any, userId: string, body: any) {
  const answers = parseOnboarding(body)
  if ('error' in answers) return corsify(NextResponse.json({ error: answers.error, field: answers.field }, { status: 400 }))

  // Refresh from Clerk so the record has the email this person signed in with.
  const account = await loadAccount(db, userId, true)
  const now = new Date()
  const phone = answers.phone ? { phone: unverifiedPhone(answers.phone, account.phone) } : {}
  await db.collection('users').updateOne({ id: userId }, { $set: { name: answers.name, ...phone, onboardedAt: now, updatedAt: now }, $unset: { onboardingDraft: '' } })

  // Email sign-ups have no name in Clerk yet; keep Clerk's profile (account settings) in step with the one given here.
  try {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    const [firstName, ...rest] = answers.name.split(' ')
    const lastName = rest.join(' ')
    if ((user.firstName || '') !== firstName || (user.lastName || '') !== lastName) await clerk.users.updateUser(userId, { firstName, lastName })
  } catch (error: any) {
    console.warn('[account] could not update the name in Clerk:', error?.errors?.[0]?.message || error?.message)
  }

  return corsify(NextResponse.json({ success: true }))
}
