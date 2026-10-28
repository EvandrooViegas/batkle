const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const { seeds, store, generation, access, memoryDb } = require('./globalDesigns.test.cjs')

const viewer = (userId, plan = 'pro', teammates = [userId].filter(Boolean)) => ({ userId, plan, admin: false, teammates })
const anna = viewer('anna'), bruno = viewer('bruno'), freeCarla = viewer('carla', 'free'), teammate = viewer('dora', 'business', ['dora', 'anna'])

test('who sees and uses a design: Batkle’s for everyone, members’ public for paid plans, private for the team', () => {
  const official = { id: 'batkle', status: 'published' }
  const publicDesign = { id: 'p', status: 'published', ownerId: 'anna', author: { name: 'Anna' }, visibility: 'public' }
  const privateDesign = { ...publicDesign, id: 'q', visibility: 'private' }
  const draft = { ...publicDesign, id: 'd', status: 'draft' }
  for (const v of [anna, bruno, freeCarla, teammate, access.ANONYMOUS]) assert.ok(access.canUse(official, v), 'Batkle’s own designs are free for everyone')
  // Public: everyone sees it; Free sees it and is offered the upgrade.
  assert.ok(access.canSee(publicDesign, freeCarla))
  assert.ok(!access.canUse(publicDesign, freeCarla))
  assert.deepEqual(access.libraryInfo(publicDesign, freeCarla), { official: false, author: 'Anna', visibility: 'public', mine: false, team: false, usable: false, upgrade: true })
  assert.ok(access.canUse(publicDesign, bruno))
  // Private: the author and their teammates only.
  assert.ok(!access.canSee(privateDesign, bruno))
  assert.ok(access.canUse(privateDesign, teammate))
  assert.equal(access.libraryInfo(privateDesign, teammate).team, true)
  assert.equal(access.libraryInfo(privateDesign, anna).mine, true)
  // Drafts are the author's; a design without a visibility is private.
  assert.ok(access.canSee(draft, anna) && !access.canSee(draft, teammate))
  assert.equal(access.visibilityOf({ ownerId: 'x' }), 'private')
  assert.equal(access.visibilityOf({}), 'public')
  // Editing: the author, or the admin; never someone else, never a Batkle design for a member.
  assert.ok(access.canEdit(publicDesign, anna) && !access.canEdit(publicDesign, bruno) && !access.canEdit(official, anna))
  assert.ok(access.canEdit(official, { ...bruno, admin: true }))
})

test('a design a brand already uses survives unpublishing, but not a Free plan or leaving the team', () => {
  const retiredOfficial = { id: 'o', status: 'draft' }
  const retiredPublic = { id: 'p', status: 'draft', ownerId: 'anna', visibility: 'public' }
  const privateDesign = { id: 'q', status: 'published', ownerId: 'anna', visibility: 'private' }
  assert.ok(access.canKeepUsing(retiredOfficial, freeCarla))
  assert.ok(access.canKeepUsing(null, freeCarla), 'an unknown record keeps working as before')
  assert.ok(access.canKeepUsing(retiredPublic, bruno))
  assert.ok(!access.canKeepUsing(retiredPublic, freeCarla))
  assert.ok(access.canKeepUsing(privateDesign, teammate))
  assert.ok(!access.canKeepUsing(privateDesign, bruno), 'out of the team, out of the design')
})

async function libraryWithMemberDesigns() {
  const db = memoryDb(); await store.ensureGlobalDesignLibrary(db)
  const make = async (id, owner, visibility) => {
    const family = { ...seeds[0], id, name: `Design ${id}` }
    const saved = await store.saveGlobalDraft(db, family, undefined, { id: owner, name: owner === 'anna' ? 'Anna Lopes' : owner })
    return visibility ? store.publishGlobalDesign(db, id, saved.revision, visibility) : saved
  }
  await make('family-public', 'anna', 'public')
  await make('family-private', 'anna', 'private')
  await make('family-draft', 'anna')
  return db
}

test('a member’s design is saved with its author, private until published, and listed for the right people', async () => {
  const db = await libraryWithMemberDesigns()
  const draft = await store.getGlobalRecord(db, 'family-draft')
  assert.equal(draft.ownerId, 'anna'); assert.deepEqual(draft.author, { name: 'Anna Lopes' }); assert.equal(draft.visibility, 'private'); assert.equal(draft.status, 'draft')
  const official = seeds.map(s => s.id)
  const ids = async v => (await store.listLibrary(db, v)).map(f => f.id)
  // Batkle's own come first, then members'.
  assert.deepEqual((await ids(anna)).slice(0, official.length), official)
  assert.deepEqual((await ids(anna)).slice(official.length).sort(), ['family-private', 'family-public'])
  assert.deepEqual((await ids(bruno)).slice(official.length), ['family-public'])
  assert.deepEqual((await ids(teammate)).slice(official.length).sort(), ['family-private', 'family-public'])
  const forFree = await store.listLibrary(db, freeCarla)
  assert.equal(forFree.find(f => f.id === 'family-public').library.upgrade, true, 'Free sees it, with the upgrade')
  assert.equal(forFree.find(f => f.id === official[0]).library.usable, true)
  assert.equal(forFree.find(f => f.id === official[0]).library.author, 'Batkle')
  // "Yours" holds drafts too, and only the account's own.
  assert.deepEqual((await store.listOwnRecords(db, anna)).map(r => r.id).sort(), ['family-draft', 'family-private', 'family-public'])
  assert.deepEqual(await store.listOwnRecords(db, bruno), [])
  // Batkle's designs published by the admin carry no owner and stay public.
  const seed = await store.getGlobalRecord(db, official[0])
  const republished = await store.publishGlobalDesign(db, official[0], seed.revision, 'private')
  assert.equal(republished.visibility, undefined)
  assert.ok((await store.listLibrary(db, freeCarla)).some(f => f.id === official[0]))
})

test('switching a design on checks the account: Free is asked to upgrade, a private design reads as missing', async () => {
  const db = await libraryWithMemberDesigns()
  for (const id of ['brand-free', 'brand-pro', 'brand-team']) await db.collection('flows').insertOne({ id, brandContext: {} })
  await assert.rejects(store.selectBrandFamilies(db, 'brand-free', ['family-public'], freeCarla), error => error.code === 'upgrade_required' && error.billing && error.details.feature === 'communityDesigns')
  await store.selectBrandFamilies(db, 'brand-free', [seeds[0].id], freeCarla)
  await assert.rejects(store.selectBrandFamilies(db, 'brand-pro', ['family-private'], bruno), /not found/)
  const result = await store.selectBrandFamilies(db, 'brand-pro', ['family-public'], bruno)
  assert.equal(result.brandContext.designs.find(d => d.globalFamilyId === 'family-public').source, 'global')
  await store.selectBrandFamilies(db, 'brand-team', ['family-private'], teammate)
  // Without a viewer (scripts, older callers) selection works as before.
  await store.selectBrandFamilies(db, 'brand-free', ['family-public'])
})

test('generation leaves out a member’s design on a Free plan, and asked for by name it offers the upgrade', async () => {
  const db = await libraryWithMemberDesigns()
  await db.collection('flows').insertOne({ id: 'brand', brandContext: {} })
  const { brandContext } = await store.selectBrandFamilies(db, 'brand', [seeds[0].id, 'family-public'])
  const brand = { ...brandContext, id: 'brand' }
  for (let i = 0; i < 6; i++) {
    const picked = await generation.chooseBrandFamily(db, brand, { headline: `Post ${i}` }, undefined, { viewer: freeCarla })
    assert.equal(picked.family.id, seeds[0].id)
  }
  await assert.rejects(generation.chooseBrandFamily(db, brand, { headline: 'x' }, 'global-family-public', { viewer: freeCarla }), error => error.code === 'upgrade_required')
  assert.equal((await generation.chooseBrandFamily(db, brand, { headline: 'x' }, 'global-family-public', { viewer: bruno })).family.id, 'family-public')
  // Only member designs and a Free plan: no Global Design, so the brand's starter designs are used.
  const onlyMember = { ...brand, designs: brand.designs.filter(d => d.globalFamilyId === 'family-public') }
  assert.equal(await generation.chooseBrandFamily(db, onlyMember, { headline: 'x' }, undefined, { viewer: freeCarla }), null)
})

// ─── Brand teams ──────────────────────────────────────────────────────────────

function teamDb() {
  const tables = new Map()
  const value = (doc, key) => key.split('.').reduce((v, k) => v?.[k], doc)
  const matches = (doc, query) => Object.entries(query).every(([key, want]) => want && typeof want === 'object' && '$in' in want ? want.$in.includes(value(doc, key)) : value(doc, key) === want)
  return { tables, collection(name) {
    if (!tables.has(name)) tables.set(name, [])
    const list = tables.get(name)
    const unique = { brandMembers: ['flowId', 'email'] }[name]
    return {
      createIndex: async () => ({}),
      find: query => ({ toArray: async () => structuredClone(list.filter(d => matches(d, query))) }),
      findOne: async query => structuredClone(list.find(d => matches(d, query)) || null),
      countDocuments: async query => list.filter(d => matches(d, query)).length,
      insertOne: async doc => {
        if (unique && list.some(d => unique.every(k => d[k] === doc[k]))) throw Object.assign(Error('duplicate'), { code: 11000 })
        list.push(structuredClone(doc)); return {}
      },
      updateOne: async (query, update) => { const doc = list.find(d => matches(d, query)); if (doc) Object.assign(doc, structuredClone(update.$set || {})); return { matchedCount: doc ? 1 : 0 } },
      deleteOne: async query => { const i = list.findIndex(d => matches(d, query)); if (i >= 0) list.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 } },
      deleteMany: async query => { const before = list.length; for (let i = list.length - 1; i >= 0; i--) if (matches(list[i], query)) list.splice(i, 1); return { deletedCount: before - list.length } },
    }
  } }
}
const teams = new Function('randomUUID', stripTypeScriptTypes(fs.readFileSync('lib/teams.ts', 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))
  + ';return { TEAM_MAX_MEMBERS, brandRole, requireBrandAccess, teammateIds, sharedBrands, memberOpened, forgetBrand, inviteMember, setMemberRole, removeMember, acceptInvitation, declineInvitation, leaveBrand, recordInvitationEmail, refreshDeliveries, brandTeam, teamsOverview, sharedPlanLimit, sharedLimitAnswer }')(require('node:crypto').randomUUID)

async function brandDb() {
  const db = teamDb()
  await db.collection('users').insertOne({ id: 'anna', name: 'Anna Lopes', email: 'anna@studio.pt' })
  await db.collection('users').insertOne({ id: 'dora', name: 'Dora', email: 'dora@studio.pt' })
  await db.collection('flows').insertOne({ id: 'prumo', ownerId: 'anna', brandContext: { name: 'Prumo', logo: '/logo.png' } })
  await db.collection('flows').insertOne({ id: 'kachica', ownerId: 'anna', brandContext: { name: 'Kachica' } })
  await db.collection('flows').insertOne({ id: 'doras', ownerId: 'dora', brandContext: { name: 'Dora’s' } })
  return db
}
const annaInvites = { userId: 'anna', email: 'anna@studio.pt' }
const verifiedDora = { email: 'dora@studio.pt', emailVerified: true }

test('a brand team: the owner invites by email with a role, the invited account accepts, and the brand is shared with it', async () => {
  const db = await brandDb()
  const { brand, member } = await teams.inviteMember(db, 'prumo', annaInvites, '  Dora@Studio.PT ', 'editor')
  assert.equal(brand.name, 'Prumo')
  assert.equal(member.email, 'dora@studio.pt', 'emails are compared lower-case')
  await assert.rejects(teams.inviteMember(db, 'prumo', annaInvites, 'dora@studio.pt', 'viewer'), /already in this brand/)
  await assert.rejects(teams.inviteMember(db, 'prumo', annaInvites, 'anna@studio.pt', 'editor'), /already in this brand/)
  await assert.rejects(teams.inviteMember(db, 'prumo', annaInvites, 'not-an-email', 'editor'), /not valid/)
  await assert.rejects(teams.inviteMember(db, 'prumo', annaInvites, 'eve@x.pt', 'boss'), /Choose a role/)
  // An invitation shares nothing until it is accepted.
  assert.equal(await teams.brandRole(db, 'dora', 'prumo'), null)
  await assert.rejects(teams.requireBrandAccess(db, 'dora', ['prumo']), error => error.status === 404)
  assert.deepEqual(await teams.teammateIds(db, 'dora'), ['dora'])
  const waiting = await teams.teamsOverview(db, 'dora', 'dora@studio.pt')
  assert.deepEqual(waiting.invitations.map(i => [i.brand.name, i.role, i.owner, i.invitedBy]), [['Prumo', 'editor', 'Anna Lopes', 'Anna Lopes']])
  // Only the account with that verified email can accept.
  await assert.rejects(teams.acceptInvitation(db, 'eve', { email: 'eve@x.pt', emailVerified: true }, member.id), /no longer open/)
  await assert.rejects(teams.acceptInvitation(db, 'dora', { ...verifiedDora, emailVerified: false }, member.id), /Verify/)
  await teams.acceptInvitation(db, 'dora', verifiedDora, member.id)

  // In the shared brand, work belongs to the owner, and the role decides what Dora may do.
  assert.deepEqual(await teams.brandRole(db, 'dora', 'prumo'), { flowId: 'prumo', ownerId: 'anna', role: 'editor' })
  assert.equal(await teams.requireBrandAccess(db, 'dora', ['prumo'], 'editor'), 'anna')
  await assert.rejects(teams.requireBrandAccess(db, 'dora', ['prumo'], 'admin'), error => error.status === 403)
  await assert.rejects(teams.requireBrandAccess(db, 'dora', ['kachica']), error => error.status === 404, 'only the brand she was invited to')
  await assert.rejects(teams.requireBrandAccess(db, 'dora', ['prumo', 'doras']), error => error.status === 404, 'one account’s brands per request')
  assert.equal(await teams.requireBrandAccess(db, 'dora', ['doras'], 'owner'), 'dora')
  assert.equal(await teams.requireBrandAccess(db, 'dora', ['missing']), null, 'brands that do not exist pass')
  assert.equal(await teams.requireBrandAccess(db, 'anna', ['prumo', 'kachica'], 'owner'), 'anna')
  const listed = await teams.sharedBrands(db, 'dora', { 'brandContext.name': 1 })
  assert.deepEqual(listed.map(f => [f.id, f.shared]), [['prumo', { role: 'editor', owner: 'Anna Lopes' }]])
  assert.equal('ownerId' in listed[0], false)
  assert.deepEqual((await teams.teammateIds(db, 'dora')).sort(), ['anna', 'dora'])
  assert.deepEqual((await teams.teammateIds(db, 'anna')).sort(), ['anna', 'dora'])
  assert.equal(await teams.memberOpened(db, 'dora', 'prumo'), true)

  // The owner changes the role; a viewer only looks.
  await teams.setMemberRole(db, 'prumo', member.id, 'viewer')
  await assert.rejects(teams.requireBrandAccess(db, 'dora', ['prumo'], 'editor'), /view this brand but not change it/)
  const team = await teams.brandTeam(db, 'prumo', 'anna', 'owner')
  assert.equal(team.canManage, true)
  assert.deepEqual(team.owner, { name: 'Anna Lopes', email: 'anna@studio.pt', you: true })
  assert.deepEqual(team.members.map(m => [m.email, m.status, m.role, m.name]), [['dora@studio.pt', 'active', 'viewer', 'Dora']])
  assert.equal((await teams.brandTeam(db, 'prumo', 'dora', 'viewer')).canManage, false)
  const overview = await teams.teamsOverview(db, 'anna', 'anna@studio.pt')
  assert.deepEqual(overview.owned.map(o => [o.flowId, o.people, o.invited]).sort(), [['kachica', 0, 0], ['prumo', 1, 0]])
  assert.deepEqual((await teams.teamsOverview(db, 'dora', 'dora@studio.pt')).shared.map(s => [s.brand.name, s.role, s.owner]), [['Prumo', 'viewer', 'Anna Lopes']])

  // Leaving, or being removed, ends the sharing.
  await teams.leaveBrand(db, 'dora', 'prumo')
  assert.equal(await teams.brandRole(db, 'dora', 'prumo'), null)
  const again = await teams.inviteMember(db, 'prumo', annaInvites, 'dora@studio.pt', 'admin')
  await teams.acceptInvitation(db, 'dora', verifiedDora, again.member.id)
  await teams.removeMember(db, 'prumo', again.member.id)
  assert.deepEqual(await teams.teammateIds(db, 'anna'), ['anna'])
  await assert.rejects(teams.removeMember(db, 'prumo', again.member.id), /not in this brand/)
})

test('a brand holds a limited number of people; bounced invitation emails are noted; a deleted brand leaves nobody behind', async () => {
  const db = await brandDb()
  for (let i = 0; i < teams.TEAM_MAX_MEMBERS; i++) await teams.inviteMember(db, 'prumo', annaInvites, `p${i}@x.pt`, 'viewer')
  await assert.rejects(teams.inviteMember(db, 'prumo', annaInvites, 'one-more@x.pt', 'viewer'), /up to/)
  await teams.inviteMember(db, 'kachica', annaInvites, 'one-more@x.pt', 'viewer')
  const [first, second, third] = (await teams.brandTeam(db, 'prumo', 'anna', 'owner')).members
  await teams.declineInvitation(db, { email: first.email }, first.id)
  assert.equal((await teams.brandTeam(db, 'prumo', 'anna', 'owner')).members.length, teams.TEAM_MAX_MEMBERS - 1)

  // Resend's answer is kept: delivered, or bounced when the address does not exist.
  await teams.recordInvitationEmail(db, second.id, 'email-2')
  await teams.recordInvitationEmail(db, third.id, 'email-3')
  const asked = []
  await teams.refreshDeliveries(db, 'prumo', async id => { asked.push(id); return id === 'email-2' ? 'bounced' : 'delivered' })
  assert.deepEqual(asked.sort(), ['email-2', 'email-3'])
  const after = (await teams.brandTeam(db, 'prumo', 'anna', 'owner')).members
  assert.deepEqual([after.find(m => m.id === second.id).delivery, after.find(m => m.id === third.id).delivery], ['bounced', 'delivered'])
  asked.length = 0
  await teams.refreshDeliveries(db, 'prumo', async id => { asked.push(id); return 'sent' })
  assert.deepEqual(asked, [], 'an answer is asked for once')

  await teams.forgetBrand(db, 'prumo')
  assert.deepEqual(db.tables.get('brandMembers').map(m => m.flowId), ['kachica'])
})

test('a plan limit met in a shared brand names the owner, and the page is told not to offer an upgrade of its own', async () => {
  const db = await brandDb()
  const credits = await teams.sharedPlanLimit(db, { message: 'You need 4 credits.', code: 'insufficient_credits', details: { needed: 4 } }, 'anna')
  assert.equal(credits.message, 'Posts in this brand use Anna Lopes’s credits, and there aren’t enough left for this. Ask Anna Lopes to add more.')
  assert.deepEqual(credits.details, { needed: 4, sharedBy: 'Anna Lopes' })
  const plan = await teams.sharedPlanLimit(db, { message: 'Scheduling is part of Pro and Business. Upgrade to use it.', code: 'upgrade_required' }, 'anna')
  assert.equal(plan.message, 'Scheduling is part of Pro and Business. This brand runs on Anna Lopes’s plan, so ask Anna Lopes to upgrade.')

  const answer = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'X-Kept': 'yes' } })
  const rewritten = await teams.sharedLimitAnswer(db, answer(402, { error: 'Out of credits.', code: 'insufficient_credits', needed: 2 }), 'anna')
  assert.equal(rewritten.headers.get('X-Kept'), 'yes')
  assert.deepEqual(await rewritten.json(), { error: 'Posts in this brand use Anna Lopes’s credits, and there aren’t enough left for this. Ask Anna Lopes to add more.', code: 'insufficient_credits', needed: 2, sharedBy: 'Anna Lopes' })
  // The account's own brands, other errors and payment problems pass unchanged.
  const own = answer(402, { error: 'Out of credits.', code: 'insufficient_credits' })
  assert.equal(await teams.sharedLimitAnswer(db, own, null), own)
  const missing = answer(404, { error: 'Not found' })
  assert.equal(await teams.sharedLimitAnswer(db, missing, 'anna'), missing)
  const payments = answer(402, { error: 'Payments are off.', code: 'payments_unavailable' })
  assert.equal(await teams.sharedLimitAnswer(db, payments, 'anna'), payments)
})
