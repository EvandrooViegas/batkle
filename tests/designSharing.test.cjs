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

// ─── Teams ────────────────────────────────────────────────────────────────────

function teamDb() {
  const tables = new Map()
  const value = (doc, key) => key.split('.').reduce((v, k) => v?.[k], doc)
  const matches = (doc, query) => Object.entries(query).every(([key, want]) => want && typeof want === 'object' && '$in' in want ? want.$in.includes(value(doc, key)) : value(doc, key) === want)
  return { tables, collection(name) {
    if (!tables.has(name)) tables.set(name, [])
    const list = tables.get(name)
    const unique = { teams: ['ownerId'], teamMembers: ['teamId', 'email'] }[name]
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
  + ';return { TEAM_MAX_MEMBERS, ownTeam, teammateIds, ensureTeam, renameTeam, deleteTeam, inviteMember, acceptInvitation, declineInvitation, leaveTeam, removeMember, teamOverview, normalizeEmail }')(require('node:crypto').randomUUID)

test('a team: invite by email, accept with that verified email, and the team shares private designs', async () => {
  const db = teamDb()
  await db.collection('users').insertOne({ id: 'anna', name: 'Anna Lopes', email: 'anna@studio.pt' })
  await db.collection('users').insertOne({ id: 'dora', name: 'Dora', email: 'dora@studio.pt' })
  const { team, member } = await teams.inviteMember(db, 'anna', 'anna@studio.pt', '  Dora@Studio.PT ', 'Anna’s team')
  assert.equal(team.name, 'Anna’s team')
  assert.equal(member.email, 'dora@studio.pt', 'emails are compared lower-case')
  assert.deepEqual(await teams.teammateIds(db, 'dora'), ['dora'], 'an invitation shares nothing until accepted')
  await assert.rejects(teams.inviteMember(db, 'anna', 'anna@studio.pt', 'dora@studio.pt', 'x'), /already/)
  await assert.rejects(teams.inviteMember(db, 'anna', 'anna@studio.pt', 'anna@studio.pt', 'x'), /already in your team/)
  await assert.rejects(teams.inviteMember(db, 'anna', 'anna@studio.pt', 'not-an-email', 'x'), /not valid/)
  // Only the account with that verified email can accept.
  await assert.rejects(teams.acceptInvitation(db, 'eve', { email: 'eve@x.pt', emailVerified: true }, member.id), /no longer open/)
  await assert.rejects(teams.acceptInvitation(db, 'dora', { email: 'dora@studio.pt', emailVerified: false }, member.id), /Verify/)
  const overviewBefore = await teams.teamOverview(db, 'dora', 'dora@studio.pt')
  assert.deepEqual(overviewBefore.invitations.map(i => i.team.owner), ['Anna Lopes'])
  await teams.acceptInvitation(db, 'dora', { email: 'dora@studio.pt', emailVerified: true }, member.id)
  assert.deepEqual((await teams.teammateIds(db, 'dora')).sort(), ['anna', 'dora'])
  assert.deepEqual((await teams.teammateIds(db, 'anna')).sort(), ['anna', 'dora'])
  const overview = await teams.teamOverview(db, 'anna', 'anna@studio.pt')
  assert.deepEqual(overview.team.members.map(m => [m.email, m.status, m.name]), [['dora@studio.pt', 'active', 'Dora']])
  assert.deepEqual((await teams.teamOverview(db, 'dora', 'dora@studio.pt')).memberships.map(m => m.name), ['Anna’s team'])
  // Leaving, or being removed, ends the sharing.
  await teams.leaveTeam(db, 'dora', team.id)
  assert.deepEqual(await teams.teammateIds(db, 'dora'), ['dora'])
  const again = await teams.inviteMember(db, 'anna', 'anna@studio.pt', 'dora@studio.pt', 'x')
  await teams.acceptInvitation(db, 'dora', { email: 'dora@studio.pt', emailVerified: true }, again.member.id)
  await teams.removeMember(db, 'anna', again.member.id)
  assert.deepEqual(await teams.teammateIds(db, 'anna'), ['anna'])
  await assert.rejects(teams.removeMember(db, 'dora', again.member.id), /no team/)
})

test('a team holds a limited number of people, keeps one team per owner and can be renamed or deleted', async () => {
  const db = teamDb()
  for (let i = 0; i < teams.TEAM_MAX_MEMBERS; i++) await teams.inviteMember(db, 'anna', 'anna@studio.pt', `p${i}@x.pt`, 'Team')
  await assert.rejects(teams.inviteMember(db, 'anna', 'anna@studio.pt', 'one-more@x.pt', 'Team'), /up to/)
  const first = await teams.ensureTeam(db, 'anna', 'Other name')
  assert.equal(first.name, 'Team', 'the existing team is kept')
  await teams.renameTeam(db, 'anna', '  Design   crew ')
  assert.equal((await teams.ownTeam(db, 'anna')).name, 'Design crew')
  await assert.rejects(teams.renameTeam(db, 'anna', '   '), /name/)
  const invite = (await teams.teamOverview(db, 'anna', 'anna@studio.pt')).team.members[0]
  await teams.declineInvitation(db, { email: invite.email }, invite.id)
  assert.equal((await teams.teamOverview(db, 'anna', 'anna@studio.pt')).team.members.length, teams.TEAM_MAX_MEMBERS - 1)
  await teams.deleteTeam(db, 'anna')
  assert.equal(await teams.ownTeam(db, 'anna'), null)
  assert.equal(db.tables.get('teamMembers').length, 0)
})
