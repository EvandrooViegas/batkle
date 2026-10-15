const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./notificationTestHelpers.cjs')

const sms = load('lib/notifications/sms.ts', ['CALLING_CODES', 'callingCode', 'toE164', 'maskPhone', 'smsConfigured', 'verifyConfigured', 'sendSms', 'startVerification', 'checkVerification', 'smsErrorMessage', 'OPTED_OUT'])

const ENV = { TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'tok_secret', TWILIO_MESSAGING_SERVICE_SID: 'MG456', TWILIO_VERIFY_SERVICE_SID: 'VA789' }
const BASIC = `Basic ${Buffer.from('AC123:tok_secret').toString('base64')}`

/** A fetch that records each call and answers with `status` and `body`. */
function fakeFetch(status = 200, body = {}) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init, form: Object.fromEntries(new URLSearchParams(init.body)) })
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }
  return { fetch, calls }
}

test('phone numbers become E.164: separators dropped, the country code added, the national 0 removed', () => {
  assert.equal(sms.toE164('+351 912 345 678'), '+351912345678')
  assert.equal(sms.toE164('912-345-678', 'PT'), '+351912345678')
  assert.equal(sms.toE164('(415) 555-0132', 'US'), '+14155550132')
  assert.equal(sms.toE164('07700 900123', 'GB'), '+447700900123')
  assert.equal(sms.toE164('06.12.34.56.78', '+33'), '+33612345678')
  assert.equal(sms.toE164('00351912345678'), '+351912345678')
  // A number with its own + code ignores the picker.
  assert.equal(sms.toE164('+44 7700 900123', 'PT'), '+447700900123')
  // Italy keeps the leading 0 of landlines after the country code.
  assert.equal(sms.toE164('06 1234 5678', 'IT'), '+390612345678')
  assert.equal(sms.callingCode('pt'), '351')
  assert.equal(sms.callingCode('+1'), '1')
  assert.ok(sms.CALLING_CODES.length > 40 && sms.CALLING_CODES.every(c => /^[A-Z]{2}$/.test(c.country) && /^[1-9]\d{0,3}$/.test(c.code)))
})

test('anything that is not a plausible E.164 number is refused', () => {
  for (const [input, country] of [
    ['912 345 678', undefined], // no country code
    ['912345678', 'ZZ'], // unknown country
    ['+12', undefined], // too short
    ['+1234567890123456', undefined], // 16 digits
    ['+0123456789', undefined], // no country starts with 0
    ['+351 912 ABC', undefined],
    ['912/345/678', 'PT'],
    ['', 'PT'],
    ['   ', 'PT'],
  ]) assert.equal(sms.toE164(input, country), null, `${input} (${country})`)
  assert.equal(sms.toE164(42, 'PT'), null)
  assert.equal(sms.toE164(null), null)
})

test('a masked number shows only its last 3 digits', () => {
  assert.equal(sms.maskPhone('+351912345678'), '+•••••••••678')
  assert.equal(sms.maskPhone('+14155550132'), '+••••••••132')
  assert.equal(sms.maskPhone(''), '')
  assert.equal(sms.maskPhone(undefined), '')
})

test('texts need the account keys and a Messaging Service or a number; verification needs a Verify service', () => {
  assert.equal(sms.smsConfigured({}), false)
  assert.equal(sms.smsConfigured({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't' }), false)
  assert.equal(sms.smsConfigured({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+15550001111' }), true)
  assert.equal(sms.smsConfigured({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: ' ', TWILIO_MESSAGING_SERVICE_SID: 'MG1' }), false)
  assert.equal(sms.smsConfigured(ENV), true)
  assert.equal(sms.verifyConfigured(ENV), true)
  assert.equal(sms.verifyConfigured({ ...ENV, TWILIO_VERIFY_SERVICE_SID: '' }), false)
})

test('a text goes to the Messages API with Basic auth and a form body, from the Messaging Service when there is one', async () => {
  const { fetch, calls } = fakeFetch(201, { sid: 'SM001', status: 'queued' })
  const sid = await sms.sendSms('+351912345678', 'Batkle: time to post', { env: ENV, fetch })
  assert.equal(sid, 'SM001')
  assert.equal(calls.length, 1)
  const [{ url, init, form }] = calls
  assert.equal(url, 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.Authorization, BASIC)
  assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded')
  assert.deepEqual(form, { To: '+351912345678', Body: 'Batkle: time to post', MessagingServiceSid: 'MG456' })

  const plain = fakeFetch(201, { sid: 'SM002' })
  await sms.sendSms('+351912345678', 'Hi', { env: { ...ENV, TWILIO_MESSAGING_SERVICE_SID: '', TWILIO_FROM_NUMBER: '+15550001111' }, fetch: plain.fetch })
  assert.deepEqual(plain.calls[0].form, { To: '+351912345678', Body: 'Hi', From: '+15550001111' })
})

test("Twilio's error code stays on the error (21610: they replied STOP), and the token never shows", async () => {
  const { fetch } = fakeFetch(400, { code: 21610, message: 'Attempt to send to unsubscribed recipient', status: 400 })
  await assert.rejects(sms.sendSms('+351912345678', 'Hi', { env: ENV, fetch }), error => {
    assert.equal(error.code, sms.OPTED_OUT)
    assert.equal(error.twilioStatus, 400)
    assert.doesNotMatch(error.message, /tok_secret/)
    return true
  })
  assert.match(sms.smsErrorMessage({ code: 21610 }).message, /STOP/)
})

test('nothing is sent without the keys, or to a number that is not E.164', async () => {
  const { fetch, calls } = fakeFetch()
  await assert.rejects(sms.sendSms('+351912345678', 'Hi', { env: {}, fetch }), { status: 503 })
  await assert.rejects(sms.sendSms('912345678', 'Hi', { env: ENV, fetch }), { status: 400 })
  await assert.rejects(sms.startVerification('+351912345678', { env: { ...ENV, TWILIO_VERIFY_SERVICE_SID: '' }, fetch }), { status: 503 })
  assert.equal(calls.length, 0)
})

test('verification codes go out and are checked through the Verify service', async () => {
  const start = fakeFetch(201, { status: 'pending' })
  assert.deepEqual(await sms.startVerification('+351912345678', { env: ENV, fetch: start.fetch }), { status: 'pending' })
  assert.equal(start.calls[0].url, 'https://verify.twilio.com/v2/Services/VA789/Verifications')
  assert.equal(start.calls[0].init.headers.Authorization, BASIC)
  assert.deepEqual(start.calls[0].form, { To: '+351912345678', Channel: 'sms' })

  const right = fakeFetch(200, { status: 'approved', valid: true })
  assert.deepEqual(await sms.checkVerification('+351912345678', '123456', { env: ENV, fetch: right.fetch }), { approved: true })
  assert.equal(right.calls[0].url, 'https://verify.twilio.com/v2/Services/VA789/VerificationCheck')
  assert.deepEqual(right.calls[0].form, { To: '+351912345678', Code: '123456' })

  const wrong = fakeFetch(200, { status: 'pending', valid: false })
  assert.deepEqual(await sms.checkVerification('+351912345678', '000000', { env: ENV, fetch: wrong.fetch }), { approved: false })

  const expired = fakeFetch(404, { code: 20404, message: 'The requested resource was not found' })
  await assert.rejects(sms.checkVerification('+351912345678', '123456', { env: ENV, fetch: expired.fetch }), { code: 20404 })
  assert.deepEqual(sms.smsErrorMessage({ code: 20404 }), { status: 400, message: 'That code has expired. Send a new one.' })
  assert.equal(sms.smsErrorMessage({ code: 60203 }).status, 429)
  assert.equal(sms.smsErrorMessage({ code: 99999 }), null)
  // The messages are for people: no provider names.
  for (const code of [60200, 21211, 21614, 21408, 60203, 60202, 20404, 21610]) assert.doesNotMatch(sms.smsErrorMessage({ code }).message, /twilio/i)
})
