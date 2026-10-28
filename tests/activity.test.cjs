const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')

const load = file => stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))
const activity = new Function('teammateIds', load('lib/notifications/activity.ts') + ';return { buildActivity, unreadCount, loadActivity, markActivitySeen, ACTIVITY_DAYS }')(async (_db, id) => [id, 'user-ana'])

const now = new Date('2026-10-21T12:00:00Z')
const ago = hours => new Date(now.getTime() - hours * 3600_000)
const ctx = {
  userId: 'user-me', now,
  brands: new Map([['flow-1', 'KACHICA'], ['flow-ana', 'Prumo']]),
  people: new Map([['user-ana', 'Ana Silva'], ['user-bo', 'Bo']]),
  libraryHref: '/app/flow-1/design-library',
}
const empty = { canvases: [], ads: [], scheduled: [], invitations: [], joined: [], memberships: [], grants: [], designs: [] }

test('posts, stories and ads made, newest first, with the brand and where each opens', () => {
  const items = activity.buildActivity({
    ...empty,
    canvases: [
      { id: 'c1', name: 'KACHICA — Agenda online para barbearias', flowId: 'flow-1', createdAt: ago(5), width: 1080, height: 1350 },
      { id: 'c2', name: 'KACHICA — Marcações sem chamadas', flowId: 'flow-1', createdAt: ago(1), width: 1080, height: 1920, story: true },
    ],
    ads: [{ id: 'ad1', flowId: 'flow-1', brief: { offer: 'Website Creation' }, canvases: [{}, {}, {}], createdAt: ago(3) }],
  }, ctx)
  assert.deepEqual(items.map(i => i.kind), ['story', 'ad', 'post'])
  assert.deepEqual(items[0], { id: 'canvas:c2', kind: 'story', title: 'Story ready', detail: 'Marcações sem chamadas', at: ago(1).toISOString(), href: '/editor/c2', brand: 'KACHICA' })
  assert.equal(items[1].detail, 'Website Creation · 3 sizes')
  assert.equal(items[1].href, '/app/flow-1/ads')
})

test('the schedule: approved, scheduled (with when it goes out), due and posted', () => {
  const items = activity.buildActivity({
    ...empty,
    scheduled: [
      { id: 's1', flowId: 'flow-1', topic: 'Barber PH', status: 'scheduled', approvedAt: ago(30), updatedAt: ago(20), scheduledAt: ago(2) },
      { id: 's2', flowId: 'flow-1', topic: 'Sites rápidos', status: 'scheduled', approvedAt: ago(10), updatedAt: ago(9), scheduledAt: new Date(now.getTime() + 86400_000) },
      { id: 's3', flowId: 'flow-1', topic: 'Antes e depois', status: 'posted', approvedAt: ago(50), updatedAt: ago(4), postedAt: ago(4) },
    ],
  }, ctx)
  const kinds = items.map(i => `${i.kind}:${i.detail}`)
  assert.ok(kinds.includes('due:Barber PH'), 'a post whose time has come is due')
  assert.ok(!kinds.includes('due:Sites rápidos'), 'a post later on is not due yet')
  const scheduled = items.find(i => i.kind === 'scheduled' && i.detail === 'Sites rápidos')
  assert.equal(scheduled.when, new Date(now.getTime() + 86400_000).toISOString())
  assert.ok(kinds.includes('posted:Antes e depois') && kinds.includes('approved:Antes e depois'))
  assert.ok(items.every(i => i.href === '/app/flow-1/schedule'))
})

test('brand teams: invitations to answer, people joining your brands, brands joined; credits and team designs', () => {
  const items = activity.buildActivity({
    ...empty,
    invitations: [{ id: 'm1', flowId: 'flow-ana', role: 'editor', invitedBy: 'user-ana', invitedAt: ago(2) }],
    joined: [{ id: 'm2', flowId: 'flow-1', userId: 'user-bo', email: 'bo@x.pt', role: 'viewer', joinedAt: ago(6) }],
    memberships: [{ id: 'm3', flowId: 'flow-ana', joinedAt: ago(8) }],
    grants: [{ ref: 'ad-sizes-ad1', credits: 1, note: 'Ad sizes that could not be made', createdAt: ago(7) }],
    designs: [{ id: 'd1', ownerId: 'user-ana', author: { name: 'Ana Silva' }, draft: { name: 'Serif Escape' }, visibility: 'private', updatedAt: ago(9) }],
  }, ctx)
  const invite = items.find(i => i.kind === 'invite')
  assert.equal(invite.title, 'Ana Silva invited you to Prumo')
  assert.equal(invite.detail, 'As an editor. Accept to add it to your brand list.')
  assert.equal(invite.invitation, 'm1')
  assert.equal(invite.href, '/app/teams')
  const joined = items.find(i => i.title === 'Bo joined KACHICA')
  assert.equal(joined.href, '/app/flow-1/team')
  assert.equal(items.find(i => i.title === 'You joined Prumo').href, '/app/flow-ana/creation')
  assert.ok(items.some(i => i.title === '1 credit added' && i.detail === 'Ad sizes that could not be made'))
  const design = items.find(i => i.kind === 'design')
  assert.equal(design.title, 'Ana Silva published a design')
  assert.equal(design.detail, 'Serif Escape · for your team')
  assert.equal(design.href, '/app/flow-1/design-library')
})

test('only the last 30 days, never the future; unread is what came after the last visit', () => {
  const items = activity.buildActivity({
    ...empty,
    canvases: [
      { id: 'old', name: 'Old', createdAt: ago(24 * 31) },
      { id: 'new', name: 'New', createdAt: ago(1) },
      { id: 'mid', name: 'Mid', createdAt: ago(24 * 5) },
    ],
  }, ctx)
  assert.deepEqual(items.map(i => i.id), ['canvas:new', 'canvas:mid'])
  assert.equal(activity.unreadCount(items, ago(2), now), 1)
  assert.equal(activity.unreadCount(items, null, now), 1, 'before a first visit, only the last 3 days')
  assert.equal(activity.unreadCount(items, now, now), 0)
})

test('reading it asks the database for the account’s own rows only, and marking it seen stores the time', async () => {
  const asked = []
  const rows = {
    users: [{ id: 'user-me', email: 'me@x.pt', activitySeenAt: ago(2) }, { id: 'user-ana', name: 'Ana Silva' }],
    flows: [{ id: 'flow-1', brandContext: { name: 'KACHICA' }, lastOpenedAt: ago(1) }],
    canvases: [{ id: 'c1', name: 'KACHICA — Agenda', flowId: 'flow-1', createdAt: ago(1) }],
    ads: [], scheduledPosts: [], brandMembers: [{ id: 'm1', flowId: 'flow-ana', role: 'viewer', invitedBy: 'user-ana', invitedAt: ago(3) }],
    creditGrants: [], globalDesignFamilies: [],
  }
  let updated = null
  const cursor = list => ({ sort: () => cursor(list), limit: () => cursor(list), toArray: async () => list })
  const db = { collection: name => ({
    find: query => {
      asked.push([name, query])
      if (name === 'brandMembers') return cursor(query.email ? rows.brandMembers : [])
      if (name === 'users') return cursor(rows.users.filter(u => query.id?.$in?.includes(u.id)))
      // The brands the account was invited to are read by their IDs, for their names.
      if (name === 'flows' && query.id) return cursor([{ id: 'flow-ana', brandContext: { name: 'Prumo' } }])
      return cursor(rows[name])
    },
    findOne: async query => { asked.push([name, query]); return name === 'users' ? rows.users[0] : null },
    updateOne: async (query, update) => { updated = [name, query, update] },
  }) }
  const result = await activity.loadActivity(db, 'user-me', now)
  assert.deepEqual(result.items.map(i => i.kind), ['post', 'invite'])
  assert.equal(result.items[1].title, 'Ana Silva invited you to Prumo')
  assert.equal(result.unread, 1)
  for (const [name, query] of asked.filter(([n, q]) => ['canvases', 'ads', 'scheduledPosts', 'creditGrants', 'flows'].includes(n) && !q.id)) assert.equal(query.ownerId, 'user-me', `${name} is read for the account only`)
  assert.deepEqual(asked.find(([n, q]) => n === 'flows' && q.id)[1], { id: { $in: ['flow-ana'] } })
  assert.deepEqual(asked.find(([n, q]) => n === 'brandMembers' && q.email)[1], { email: 'me@x.pt', status: 'invited' })
  await activity.markActivitySeen(db, 'user-me', now)
  assert.deepEqual(updated, ['users', { id: 'user-me' }, { $set: { activitySeenAt: now } }])
})
