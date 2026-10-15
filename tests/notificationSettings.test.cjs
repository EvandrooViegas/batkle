const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, fakeDb, NextResponse, notificationModules, billingRecord } = require('./notificationTestHelpers.cjs')

const { account, settings, outbox, services, reset } = notificationModules()

const NOW = new Date()
const VERIFIED = { number: '+351912345678', verifiedAt: NOW, smsConsentAt: NOW, optedOutAt: null }
function world({ plan = 'pro', status, user = {} } = {}) {
  return fakeDb({
    users: [{ id: 'u1', email: 'ana@example.com', name: 'Ana', ...user }],
    billingAccounts: plan === 'free' ? [] : [billingRecord(account, 'u1', plan, { now: NOW, ...(status ? { status } : {}) })],
  })
}
const me = db => db.data.users[0]

test('settings default to email on, texts off, reminders when the post is due', () => {
  assert.deepEqual(settings.readNotifications({}), { email: true, sms: false, leadMinutes: 0 })
  assert.deepEqual(settings.readNotifications({ notifications: { email: false, sms: true, leadMinutes: 60 } }), { email: false, sms: true, leadMinutes: 60 })
  assert.deepEqual(settings.readNotifications({ notifications: { email: 'yes', sms: 'yes', leadMinutes: 30 } }), { email: true, sms: false, leadMinutes: 0 })
  assert.equal(settings.phoneReady({ phone: VERIFIED }), true)
  for (const phone of [null, { ...VERIFIED, verifiedAt: null }, { ...VERIFIED, smsConsentAt: null }, { ...VERIFIED, optedOutAt: NOW }, { ...VERIFIED, number: '912345678' }]) {
    assert.equal(settings.phoneReady({ phone }), false, JSON.stringify(phone))
  }
})

test('the settings view masks the phone and says what the plan includes, with the upgrade message where it does not', async () => {
  reset()
  const pro = await settings.notificationsView(world({ user: { phone: VERIFIED } }), 'u1')
  assert.deepEqual(pro.phone, { masked: '+•••••••••678', verified: true, consented: true, optedOut: false })
  assert.deepEqual(pro.email, { address: 'ana@example.com', configured: true, included: true })
  assert.deepEqual([pro.texts.configured, pro.texts.included, pro.texts.left, pro.texts.allowance], [true, true, 30, 30])
  assert.deepEqual(pro.upgrade, { scheduling: null, emailReminders: null, textReminders: null })
  assert.doesNotMatch(JSON.stringify(pro), /912345678/, 'the full number never leaves the server')

  const free = await settings.notificationsView(world({ plan: 'free' }), 'u1')
  assert.equal(free.phone, null)
  assert.equal(free.email.included, false)
  for (const feature of ['scheduling', 'emailReminders', 'textReminders']) {
    assert.equal(free.upgrade[feature].code, 'upgrade_required')
    assert.equal(free.upgrade[feature].feature, feature)
  }
  assert.match(free.upgrade.scheduling.error, /^Scheduling posts is part of Pro and Business/)

  const trial = await settings.notificationsView(world({ status: 'trialing' }), 'u1')
  assert.equal(trial.texts.allowance, 5)

  services.sms = false
  assert.equal((await settings.notificationsView(world(), 'u1')).texts.configured, false)
})

test('turning texts on needs the plan, texts set up, and a verified number the person agreed to', async () => {
  reset()
  await assert.rejects(settings.updateNotifications(world({ plan: 'free', user: { phone: VERIFIED } }), 'u1', { sms: true }), { status: 402, code: 'upgrade_required' })
  await assert.rejects(settings.updateNotifications(world(), 'u1', { sms: true }), { status: 400, message: /verify your phone number/ })
  await assert.rejects(settings.updateNotifications(world({ user: { phone: { ...VERIFIED, verifiedAt: null } } }), 'u1', { sms: true }), { status: 400 })
  await assert.rejects(settings.updateNotifications(world({ user: { phone: { ...VERIFIED, smsConsentAt: null } } }), 'u1', { sms: true }), { status: 400 })
  services.sms = false
  await assert.rejects(settings.updateNotifications(world({ user: { phone: VERIFIED } }), 'u1', { sms: true }), { status: 503 })
  services.sms = true

  const db = world({ user: { phone: { ...VERIFIED, optedOutAt: NOW } } })
  const view = await settings.updateNotifications(db, 'u1', { sms: true, leadMinutes: 60, email: false })
  assert.deepEqual(view.settings, { email: false, sms: true, leadMinutes: 60 })
  assert.equal(me(db).phone.optedOutAt, null, 'turning texts back on after STOP is asking for them again')

  // Turning things off never needs the plan.
  const free = world({ plan: 'free' })
  assert.deepEqual((await settings.updateNotifications(free, 'u1', { sms: false, email: false })).settings, { email: false, sms: false, leadMinutes: 0 })
})

test('settings changes are checked', async () => {
  reset()
  const db = world()
  await assert.rejects(settings.updateNotifications(db, 'u1', { leadMinutes: 30 }), { status: 400 })
  await assert.rejects(settings.updateNotifications(db, 'u1', { email: 'yes' }), { status: 400 })
  await assert.rejects(settings.updateNotifications(db, 'u1', { sms: 1 }), { status: 400 })
  await assert.rejects(settings.updateNotifications(db, 'u1', {}), { status: 400 })
  await assert.rejects(settings.updateNotifications(db, 'u1', null), { status: 400 })
})

test('verifying a number: a code, then the right code with consent saves it verified', async () => {
  reset()
  const db = world()
  await assert.rejects(settings.startPhoneVerification(db, 'u1', { phone: '912 345 678' }), { status: 400 })
  assert.deepEqual(await settings.startPhoneVerification(db, 'u1', { phone: '+351 912 345 678' }), { sent: true, phone: '+•••••••••678' })
  assert.deepEqual(outbox.codes, ['+351912345678'])

  await assert.rejects(settings.checkPhoneVerification(db, 'u1', { phone: '+351912345678', code: '123456' }), { status: 400, message: /Tick the box/ })
  await assert.rejects(settings.checkPhoneVerification(db, 'u1', { phone: '+351912345678', code: 'abc', consent: true }), { status: 400 })
  await assert.rejects(settings.checkPhoneVerification(db, 'u1', { phone: '+351912345678', code: '000000', consent: true }), { status: 400, message: /isn’t right/ })
  assert.equal(me(db).phone, undefined)

  const view = await settings.checkPhoneVerification(db, 'u1', { phone: '+351912345678', code: '123 456', consent: true })
  assert.deepEqual(view.phone, { masked: '+•••••••••678', verified: true, consented: true, optedOut: false })
  const { phone } = me(db)
  assert.equal(phone.number, '+351912345678')
  assert.ok(phone.verifiedAt instanceof Date && phone.smsConsentAt instanceof Date)
  assert.equal(phone.consentText, settings.CONSENT_TEXT)
  assert.match(settings.CONSENT_TEXT, /Message and data rates may apply\. Reply STOP to stop\./)

  // The texts can be turned on now; removing the number turns them off again.
  assert.equal((await settings.updateNotifications(db, 'u1', { sms: true })).settings.sms, true)
  const removed = await settings.removePhone(db, 'u1')
  assert.equal(removed.phone, null)
  assert.equal(removed.settings.sms, false)
  assert.equal(me(db).phone, undefined)
})

test('a number saved in onboarding can be verified without typing it again', async () => {
  reset()
  const db = world({ user: { phone: { number: '+447700900123', verifiedAt: null, smsConsentAt: null, optedOutAt: null } } })
  await settings.startPhoneVerification(db, 'u1', {})
  assert.deepEqual(outbox.codes, ['+447700900123'])
  await settings.checkPhoneVerification(db, 'u1', { code: '123456', consent: true })
  assert.deepEqual(outbox.checks, [{ to: '+447700900123', code: '123456' }])
  assert.ok(me(db).phone.verifiedAt)
  await assert.rejects(settings.startPhoneVerification(world(), 'u1', {}), { status: 400 })
})

test('codes are limited to about five an hour per account, and need the plan and the service', async () => {
  reset()
  const db = world()
  for (let i = 0; i < settings.PHONE_CODES_PER_HOUR; i++) await settings.startPhoneVerification(db, 'u1', { phone: '+351912345678' })
  await assert.rejects(settings.startPhoneVerification(db, 'u1', { phone: '+351912345678' }), { status: 429, expose: true })
  assert.equal(outbox.codes.length, settings.PHONE_CODES_PER_HOUR)
  // The next hour is a new window.
  assert.equal(await settings.takeRateSlot(db, 'phone-code:u1', 5, 3600_000, new Date(NOW.getTime() + 3600_000)), true)

  await assert.rejects(settings.startPhoneVerification(world({ plan: 'free' }), 'u1', { phone: '+351912345678' }), { status: 402, code: 'upgrade_required' })
  services.verify = false
  await assert.rejects(settings.startPhoneVerification(world(), 'u1', { phone: '+351912345678' }), { status: 503 })
  await assert.rejects(settings.checkPhoneVerification(world(), 'u1', { phone: '+351912345678', code: '123456', consent: true }), { status: 503 })
})

test('the notifications API keeps billing codes and shows messages written for people as they are', async () => {
  reset()
  const db = world({ plan: 'free' })
  const route = load('app/api/notifications/[[...path]]/route.js', ['GET', 'PUT', 'POST', 'DELETE'], {
    'next/server': { NextResponse },
    '@/lib/services/db/mongo': { connectToMongo: async () => db },
    '@/lib/auth': { requireUserId: async () => 'u1', loadAccount: async () => me(db) },
    '@/lib/billing/account': account,
    '@/lib/services/publicError': { publicMessage: () => 'PLAIN' },
    '@/lib/notifications/settings': settings,
  })
  const request = (method, body) => ({ method, json: async () => body })
  const params = path => ({ params: { path } })

  const view = await route.GET(request('GET'), params([]))
  assert.equal(view.status, 200)
  assert.equal(view.body.upgrade.textReminders.code, 'upgrade_required')

  const gated = await route.PUT(request('PUT', { sms: true }), params([]))
  assert.equal(gated.status, 402)
  assert.equal(gated.body.code, 'upgrade_required')
  assert.match(gated.body.error, /^Text reminders are part of Pro/)

  const bad = await route.PUT(request('PUT', { leadMinutes: 5 }), params([]))
  assert.deepEqual([bad.status, bad.body.error], [400, 'Choose when reminders arrive: when the post is due, or an hour before.'])

  assert.equal((await route.POST(request('POST', {}), params(['phone', 'start']))).status, 402)
  assert.equal((await route.DELETE(request('DELETE'), params(['phone']))).status, 200)
  assert.equal((await route.GET(request('GET'), params(['nothing']))).status, 404)
})
