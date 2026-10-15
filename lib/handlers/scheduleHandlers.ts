import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { CAPTION_MAX, PLATFORM_IDS, scheduleProblem } from '@/lib/client/schedule'
import { requireFeature } from '@/lib/billing/account'

/**
 * Approved posts and their schedule, in `scheduledPosts`: one entry per idea, pointing at the build that was
 * approved (`canvasId`). An entry is `approved` until it has platforms and a time (`scheduled`), and `posted` once
 * the user marks it so. Batkle doesn't publish by itself: a post whose time has come shows as due, with its slides
 * and caption ready to post, and a reminder goes out (lib/notifications/reminders.ts, state kept in `reminder`).
 *
 * Every plan can approve posts, download them, copy captions and mark them posted; giving a post a time
 * (scheduling) is part of the paid plans.
 */

const STATUSES = ['approved', 'scheduled', 'posted']
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })
const posts = (db: any) => db.collection('scheduledPosts')
const clean = ({ _id, ownerId, reminder, ...entry }: any) => entry
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

let indexes: Promise<unknown> | null = null
function ensureIndexes(db: any) {
  indexes ||= Promise.all([
    posts(db).createIndex({ ownerId: 1, flowId: 1, ideaId: 1 }, { unique: true }),
    posts(db).createIndex({ ownerId: 1, scheduledAt: 1 }),
  ]).catch(error => { indexes = null; console.warn('[schedule] could not create indexes:', error?.message) })
  return indexes
}

/** The account's approved and scheduled posts, for one brand or all of them. */
export async function handleListSchedule(db: any, ownerId: string, flowId: string | null) {
  const list = await posts(db).find({ ownerId, ...(flowId ? { flowId } : {}) }).sort({ scheduledAt: 1, approvedAt: -1 }).limit(500).toArray()
  return NextResponse.json(list.map(clean))
}

/**
 * Approves an idea's current build. Approving again after a rebuild points the entry at the new version and keeps
 * its schedule; a post already marked posted starts over as a new approval.
 */
export async function handleApprovePost(db: any, ownerId: string, body: any) {
  const { flowId, ideaId, canvasId } = body || {}
  if (![flowId, ideaId, canvasId].every(v => typeof v === 'string' && v && v.length <= 100)) throw httpError(400, 'Choose a post to approve.')
  const [flow, canvas] = await Promise.all([
    db.collection('flows').findOne({ id: flowId, ownerId }, { projection: { _id: 1 } }),
    db.collection('canvases').findOne({ id: canvasId, ownerId }, { projection: { _id: 0, type: 1, pages: 1 } }),
  ])
  if (!flow || !canvas) throw httpError(404, 'Post not found')
  await ensureIndexes(db)

  const now = new Date()
  const carousel = canvas.type === 'carousel'
  const version = { canvasId, topic: text(body.topic, 300), format: carousel ? 'carousel' : 'single', slides: carousel ? canvas.pages?.length || 1 : 1, approvedAt: now, updatedAt: now }
  const existing = await posts(db).findOne({ ownerId, flowId, ideaId })
  if (existing) {
    const restart = existing.status === 'posted' && existing.canvasId !== canvasId ? { status: 'approved', scheduledAt: null, postedAt: null } : {}
    await posts(db).updateOne({ id: existing.id, ownerId }, { $set: { ...version, ...restart }, ...('status' in restart ? { $unset: { reminder: '' } } : {}) })
    return NextResponse.json(clean({ ...existing, ...version, ...restart }))
  }
  const entry = {
    id: randomUUID(), ownerId, flowId, ideaId, ...version,
    status: 'approved', platforms: [], scheduledAt: null, timeZone: null, postedAt: null,
    caption: text(body.caption, CAPTION_MAX), createdAt: now,
  }
  try {
    await posts(db).insertOne(entry)
  } catch (error: any) {
    // Approved twice at once: the other request made the entry.
    if (error?.code !== 11000) throw error
    return NextResponse.json(clean(await posts(db).findOne({ ownerId, flowId, ideaId })))
  }
  return NextResponse.json(clean(entry))
}

/**
 * Changes an entry: platforms, time (`scheduledAt`, ISO), time zone, caption and status. Scheduling needs the plan's
 * scheduling (402 upgrade_required otherwise), at least one platform and a time in the future; going back to
 * `approved` clears the time. A new time or status clears the reminder sent for the old one.
 */
export async function handleUpdateScheduledPost(db: any, ownerId: string, id: string, body: any) {
  const entry = await posts(db).findOne({ id, ownerId })
  if (!entry) throw httpError(404, 'Post not found')
  const next: any = {}
  if ('platforms' in body) {
    if (!Array.isArray(body.platforms) || body.platforms.some((p: unknown) => !PLATFORM_IDS.includes(p as string))) throw httpError(400, 'Choose Instagram, TikTok or both.')
    next.platforms = PLATFORM_IDS.filter(p => body.platforms.includes(p))
  }
  if ('caption' in body) {
    if (typeof body.caption !== 'string') throw httpError(400, 'The caption must be text.')
    if (body.caption.length > CAPTION_MAX) throw httpError(400, `Keep the caption under ${CAPTION_MAX.toLocaleString('en-US')} characters.`)
    next.caption = body.caption
  }
  if ('timeZone' in body) next.timeZone = typeof body.timeZone === 'string' ? body.timeZone.slice(0, 64) : null
  if ('scheduledAt' in body) {
    const at = body.scheduledAt === null ? null : new Date(body.scheduledAt)
    if (at && Number.isNaN(at.getTime())) throw httpError(400, 'Choose a valid date and time.')
    next.scheduledAt = at
  }
  if ('status' in body) {
    if (!STATUSES.includes(body.status)) throw httpError(400, 'Unknown status.')
    next.status = body.status
  }

  // Giving a post a time is the paid part; approving, downloading and marking posted are on every plan.
  if (next.status === 'scheduled' || next.scheduledAt) await requireFeature(db, ownerId, 'scheduling')

  const merged = { ...entry, ...next }
  const reschedules = next.status === 'scheduled' || (merged.status === 'scheduled' && ('scheduledAt' in next || 'platforms' in next))
  if (reschedules) {
    const problem = scheduleProblem({ platforms: merged.platforms, scheduledAt: merged.scheduledAt, caption: merged.caption })
    if (problem) throw httpError(400, problem)
  }
  if (next.status === 'approved') next.scheduledAt = null
  if (next.status) next.postedAt = next.status === 'posted' ? new Date() : null
  next.updatedAt = new Date()
  const time = (value: unknown) => (value ? new Date(value as any).getTime() : null)
  const moved = ('scheduledAt' in next && time(next.scheduledAt) !== time(entry.scheduledAt)) || ('status' in next && next.status !== entry.status)
  await posts(db).updateOne({ id, ownerId }, { $set: next, ...(moved ? { $unset: { reminder: '' } } : {}) })
  return NextResponse.json(clean({ ...entry, ...next }))
}

/** Takes a post off the schedule and out of the approved list; the post itself stays in Creation. */
export async function handleDeleteScheduledPost(db: any, ownerId: string, id: string) {
  const result = await posts(db).deleteOne({ id, ownerId })
  if (!result.deletedCount) throw httpError(404, 'Post not found')
  return NextResponse.json({ success: true })
}
