import { teammateIds } from '@/lib/teams'

/**
 * The notification center: what happened on the account in the last 30 days, read from where it already lives (no
 * separate event log): posts and stories built, ads made, posts approved, scheduled, due and marked posted, brand
 * invitations and people joining brands, credits added, and designs published by teammates. `users.activitySeenAt` marks
 * what the person has seen; anything after it is unread.
 */
export const ACTIVITY_DAYS = 30
export const ACTIVITY_LIMIT = 80
// Before the first visit to the notification center, only the last few days count as unread.
const FIRST_UNREAD_DAYS = 3
const DAY = 86400_000

export type ActivityKind = 'post' | 'story' | 'ad' | 'approved' | 'scheduled' | 'due' | 'posted' | 'invite' | 'joined' | 'credits' | 'design'
export interface ActivityItem {
  id: string; kind: ActivityKind; title: string; detail: string; at: string; href: string
  brand?: string; when?: string; invitation?: string
}

const time = (value: any) => (value ? new Date(value).getTime() || 0 : 0)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
// Built posts are named "Brand — topic".
const topicOf = (name: unknown) => String(name || '').split(' — ').slice(1).join(' — ').trim() || String(name || 'Untitled').trim()
const ROLE_NAMES: Record<string, string> = { admin: 'an admin', editor: 'an editor', viewer: 'a viewer' }

export interface ActivityRows {
  canvases: any[]; ads: any[]; scheduled: any[]; invitations: any[]; joined: any[]; memberships: any[]; grants: any[]; designs: any[]
}
export interface ActivityContext {
  userId: string; now: Date
  brands: Map<string, string>      // flowId → brand name (its own, and those it was invited to or joined)
  people: Map<string, string>      // userId → name (or email)
  libraryHref: string              // where a published design opens
}

/** The activity items, newest first, from the rows `loadActivity` reads (pure, for tests). */
export function buildActivity(rows: ActivityRows, ctx: ActivityContext): ActivityItem[] {
  const now = ctx.now.getTime(), since = now - ACTIVITY_DAYS * DAY
  const items: ActivityItem[] = []
  const add = (item: Omit<ActivityItem, 'at'> & { at: any }) => {
    const at = time(item.at)
    if (at && at >= since && at <= now) items.push({ ...item, at: new Date(at).toISOString() })
  }
  const brand = (flowId: any) => ctx.brands.get(flowId) || undefined

  for (const c of rows.canvases) {
    const story = c.story || (c.width === 1080 && c.height === 1920)
    add({ id: `canvas:${c.id}`, kind: story ? 'story' : 'post', title: story ? 'Story ready' : 'Post ready', detail: topicOf(c.name), at: c.createdAt, href: `/editor/${c.id}`, brand: brand(c.flowId) })
  }
  for (const a of rows.ads) {
    const sizes = Array.isArray(a.canvases) ? a.canvases.length : 0
    add({ id: `ad:${a.id}`, kind: 'ad', title: 'Ad ready', detail: [a.brief?.offer, sizes && plural(sizes, 'size')].filter(Boolean).join(' · '), at: a.createdAt, href: `/app/${a.flowId}/ads`, brand: brand(a.flowId) })
  }
  for (const p of rows.scheduled) {
    const href = `/app/${p.flowId}/schedule`, detail = String(p.topic || 'A post'), base = { href, detail, brand: brand(p.flowId) }
    add({ ...base, id: `approved:${p.id}:${time(p.approvedAt)}`, kind: 'approved', title: 'Post approved', at: p.approvedAt })
    if (p.status === 'scheduled' && p.scheduledAt) {
      // When it was scheduled is the entry's last change; the time it goes out is `when`.
      if (time(p.updatedAt) > time(p.approvedAt)) add({ ...base, id: `scheduled:${p.id}:${time(p.scheduledAt)}`, kind: 'scheduled', title: 'Post scheduled', at: p.updatedAt, when: new Date(p.scheduledAt).toISOString() })
      add({ ...base, id: `due:${p.id}:${time(p.scheduledAt)}`, kind: 'due', title: 'Time to post', at: p.scheduledAt })
    }
    if (p.status === 'posted') add({ ...base, id: `posted:${p.id}:${time(p.postedAt)}`, kind: 'posted', title: 'Marked as posted', at: p.postedAt })
  }
  for (const inv of rows.invitations) {
    const by = ctx.people.get(inv.invitedBy) || 'Someone'
    add({ id: `invite:${inv.id}`, kind: 'invite', title: `${by} invited you to ${brand(inv.flowId) || 'a brand'}`, detail: `As ${ROLE_NAMES[inv.role] || 'a member'}. Accept to add it to your brand list.`, at: inv.invitedAt, href: '/app/teams', invitation: inv.id })
  }
  for (const m of rows.joined) add({ id: `joined:${m.id}`, kind: 'joined', title: `${ctx.people.get(m.userId) || m.email} joined ${brand(m.flowId) || 'your brand'}`, detail: `As ${ROLE_NAMES[m.role] || 'a member'}.`, at: m.joinedAt, href: `/app/${m.flowId}/team` })
  for (const m of rows.memberships) add({ id: `member:${m.id}`, kind: 'joined', title: `You joined ${brand(m.flowId) || 'a brand'}`, detail: 'It is in your brand list.', at: m.joinedAt, href: `/app/${m.flowId}/creation` })
  for (const g of rows.grants) add({ id: `credits:${g.ref || time(g.createdAt)}`, kind: 'credits', title: `${plural(Number(g.credits) || 0, 'credit')} added`, detail: String(g.note || ''), at: g.createdAt, href: '/app/settings#credits' })
  for (const d of rows.designs) {
    const mine = d.ownerId === ctx.userId
    const name = d.draft?.name || d.name || 'A design'
    add({ id: `design:${d.id || d._id}:${time(d.updatedAt)}`, kind: 'design', title: mine ? 'Your design is published' : `${d.author?.name || ctx.people.get(d.ownerId) || 'A teammate'} published a design`, detail: `${name}${d.visibility === 'public' ? ' · public' : ' · for your team'}`, at: d.updatedAt, href: ctx.libraryHref })
  }
  return items.sort((a, b) => time(b.at) - time(a.at)).slice(0, ACTIVITY_LIMIT)
}

/** How many items are newer than what the person has seen (the last few days before a first visit). */
export function unreadCount(items: ActivityItem[], seenAt: any, now = new Date()) {
  const seen = time(seenAt) || now.getTime() - FIRST_UNREAD_DAYS * DAY
  return items.filter(i => time(i.at) > seen).length
}

/** Reads the account's activity: only the fields the feed shows, from the last 30 days. */
export async function loadActivity(db: any, userId: string, now = new Date()) {
  const since = new Date(now.getTime() - ACTIVITY_DAYS * DAY)
  const pick = (fields: string[]) => ({ projection: Object.fromEntries([['_id', 0], ...fields.map(f => [f, 1])]) })
  const user = await db.collection('users').findOne({ id: userId }, pick(['email', 'activitySeenAt']))
  const email = String(user?.email || '').trim().toLowerCase()
  const [flows, canvases, ads, scheduled, invitations, joined, memberships, grants, mates] = await Promise.all([
    db.collection('flows').find({ ownerId: userId }, pick(['id', 'name', 'brandContext.name', 'lastOpenedAt'])).toArray(),
    db.collection('canvases').find({ ownerId: userId, createdAt: { $gte: since }, ad: { $exists: false }, globalDesignEditor: { $exists: false } }, pick(['id', 'name', 'flowId', 'createdAt', 'story', 'width', 'height'])).sort({ createdAt: -1 }).limit(ACTIVITY_LIMIT).toArray(),
    db.collection('ads').find({ ownerId: userId, createdAt: { $gte: since } }, pick(['id', 'flowId', 'brief.offer', 'canvases', 'createdAt'])).sort({ createdAt: -1 }).limit(40).toArray(),
    db.collection('scheduledPosts').find({ ownerId: userId, $or: [{ approvedAt: { $gte: since } }, { updatedAt: { $gte: since } }, { postedAt: { $gte: since } }] }, pick(['id', 'flowId', 'topic', 'status', 'approvedAt', 'scheduledAt', 'postedAt', 'updatedAt'])).limit(100).toArray(),
    email ? db.collection('brandMembers').find({ email, status: 'invited' }, pick(['id', 'flowId', 'role', 'invitedBy', 'invitedAt'])).toArray() : [],
    db.collection('brandMembers').find({ ownerId: userId, status: 'active', joinedAt: { $gte: since } }, pick(['id', 'flowId', 'userId', 'email', 'role', 'joinedAt'])).toArray(),
    db.collection('brandMembers').find({ userId, status: 'active', joinedAt: { $gte: since } }, pick(['id', 'flowId', 'joinedAt'])).toArray(),
    db.collection('creditGrants').find({ ownerId: userId, createdAt: { $gte: since } }, pick(['ref', 'credits', 'note', 'createdAt'])).sort({ createdAt: -1 }).limit(30).toArray(),
    teammateIds(db, userId),
  ])
  // The names of brands shared with the account, or that it was invited to.
  const otherIds = [...new Set([...invitations, ...memberships].map((m: any) => m.flowId))].filter(id => !flows.some((f: any) => f.id === id))
  const others = otherIds.length ? await db.collection('flows').find({ id: { $in: otherIds } }, pick(['id', 'name', 'brandContext.name'])).toArray() : []
  const designs = await db.collection('globalDesignFamilies').find({ ownerId: { $in: mates }, status: 'published', deletedAt: { $exists: false }, updatedAt: { $gte: since } }, pick(['id', 'ownerId', 'author', 'draft.name', 'visibility', 'updatedAt'])).limit(30).toArray()
  const peopleIds = [...new Set([...invitations.map((i: any) => i.invitedBy), ...joined.map((m: any) => m.userId), ...designs.map((d: any) => d.ownerId)].filter(Boolean))]
  const people = peopleIds.length ? await db.collection('users').find({ id: { $in: peopleIds } }, pick(['id', 'name', 'email'])).toArray() : []
  const recent = [...flows].sort((a: any, b: any) => time(b.lastOpenedAt) - time(a.lastOpenedAt))[0]

  const items = buildActivity({ canvases, ads, scheduled, invitations, joined, memberships, grants, designs }, {
    userId, now,
    brands: new Map([...flows, ...others].map((f: any) => [f.id, f.brandContext?.name || f.name || 'Brand'])),
    people: new Map(people.map((p: any) => [p.id, p.name || p.email])),
    libraryHref: recent ? `/app/${recent.id}/design-library` : '/app',
  })
  return { items, unread: unreadCount(items, user?.activitySeenAt, now), seenAt: user?.activitySeenAt ? new Date(user.activitySeenAt).toISOString() : null }
}

/** Everything up to now has been seen. */
export async function markActivitySeen(db: any, userId: string, now = new Date()) {
  await db.collection('users').updateOne({ id: userId }, { $set: { activitySeenAt: now } })
  return { seenAt: now.toISOString() }
}
