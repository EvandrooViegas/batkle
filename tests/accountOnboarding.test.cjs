const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, fakeDb, NextResponse, notificationModules } = require('./notificationTestHelpers.cjs')

const sms = load('lib/notifications/sms.ts', ['CALLING_CODES', 'toE164'])
const { parseOnboarding, parseOnboardingDraft, parsePhoneAnswer, defaultPhoneCountry, NAME_MAX, PHONE_INPUT_MAX } = load('lib/onboardingOptions.js',
  ['parseOnboarding', 'parseOnboardingDraft', 'parsePhoneAnswer', 'defaultPhoneCountry', 'NAME_MAX', 'PHONE_INPUT_MAX'], { './notifications/sms': sms })

test('account onboarding asks for a name and an optional phone, and stores nothing else', () => {
  assert.deepEqual(parseOnboarding({ name: '  Ana   Silva ' }), { name: 'Ana Silva' })
  // An open tab from before the questions were removed may still send them; they are dropped.
  assert.deepEqual(parseOnboarding({ name: 'Ana', role: 'agency', brandCount: '2-5', postingFrequency: 'daily', referral: 'friend' }), { name: 'Ana' })
  assert.equal(parseOnboarding({ name: '   ' }).error, 'Tell us your name.')
  assert.equal(parseOnboarding({ name: '   ' }).field, 'name')
  assert.match(parseOnboarding({ name: 'a'.repeat(NAME_MAX + 1) }).error, /at most/)
})

test('the phone number is optional, checked, and saved in E.164', () => {
  assert.deepEqual(parseOnboarding({ name: 'Ana', phone: '', phoneCountry: 'PT' }), { name: 'Ana' })
  assert.deepEqual(parseOnboarding({ name: 'Ana', phone: '   ' }), { name: 'Ana' })
  assert.deepEqual(parseOnboarding({ name: 'Ana', phone: '912 345 678', phoneCountry: 'PT' }), { name: 'Ana', phone: '+351912345678' })
  assert.deepEqual(parseOnboarding({ name: 'Ana', phone: '+44 7700 900123', phoneCountry: 'PT' }), { name: 'Ana', phone: '+447700900123' })
  assert.deepEqual(parseOnboarding({ name: 'Ana', phone: '(415) 555-0132', phoneCountry: 'us' }), { name: 'Ana', phone: '+14155550132' })

  for (const [phone, phoneCountry] of [['12', 'PT'], ['call me', 'PT'], ['912 345 678', 'ZZ'], ['912 345 678', undefined], ['9'.repeat(PHONE_INPUT_MAX + 1), 'PT']]) {
    const answer = parseOnboarding({ name: 'Ana', phone, phoneCountry })
    assert.equal(answer.field, 'phone', `${phone} (${phoneCountry})`)
    assert.match(answer.error, /mobile number/)
  }
  assert.deepEqual(parsePhoneAnswer(undefined, 'PT'), { phone: null })
})

test('the country picker starts on the browser language region, else the United States', () => {
  assert.equal(defaultPhoneCountry(['pt-PT', 'en']), 'PT')
  assert.equal(defaultPhoneCountry(['en', 'en_GB']), 'GB')
  assert.equal(defaultPhoneCountry(['fr', 'xx-ZZ']), 'US')
  assert.equal(defaultPhoneCountry([]), 'US')
  assert.equal(defaultPhoneCountry(undefined), 'US')
})

test('an unfinished onboarding keeps the typed name and phone, nothing else', () => {
  assert.deepEqual(parseOnboardingDraft({ step: 'plans', answers: { name: 'Ana', role: 'agency' } }), { step: 'about', answers: { name: 'Ana' } })
  assert.deepEqual(parseOnboardingDraft({ answers: { name: 42 } }), { step: 'about', answers: { name: '' } })
  assert.equal(parseOnboardingDraft({ answers: { name: 'x'.repeat(200) } }).answers.name.length, NAME_MAX)
  assert.deepEqual(parseOnboardingDraft({ answers: { name: 'Ana', phone: '912 34', phoneCountry: 'pt' } }), { step: 'about', answers: { name: 'Ana', phone: '912 34', phoneCountry: 'PT' } })
  assert.deepEqual(parseOnboardingDraft({ answers: { name: 'Ana', phone: 7, phoneCountry: 'Narnia' } }), { step: 'about', answers: { name: 'Ana' } })
  assert.equal(parseOnboardingDraft({ answers: { phone: '1'.repeat(100) } }).answers.phone.length, PHONE_INPUT_MAX)
})

test('finishing onboarding saves the phone unverified, keeping a number already verified', async () => {
  const { settings } = notificationModules()
  const verified = { number: '+351912345678', verifiedAt: new Date(), smsConsentAt: new Date(), optedOutAt: null }
  const handlers = load('lib/handlers/accountHandlers.ts', ['handleCompleteOnboarding', 'handleSaveOnboardingDraft'], {
    'next/server': { NextResponse },
    '@clerk/nextjs/server': { clerkClient: async () => ({ users: { getUser: async () => ({ firstName: 'Ana', lastName: '' }), updateUser: async () => {} } }) },
    '@/lib/services/middleware': { corsify: response => response },
    '@/lib/auth': { loadAccount: async (db, id) => db.collection('users').findOne({ id }) },
    '@/lib/onboardingOptions': { parseOnboarding, parseOnboardingDraft },
    '@/lib/notifications/settings': settings,
  })

  const db = fakeDb({ users: [{ id: 'u1', email: 'ana@example.com' }, { id: 'u2', email: 'bo@example.com', phone: verified }] })
  const bad = await handlers.handleCompleteOnboarding(db, 'u1', { name: 'Ana', phone: 'nope', phoneCountry: 'PT' })
  assert.deepEqual([bad.status, bad.body.field], [400, 'phone'])
  assert.equal(db.data.users[0].onboardedAt, undefined)

  await handlers.handleCompleteOnboarding(db, 'u1', { name: 'Ana', phone: '912 345 678', phoneCountry: 'PT' })
  assert.deepEqual(db.data.users[0].phone, { number: '+351912345678', verifiedAt: null, smsConsentAt: null, optedOutAt: null })
  assert.ok(db.data.users[0].onboardedAt instanceof Date)

  await handlers.handleCompleteOnboarding(db, 'u2', { name: 'Bo', phone: '+351912345678' })
  assert.ok(db.data.users[1].phone.verifiedAt instanceof Date, 'the same number keeps its verification')

  const none = fakeDb({ users: [{ id: 'u3', email: 'cy@example.com' }] })
  await handlers.handleCompleteOnboarding(none, 'u3', { name: 'Cy' })
  assert.equal('phone' in none.data.users[0], false)
})
