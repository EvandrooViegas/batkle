const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')

const load = file => stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))

function fakeDb(docs) {
  const updates = []
  return {
    updates,
    collection: () => ({
      find: () => ({ toArray: async () => docs.map(d => ({ _id: 'x', ...d })) }),
      updateOne: async (filter, update) => {
        updates.push({ filter, update })
        return { matchedCount: docs.some(d => d.id === filter.id) ? 1 : 0 }
      },
    }),
  }
}

const flowsModule = db => new Function('cache', 'connectToMongo', 'ensureMinimumBrandDesigns', 'currentUserId', load('lib/data/flows.ts') + ';return {getFlows,lastUsedAt}')(f => f, async () => db, x => x, async () => 'user_1')

test('brands are listed most recently used first, so /app opens the last one used', async () => {
  const db = fakeDb([
    { id: 'old', createdAt: new Date('2026-01-01') },
    { id: 'opened-yesterday', lastOpenedAt: new Date('2026-10-07'), updatedAt: new Date('2026-09-01') },
    { id: 'opened-today', lastOpenedAt: new Date('2026-10-08T09:00:00Z'), createdAt: new Date('2026-02-01') },
    { id: 'edited-last-week', updatedAt: new Date('2026-10-01') },
  ])
  const flows = await flowsModule(db).getFlows()
  assert.deepEqual(flows.map(f => f.id), ['opened-today', 'opened-yesterday', 'edited-last-week', 'old'])
  // Timestamps are only used for ordering; the client never receives them.
  for (const flow of flows) for (const key of ['_id', 'lastOpenedAt', 'updatedAt', 'createdAt']) assert.equal(key in flow, false)
})

test('a brand without any timestamp sorts last instead of breaking the order', () => {
  const { lastUsedAt } = flowsModule(fakeDb([]))
  assert.equal(lastUsedAt({}), 0)
  assert.equal(lastUsedAt({ lastOpenedAt: 'not a date' }), 0)
  assert.equal(lastUsedAt({ lastOpenedAt: new Date('2026-10-08'), updatedAt: new Date('2026-10-09') }), new Date('2026-10-08').getTime())
})

test('opening a brand records lastOpenedAt without touching updatedAt', async () => {
  const handlers = new Function('persistInlineImages', 'ensureMinimumBrandDesigns', 'withMinimumBrandDesigns', 'NextResponse', 'uuidv4', 'corsify',
    load('lib/handlers/flowHandlers.ts') + ';return {handleFlowOpened}')(x => x, (_, f) => f, x => x, { json: (body, init) => ({ body, status: init?.status || 200 }) }, () => 'id', x => x)
  const db = fakeDb([{ id: 'brand' }])
  const ok = await handlers.handleFlowOpened(db, 'brand')
  assert.equal(ok.status, 200)
  assert.deepEqual(Object.keys(db.updates[0].update.$set), ['lastOpenedAt'])
  assert.ok(db.updates[0].update.$set.lastOpenedAt instanceof Date)
  assert.equal((await handlers.handleFlowOpened(db, 'missing')).status, 404)
})
