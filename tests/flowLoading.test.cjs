const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')

function loadDataAccess(db, ensureMinimumBrandDesigns) {
  const source = stripTypeScriptTypes(fs.readFileSync('lib/data/flows.ts', 'utf8')
    .replace(/^import .*$/gm, '').replace(/export /g, ''))
  return new Function('cache', 'connectToMongo', 'ensureMinimumBrandDesigns',
    source + '; return { getFlows, getFlow }')(
    fn => fn, async () => db, ensureMinimumBrandDesigns)
}

test('flow selector reads only summaries without initializing every brand', async () => {
  const summary = { id: 'brand-a', name: 'Brand A', brandContext: { name: 'Brand A', logo: '/logo.png' } }
  const db = { collection: name => {
    assert.equal(name, 'flows')
    return { find: (query, options) => {
      assert.deepEqual(query, {})
      // Timestamps are read only to order brands by last use.
      assert.deepEqual(options.projection, { _id: 0, id: 1, name: 1, lastOpenedAt: 1, updatedAt: 1, createdAt: 1, 'brandContext.name': 1, 'brandContext.logo': 1, 'brandContext.logoVariants.originalTransparent': 1, 'brandContext.logoVariants.inkLightness': 1 })
      return { toArray: async () => [summary] }
    } }
  } }
  const { getFlows } = loadDataAccess(db, () => assert.fail('Selector must not initialize designs'))
  assert.deepEqual(await getFlows(), [summary])
})

test('selected brand keeps its full profile and initialized designs; missing brands return null', async () => {
  const flow = { _id: 'mongo-id', id: 'brand-a', brandContext: { about: 'Full business profile', colors: ['#123456'] } }
  const db = { collection: () => ({ findOne: async ({ id }) => id === flow.id ? flow : null }) }
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
