const { test } = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('./billingAccount.test.cjs')

const USER = 'user_1'
const HOUR = 3600 * 1000
const account = db => db.table('billingAccounts').find(a => a.id === USER)
const charge = (db, id) => db.table('creditCharges').find(c => c.id === id)

test('a post left before its images gets its credits back after three hours, and only then', async () => {
  const { db, billing, clock } = setup({ start: '2026-10-15T09:00:00Z' })
  const { id } = await billing.chargeCredits(db, USER, 4, { ref: 'post_a' })
  assert.equal(account(db).creditsUsed, 4)

  clock.advance(2 * HOUR)
  assert.deepEqual(await billing.releaseStaleCharges(db, { now: new clock.Date() }), { refunded: 0, settled: 0 }, 'a post may still be in progress')

  clock.advance(1.5 * HOUR)
  assert.deepEqual(await billing.releaseStaleCharges(db, { now: new clock.Date() }), { refunded: 1, settled: 0 })
  assert.equal(account(db).creditsUsed, 0)
  assert.equal(charge(db, id).status, 'refunded')
  assert.deepEqual(await billing.releaseStaleCharges(db, { now: new clock.Date() }), { refunded: 0, settled: 0 }, 'once only')
  assert.equal(account(db).creditsUsed, 0)
})

test('a post whose images were made stays charged: the charge is settled, not refunded', async () => {
  const { db, billing, clock } = setup({ start: '2026-10-15T09:00:00Z' })
  const { id } = await billing.chargeCredits(db, USER, 3, { ref: 'post_b' })
  charge(db, id).imagesAt = new clock.Date()
  clock.advance(4 * HOUR)
  assert.deepEqual(await billing.releaseStaleCharges(db, { now: new clock.Date() }), { refunded: 0, settled: 1 })
  assert.equal(charge(db, id).status, 'settled')
  assert.equal(account(db).creditsUsed, 3)
})

test('finished and refunded posts are left alone, and bought credits come back where they were taken from', async () => {
  const { db, billing, clock } = setup({ start: '2026-10-15T09:00:00Z' })
  await billing.grantExtraCredits(db, USER, 10, { ref: 'cs_1' })
  const done = await billing.chargeCredits(db, USER, 2, { ref: 'post_done' })
  await billing.settleCharge(db, USER, done.id)
  // 30 Free credits a month: 2 used, so 28 more come from the month and 2 from the bought ones.
  const big = await billing.chargeCredits(db, USER, 30, { ref: 'post_big' })
  assert.equal(big.fromExtra, 2)
  clock.advance(5 * HOUR)
  assert.deepEqual(await billing.releaseStaleCharges(db, { now: new clock.Date() }), { refunded: 1, settled: 0 })
  assert.equal(account(db).creditsUsed, 2)
  assert.equal(account(db).extraCredits, 10)
  assert.equal(charge(db, done.id).status, 'settled')
})
