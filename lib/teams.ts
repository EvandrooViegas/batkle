import { randomUUID } from 'node:crypto'

/**
 * Teams: a Pro or Business account invites people by email, and everyone in the team can see and use the private
 * designs its members publish. A team shares nothing else: brands, posts and plans stay each person's own.
 * Each account owns at most one team and can belong to any number of others.
 *
 *   teams        { id, ownerId, name, createdAt, updatedAt }
 *   teamMembers  { id, teamId, email, userId, status: 'invited' | 'active', invitedBy, invitedAt, joinedAt }
 *
 * The owner has no member row; ownership is teams.ownerId. An invitation is accepted by the account whose verified
 * email it was sent to.
 */
export const TEAM_MAX_MEMBERS = 20

const teams = (db: any) => db.collection('teams')
const members = (db: any) => db.collection('teamMembers')
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })

export const normalizeEmail = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '')
export const validEmail = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
const cleanName = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 60) : '')

let indexes: Promise<unknown> | null = null
/** Created once per server process: one team per owner, one row per email in a team. */
export function ensureTeamIndexes(db: any) {
  indexes ||= Promise.all([
    teams(db).createIndex({ ownerId: 1 }, { unique: true }),
    teams(db).createIndex({ id: 1 }, { unique: true }),
    members(db).createIndex({ teamId: 1, email: 1 }, { unique: true }),
    members(db).createIndex({ userId: 1, status: 1 }),
    members(db).createIndex({ email: 1, status: 1 }),
  ]).catch(error => { indexes = null; console.warn('[teams] could not create indexes:', error?.message) })
  return indexes
}

export async function ownTeam(db: any, userId: string) {
  return teams(db).findOne({ ownerId: userId }, { projection: { _id: 0 } })
}

/** Everyone who shares a team with this account, the account itself included. */
export async function teammateIds(db: any, userId: string): Promise<string[]> {
  const [joined, owned] = await Promise.all([
    members(db).find({ userId, status: 'active' }, { projection: { _id: 0, teamId: 1 } }).toArray(),
    teams(db).find({ ownerId: userId }, { projection: { _id: 0, id: 1 } }).toArray(),
  ])
  const teamIds = [...new Set([...joined.map((m: any) => m.teamId), ...owned.map((t: any) => t.id)])]
  if (!teamIds.length) return [userId]
  const [rows, owners] = await Promise.all([
    members(db).find({ teamId: { $in: teamIds }, status: 'active' }, { projection: { _id: 0, userId: 1 } }).toArray(),
    teams(db).find({ id: { $in: teamIds } }, { projection: { _id: 0, ownerId: 1 } }).toArray(),
  ])
  return [...new Set([userId, ...owners.map((t: any) => t.ownerId), ...rows.map((r: any) => r.userId)].filter(Boolean))] as string[]
}

/** The account's own team, created the first time it is needed (named after the person, renamable). */
export async function ensureTeam(db: any, userId: string, defaultName: string) {
  const existing = await ownTeam(db, userId)
  if (existing) return existing
  const now = new Date()
  const team = { id: `team_${randomUUID()}`, ownerId: userId, name: cleanName(defaultName) || 'My team', createdAt: now, updatedAt: now }
  try {
    await teams(db).insertOne({ ...team })
  } catch (error: any) {
    // Two requests at once: the other one created it.
    if (error?.code !== 11000) throw error
    return ownTeam(db, userId)
  }
  return team
}

export async function renameTeam(db: any, userId: string, name: unknown) {
  const clean = cleanName(name)
  if (!clean) throw httpError(400, 'Give the team a name.')
  const result = await teams(db).updateOne({ ownerId: userId }, { $set: { name: clean, updatedAt: new Date() } })
  if (!result.matchedCount) throw httpError(404, 'You have no team yet.')
}

/** Deleting a team removes everyone from it; their own designs and brands are untouched. */
export async function deleteTeam(db: any, userId: string) {
  const team = await ownTeam(db, userId)
  if (!team) return
  await members(db).deleteMany({ teamId: team.id })
  await teams(db).deleteOne({ id: team.id })
}

/** Invites someone by email to the account's team. `ownerEmail` is the inviter's own, which cannot be invited. */
export async function inviteMember(db: any, userId: string, ownerEmail: string, email: unknown, defaultName: string) {
  const address = normalizeEmail(email)
  if (!validEmail(address)) throw httpError(400, 'That email address is not valid.')
  if (address === normalizeEmail(ownerEmail)) throw httpError(400, 'You are already in your team.')
  const team = await ensureTeam(db, userId, defaultName)
  if (await members(db).findOne({ teamId: team.id, email: address }, { projection: { _id: 1 } })) throw httpError(409, `${address} is already in the team or invited.`)
  if (await members(db).countDocuments({ teamId: team.id }) >= TEAM_MAX_MEMBERS) throw httpError(409, `A team holds up to ${TEAM_MAX_MEMBERS} people. Remove someone to invite another.`)
  const member = { id: `member_${randomUUID()}`, teamId: team.id, email: address, userId: null, status: 'invited', invitedBy: userId, invitedAt: new Date(), joinedAt: null }
  try {
    await members(db).insertOne({ ...member })
  } catch (error: any) {
    if (error?.code === 11000) throw httpError(409, `${address} is already in the team or invited.`)
    throw error
  }
  return { team, member }
}

/** Accepts an invitation sent to this account's verified email. */
export async function acceptInvitation(db: any, userId: string, account: { email: string; emailVerified: boolean }, memberId: unknown) {
  if (!account.emailVerified) throw httpError(403, 'Verify your email address to join a team.')
  const invite = await members(db).findOne({ id: memberId, email: normalizeEmail(account.email), status: 'invited' }, { projection: { _id: 0 } })
  if (!invite) throw httpError(404, 'This invitation is no longer open.')
  const team = await teams(db).findOne({ id: invite.teamId }, { projection: { _id: 0 } })
  if (!team) { await members(db).deleteOne({ id: invite.id }); throw httpError(404, 'This team no longer exists.') }
  if (team.ownerId === userId) throw httpError(400, 'You already own this team.')
  await members(db).updateOne({ id: invite.id, status: 'invited' }, { $set: { userId, status: 'active', joinedAt: new Date() } })
  return team
}

export async function declineInvitation(db: any, account: { email: string }, memberId: unknown) {
  await members(db).deleteOne({ id: memberId, email: normalizeEmail(account.email), status: 'invited' })
}

export async function leaveTeam(db: any, userId: string, teamId: unknown) {
  const result = await members(db).deleteOne({ teamId, userId })
  if (!result.deletedCount) throw httpError(404, 'You are not in this team.')
}

/** The owner removes someone, or takes back an invitation. */
export async function removeMember(db: any, userId: string, memberId: unknown) {
  const team = await ownTeam(db, userId)
  if (!team) throw httpError(404, 'You have no team yet.')
  const result = await members(db).deleteOne({ id: memberId, teamId: team.id })
  if (!result.deletedCount) throw httpError(404, 'That person is not in your team.')
}

const displayName = (user: any) => user?.name || (user?.email ? String(user.email).split('@')[0] : '') || 'Someone'

/**
 * What the Team settings show: the account's own team and its people, the teams it belongs to, and invitations
 * waiting for its email.
 */
export async function teamOverview(db: any, userId: string, email: string) {
  const address = normalizeEmail(email)
  const [team, joined, invited] = await Promise.all([
    ownTeam(db, userId),
    members(db).find({ userId, status: 'active' }, { projection: { _id: 0 } }).toArray(),
    address ? members(db).find({ email: address, status: 'invited' }, { projection: { _id: 0 } }).toArray() : [],
  ])
  const ownRows = team ? await members(db).find({ teamId: team.id }, { projection: { _id: 0 } }).toArray() : []
  const otherTeamIds = [...new Set([...joined, ...invited].map((m: any) => m.teamId))]
  const otherTeams = otherTeamIds.length ? await teams(db).find({ id: { $in: otherTeamIds } }, { projection: { _id: 0 } }).toArray() : []
  const userIds = [...new Set([...ownRows.map((m: any) => m.userId), ...otherTeams.map((t: any) => t.ownerId)].filter(Boolean))]
  const users = userIds.length ? await db.collection('users').find({ id: { $in: userIds } }, { projection: { _id: 0, id: 1, name: 1, email: 1 } }).toArray() : []
  const userById = new Map(users.map((u: any) => [u.id, u]))
  const teamById = new Map(otherTeams.map((t: any) => [t.id, t]))
  const describe = (t: any) => ({ id: t.id, name: t.name, owner: displayName(userById.get(t.ownerId)) })
  return {
    team: team ? {
      id: team.id, name: team.name, max: TEAM_MAX_MEMBERS,
      members: ownRows
        .sort((a: any, b: any) => +new Date(a.invitedAt) - +new Date(b.invitedAt))
        .map((m: any) => ({ id: m.id, email: m.email, status: m.status, name: m.userId ? displayName(userById.get(m.userId)) : '' })),
    } : null,
    memberships: joined.map((m: any) => teamById.get(m.teamId)).filter(Boolean).map(describe),
    invitations: invited.filter((m: any) => teamById.has(m.teamId)).map((m: any) => ({ id: m.id, team: describe(teamById.get(m.teamId)) })),
  }
}
