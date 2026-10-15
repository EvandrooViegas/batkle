const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')

// `userId` is the signed-in account (null when signed out); brands belong to the account in their `ownerId`.
function loadDataAccess(db, ensureMinimumBrandDesigns, userId = 'user_1') {
  const source = stripTypeScriptTypes(fs.readFileSync('lib/data/flows.ts', 'utf8')
    .replace(/^import .*$/gm, '').replace(/export /g, ''))
  return new Function('cache', 'connectToMongo', 'ensureMinimumBrandDesigns', 'currentUserId',
    source + '; return { getFlows, getFlow }')(
    fn => fn, async () => db, ensureMinimumBrandDesigns, async () => userId)
}

test('flow selector reads only summaries without initializing every brand', async () => {
  const summary = { id: 'brand-a', name: 'Brand A', brandContext: { name: 'Brand A', logo: '/logo.png' } }
  const db = { collection: name => {
    assert.equal(name, 'flows')
    return { find: (query, options) => {
      // Only the signed-in account's own brands.
      assert.deepEqual(query, { ownerId: 'user_1' })
      // Timestamps are read only to order brands by last use; the onboarding step marks a brand left unfinished.
      assert.deepEqual(options.projection, { _id: 0, id: 1, name: 1, lastOpenedAt: 1, updatedAt: 1, createdAt: 1, 'brandContext.name': 1, 'brandContext.logo': 1, 'brandContext.logoVariants.originalTransparent': 1, 'brandContext.logoVariants.inkLightness': 1, 'onboarding.step': 1 })
      return { toArray: async () => [summary] }
    } }
  } }
  const { getFlows } = loadDataAccess(db, () => assert.fail('Selector must not initialize designs'))
  assert.deepEqual(await getFlows(), [summary])
})

test('selected brand keeps its full profile and initialized designs; missing brands return null', async () => {
  const flow = { _id: 'mongo-id', id: 'brand-a', ownerId: 'user_1', brandContext: { about: 'Full business profile', colors: ['#123456'] } }
  const db = { collection: () => ({ findOne: async ({ id, ownerId }) => id === flow.id && ownerId === flow.ownerId ? flow : null }) }
  let initialized = 0
  const { getFlow } = loadDataAccess(db, async (database, selected) => {
    assert.equal(database, db)
    initialized++
    return { ...selected, brandContext: { ...selected.brandContext, designs: [{ id: 'starter' }] } }
  })
  assert.deepEqual(await getFlow('brand-a'), { id: flow.id, brandContext: { ...flow.brandContext, designs: [{ id: 'starter' }] } })
  assert.equal(await getFlow('missing'), null)
  assert.equal(initialized, 1)
})

test('a brand owned by another account reads as missing, and signed-out visitors get no brands at all', async () => {
  const flow = { _id: 'mongo-id', id: 'brand-a', ownerId: 'user_1', brandContext: { name: 'Brand A' } }
  const db = { collection: () => ({ findOne: async ({ id, ownerId }) => id === flow.id && ownerId === flow.ownerId ? flow : null }) }
  const other = loadDataAccess(db, async (_, selected) => selected, 'user_2')
  assert.equal(await other.getFlow('brand-a'), null)

  const untouched = { collection: () => assert.fail('Signed-out requests must not query brands') }
  const signedOut = loadDataAccess(untouched, () => assert.fail('Signed-out requests must not load brands'), null)
  assert.deepEqual(await signedOut.getFlows(), [])
  assert.equal(await signedOut.getFlow('brand-a'), null)
})
