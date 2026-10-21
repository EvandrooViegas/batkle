import { NextResponse } from 'next/server'
import { loadAccount } from '@/lib/auth'
import { requireFeature } from '@/lib/billing/account'
import { emailConfigured, emailLayout, escapeHtml, sendEmail } from '@/lib/notifications/email'
import { acceptInvitation, declineInvitation, deleteTeam, ensureTeam, ensureTeamIndexes, inviteMember, leaveTeam, removeMember, renameTeam, teamOverview } from '@/lib/teams'

const displayName = (account: any) => account?.name || String(account?.email || '').split('@')[0] || 'Someone'
const defaultTeamName = (account: any) => `${displayName(account)}’s team`

/** Teams come with the plans that include custom designs (Pro and Business); the upgrade names teams. */
async function requireTeamsPlan(db: any, userId: string) {
  try { await requireFeature(db, userId, 'customDesigns') }
  catch (error: any) {
    if (error?.billing) Object.assign(error, { message: 'Teams are part of Pro and Business. Upgrade to share designs with a team.', details: { ...error.details, feature: 'teams' } })
    throw error
  }
}

/** The invitation email: who invited them, and where to accept. Never fails the invite; returns whether it went. */
async function emailInvitation(to: string, inviter: string, teamName: string, link: string, key: string) {
  if (!emailConfigured()) return false
  const heading = `${inviter} invited you to ${teamName}`
  const paragraphs = [
    `${escapeHtml(inviter)} added you to <strong>${escapeHtml(teamName)}</strong> on Batkle. Teams share the post designs their members make, so you can use them for your own brands.`,
    `Sign in to Batkle with this email address (${escapeHtml(to)}), or create a free account with it, then accept the invitation in Settings.`,
  ]
  try {
    await sendEmail({
      to, subject: heading, idempotencyKey: key,
      html: emailLayout({ heading, paragraphs, button: { label: 'Open the invitation', url: link }, footer: 'Not expecting this? Ignore it: nothing happens unless you accept.' }),
      text: `${heading}\n\n${inviter} added you to ${teamName} on Batkle. Teams share the post designs their members make.\n\nSign in with ${to} and accept the invitation in Settings: ${link}\n`,
    })
    return true
  } catch (error: any) {
    console.warn('[teams] invitation email not sent:', error?.message)
    return false
  }
}

/**
 * /api/teams, for the signed-in account:
 *   GET    /                           the account's team, the teams it is in, and invitations to its email
 *   PATCH  /                           { name } rename (creates the team if needed)
 *   DELETE /                           delete the account's team
 *   POST   /invite                     { email } invite someone (Pro and Business)
 *   DELETE /members/:id                remove someone, or take back an invitation
 *   POST   /invitations/:id/accept     join a team
 *   DELETE /invitations/:id            decline
 *   DELETE /memberships/:teamId        leave a team
 */
export async function handleTeamRequest(db: any, request: Request, userId: string, path: string[], baseUrl: string) {
  await ensureTeamIndexes(db)
  const method = request.method
  const account = await loadAccount(db, userId)
  const body = method === 'POST' || method === 'PATCH' ? await request.json().catch(() => ({})) : {}
  const overview = async () => NextResponse.json(await teamOverview(db, userId, account.email))
  const [first, id, action] = path

  if (!first && method === 'GET') return overview()
  if (!first && method === 'PATCH') {
    await requireTeamsPlan(db, userId)
    await ensureTeam(db, userId, defaultTeamName(account))
    await renameTeam(db, userId, body.name)
    return overview()
  }
  if (!first && method === 'DELETE') { await deleteTeam(db, userId); return overview() }
  if (first === 'invite' && method === 'POST') {
    await requireTeamsPlan(db, userId)
    const { team, member } = await inviteMember(db, userId, account.email, body.email, defaultTeamName(account))
    const emailed = await emailInvitation(member.email, displayName(account), team.name, `${baseUrl}/app/team`, `team-invite-${member.id}`)
    return NextResponse.json({ ...(await teamOverview(db, userId, account.email)), emailed })
  }
  if (first === 'members' && id && method === 'DELETE') { await removeMember(db, userId, id); return overview() }
  if (first === 'invitations' && id && action === 'accept' && method === 'POST') { await acceptInvitation(db, userId, account, id); return overview() }
  if (first === 'invitations' && id && !action && method === 'DELETE') { await declineInvitation(db, account, id); return overview() }
  if (first === 'memberships' && id && method === 'DELETE') { await leaveTeam(db, userId, id); return overview() }
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}
