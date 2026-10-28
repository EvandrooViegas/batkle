import { NextResponse } from 'next/server'
import { loadAccount } from '@/lib/auth'
import { requireFeature } from '@/lib/billing/account'
import { emailConfigured, emailDelivery, emailLayout, escapeHtml, mailDomainExists, sendEmail } from '@/lib/notifications/email'
import {
  acceptInvitation, brandRole, brandTeam, declineInvitation, ensureTeamIndexes, inviteMember, leaveBrand, normalizeEmail, recordInvitationEmail,
  refreshDeliveries, removeMember, roleAtLeast, setMemberRole, teamsOverview, validEmail, type MemberRole,
} from '@/lib/teams'

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })
const displayName = (account: any) => account?.name || String(account?.email || '').split('@')[0] || 'Someone'

/** What each role can do, as the invitation email puts it. */
export const ROLE_TEXT: Record<MemberRole, string> = {
  admin: 'As an admin you can do everything its owner can except delete it: posts, ads, the schedule, the brand profile and its people.',
  editor: 'As an editor you can make, edit and schedule its posts and ads.',
  viewer: 'As a viewer you can see its posts, schedule and gallery.',
}
const ROLE_NAME: Record<MemberRole, string> = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' }

/** Inviting people is part of the brand owner's plan when it includes custom designs (Pro and Business). */
async function requireTeamsPlan(db: any, ownerId: string) {
  try { await requireFeature(db, ownerId, 'customDesigns') }
  catch (error: any) {
    if (error?.billing) Object.assign(error, { message: 'Inviting people to a brand is part of Pro and Business.', details: { ...error.details, feature: 'teams' } })
    throw error
  }
}

/** The invitation email: who invited them, to which brand and as what, and where to accept. Answers Resend's ID, or ''. */
async function emailInvitation(to: string, inviter: string, brand: string, role: MemberRole, link: string, key: string) {
  if (!emailConfigured()) return ''
  const heading = `${inviter} invited you to ${brand}`
  const paragraphs = [
    `${escapeHtml(inviter)} added you to the brand <strong>${escapeHtml(brand)}</strong> on Batkle. ${escapeHtml(ROLE_TEXT[role])}`,
    `Sign in to Batkle with this email address (${escapeHtml(to)}), or create a free account with it, then accept the invitation. The brand then appears in your brand list.`,
  ]
  try {
    const { id } = await sendEmail({
      to, subject: heading, idempotencyKey: key,
      html: emailLayout({ heading, paragraphs, button: { label: 'Open the invitation', url: link }, footer: 'Not expecting this? Ignore it: nothing happens unless you accept.' }),
      text: `${heading}\n\n${inviter} added you to the brand ${brand} on Batkle. ${ROLE_TEXT[role]}\n\nSign in with ${to} and accept the invitation: ${link}\n`,
    })
    return id
  } catch (error: any) {
    console.warn('[teams] invitation email not sent:', error?.message)
    return ''
  }
}

/** The account's part in the brand, at least `need`; a brand it has no part in reads as missing. */
async function requireRole(db: any, userId: string, flowId: string, need: 'viewer' | 'admin') {
  const access = await brandRole(db, userId, flowId)
  if (!access) throw httpError(404, 'Brand not found')
  if (!roleAtLeast(access.role, need)) throw httpError(403, 'Only the brand’s owner and its admins can manage its people.')
  return access
}

/**
 * /api/teams, for the signed-in account:
 *   GET    /                                  invitations to its email, brands shared with it, its own brands' teams
 *   POST   /invitations/:id/accept            join a brand
 *   DELETE /invitations/:id                   decline
 *   GET    /brands/:flowId                    the brand's people (anyone in the brand)
 *   POST   /brands/:flowId/invite             { email, role } (the owner and admins; the owner's plan includes teams)
 *   PATCH  /brands/:flowId/members/:id        { role } (the owner and admins)
 *   DELETE /brands/:flowId/members/:id        remove someone, or take back an invitation (the owner and admins)
 *   DELETE /brands/:flowId/membership         leave a brand shared with you
 */
export async function handleTeamRequest(db: any, request: Request, userId: string, path: string[], baseUrl: string) {
  await ensureTeamIndexes(db)
  const method = request.method
  const account = await loadAccount(db, userId)
  const body = method === 'POST' || method === 'PATCH' ? await request.json().catch(() => ({})) : {}
  const [first, id, action, memberId] = path

  if (!first && method === 'GET') return NextResponse.json(await teamsOverview(db, userId, account.email))
  if (first === 'invitations' && id && action === 'accept' && method === 'POST') {
    const joined = await acceptInvitation(db, userId, account, id)
    return NextResponse.json({ ...(await teamsOverview(db, userId, account.email)), joined: joined.flowId })
  }
  if (first === 'invitations' && id && !action && method === 'DELETE') {
    await declineInvitation(db, account, id)
    return NextResponse.json(await teamsOverview(db, userId, account.email))
  }

  if (first !== 'brands' || !id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const flowId = id
  const team = async (role: any) => NextResponse.json(await brandTeam(db, flowId, userId, role))

  if (!action && method === 'GET') {
    const access = await requireRole(db, userId, flowId, 'viewer')
    // The people who manage the brand see whether their invitations arrived.
    if (roleAtLeast(access.role, 'admin')) await refreshDeliveries(db, flowId, emailDelivery).catch(error => console.warn('[teams] delivery check failed:', error?.message))
    return team(access.role)
  }
  if (action === 'membership' && method === 'DELETE') {
    await leaveBrand(db, userId, flowId)
    return NextResponse.json(await teamsOverview(db, userId, account.email))
  }
  if (action === 'invite' && method === 'POST') {
    const access = await requireRole(db, userId, flowId, 'admin')
    await requireTeamsPlan(db, access.ownerId)
    // An address whose domain cannot receive mail is a typo: say so instead of sending an invitation nobody gets.
    const address = normalizeEmail(body.email)
    if (validEmail(address) && !(await mailDomainExists(address))) throw httpError(400, `Email can’t be delivered to ${address.split('@')[1]}. Check the address.`)
    const { brand, member } = await inviteMember(db, flowId, { userId, email: account.email }, body.email, body.role)
    const emailId = await emailInvitation(member.email, displayName(account), brand.name, member.role as MemberRole, `${baseUrl}/app/teams`, `brand-invite-${member.id}`)
    await recordInvitationEmail(db, member.id, emailId)
    return NextResponse.json({ ...(await brandTeam(db, flowId, userId, access.role)), emailed: Boolean(emailId), invited: { id: member.id, email: member.email, role: ROLE_NAME[member.role as MemberRole] } })
  }
  if (action === 'members' && memberId && method === 'PATCH') {
    const access = await requireRole(db, userId, flowId, 'admin')
    await setMemberRole(db, flowId, memberId, body.role)
    return team(access.role)
  }
  if (action === 'members' && memberId && method === 'DELETE') {
    const access = await requireRole(db, userId, flowId, 'admin')
    await removeMember(db, flowId, memberId)
    return team(access.role)
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}
