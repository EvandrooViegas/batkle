const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const { randomUUID } = require('node:crypto')
const { fakeMongo, plans } = require('./billingAccount.test.cjs')

const load = file => stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))
const attribution = new Function(load('lib/analytics/attribution.ts') + ';return { channelOf, referrerHost, readTouch, nextAttribution, encodeAttribution, decodeAttribution, cookieValue, campaignKey, campaignLink, ATTRIBUTION_COOKIE, VISITOR_COOKIE, UTM_KEYS }')()
const visits = new Function(...Object.keys(attribution), load('lib/analytics/visits.ts') + ';return { recordVisit, recordSignupAttribution }')(...Object.values(attribution))
const metrics = new Function('PLANS', 'TRIAL', 'planById', 'adminEmails', 'campaignKey', 'channelOf', load('lib/analytics/metrics.ts') + ';return { summarizeMetrics, monthlyRevenue, touchOf }')(
  plans.PLANS, plans.TRIAL, plans.planById, () => [], attribution.campaignKey, attribution.channelOf)

test('a visit’s channel comes from its tags first, then from the site that sent it', () => {
  const c = (source, medium, referrer = '') => attribution.channelOf({ source, medium, referrer })
  assert.equal(c('facebook', 'paid-social'), 'Paid social')
  assert.equal(c('instagram', 'cpc'), 'Paid social')
  assert.equal(c('google', 'cpc'), 'Paid search')
  assert.equal(c('newsletter', 'email'), 'Email')
  assert.equal(c('instagram', 'social'), 'Organic social')
  assert.equal(c('partner-blog', 'referral'), 'Referral')
  assert.equal(c('podcast', 'audio'), 'Campaign')
  assert.equal(c('', '', 'google.pt'), 'Search')
  assert.equal(c('', '', 'l.instagram.com'), 'Organic social')
  assert.equal(c('', '', 'some-blog.com'), 'Referral')
  assert.equal(c('', ''), 'Direct')
})

test('reading a visit: UTM tags, Meta’s and Google’s click IDs, and the sending site unless it is Batkle', () => {
  const now = new Date('2026-10-20T10:00:00Z')
  const tagged = attribution.readTouch('?utm_source=facebook&utm_medium=paid-social&utm_campaign=launch&utm_content=video-a', 'https://www.facebook.com/', '/', 'batkle.com', now)
  assert.deepEqual({ ...tagged }, { source: 'facebook', medium: 'paid-social', campaign: 'launch', content: 'video-a', term: '', referrer: 'facebook.com', landing: '/', channel: 'Paid social', at: now.toISOString() })
  assert.equal(attribution.readTouch('?fbclid=abc', '', '/', 'batkle.com').channel, 'Paid social', 'an untagged Meta ad click still counts as one')
  assert.equal(attribution.readTouch('?gclid=abc', '', '/', 'batkle.com').channel, 'Paid search')
  assert.equal(attribution.readTouch('', 'https://www.batkle.com/pricing', '/sign-up', 'batkle.com').channel, 'Direct', 'moving between Batkle pages is not a new source')
  assert.equal(attribution.referrerHost('not a url'), '')
})

test('the first visit is kept; the last moves only with a campaign or another site, never with a direct visit', () => {
  const ad = attribution.readTouch('?utm_source=facebook&utm_medium=paid-social&utm_campaign=launch', '', '/', 'batkle.com')
  const direct = attribution.readTouch('', '', '/pricing', 'batkle.com')
  const mail = attribution.readTouch('?utm_source=newsletter&utm_medium=email&utm_campaign=oct', '', '/', 'batkle.com')
  let state = attribution.nextAttribution(null, ad)
  state = attribution.nextAttribution(state, direct)
  assert.equal(state.last.campaign, 'launch')
  state = attribution.nextAttribution(state, mail)
  assert.equal(state.first.campaign, 'launch'); assert.equal(state.last.campaign, 'oct')
  // The cookie survives a round trip; anything else reads as nothing.
  const cookie = `other=1; ${attribution.ATTRIBUTION_COOKIE}=${attribution.encodeAttribution(state)}; x=2`
  assert.equal(attribution.decodeAttribution(attribution.cookieValue(cookie, attribution.ATTRIBUTION_COOKIE)).last.source, 'newsletter')
  assert.equal(attribution.decodeAttribution('%7Bnot json'), null)
  assert.equal(attribution.decodeAttribution('x'.repeat(5000)), null)
  assert.equal(attribution.campaignLink('https://batkle.com/', { source: 'facebook', medium: 'paid-social', campaign: 'launch', content: '' }), 'https://batkle.com/?utm_source=facebook&utm_medium=paid-social&utm_campaign=launch')
})

test('visits are counted once per visitor per half hour, and signups keep the campaign that brought them, once', async () => {
  const db = fakeMongo()
  const now = new Date('2026-10-20T10:00:00Z')
  const body = { visitorId: 'v-1234567890', source: 'facebook', medium: 'paid-social', campaign: 'launch', landing: '/' }
  assert.equal(await visits.recordVisit(db, body, now), true)
  assert.equal(await visits.recordVisit(db, body, new Date(now.getTime() + 10 * 60_000)), false)
  assert.equal(await visits.recordVisit(db, body, new Date(now.getTime() + 31 * 60_000)), true)
  assert.equal(await visits.recordVisit(db, { ...body, visitorId: 'x' }, now), false, 'a visitor ID that is not ours is ignored')
  const stored = db.tables.get('visits')
  assert.equal(stored.length, 2)
  assert.equal(stored[0].channel, 'Paid social')
  assert.equal(stored[0].ip, undefined)

  await db.collection('users').insertOne({ id: 'u1', email: 'a@x.pt' })
  const state = attribution.nextAttribution(null, attribution.readTouch('?utm_source=facebook&utm_medium=paid-social&utm_campaign=launch', '', '/', 'batkle.com'))
  const cookies = `${attribution.ATTRIBUTION_COOKIE}=${attribution.encodeAttribution(state)}; ${attribution.VISITOR_COOKIE}=v-1234567890`
  await visits.recordSignupAttribution(db, 'u1', cookies)
  await visits.recordSignupAttribution(db, 'u1', '')
  const user = db.tables.get('users')[0]
  assert.equal(user.attribution.last.campaign, 'launch', 'the first save is kept')
  assert.equal(user.attribution.visitorId, 'v-1234567890')
})

const now = new Date('2026-10-20T12:00:00Z')
const daysAgo = n => new Date(now.getTime() - n * 864e5)
const touch = (source, medium, campaign) => ({ source, medium, campaign, channel: attribution.channelOf({ source, medium, referrer: '' }) })
function rows() {
  return {
    users: [
      { id: 'admin', email: 'boss@batkle.com', createdAt: daysAgo(3), onboardedAt: daysAgo(3) },
      { id: 'u1', email: 'a@x.pt', createdAt: daysAgo(2), onboardedAt: daysAgo(2), attribution: { first: touch('facebook', 'paid-social', 'launch'), last: touch('facebook', 'paid-social', 'launch') } },
      { id: 'u2', email: 'b@x.pt', createdAt: daysAgo(5), onboardedAt: daysAgo(5), attribution: { first: touch('facebook', 'paid-social', 'launch'), last: null } },
      { id: 'u3', email: 'c@x.pt', createdAt: daysAgo(10), attribution: { first: null, last: null } },
      { id: 'u4', email: 'd@x.pt', createdAt: daysAgo(40), onboardedAt: daysAgo(40) },
    ],
    billing: [
      { id: 'admin', plan: 'business', status: 'active', interval: 'month' },
      { id: 'u1', plan: 'pro', status: 'active', interval: 'month', trialUsed: true, trialEnd: daysAgo(1) },
      { id: 'u2', plan: 'business', status: 'trialing', interval: 'month', trialUsed: true, trialEnd: new Date(now.getTime() + 2 * 864e5) },
      { id: 'u4', plan: 'business', status: 'active', interval: 'year' },
    ],
    canvases: [
      { ownerId: 'u1', createdAt: daysAgo(1) }, { ownerId: 'u1', createdAt: daysAgo(2) }, { ownerId: 'u4', createdAt: daysAgo(20) },
      { ownerId: 'u1', createdAt: daysAgo(1), ad: { id: 'ad1' } }, { ownerId: 'admin', createdAt: daysAgo(1) },
    ],
    ads: [{ ownerId: 'u1', createdAt: daysAgo(1) }],
    charges: [{ ownerId: 'u1', credits: 4, status: 'settled', createdAt: daysAgo(1) }, { ownerId: 'u1', credits: 3, status: 'refunded', createdAt: daysAgo(1) }, { ownerId: 'admin', credits: 9, status: 'settled', createdAt: daysAgo(1) }],
    visits: [
      { at: daysAgo(2), visitorId: 'v1', source: 'facebook', medium: 'paid-social', campaign: 'launch', channel: 'Paid social' },
      { at: daysAgo(2), visitorId: 'v2', source: 'facebook', medium: 'paid-social', campaign: 'launch', channel: 'Paid social' },
      { at: daysAgo(3), visitorId: 'v2', source: 'facebook', medium: 'paid-social', campaign: 'launch', channel: 'Paid social' },
      { at: daysAgo(4), visitorId: 'v3', source: '', medium: '', campaign: '', channel: 'Direct' },
    ],
    designs: [{ ownerId: 'u1', status: 'published', visibility: 'public' }, { ownerId: 'u1', status: 'draft' }, { status: 'published' }],
    teams: [{ ownerId: 'u1' }], members: [{ status: 'active' }, { status: 'invited' }],
    aiImages: [{ brand_id: 'brand_b1', created_at: daysAgo(1) }, { brand_id: 'brand_badmin', created_at: daysAgo(1) }],
    flows: [{ id: 'b1', ownerId: 'u1' }, { id: 'badmin', ownerId: 'admin' }],
  }
}

test('revenue counts paying subscriptions only, a yearly one as a twelfth, and leaves trials out', () => {
  assert.equal(metrics.monthlyRevenue({ plan: 'pro', status: 'active', interval: 'month' }), plans.PLANS.pro.price.month)
  assert.equal(metrics.monthlyRevenue({ plan: 'business', status: 'active', interval: 'year' }), plans.PLANS.business.price.year / 12)
  assert.equal(metrics.monthlyRevenue({ plan: 'pro', status: 'trialing' }), 0)
  assert.equal(metrics.monthlyRevenue({ plan: 'pro', status: 'canceled' }), 0)
  const m = metrics.summarizeMetrics(rows(), { days: 30, now, admins: ['boss@batkle.com'] })
  const expected = Math.round((plans.PLANS.pro.price.month + plans.PLANS.business.price.year / 12) * 100) / 100
  assert.equal(m.revenue.mrr, expected, 'the admin’s own Business plan is not revenue')
  assert.equal(m.revenue.paying, 2); assert.equal(m.revenue.trialing, 1)
  assert.deepEqual(m.plans, { free: 1, pro: 1, business: 2 })
})

test('the dashboard leaves admin accounts out and counts the period’s signups, use and campaigns', () => {
  const m = metrics.summarizeMetrics(rows(), { days: 30, now, admins: ['boss@batkle.com'] })
  assert.equal(m.acquisition.signups, 3, 'u1, u2 and u3; the admin and the 40-day-old account are not in the period')
  assert.equal(m.acquisition.onboarded, 2)
  assert.equal(m.acquisition.converted, 1)
  assert.equal(m.acquisition.visits, 4); assert.equal(m.acquisition.visitors, 3)
  assert.equal(m.usage.posts, 3, 'ads and the admin’s posts are not posts')
  assert.equal(m.usage.ads, 1)
  assert.equal(m.usage.credits, 4, 'refunded charges and the admin’s are left out')
  assert.equal(m.usage.aiImages, 1)
  assert.equal(m.usage.activeWeek, 1)
  assert.deepEqual([m.designs.memberPublic, m.designs.memberDrafts, m.designs.batkle, m.designs.teams, m.designs.teamMembers], [1, 1, 1, 1, 1])
  const launch = m.campaigns.find(c => c.campaign === 'launch')
  assert.deepEqual([launch.visits, launch.visitors, launch.signups, launch.trials, launch.paying], [3, 2, 2, 2, 1])
  assert.equal(launch.signupRate, 100); assert.equal(launch.paidRate, 50)
  assert.equal(launch.mrr, plans.PLANS.pro.price.month)
  // An account whose last touch is missing counts under its first; none at all under Unknown.
  assert.ok(m.channels.some(c => c.channel === 'Unknown' && c.signups === 1))
  assert.equal(m.series.length, 31)
  assert.equal(m.series.reduce((s, d) => s + d.signups, 0), 3)
  assert.equal(m.recent[0].id, 'u1')
  assert.ok(!m.recent.some(r => r.id === 'admin'))
})

test('an admin account works on Business terms with credits to spare, without changing what is saved', async () => {
  const previous = process.env.ADMIN_EMAILS
  process.env.ADMIN_EMAILS = ' Boss@Batkle.com , other@x.pt '
  try {
    const billing = new Function('randomUUID', ...Object.keys(plans), load('lib/billing/account.ts') + ';return { adminEmails, ADMIN_CREDITS, loadBilling, effectivePlanId, creditsLeft, hasFeature, requireBrandSlot, getBillingSummary }')(randomUUID, ...Object.values(plans))
    const db = fakeMongo({ seed: { users: [{ id: 'admin', email: 'boss@batkle.com', emailVerified: true }, { id: 'unverified', email: 'other@x.pt', emailVerified: false }, { id: 'member', email: 'm@x.pt', emailVerified: true }] } })
    assert.deepEqual(billing.adminEmails(), ['boss@batkle.com', 'other@x.pt'])
    const admin = await billing.loadBilling(db, 'admin')
    assert.equal(admin.admin, true); assert.equal(billing.effectivePlanId(admin), 'business')
    assert.equal(billing.creditsLeft(admin).total, billing.ADMIN_CREDITS)
    assert.equal(await billing.hasFeature(db, 'admin', 'adDesigns'), true)
    assert.equal(db.tables.get('billingAccounts').find(a => a.id === 'admin').plan, 'free', 'the saved plan is untouched')
    for (let i = 0; i < 6; i++) await db.collection('flows').insertOne({ id: `f${i}`, ownerId: 'admin' })
    await billing.requireBrandSlot(db, 'admin')
    // An unverified email, or one not listed, is an ordinary account.
    assert.equal((await billing.loadBilling(db, 'unverified')).admin, undefined)
    assert.equal(billing.effectivePlanId(await billing.loadBilling(db, 'member')), 'free')
    const summary = await billing.getBillingSummary(db, 'admin')
    assert.equal(summary.admin, true); assert.equal(summary.features.customDesigns, true)
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = previous
  }
})
