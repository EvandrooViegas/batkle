const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, fakeDb, NextResponse, notificationModules, billingRecord, HOUR } = require('./notificationTestHelpers.cjs')

const { account, reminders, handlers, outbox, services, reset } = notificationModules()

// Whole minutes near the real time: the billing code reads the clock itself when it counts a text.
const NOW = new Date(Math.floor(Date.now() / 60_000) * 60_000)
const MIN = 60_000
const at = minutes => new Date(NOW.getTime() + minutes * MIN)
const PHONE = { number: '+351912345678', verifiedAt: at(-1440), smsConsentAt: at(-1440), optedOutAt: null }

const user = (id, extra = {}) => ({ id, email: `${id}@example.com`, name: 'Ana', phone: PHONE, notifications: { email: true, sms: true, leadMinutes: 0 }, ...extra })
const post = (id, extra = {}) => ({
  id, ownerId: 'pro', flowId: 'brand', ideaId: `idea-${id}`, canvasId: `canvas-${id}`, status: 'scheduled', scheduledAt: at(-1), timeZone: 'Europe/Lisbon',
  topic: 'Three bread tips', caption: 'Fresh bread daily\n#bread', platforms: ['instagram', 'tiktok'], ...extra,
})
function world({ users = [user('pro')], billing = [billingRecord(account, 'pro', 'pro', { now: NOW })], posts = [post('p1')] } = {}) {
  return fakeDb({ users, billingAccounts: billing, flows: [{ id: 'brand', ownerId: 'pro', name: 'acme', brandContext: { name: 'Acme Bakery' } }], scheduledPosts: posts })
}
const run = (db, options = {}) => reminders.runReminders(db, { now: NOW, baseUrl: 'https://batkle.test/', ...options })
const saved = (db, id) => db.data.scheduledPosts.find(p => p.id === id)
const texts = (db, id) => db.data.billingAccounts.find(a => a.id === id).textsUsed

test('a due post is reminded once by email and once by text, even when two runs overlap', async () => {
  reset()
  const db = world()
  const [first, second] = await Promise.all([run(db), run(db)])
  assert.equal(first.reminded + second.reminded, 1)
  assert.equal(first.skipped + second.skipped, 1, 'the slower run finds the post already claimed')
  await run(db, { now: at(10) })
  assert.equal(outbox.emails.length, 1)
  assert.equal(outbox.texts.length, 1)
  assert.equal(texts(db, 'pro'), 1)

  const { reminder } = saved(db, 'p1')
  assert.deepEqual(reminder.channels, { email: 'sent', sms: 'sent' })
  assert.equal(reminder.done, true)
  assert.equal(reminder.attempts, 1)
  assert.ok(reminder.sentAt instanceof Date)
  assert.equal(reminder.at.getTime(), at(-1).getTime())

  const [mail] = outbox.emails
  assert.equal(mail.to, 'pro@example.com')
  assert.equal(mail.subject, 'Time to post: Three bread tips')
  assert.equal(mail.idempotencyKey, `reminder-p1-${at(-1).toISOString()}`)
  assert.match(mail.html, /Time to post: Three bread tips/)
  assert.match(mail.html, /Acme Bakery/)
  assert.match(mail.html, /Fresh bread daily<br>#bread/)
  assert.match(mail.html, /href="https:\/\/batkle\.test\/app\/brand\/schedule\?post=p1"/)
  assert.match(mail.html, /https:\/\/batkle\.test\/app\/settings#notifications/)
  assert.match(mail.html, /Instagram \+ TikTok/)
  assert.match(mail.text, /Fresh bread daily\n#bread/)
  assert.match(mail.text, /Turn reminders off: https:\/\/batkle\.test\/app\/settings#notifications/)
  assert.deepEqual(outbox.texts[0], { to: '+351912345678', body: 'Batkle: time to post "Three bread tips" for Acme Bakery. https://batkle.test/app/brand/schedule?post=p1' })
})

test('a reminder comes when the post is due, or up to an hour before for people who chose that', async () => {
  reset()
  const db = world({ posts: [post('soon', { scheduledAt: at(30) }), post('later', { scheduledAt: at(90) })] })
  await run(db)
  assert.equal(outbox.emails.length, 0)
  assert.equal(saved(db, 'soon').reminder, undefined, 'a post further ahead is not claimed, so a later run reminds it')

  db.data.users[0].notifications.leadMinutes = 60
  await run(db)
  assert.deepEqual(outbox.emails.map(m => m.idempotencyKey), [`reminder-soon-${at(30).toISOString()}`])
  assert.match(outbox.emails[0].html, /is due at /)
  assert.equal(saved(db, 'later').reminder, undefined)
})

test('a post more than 6 hours late gets no reminder; one 5 hours late still does', async () => {
  reset()
  const db = world({ posts: [post('stale', { scheduledAt: at(-7 * 60) }), post('late', { scheduledAt: at(-5 * 60) })] })
  await run(db)
  assert.deepEqual(outbox.emails.map(m => m.idempotencyKey.split('-')[1]), ['late'])
  assert.equal(saved(db, 'stale').reminder, undefined)
})

test('each channel needs the plan, the setting and the service: Free gets none, and settings pick the channels', async () => {
  reset()
  const owners = ['free', 'noemail', 'nosms', 'unverified', 'noconsent']
  const db = world({
    users: [
      user('free'),
      user('noemail', { notifications: { email: false, sms: true, leadMinutes: 0 } }),
      user('nosms', { notifications: { email: true, sms: false, leadMinutes: 0 } }),
      user('unverified', { phone: { ...PHONE, verifiedAt: null } }),
      user('noconsent', { phone: { ...PHONE, smsConsentAt: null } }),
    ],
    // Free has no billing record: it opens on Free.
    billing: owners.slice(1).map(id => billingRecord(account, id, 'pro', { now: NOW })),
    posts: owners.map(id => post(id, { ownerId: id })),
  })
  await run(db)
  const channels = Object.fromEntries(owners.map(id => [id, saved(db, id).reminder.channels]))
  assert.deepEqual(channels, {
    free: { email: 'not_on_plan', sms: 'not_on_plan' },
    noemail: { email: 'off', sms: 'sent' },
    nosms: { email: 'sent', sms: 'off' },
    unverified: { email: 'sent', sms: 'off' },
    noconsent: { email: 'sent', sms: 'off' },
  })
  assert.deepEqual(outbox.emails.map(m => m.to).sort(), ['noconsent@example.com', 'nosms@example.com', 'unverified@example.com'])
  assert.equal(outbox.texts.length, 1, 'never a text to an unverified number or without consent')
  assert.ok(owners.every(id => saved(db, id).reminder.done))

  // Without email or SMS set up, nothing is sent and nothing breaks.
  reset()
  services.email = false
  services.sms = false
  const quiet = world()
  await run(quiet)
  assert.deepEqual(saved(quiet, 'p1').reminder.channels, { email: 'unavailable', sms: 'unavailable' })
  assert.equal(outbox.emailAttempts + outbox.smsAttempts, 0)
})

test("texts stop when the month's allowance is used, the trial's smaller one too", async () => {
  reset()
  const db = world({ billing: [billingRecord(account, 'pro', 'pro', { now: NOW, textsUsed: 30 })] })
  await run(db)
  assert.deepEqual(saved(db, 'p1').reminder.channels, { email: 'sent', sms: 'no_texts_left' })
  assert.equal(outbox.smsAttempts, 0)
  assert.equal(texts(db, 'pro'), 30)

  reset()
  const trial = world({ billing: [billingRecord(account, 'pro', 'pro', { now: NOW, status: 'trialing', textsUsed: 4 })], posts: [post('a', { scheduledAt: at(-3) }), post('b', { scheduledAt: at(-2) })] })
  await run(trial)
  assert.equal(outbox.texts.length, 1)
  assert.equal(saved(trial, 'a').reminder.channels.sms, 'sent')
  assert.equal(saved(trial, 'b').reminder.channels.sms, 'no_texts_left')
  assert.equal(texts(trial, 'pro'), 5)
})

test('a STOP reply (Twilio 21610) turns texts off and gives the text back', async () => {
  reset()
  services.smsError = Object.assign(new Error('Twilio: HTTP 400 (error 21610)'), { code: 21610, status: 502 })
  const db = world({ posts: [post('a', { scheduledAt: at(-3) }), post('b', { scheduledAt: at(-2) })] })
  await run(db)
  assert.equal(outbox.smsAttempts, 1, 'nothing more is texted to them in the same run')
  const [owner] = db.data.users
  assert.ok(owner.phone.optedOutAt instanceof Date)
  assert.equal(owner.notifications.sms, false)
  assert.equal(texts(db, 'pro'), 0)
  assert.equal(saved(db, 'a').reminder.channels.sms, 'opted_out')
  assert.notEqual(saved(db, 'b').reminder.channels.sms, 'sent')
  assert.equal(outbox.emails.length, 2, 'email reminders carry on')
  assert.equal(saved(db, 'a').reminder.done, true, 'a STOP is final, not retried')
})

test('a failed channel is tried again on later runs, at most 3 times, without resending what worked', async () => {
  reset()
  services.emailFailures = 1
  const db = world()
  await run(db)
  let { reminder } = saved(db, 'p1')
  assert.deepEqual([reminder.channels.email, reminder.channels.sms, reminder.done, reminder.attempts], ['failed', 'sent', false, 1])
  assert.equal(reminder.errors[0].channel, 'email')
  assert.doesNotMatch(JSON.stringify(reminder.errors), /@|\+351/, 'no addresses or numbers in the stored errors')

  await run(db, { now: at(1) })
  assert.equal(outbox.emailAttempts, 1, 'not straight away: another run may still be sending')
  await run(db, { now: at(5) })
  reminder = saved(db, 'p1').reminder
  assert.deepEqual([reminder.channels.email, reminder.done, reminder.attempts], ['sent', true, 2])
  assert.equal(outbox.texts.length, 1)
  assert.equal(texts(db, 'pro'), 1)

  reset()
  services.emailFailures = 10
  const failing = world()
  for (const minutes of [0, 5, 10, 15, 20]) await run(failing, { now: at(minutes) })
  reminder = saved(failing, 'p1').reminder
  assert.equal(outbox.emailAttempts, reminders.MAX_ATTEMPTS)
  assert.deepEqual([reminder.channels.email, reminder.done, reminder.attempts], ['failed', true, 3])
})

test('a text that fails gives its slot back', async () => {
  reset()
  services.smsError = Object.assign(new Error('Twilio: HTTP 500'), { status: 502 })
  const db = world()
  await run(db)
  assert.equal(saved(db, 'p1').reminder.channels.sms, 'failed')
  assert.equal(texts(db, 'pro'), 0)
})

test('a run handles at most `limit` posts and says there are more', async () => {
  reset()
  const db = world({ posts: [1, 2, 3].map(n => post(`p${n}`, { scheduledAt: at(-n) })) })
  const result = await run(db, { limit: 2 })
  assert.equal(result.reminded, 2)
  assert.equal(result.more, true)
  // The oldest go first.
  assert.deepEqual(outbox.emails.map(m => m.idempotencyKey.split('-')[1]).sort(), ['p2', 'p3'])
  await run(db, { limit: 2 })
  assert.equal(outbox.emails.length, 3)
})

test('rescheduling a reminded post clears its reminder, so the new time gets its own; a caption edit does not', async () => {
  reset()
  const db = world({ users: [user('pro', { notifications: { email: true, sms: false, leadMinutes: 60 } })] })
  await run(db)
  assert.equal(outbox.emails.length, 1)

  await handlers.handleUpdateScheduledPost(db, 'pro', 'p1', { caption: 'Fresh bread, every morning' })
  assert.ok(saved(db, 'p1').reminder, 'same time: the reminder stands')

  const later = new Date(Date.now() + 30 * MIN)
  const { body } = await handlers.handleUpdateScheduledPost(db, 'pro', 'p1', { status: 'scheduled', scheduledAt: later.toISOString(), platforms: ['instagram'] })
  assert.equal('reminder' in body, false, 'the API never sends reminder state')
  assert.equal(saved(db, 'p1').reminder, undefined)
  await run(db, { now: new Date() })
  assert.equal(outbox.emails.length, 2)
  assert.equal(outbox.emails[1].idempotencyKey, `reminder-p1-${later.toISOString()}`)

  // Marking it posted clears it too, and a posted post is never reminded.
  await handlers.handleUpdateScheduledPost(db, 'pro', 'p1', { status: 'posted' })
  assert.equal(saved(db, 'p1').reminder, undefined)
  await run(db, { now: new Date() })
  assert.equal(outbox.emails.length, 2)
})

test('the reminder text stays short and plain', () => {
  const body = reminders.reminderText({ entry: { topic: `The "best" ${'very '.repeat(30)}long topic` }, brand: 'Acme', link: 'https://batkle.test/x' })
  assert.match(body, /^Batkle: time to post "The 'best' very/)
  assert.ok(body.length < 140, body)
})

test('the reminders job needs Authorization: Bearer CRON_SECRET, and is off without a secret', async () => {
  const calls = [], released = []
  let releaseFails = false
  const route = env => load('app/api/cron/reminders/route.js', ['GET', 'POST'], {
    '@/lib/billing/account': { releaseStaleCharges: async db => { released.push(db); if (releaseFails) throw new Error('db down'); return { refunded: 1, settled: 0 } } },
    'next/server': { NextResponse },
    '@/lib/services/db/mongo': { connectToMongo: async () => 'db' },
    '@/lib/services/middleware': { getBaseUrl: () => 'https://batkle.test' },
    '@/lib/notifications/reminders': { cronAuthProblem: reminders.cronAuthProblem, runReminders: async (db, options) => { calls.push({ db, options }); return { reminded: 0, failed: 0 } } },
  }, env)
  const request = authorization => ({ headers: { get: name => (name.toLowerCase() === 'authorization' ? authorization : null) } })

  const off = route({})
  assert.equal((await off.GET(request('Bearer anything'))).status, 503)
  assert.equal((await route({ CRON_SECRET: '  ' }).GET(request('Bearer '))).status, 503)

  const on = route({ CRON_SECRET: 'cron-secret-123' })
  for (const header of [null, '', 'cron-secret-123', 'Basic cron-secret-123', 'Bearer wrong', 'Bearer cron-secret-1234']) {
    assert.equal((await on.GET(request(header))).status, 401, String(header))
  }
  assert.equal(calls.length, 0, 'never runs without the secret')

  const ok = await on.GET(request('Bearer cron-secret-123'))
  assert.equal(ok.status, 200)
  assert.equal((await on.POST(request('bearer   cron-secret-123'))).status, 200)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], { db: 'db', options: { baseUrl: 'https://batkle.test' } })
  assert.deepEqual(released, ['db', 'db'], 'each run also settles half-made posts')
  assert.deepEqual(ok.body.charges, { refunded: 1, settled: 0 })

  // Settling stale charges failing never fails the reminders.
  releaseFails = true
  const still = await on.GET(request('Bearer cron-secret-123'))
  assert.equal(still.status, 200)
  assert.equal(still.body.charges, null)
})
