const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')

const load = file => stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))

const schedule = new Function(load('lib/client/schedule.js') +
  ';return { PLATFORM_IDS, CAPTION_MAX, HASHTAG_MAX, startingCaption, hashtagCount, scheduleState, toScheduledAt, toInputs, suggestedTime, scheduleProblem, platformNames, groupSchedule }')()

let nextId = 0
// Plans by account: scheduling (giving a post a time) is part of Pro and Business only.
const FREE_USERS = new Set(['user_free'])
const featureChecks = []
async function requireFeature(db, userId, feature) {
  featureChecks.push(feature)
  if (FREE_USERS.has(userId)) throw Object.assign(new Error('Scheduling posts is part of Pro and Business. Upgrade to use it.'), { status: 402, code: 'upgrade_required', billing: true, details: { feature, requiredPlan: 'pro' } })
}
const handlers = new Function('NextResponse', 'randomUUID', 'CAPTION_MAX', 'PLATFORM_IDS', 'scheduleProblem', 'requireFeature',
  load('lib/handlers/scheduleHandlers.ts') + ';return { handleApprovePost, handleUpdateScheduledPost, handleDeleteScheduledPost, handleListSchedule }')(
  { json: (body, init) => ({ body, status: init?.status || 200 }) }, () => `entry-${++nextId}`, schedule.CAPTION_MAX, schedule.PLATFORM_IDS, schedule.scheduleProblem, requireFeature)

/** An in-memory stand-in for the few MongoDB calls the handlers make (equality queries only). */
function fakeDb(seed = {}) {
  const data = { flows: [], canvases: [], scheduledPosts: [], ...seed }
  const matches = (doc, query) => Object.entries(query).every(([key, value]) => doc[key] === value)
  const collection = name => ({
    createIndex: async () => {},
    findOne: async query => data[name].find(doc => matches(doc, query)) || null,
    insertOne: async doc => { data[name].push({ ...doc }) },
    updateOne: async (query, update) => {
      const doc = data[name].find(d => matches(d, query))
      if (doc) Object.assign(doc, update.$set)
      if (doc) for (const key of Object.keys(update.$unset || {})) delete doc[key]
      return { matchedCount: doc ? 1 : 0 }
    },
    deleteOne: async query => {
      const index = data[name].findIndex(d => matches(d, query))
      if (index >= 0) data[name].splice(index, 1)
      return { deletedCount: index >= 0 ? 1 : 0 }
    },
    find: query => {
      const list = data[name].filter(d => matches(d, query))
      const chain = { sort: () => chain, limit: () => chain, toArray: async () => list }
      return chain
    },
  })
  return { data, collection }
}

const HOUR = 3600000
const future = new Date(Date.now() + 48 * HOUR).toISOString()

test('a newly approved post starts with its caption and hashtags', () => {
  assert.equal(schedule.startingCaption({ caption: 'Three ways to save on energy.', hashtags: ['energy', '#homes'] }), 'Three ways to save on energy.\n\n#energy #homes')
  assert.equal(schedule.startingCaption({ hashtags: [] }), '')
  assert.equal(schedule.startingCaption({ caption: 'x'.repeat(5000) }).length, schedule.CAPTION_MAX)
})

test('schedule state follows approval, rebuilds, time and posting', () => {
  const now = Date.parse('2026-10-14T12:00:00Z')
  const entry = { canvasId: 'c1', status: 'approved' }
  assert.equal(schedule.scheduleState(null, 'c1', now), 'unapproved')
  assert.equal(schedule.scheduleState(entry, 'c1', now), 'approved')
  assert.equal(schedule.scheduleState(entry, 'c2', now), 'changed')
  assert.equal(schedule.scheduleState(entry, null, now), 'approved')
  assert.equal(schedule.scheduleState({ ...entry, status: 'scheduled', scheduledAt: '2026-10-15T09:00:00Z' }, 'c1', now), 'scheduled')
  assert.equal(schedule.scheduleState({ ...entry, status: 'scheduled', scheduledAt: '2026-10-14T11:59:00Z' }, 'c1', now), 'due')
  assert.equal(schedule.scheduleState({ ...entry, status: 'posted' }, 'c1', now), 'posted')
})

test('local date and time inputs round-trip through the saved instant', () => {
  const iso = schedule.toScheduledAt('2026-10-20', '18:30')
  assert.deepEqual(schedule.toInputs(iso), { date: '2026-10-20', time: '18:30' })
  assert.equal(schedule.toScheduledAt('2026-10-20', ''), null)
  assert.equal(schedule.toScheduledAt('20/10/2026', '18:30'), null)
  assert.deepEqual(schedule.toInputs(null), { date: '', time: '' })
  const suggested = new Date(schedule.suggestedTime(new Date(2026, 9, 14, 15, 7)))
  assert.deepEqual([suggested.getDate(), suggested.getHours(), suggested.getMinutes()], [15, 10, 0])
})

test('a schedule needs a platform, a future time, and a caption Instagram accepts', () => {
  const now = Date.parse('2026-10-14T12:00:00Z')
  const ok = { platforms: ['instagram'], scheduledAt: '2026-10-15T09:00:00Z', caption: 'Hi #one' }
  assert.equal(schedule.scheduleProblem(ok, now), null)
  assert.match(schedule.scheduleProblem({ ...ok, platforms: [] }, now), /Instagram, TikTok or both/)
  assert.match(schedule.scheduleProblem({ ...ok, scheduledAt: null }, now), /date and time/)
  assert.match(schedule.scheduleProblem({ ...ok, scheduledAt: '2026-10-14T11:00:00Z' }, now), /future/)
  assert.match(schedule.scheduleProblem({ ...ok, caption: 'x'.repeat(2201) }, now), /2,200/)
  const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ')
  assert.match(schedule.scheduleProblem({ ...ok, caption: tags }, now), /30 hashtags/)
  // TikTok alone has no 30-hashtag rule.
  assert.equal(schedule.scheduleProblem({ ...ok, platforms: ['tiktok'], caption: tags }, now), null)
  assert.equal(schedule.platformNames(['tiktok', 'instagram']), 'Instagram + TikTok')
})

test('the schedule page groups due, waiting, upcoming and posted posts in a useful order', () => {
  const now = Date.parse('2026-10-14T12:00:00Z')
  const groups = schedule.groupSchedule([
    { id: 'later', status: 'scheduled', scheduledAt: '2026-10-20T09:00:00Z' },
    { id: 'soon', status: 'scheduled', scheduledAt: '2026-10-15T09:00:00Z' },
    { id: 'late', status: 'scheduled', scheduledAt: '2026-10-14T08:00:00Z' },
    { id: 'old-approval', status: 'approved', approvedAt: '2026-10-01T00:00:00Z' },
    { id: 'new-approval', status: 'approved', approvedAt: '2026-10-13T00:00:00Z' },
    { id: 'posted', status: 'posted', postedAt: '2026-10-10T00:00:00Z' },
  ], now)
  assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.map(e => e.id)])), {
    due: ['late'], approved: ['new-approval', 'old-approval'], upcoming: ['soon', 'later'], posted: ['posted'],
  })
})

test('only the owner can approve a post, and approving creates one entry per idea', async () => {
  const db = fakeDb({
    flows: [{ id: 'brand', ownerId: 'user_1' }],
    canvases: [{ id: 'c1', ownerId: 'user_1', type: 'carousel', pages: [{}, {}, {}] }, { id: 'theirs', ownerId: 'user_2', type: 'single' }],
  })
  const body = { flowId: 'brand', ideaId: 'idea', canvasId: 'c1', topic: ' Energy tips ', caption: 'Save energy' }
  await assert.rejects(handlers.handleApprovePost(db, 'user_2', body), { status: 404 })
  await assert.rejects(handlers.handleApprovePost(db, 'user_1', { ...body, canvasId: 'theirs' }), { status: 404 })
  await assert.rejects(handlers.handleApprovePost(db, 'user_1', { flowId: 'brand' }), { status: 400 })

  const { body: entry } = await handlers.handleApprovePost(db, 'user_1', body)
  assert.equal(entry.status, 'approved')
  assert.deepEqual([entry.topic, entry.format, entry.slides, entry.caption, entry.platforms, entry.scheduledAt], ['Energy tips', 'carousel', 3, 'Save energy', [], null])
  assert.equal('ownerId' in entry, false)

  await handlers.handleApprovePost(db, 'user_1', body)
  assert.equal(db.data.scheduledPosts.length, 1)
})

test('a rebuilt post keeps its schedule when approved again; a posted one starts over', async () => {
  const db = fakeDb({
    flows: [{ id: 'brand', ownerId: 'user_1' }],
    canvases: ['c1', 'c2', 'c3'].map(id => ({ id, ownerId: 'user_1', type: 'single' })),
  })
  const approve = canvasId => handlers.handleApprovePost(db, 'user_1', { flowId: 'brand', ideaId: 'idea', canvasId })
  const { body: entry } = await approve('c1')
  await handlers.handleUpdateScheduledPost(db, 'user_1', entry.id, { platforms: ['tiktok'], scheduledAt: future, status: 'scheduled' })
  const { body: rebuilt } = await approve('c2')
  assert.deepEqual([rebuilt.canvasId, rebuilt.status, rebuilt.platforms], ['c2', 'scheduled', ['tiktok']])

  await handlers.handleUpdateScheduledPost(db, 'user_1', entry.id, { status: 'posted' })
  const { body: again } = await approve('c3')
  assert.deepEqual([again.status, again.scheduledAt, again.postedAt], ['approved', null, null])
})

test('scheduling checks platforms and time; going back to approved clears the time', async () => {
  const db = fakeDb({ scheduledPosts: [{ id: 'e1', ownerId: 'user_1', status: 'approved', platforms: [], scheduledAt: null, caption: 'Hi' }] })
  const update = (changes, owner = 'user_1') => handlers.handleUpdateScheduledPost(db, owner, 'e1', changes)

  await assert.rejects(update({ status: 'scheduled', scheduledAt: future }), { status: 400, message: /Instagram, TikTok or both/ })
  await assert.rejects(update({ status: 'scheduled', platforms: ['instagram'], scheduledAt: new Date(Date.now() - HOUR).toISOString() }), { status: 400, message: /future/ })
  await assert.rejects(update({ platforms: ['facebook'] }), { status: 400 })
  await assert.rejects(update({ scheduledAt: 'not a date' }), { status: 400 })
  await assert.rejects(update({ status: 'scheduled' }, 'user_2'), { status: 404 })

  const { body: scheduled } = await update({ status: 'scheduled', platforms: ['tiktok', 'instagram'], scheduledAt: future, timeZone: 'Europe/Lisbon' })
  assert.deepEqual([scheduled.status, scheduled.platforms, scheduled.timeZone], ['scheduled', ['instagram', 'tiktok'], 'Europe/Lisbon'])
  assert.equal(new Date(scheduled.scheduledAt).toISOString(), future)

  const { body: posted } = await update({ status: 'posted' })
  assert.ok(posted.postedAt instanceof Date)
  const { body: back } = await update({ status: 'approved' })
  assert.deepEqual([back.status, back.scheduledAt, back.postedAt], ['approved', null, null])

  await assert.rejects(handlers.handleDeleteScheduledPost(db, 'user_2', 'e1'), { status: 404 })
  await handlers.handleDeleteScheduledPost(db, 'user_1', 'e1')
  assert.equal(db.data.scheduledPosts.length, 0)
})

test('Free can approve, mark posted and unschedule, but giving a post a time needs a paid plan (402)', async () => {
  const db = fakeDb({
    flows: [{ id: 'brand', ownerId: 'user_free' }, { id: 'pro-brand', ownerId: 'user_pro' }],
    canvases: [{ id: 'c1', ownerId: 'user_free', type: 'single' }, { id: 'c2', ownerId: 'user_pro', type: 'single' }],
  })
  const { body: entry } = await handlers.handleApprovePost(db, 'user_free', { flowId: 'brand', ideaId: 'idea', canvasId: 'c1' })
  assert.equal(entry.status, 'approved')

  featureChecks.length = 0
  await assert.rejects(handlers.handleUpdateScheduledPost(db, 'user_free', entry.id, { status: 'scheduled', platforms: ['instagram'], scheduledAt: future }), error => {
    assert.equal(error.status, 402)
    assert.equal(error.code, 'upgrade_required')
    assert.match(error.message, /Pro and Business/)
    return true
  })
  await assert.rejects(handlers.handleUpdateScheduledPost(db, 'user_free', entry.id, { scheduledAt: future }), { status: 402 })
  assert.deepEqual(featureChecks, ['scheduling', 'scheduling'])
  assert.equal(db.data.scheduledPosts[0].status, 'approved', 'nothing was saved')

  // Captions, posting by hand and going back are on every plan.
  assert.equal((await handlers.handleUpdateScheduledPost(db, 'user_free', entry.id, { caption: 'New caption' })).body.caption, 'New caption')
  assert.equal((await handlers.handleUpdateScheduledPost(db, 'user_free', entry.id, { status: 'posted' })).body.status, 'posted')
  assert.equal((await handlers.handleUpdateScheduledPost(db, 'user_free', entry.id, { status: 'approved' })).body.status, 'approved')
  assert.equal((await handlers.handleUpdateScheduledPost(db, 'user_free', entry.id, { scheduledAt: null })).body.scheduledAt, null)

  const { body: proEntry } = await handlers.handleApprovePost(db, 'user_pro', { flowId: 'pro-brand', ideaId: 'idea', canvasId: 'c2' })
  const { body: scheduled } = await handlers.handleUpdateScheduledPost(db, 'user_pro', proEntry.id, { status: 'scheduled', platforms: ['instagram'], scheduledAt: future })
  assert.equal(scheduled.status, 'scheduled')
})

test('a new time or status clears the reminder sent for the old one; other edits keep it', async () => {
  const reminder = { at: new Date(future), done: true, channels: { email: 'sent' } }
  const db = fakeDb({ scheduledPosts: [{ id: 'e1', ownerId: 'user_1', status: 'scheduled', platforms: ['instagram'], scheduledAt: new Date(future), caption: 'Hi', reminder }] })
  const update = changes => handlers.handleUpdateScheduledPost(db, 'user_1', 'e1', changes)

  const { body } = await update({ caption: 'Hello', status: 'scheduled', scheduledAt: future, platforms: ['instagram'] })
  assert.ok(db.data.scheduledPosts[0].reminder, 'the same time keeps its reminder')
  assert.equal('reminder' in body, false, 'reminder state stays on the server')

  const later = new Date(Date.parse(future) + HOUR).toISOString()
  await update({ scheduledAt: later })
  assert.equal(db.data.scheduledPosts[0].reminder, undefined)

  db.data.scheduledPosts[0].reminder = reminder
  await update({ status: 'posted' })
  assert.equal(db.data.scheduledPosts[0].reminder, undefined)
})

test('approving a new version of a posted post starts over without the old reminder', async () => {
  const db = fakeDb({
    flows: [{ id: 'brand', ownerId: 'user_1' }],
    canvases: ['c1', 'c2'].map(id => ({ id, ownerId: 'user_1', type: 'single' })),
    scheduledPosts: [{ id: 'e1', ownerId: 'user_1', flowId: 'brand', ideaId: 'idea', canvasId: 'c1', status: 'posted', scheduledAt: new Date(), reminder: { at: new Date(), done: true } }],
  })
  const { body } = await handlers.handleApprovePost(db, 'user_1', { flowId: 'brand', ideaId: 'idea', canvasId: 'c2' })
  assert.equal(body.status, 'approved')
  assert.equal(db.data.scheduledPosts[0].reminder, undefined)
})
