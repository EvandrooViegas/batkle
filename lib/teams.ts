import { randomUUID } from 'node:crypto'

/**
 * Brand teams. The owner of a brand, or someone they made an admin of it, invites people to that brand by email, each
 * with a role; once they accept, the brand is in their brand list next to their own. A shared brand stays the owner's:
 * its posts, ads and schedule are saved on the owner's account, and making posts in it spends the owner's credits on
 * the owner's plan. People who share a brand are teammates, so they also see the private designs each other publishes.
 *
 *   brandMembers { id, flowId, ownerId, email, userId, role, status: 'invited' | 'active', invitedBy, invitedAt,
 *                  joinedAt, lastOpenedAt, emailId, delivery: 'sent' | 'delivered' | 'bounced' | null }
 *
 * The owner has no member row; ownership is flows.ownerId. An invitation is accepted by the account whose verified
 * email it was sent to. `emailId` is the invitation email at Resend, and `delivery` what Resend last said about it.
 */

/** The roles the owner gives; each can do everything the ones after it can. */
export const ROLES = ['admin', 'editor', 'viewer'] as const
export type MemberRole = typeof ROLES[number]
export type BrandRole = 'owner' | MemberRole
const RANK: Record<BrandRole, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 }

/** People a brand can have besides its owner, invitations included. */
export const TEAM_MAX_MEMBERS = 20
const DAY = 86400_000

const members = (db: any) => db.collection('brandMembers')
const flows = (db: any) => db.collection('flows')
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })

export const normalizeEmail = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '')
export const validEmail = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
export const isRole = (value: unknown): value is MemberRole => ROLES.includes(value as MemberRole)
export const roleAtLeast = (role: BrandRole | null | undefined, need: BrandRole) => Boolean(role && RANK[role] >= RANK[need])
const displayName = (user: any) => user?.name || (user?.email ? String(user.email).split('@')[0] : '') || 'Someone'

let indexes: Promise<unknown> | null = null
/** Created once per server process: one row per email in a brand, and the lookups by person and by owner. */
export function ensureTeamIndexes(db: any) {
  indexes ||= Promise.all([
    members(db).createIndex({ flowId: 1, email: 1 }, { unique: true }),
    members(db).createIndex({ id: 1 }, { unique: true }),
    members(db).createIndex({ userId: 1, status: 1 }),
    members(db).createIndex({ email: 1, status: 1 }),
    members(db).createIndex({ ownerId: 1, status: 1 }),
  ]).catch(error => { indexes = null; console.warn('[teams] could not create indexes:', error?.message) })
  return indexes
}

// ─── Access ──────────────────────────────────────────────────────────────────

const REFUSALS: Record<BrandRole, string> = {
  viewer: 'Brand not found',
  editor: 'You can view this brand but not change it. Ask its owner for the Editor role.',
  admin: 'Only the brand’s owner and its admins can change this.',
  owner: 'Only the brand’s owner can do this.',
}

/** The account's part in a brand: 'owner', or its role as a member, with the brand's owner. Null when it has none. */
export async function brandRole(db: any, userId: string | null | undefined, flowId: unknown): Promise<{ flowId: string; ownerId: string; role: BrandRole } | null> {
  if (!userId || typeof flowId !== 'string' || !flowId) return null
  const flow = await flows(db).findOne({ id: flowId }, { projection: { _id: 0, id: 1, ownerId: 1 } })
  if (!flow) return null
  if (flow.ownerId === userId) return { flowId, ownerId: flow.ownerId, role: 'owner' }
  const member = await members(db).findOne({ flowId, userId, status: 'active' }, { projection: { _id: 0, role: 1 } })
  return member && isRole(member.role) ? { flowId, ownerId: flow.ownerId, role: member.role } : null
}

/**
 * Checks the account may act on these brands with at least the role `need`, and answers whose account the work
 * belongs to: the brands' owner (the account itself for its own brands). A brand it has no part in reads as missing
 * (404); too low a role is a 403 that says what it takes. Brands that don't exist pass; with none left, null.
 */
export async function requireBrandAccess(db: any, userId: string, flowIds: unknown[], need: BrandRole = 'viewer'): Promise<string | null> {
  const ids = [...new Set(flowIds.filter((id): id is string => typeof id === 'string' && Boolean(id)))]
  if (!ids.length) return null
  const found = await flows(db).find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, ownerId: 1 } }).toArray()
  if (!found.length) return null
  // One request works in one account's brands.
  if (new Set(found.map((f: any) => f.ownerId)).size > 1) throw httpError(404, 'Brand not found')
  const ownerId = found[0].ownerId
  if (ownerId && ownerId === userId) return ownerId
  const rows = await members(db).find({ flowId: { $in: found.map((f: any) => f.id) }, userId, status: 'active' }, { projection: { _id: 0, flowId: 1, role: 1 } }).toArray()
  for (const flow of found) {
    const role = rows.find((r: any) => r.flowId === flow.id)?.role
    if (!isRole(role)) throw httpError(404, 'Brand not found')
    if (!roleAtLeast(role, need)) throw httpError(403, REFUSALS[need])
  }
  return ownerId
}

/**
 * A plan limit met in a brand shared with the account is the owner's plan, not the account's: the message says whose
 * it is and who to ask, and `sharedBy` (in the billing body) tells the page not to offer an upgrade of the account's own.
 */
export async function sharedPlanLimit(db: any, error: any, ownerId: string) {
  const owner = displayName(await db.collection('users').findOne({ id: ownerId }, { projection: { _id: 0, name: 1, email: 1 } }))
  const first = String(error?.message || '').split(/(?<=\.)\s/)[0]
  const message = error?.code === 'insufficient_credits'
    ? `Posts in this brand use ${owner}’s credits, and there aren’t enough left for this. Ask ${owner} to add more.`
    : `${first} This brand runs on ${owner}’s plan, so ask ${owner} to upgrade.`
  return Object.assign(error, { message, details: { ...error?.details, sharedBy: owner } })
}

/**
 * The same for an API answer: a credits, plan or storage limit (402) met while working in a brand of `ownerId`'s
 * that is shared with the caller gets the owner's wording and `sharedBy`. Anything else passes unchanged.
 */
export async function sharedLimitAnswer(db: any, response: Response, ownerId: string | null | undefined) {
  if (!ownerId || !(response instanceof Response) || response.status !== 402) return response
  let body: any
  try { body = await response.clone().json() } catch { return response }
  if (!['insufficient_credits', 'upgrade_required', 'limit_reached'].includes(body?.code) || typeof body.error !== 'string') return response
  const { error, code, ...details } = body
  const limit = await sharedPlanLimit(db, { message: error, code, details }, ownerId)
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new Response(JSON.stringify({ ...body, error: limit.message, sharedBy: limit.details.sharedBy }), { status: 402, headers })
}

/** Everyone who shares a brand with this account, the account itself included: they see each other's private designs. */
export async function teammateIds(db: any, userId: string): Promise<string[]> {
  const [joined, mine] = await Promise.all([
    members(db).find({ userId, status: 'active' }, { projection: { _id: 0, flowId: 1, ownerId: 1 } }).toArray(),
    members(db).find({ ownerId: userId, status: 'active' }, { projection: { _id: 0, userId: 1 } }).toArray(),
  ])
  const flowIds = [...new Set(joined.map((m: any) => m.flowId))]
  const others = flowIds.length ? await members(db).find({ flowId: { $in: flowIds }, status: 'active' }, { projection: { _id: 0, userId: 1 } }).toArray() : []
  return [...new Set([userId, ...joined.map((m: any) => m.ownerId), ...mine.map((m: any) => m.userId), ...others.map((m: any) => m.userId)].filter(Boolean))] as string[]
}

// ─── The brand list ──────────────────────────────────────────────────────────

/**
 * The brands shared with this account, read with `projection`, each with `lastOpenedAt` (when this person last
 * opened it, else when they joined) and `shared: { role, owner }` for the brand list.
 */
export async function sharedBrands(db: any, userId: string, projection: Record<string, number>) {
  const rows = await members(db).find({ userId, status: 'active' }, { projection: { _id: 0, flowId: 1, ownerId: 1, role: 1, lastOpenedAt: 1, joinedAt: 1 } }).toArray()
  if (!rows.length) return []
  const [found, owners] = await Promise.all([
    flows(db).find({ id: { $in: rows.map((r: any) => r.flowId) } }, { projection: { ...projection, _id: 0, id: 1, ownerId: 1 } }).toArray(),
    db.collection('users').find({ id: { $in: [...new Set(rows.map((r: any) => r.ownerId))] } }, { projection: { _id: 0, id: 1, name: 1, email: 1 } }).toArray(),
  ])
  const ownerById = new Map(owners.map((u: any) => [u.id, u]))
  return found.flatMap((flow: any) => {
    const row = rows.find((r: any) => r.flowId === flow.id)
    if (!row || !isRole(row.role) || row.ownerId !== flow.ownerId) return []
    const { ownerId, ...rest } = flow
    return [{ ...rest, lastOpenedAt: row.lastOpenedAt || row.joinedAt, shared: { role: row.role, owner: displayName(ownerById.get(ownerId)) } }]
  })
}

/** A member opened a shared brand: it moves up their brand list. The owner's own visits are kept on the brand. */
export async function memberOpened(db: any, userId: string, flowId: string) {
  const result = await members(db).updateOne({ flowId, userId, status: 'active' }, { $set: { lastOpenedAt: new Date() } })
  return result.matchedCount > 0
}

/** A deleted brand is gone for everyone in it too. */
export async function forgetBrand(db: any, flowId: string) {
  await members(db).deleteMany({ flowId })
}

// ─── People ──────────────────────────────────────────────────────────────────

export const BRAND_FIELDS = { _id: 0, id: 1, ownerId: 1, name: 1, 'brandContext.name': 1, 'brandContext.logo': 1, 'brandContext.logoVariants.originalTransparent': 1, 'brandContext.logoVariants.inkLightness': 1 }

/** A brand as the team pages show it: its name and logo (the same choice of logo file as the brand list). */
export function brandCard(flow: any) {
  const context = flow?.brandContext || {}
  return {
    id: flow?.id,
    name: context.name || flow?.name || 'Untitled brand',
    logo: context.logoVariants?.originalTransparent || context.logo || null,
    logoOnDark: (context.logoVariants?.inkLightness ?? 0) > 0.72,
  }
}

async function brandOf(db: any, flowId: unknown) {
  const flow = typeof flowId === 'string' && flowId ? await flows(db).findOne({ id: flowId }, { projection: BRAND_FIELDS }) : null
  if (!flow) throw httpError(404, 'Brand not found')
  return flow
}

/**
 * Invites someone by email to a brand with a role. The route has checked that the inviter may manage the brand's
 * people; `inviter.email` is theirs, and neither they nor the owner can be invited.
 */
export async function inviteMember(db: any, flowId: string, inviter: { userId: string; email: string }, email: unknown, role: unknown) {
  const address = normalizeEmail(email)
  if (!validEmail(address)) throw httpError(400, 'That email address is not valid.')
  if (!isRole(role)) throw httpError(400, 'Choose a role: Admin, Editor or Viewer.')
  const flow = await brandOf(db, flowId)
  const owner = await db.collection('users').findOne({ id: flow.ownerId }, { projection: { _id: 0, email: 1 } })
  if (address === normalizeEmail(inviter.email)) throw httpError(400, 'You are already in this brand.')
  if (address === normalizeEmail(owner?.email)) throw httpError(400, 'That is the brand’s owner.')
  if (await members(db).findOne({ flowId, email: address }, { projection: { _id: 1 } })) throw httpError(409, `${address} is already in this brand or invited.`)
  if (await members(db).countDocuments({ flowId }) >= TEAM_MAX_MEMBERS) throw httpError(409, `A brand can have up to ${TEAM_MAX_MEMBERS} people besides its owner. Remove someone to invite another.`)
  const member = { id: `member_${randomUUID()}`, flowId, ownerId: flow.ownerId, email: address, userId: null, role, status: 'invited', invitedBy: inviter.userId, invitedAt: new Date(), joinedAt: null, emailId: null, delivery: null }
  try {
    await members(db).insertOne({ ...member })
  } catch (error: any) {
    if (error?.code === 11000) throw httpError(409, `${address} is already in this brand or invited.`)
    throw error
  }
  return { brand: brandCard(flow), member }
}

export async function setMemberRole(db: any, flowId: string, memberId: unknown, role: unknown) {
  if (!isRole(role)) throw httpError(400, 'Choose a role: Admin, Editor or Viewer.')
  const result = await members(db).updateOne({ id: memberId, flowId }, { $set: { role } })
  if (!result.matchedCount) throw httpError(404, 'That person is not in this brand.')
}

/** Removes someone from a brand, or takes back an invitation. */
export async function removeMember(db: any, flowId: string, memberId: unknown) {
  const result = await members(db).deleteOne({ id: memberId, flowId })
  if (!result.deletedCount) throw httpError(404, 'That person is not in this brand.')
}

/** Accepts an invitation sent to this account's verified email; the brand joins its brand list. */
export async function acceptInvitation(db: any, userId: string, account: { email: string; emailVerified: boolean }, memberId: unknown) {
  if (!account.emailVerified) throw httpError(403, 'Verify your email address to join a brand.')
  const invite = await members(db).findOne({ id: memberId, email: normalizeEmail(account.email), status: 'invited' }, { projection: { _id: 0 } })
  if (!invite) throw httpError(404, 'This invitation is no longer open.')
  const flow = await flows(db).findOne({ id: invite.flowId }, { projection: { _id: 0, id: 1, ownerId: 1 } })
  if (!flow || flow.ownerId === userId) {
    await members(db).deleteOne({ id: invite.id })
    throw httpError(flow ? 400 : 404, flow ? 'This brand is already yours.' : 'This brand no longer exists.')
  }
  const now = new Date()
  await members(db).updateOne({ id: invite.id, status: 'invited' }, { $set: { userId, status: 'active', joinedAt: now, lastOpenedAt: now } })
  return { ...invite, userId, status: 'active', joinedAt: now }
}

export async function declineInvitation(db: any, account: { email: string }, memberId: unknown) {
  await members(db).deleteOne({ id: memberId, email: normalizeEmail(account.email), status: 'invited' })
}

export async function leaveBrand(db: any, userId: string, flowId: unknown) {
  const result = await members(db).deleteOne({ flowId, userId, status: 'active' })
  if (!result.deletedCount) throw httpError(404, 'You are not in this brand.')
}

// ─── Invitation emails ───────────────────────────────────────────────────────

export async function recordInvitationEmail(db: any, memberId: string, emailId: string) {
  if (emailId) await members(db).updateOne({ id: memberId }, { $set: { emailId, delivery: 'sent' } })
}

/**
 * Asks how a brand's invitation emails still on their way did (`check`, Resend in production), the newest few from
 * the last 3 days, and keeps the answer: 'delivered', or 'bounced' when the address does not exist.
 */
export async function refreshDeliveries(db: any, flowId: string, check: (emailId: string) => Promise<'sent' | 'delivered' | 'bounced' | null>, now = new Date(), limit = 3) {
  const since = now.getTime() - 3 * DAY
  const pending = (await members(db).find({ flowId, status: 'invited', delivery: 'sent' }, { projection: { _id: 0, id: 1, emailId: 1, invitedAt: 1 } }).toArray())
    .filter((m: any) => m.emailId && new Date(m.invitedAt).getTime() >= since)
    .sort((a: any, b: any) => +new Date(b.invitedAt) - +new Date(a.invitedAt))
    .slice(0, limit)
  for (const m of pending) {
    const delivery = await check(m.emailId)
    if (delivery === 'delivered' || delivery === 'bounced') await members(db).updateOne({ id: m.id, delivery: 'sent' }, { $set: { delivery } })
  }
}

// ─── What the team pages show ────────────────────────────────────────────────

/** A brand's people as its Team page shows them: the owner, then everyone in it or invited, oldest first. */
export async function brandTeam(db: any, flowId: string, userId: string, role: BrandRole) {
  const flow = await brandOf(db, flowId)
  const rows = await members(db).find({ flowId }, { projection: { _id: 0 } }).toArray()
  const ids = [...new Set([flow.ownerId, ...rows.map((m: any) => m.userId)].filter(Boolean))]
  const users = await db.collection('users').find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, name: 1, email: 1 } }).toArray()
  const byId = new Map(users.map((u: any) => [u.id, u]))
  const owner: any = byId.get(flow.ownerId)
  return {
    brand: brandCard(flow),
    role,
    canManage: roleAtLeast(role, 'admin'),
    max: TEAM_MAX_MEMBERS,
    owner: { name: owner?.name || '', email: owner?.email || '', you: flow.ownerId === userId },
    members: rows
      .sort((a: any, b: any) => +new Date(a.invitedAt) - +new Date(b.invitedAt))
      .map((m: any) => ({
        id: m.id, email: m.email, role: m.role, status: m.status, you: Boolean(userId) && m.userId === userId,
        name: m.userId ? displayName(byId.get(m.userId)) : '', delivery: m.status === 'invited' ? m.delivery || null : null,
        invitedAt: m.invitedAt ? new Date(m.invitedAt).toISOString() : null,
      })),
  }
}

/**
 * Every team the account is part of, for /app/teams: invitations waiting for its email, the brands shared with it
 * and its role in each, and its own brands with how many people each has.
 */
export async function teamsOverview(db: any, userId: string, email: string) {
  const address = normalizeEmail(email)
  const [invited, joined, owned] = await Promise.all([
    address ? members(db).find({ email: address, status: 'invited' }, { projection: { _id: 0 } }).toArray() : [],
    members(db).find({ userId, status: 'active' }, { projection: { _id: 0 } }).toArray(),
    flows(db).find({ ownerId: userId }, { projection: { ...BRAND_FIELDS, 'onboarding.step': 1, lastOpenedAt: 1, updatedAt: 1 } }).toArray(),
  ])
  const ownedIds = owned.filter((f: any) => !f.onboarding?.step).map((f: any) => f.id)
  const otherIds = [...new Set([...invited, ...joined].map((m: any) => m.flowId))]
  const [ownedRows, others] = await Promise.all([
    ownedIds.length ? members(db).find({ flowId: { $in: ownedIds } }, { projection: { _id: 0, flowId: 1, status: 1 } }).toArray() : [],
    otherIds.length ? flows(db).find({ id: { $in: otherIds } }, { projection: BRAND_FIELDS }).toArray() : [],
  ])
  const flowById = new Map(others.map((f: any) => [f.id, f]))
  const peopleIds = [...new Set([...invited.map((m: any) => m.invitedBy), ...others.map((f: any) => f.ownerId)].filter(Boolean))]
  const people = peopleIds.length ? await db.collection('users').find({ id: { $in: peopleIds } }, { projection: { _id: 0, id: 1, name: 1, email: 1 } }).toArray() : []
  const personById = new Map(people.map((u: any) => [u.id, u]))
  const ownerOf = (flowId: string) => displayName(personById.get((flowById.get(flowId) as any)?.ownerId))
  const time = (value: any) => (value ? new Date(value).getTime() || 0 : 0)
  return {
    invitations: invited
      .filter((m: any) => flowById.has(m.flowId) && (flowById.get(m.flowId) as any).ownerId !== userId)
      .sort((a: any, b: any) => time(b.invitedAt) - time(a.invitedAt))
      .map((m: any) => ({ id: m.id, role: m.role, brand: brandCard(flowById.get(m.flowId)), owner: ownerOf(m.flowId), invitedBy: displayName(personById.get(m.invitedBy)), invitedAt: m.invitedAt ? new Date(m.invitedAt).toISOString() : null })),
    shared: joined
      .filter((m: any) => flowById.has(m.flowId) && isRole(m.role))
      .sort((a: any, b: any) => time(b.lastOpenedAt || b.joinedAt) - time(a.lastOpenedAt || a.joinedAt))
      .map((m: any) => ({ flowId: m.flowId, role: m.role, brand: brandCard(flowById.get(m.flowId)), owner: ownerOf(m.flowId), joinedAt: m.joinedAt ? new Date(m.joinedAt).toISOString() : null })),
    owned: owned
      .filter((f: any) => ownedIds.includes(f.id))
      .sort((a: any, b: any) => time(b.lastOpenedAt || b.updatedAt) - time(a.lastOpenedAt || a.updatedAt))
      .map((f: any) => {
        const rows = ownedRows.filter((m: any) => m.flowId === f.id)
        return { flowId: f.id, brand: brandCard(f), people: rows.filter((m: any) => m.status === 'active').length, invited: rows.filter((m: any) => m.status === 'invited').length }
      }),
  }
}
