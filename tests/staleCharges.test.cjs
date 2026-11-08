const { test } = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('./billingAccount.test.cjs')

const USER = 'user_1'
const MINUTE = 60 * 1000
const account = db => db.table('billingAccounts').find(a => a.id === USER)
const charge = (db, id) => db.table('creditCharges').find(c => c.id === id)

test('a post that was never finished gets its credits back after half an hour, and only then', async () => {
  const { db, billing, clock } = setup({ start: '2026-10-15T09:00:00Z' })
  const { id } = await billing.chargeCredits(db, USER, 4, { ref: 'post_a' })
  assert.equal(account(db).creditsUsed, 4)

  clock.advance(20 * MINUTE)
  assert.deepEqual(await billing.releaseStaleCharges(db, { now: new clock.Date() }), { refunded: 0 }, 'a post may still be in progress')

  clock.advance(15 * MINUTE)
  assert.deepEqual(await billing.releaseStaleCharges(db, { now: new clock.Date() }), { refunded: 1 })
  assert.equal(account(db).creditsUsed, 0)
  assert.equal(charge(db, id).status, 'refunded')
  assert.deepEqual(await billing.releaseStaleCharges(db, { now: new clock.Date() }), { refunded: 0 }, 'once only')
  assert.equal(account(db).creditsUsed, 0)
})

test('a post whose images were made but whose post never was costs nothing either', async () => {
  const { db, billing, clock } = setup({ start: '2026-10-15T09:00:00Z' })
  const { id } = await billing.chargeCredits(db, USER, 3, { ref: 'post_b' })
  // The images step claimed the charge, then the build failed without answering (a time-out).
  charge(db, id).imagesAt = new clock.Date()
  clock.advance(40 * MINUTE)
  assert.deepEqual(await billing.releaseStaleCharges(db, { now: new clock.Date() }), { refunded: 1 })
  assert.equal(charge(db, id).status, 'refunded')
  assert.equal(account(db).creditsUsed, 0)
})

test('finished and refunded posts are left alone, and bought credits come back where they were taken from', async () => {
  const { db, billing, clock } = setup({ start: '2026-10-15T09:00:00Z' })
  await billing.grantExtraCredits(db, USER, 10, { ref: 'cs_1' })
  const done = await billing.chargeCredits(db, USER, 2, { ref: 'post_done' })
  await billing.settleCharge(db, USER, done.id)
  // 30 Free credits a month: 2 used, so 28 more come from the month and 2 from the bought ones.
  const big = await billing.chargeCredits(db, USER, 30, { ref: 'post_big' })
  assert.equal(big.fromExtra, 2)
  clock.advance(5 * 60 * MINUTE)
  assert.deepEqual(await billing.releaseStaleCharges(db, { now: new clock.Date() }), { refunded: 1 })
  assert.equal(account(db).creditsUsed, 2)
  assert.equal(account(db).extraCredits, 10)
  assert.equal(charge(db, done.id).status, 'settled')
})

test('reading an account gives back its own unfinished posts, so a failed one never blocks the next', async () => {
  const { db, billing, clock } = setup({ start: '2026-10-15T09:00:00Z' })
  // 30 Free credits: a 30-slide post that never finished holds them all.
  await billing.chargeCredits(db, USER, 30, { ref: 'post_lost' })
  db.table('creditCharges').push({ id: 'chg_other', ownerId: 'someone_else', credits: 5, fromMonthly: 5, fromExtra: 0, periodStart: account(db).creditPeriodStart, reason: 'post', ref: 'post_x', status: 'held', createdAt: new clock.Date() })
  await assert.rejects(billing.chargeCredits(db, USER, 1, { ref: 'post_next' }), { code: 'insufficient_credits' }, 'still being made')
  clock.advance(31 * MINUTE)
  // No scheduled job ran: the next charge reads the account, which gives the lost post's credits back first.
  const next = await billing.chargeCredits(db, USER, 4, { ref: 'post_next' })
  assert.equal(next.credits, 4)
  assert.equal(account(db).creditsUsed, 4)
  assert.equal(db.table('creditCharges').find(c => c.ref === 'post_lost').status, 'refunded')
  assert.equal(charge(db, 'chg_other').status, 'held', 'another account’s charge is its own business')
  const summary = await billing.getBillingSummary(db, USER)
  assert.equal(summary.credits.left, 26)
})

test('a failed post gives its credits back at once when the browser asks, and a made post keeps its charge', async () => {
  const { db, billing } = setup({ start: '2026-10-15T09:00:00Z' })
  const failed = await billing.chargeCredits(db, USER, 3, { ref: 'post_failed' })
  assert.equal(await billing.releaseCharge(db, USER, 'post_failed'), 'refunded')
  assert.equal(charge(db, failed.id).status, 'refunded')
  assert.equal(account(db).creditsUsed, 0)
  assert.equal(await billing.releaseCharge(db, USER, 'post_failed'), 'refunded', 'asking again changes nothing')
  assert.equal(account(db).creditsUsed, 0)

  // The server already gave it back (the step failed and answered): the answer is the same, nothing twice.
  const refunded = await billing.chargeCredits(db, USER, 2, { ref: 'post_server' })
  await billing.refundCharge(db, USER, refunded.id)
  assert.equal(await billing.releaseCharge(db, USER, 'post_server'), 'refunded')
  assert.equal(account(db).creditsUsed, 0)

  // The post was made after all (its response was lost on the way): it stays paid for.
  const made = await billing.chargeCredits(db, USER, 2, { ref: 'post_made' })
  await billing.settleCharge(db, USER, made.id)
  assert.equal(await billing.releaseCharge(db, USER, 'post_made'), 'settled')
  assert.equal(account(db).creditsUsed, 2)

  assert.equal(await billing.releaseCharge(db, USER, 'post_unknown'), null)
  assert.equal(await billing.releaseCharge(db, 'someone_else', 'post_made'), null, 'only the account’s own charges')
  assert.equal(await billing.releaseCharge(db, USER, 42), null)
})

test('a post dropped after its AI images were made gets its credits back three times a day, then the images count as paid for', async () => {
  const { db, billing, clock } = setup({ start: '2026-10-15T09:00:00Z' })
  assert.equal(billing.IMAGE_REFUNDS_PER_DAY, 3)
  const dropped = async ref => {
    const { id } = await billing.chargeCredits(db, USER, 2, { ref })
    charge(db, id).imagesAt = new clock.Date()
    charge(db, id).aiImages = 2
    return id
  }
  for (const ref of ['post_1', 'post_2', 'post_3']) {
    await dropped(ref)
    assert.equal(await billing.releaseCharge(db, USER, ref), 'refunded')
    clock.advance(MINUTE)
  }
  assert.equal(account(db).creditsUsed, 0)
  const fourth = await dropped('post_4')
  assert.equal(await billing.releaseCharge(db, USER, 'post_4'), 'settled', 'the fourth in a day keeps its credits')
  assert.equal(charge(db, fourth).status, 'settled')
  assert.equal(account(db).creditsUsed, 2)
  // The scheduled job follows the same rule for a tab closed after the images.
  const fifth = await dropped('post_5')
  clock.advance(31 * MINUTE)
  assert.deepEqual(await billing.releaseStaleCharges(db, { now: new clock.Date() }), { refunded: 0 })
  assert.equal(charge(db, fifth).status, 'settled')
  // A day later, refunds are back.
  clock.advance(24 * 60 * MINUTE)
  await dropped('post_6')
  assert.equal(await billing.releaseCharge(db, USER, 'post_6'), 'refunded')
})

test('posts that made no AI images (stock photos, gallery cutouts, typography) always get their credits back', async () => {
  const { db, billing } = setup({ start: '2026-10-15T09:00:00Z' })
  for (const ref of ['post_a', 'post_b', 'post_c', 'post_d', 'post_e']) {
    const { id } = await billing.chargeCredits(db, USER, 1, { ref })
    charge(db, id).imagesAt = new Date()
    assert.equal(await billing.releaseCharge(db, USER, ref), 'refunded')
  }
  assert.equal(account(db).creditsUsed, 0)
  assert.equal(await billing.giveBackCharge(db, USER, 'chg_missing'), null)
})
