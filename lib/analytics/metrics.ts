import { PLANS, TRIAL, planById } from '@/lib/billing/plans'
import { adminEmails } from '@/lib/billing/account'
import { campaignKey, channelOf } from './attribution'

/**
 * The admin dashboard's numbers, for one period (the last `days` days) and the one before it, for comparison.
 * Admin accounts are left out of every number, so testing Batkle does not count as use of it.
 *
 * `summarizeMetrics` is pure (rows in, numbers out); `loadMetrics` reads the rows.
 */

const DAY = 24 * 60 * 60 * 1000
const PAID = ['active', 'trialing', 'past_due']
const time = (value: any) => (value ? new Date(value).getTime() : NaN)
const within = (value: any, from: number, to: number) => { const t = time(value); return t >= from && t < to }
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10)
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0)
const money = (value: number) => Math.round(value * 100) / 100

export interface MetricRows {
  users: any[]; billing: any[]; canvases: any[]; ads: any[]; charges: any[]; visits: any[]
  designs: any[]; teams: any[]; members: any[]; aiImages: any[]; flows: any[]
}

/** What one subscription brings in each month: a yearly price counts as a twelfth. Trials bring nothing yet. */
export function monthlyRevenue(account: any): number {
  if (!account || !['active', 'past_due'].includes(account.status) || account.plan === 'free') return 0
  const plan = planById(account.plan)
  return account.interval === 'year' ? plan.price.year / 12 : plan.price.month
}

/** The account's campaign: the last visit that came from somewhere, else the first. */
export const touchOf = (user: any) => user?.attribution?.last || user?.attribution?.first || null

export function summarizeMetrics(rows: MetricRows, { days = 30, now = new Date(), admins = [] as string[] } = {}) {
  const end = now.getTime(), start = end - days * DAY, prevStart = start - days * DAY
  const adminIds = new Set(rows.users.filter(u => admins.includes(String(u.email || '').toLowerCase())).map(u => u.id))
  const people = rows.users.filter(u => !adminIds.has(u.id))
  const billing = new Map(rows.billing.filter(b => !adminIds.has(b.id)).map(b => [b.id, b]))
  const owned = (row: any) => row.ownerId && !adminIds.has(row.ownerId)
  const brandOwner = new Map(rows.flows.map((f: any) => [`brand_${f.id}`, f.ownerId]))

  // ── Customers and revenue (now) ─────────────────────────────────────────────
  const accounts = [...billing.values()]
  const paying = accounts.filter(b => ['active', 'past_due'].includes(b.status) && b.plan !== 'free')
  const trialing = accounts.filter(b => b.status === 'trialing')
  const mrr = paying.reduce((sum, b) => sum + monthlyRevenue(b), 0)
  const plans = Object.fromEntries(Object.keys(PLANS).map(id => [id, 0])) as Record<string, number>
  for (const user of people) {
    const b = billing.get(user.id)
    plans[b && PAID.includes(b.status) ? planById(b.plan).id : 'free']++
  }
  const canceled = accounts.filter(b => b.status === 'canceled' && within(b.updatedAt, start, end)).length
  // A trial's start is TRIAL.days before its end.
  const trialStart = (b: any) => time(b.trialEnd) - TRIAL.days * DAY
  const trialsStarted = (from: number, to: number) => accounts.filter(b => b.trialUsed && trialStart(b) >= from && trialStart(b) < to).length

  // ── Acquisition ─────────────────────────────────────────────────────────────
  const signups = (from: number, to: number) => people.filter(u => within(u.createdAt, from, to))
  const current = signups(start, end), previous = signups(prevStart, start)
  const visitsNow = rows.visits.filter(v => within(v.at, start, end))
  const visitsBefore = rows.visits.filter(v => within(v.at, prevStart, start))
  const converted = (users: any[]) => users.filter(u => { const b = billing.get(u.id); return b && ['active', 'past_due'].includes(b.status) && b.plan !== 'free' })

  // ── Use ─────────────────────────────────────────────────────────────────────
  const posts = rows.canvases.filter(c => owned(c) && !c.ad && !c.globalDesignEditor)
  const postsNow = posts.filter(c => within(c.createdAt, start, end))
  const active = (from: number) => new Set(posts.filter(c => within(c.createdAt, from, end)).map(c => c.ownerId)).size
  const credits = (from: number, to: number) => rows.charges.filter(c => owned(c) && c.status !== 'refunded' && within(c.createdAt, from, to)).reduce((sum, c) => sum + (c.credits || 0), 0)
  const aiImages = rows.aiImages.filter(a => !adminIds.has(brandOwner.get(a.brand_id)) && within(a.created_at, start, end)).length

  // ── Per day ─────────────────────────────────────────────────────────────────
  const series: { date: string; signups: number; visits: number; posts: number }[] = []
  // Every UTC day the period touches, oldest first.
  for (let t = Math.floor(start / DAY) * DAY; t <= end; t += DAY) series.push({ date: dayKey(t), signups: 0, visits: 0, posts: 0 })
  const bump = (value: any, field: 'signups' | 'visits' | 'posts') => { const row = series.find(r => r.date === dayKey(time(value))); if (row) row[field]++ }
  current.forEach(u => bump(u.createdAt, 'signups'))
  visitsNow.forEach(v => bump(v.at, 'visits'))
  postsNow.forEach(c => bump(c.createdAt, 'posts'))

  // ── Campaigns and channels: visits, and the accounts that signed up in the period ──
  const campaigns = new Map<string, any>(), channels = new Map<string, any>()
  const row = (map: Map<string, any>, key: string, base: any) => { if (!map.has(key)) map.set(key, { ...base, visits: 0, visitors: new Set(), signups: 0, onboarded: 0, trials: 0, paying: 0, mrr: 0 }); return map.get(key) }
  for (const visit of visitsNow) {
    const key = campaignKey({ ...visit, channel: visit.channel || channelOf(visit) })
    for (const [map, id, base] of [[campaigns, `${key.source}|${key.medium}|${key.campaign}`, key], [channels, key.channel, { channel: key.channel }]] as const) {
      const r = row(map, id, base); r.visits++; r.visitors.add(visit.visitorId)
    }
  }
  for (const user of current) {
    const key = campaignKey(touchOf(user))
    const b = billing.get(user.id)
    for (const [map, id, base] of [[campaigns, `${key.source}|${key.medium}|${key.campaign}`, key], [channels, key.channel, { channel: key.channel }]] as const) {
      const r = row(map, id, base)
      r.signups++
      if (user.onboardedAt) r.onboarded++
      if (b?.trialUsed) r.trials++
      if (b && ['active', 'past_due'].includes(b.status) && b.plan !== 'free') { r.paying++; r.mrr += monthlyRevenue(b) }
    }
  }
  const finish = (r: any) => ({ ...r, visitors: r.visitors.size, mrr: money(r.mrr), signupRate: pct(r.signups, r.visitors.size), paidRate: pct(r.paying, r.signups) })
  const order = (a: any, b: any) => b.signups - a.signups || b.visits - a.visits

  // ── Designs and teams ───────────────────────────────────────────────────────
  const memberDesigns = rows.designs.filter(d => d.ownerId && !d.deletedAt && !adminIds.has(d.ownerId))

  const postsByOwner = new Map<string, number>()
  for (const c of posts) postsByOwner.set(c.ownerId, (postsByOwner.get(c.ownerId) || 0) + 1)
  const recent = [...people].sort((a, b) => time(b.createdAt) - time(a.createdAt)).slice(0, 25).map(u => {
    const b = billing.get(u.id), touch = touchOf(u)
    return {
      id: u.id, name: u.name || '', email: u.email || '', createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null, onboarded: Boolean(u.onboardedAt),
      plan: b && PAID.includes(b.status) ? planById(b.plan).id : 'free', status: b?.status || 'none',
      channel: touch ? touch.channel || channelOf(touch) : 'Unknown', source: touch?.source || '', campaign: touch?.campaign || '', posts: postsByOwner.get(u.id) || 0,
    }
  })

  return {
    period: { days, from: new Date(start).toISOString(), to: new Date(end).toISOString() },
    revenue: { mrr: money(mrr), arr: money(mrr * 12), paying: paying.length, trialing: trialing.length, trialPipeline: money(trialing.reduce((s, b) => s + planById(b.plan).price.month, 0)), canceled },
    plans,
    acquisition: {
      visits: visitsNow.length, visitsBefore: visitsBefore.length,
      visitors: new Set(visitsNow.map(v => v.visitorId)).size,
      signups: current.length, signupsBefore: previous.length,
      onboarded: current.filter(u => u.onboardedAt).length,
      trials: trialsStarted(start, end), trialsBefore: trialsStarted(prevStart, start),
      converted: converted(current).length,
      paidRate: pct(converted(current).length, current.length),
    },
    usage: {
      accounts: people.length, posts: postsNow.length, postsBefore: posts.filter(c => within(c.createdAt, prevStart, start)).length,
      ads: rows.ads.filter(a => owned(a) && within(a.createdAt, start, end)).length,
      activeWeek: active(end - 7 * DAY), activePeriod: active(start),
      credits: credits(start, end), creditsBefore: credits(prevStart, start), aiImages,
    },
    designs: {
      memberPublic: memberDesigns.filter(d => d.status === 'published' && d.visibility === 'public').length,
      memberPrivate: memberDesigns.filter(d => d.status === 'published' && d.visibility !== 'public').length,
      memberDrafts: memberDesigns.filter(d => d.status !== 'published').length,
      batkle: rows.designs.filter(d => !d.ownerId && !d.deletedAt && d.status === 'published').length,
      teams: rows.teams.filter(t => !adminIds.has(t.ownerId)).length,
      teamMembers: rows.members.filter(m => m.status === 'active').length,
    },
    series,
    campaigns: [...campaigns.values()].map(finish).sort(order).slice(0, 50),
    channels: [...channels.values()].map(finish).sort(order),
    recent,
  }
}

export type Metrics = ReturnType<typeof summarizeMetrics>

/** Reads what the dashboard needs: only the fields it uses, the period before for comparison included. */
export async function loadMetrics(db: any, { days = 30, now = new Date() } = {}) {
  const since = new Date(now.getTime() - 2 * days * DAY)
  const read = (name: string, query: any, fields: string[]) => db.collection(name).find(query, { projection: Object.fromEntries([['_id', 0], ...fields.map(f => [f, 1])]) }).limit(200_000).toArray()
  const [users, billing, canvases, ads, charges, visits, designs, teams, members, aiImages, flows] = await Promise.all([
    read('users', {}, ['id', 'email', 'name', 'createdAt', 'onboardedAt', 'attribution']),
    read('billingAccounts', {}, ['id', 'plan', 'status', 'interval', 'trialUsed', 'trialEnd', 'updatedAt']),
    read('canvases', { createdAt: { $gte: since } }, ['ownerId', 'createdAt', 'ad', 'globalDesignEditor']),
    read('ads', { createdAt: { $gte: since } }, ['ownerId', 'createdAt']),
    read('creditCharges', { createdAt: { $gte: since } }, ['ownerId', 'credits', 'status', 'createdAt']),
    read('visits', { at: { $gte: since } }, ['at', 'visitorId', 'channel', 'source', 'medium', 'campaign', 'referrer']),
    read('globalDesignFamilies', {}, ['ownerId', 'status', 'visibility', 'deletedAt']),
    read('teams', {}, ['ownerId']),
    read('teamMembers', {}, ['status']),
    read('assets', { source: 'ai_generated', created_at: { $gte: since } }, ['brand_id', 'created_at']),
    read('flows', {}, ['id', 'ownerId']),
  ])
  return summarizeMetrics({ users, billing, canvases, ads, charges, visits, designs, teams, members, aiImages, flows }, { days, now, admins: adminEmails() })
}
