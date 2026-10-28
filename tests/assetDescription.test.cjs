const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const load = path => stripTypeScriptTypes(fs.readFileSync(path, 'utf8').replace(/^import .*$/gm, '').replace(/export /g, ''))

test('multilingual descriptions are preserved and indexed once with no automatic retries', async () => {
  const requests = []
  class Groq {
    constructor(options) {
      assert.equal(options.maxRetries, 0)
      this.chat = { completions: { create: async body => {
        requests.push(body)
        assert.equal(body.model, 'qwen/qwen3.8-27b')
        return { choices: [{ message: { content: JSON.stringify({ description_en: 'Wheat field at harvest', tags_en: ['wheat', 'field', 'harvest'] }) } }] }
      } } }
    }
  }
  const { indexAssetDescription } = new Function('Groq', 'process', load('lib/services/assetDescription.ts') + ';return {indexAssetDescription}')(Groq, { env: { GROQ_API_KEY: 'test' } })
  for (const description of ['Campo de trigo na colheita', 'حقل قمح عند الحصاد', '収穫時の小麦畑']) {
    const result = await indexAssetDescription(description)
    assert.equal(result.description, description)
    assert.equal(JSON.parse(requests.at(-1).messages[1].content).description, description)
    assert.equal(result.search_description, 'Wheat field at harvest')
    assert.deepEqual(result.description_tags, ['wheat', 'field', 'harvest'])
  }
  assert.equal(requests.length, 3)
  assert.deepEqual(await indexAssetDescription('  '), { description: '', search_description: '', description_tags: [] })
  await assert.rejects(indexAssetDescription('x'.repeat(2001)))
  assert.equal(requests.length, 3)
})

test('description indexing errors do not trigger another model call', async () => {
  let calls = 0
  class Groq { constructor() { this.chat = { completions: { create: async () => { calls++; return { choices: [{ message: { content: '{}' } }] } } } } } }
  const index = new Function('Groq', 'process', load('lib/services/assetDescription.ts') + ';return indexAssetDescription')(Groq, { env: { GROQ_API_KEY: 'test' } })
  await assert.rejects(index('Uma imagem'), /could not be indexed/)
  assert.equal(calls, 1)
})

test('an explicit description model is honored and access errors never trigger model switching', async () => {
  const requests = []
  const denied = Object.assign(new Error('Model unavailable'), { status: 404, code: 'model_not_found' })
  class Groq { constructor(options) {
    assert.equal(options.maxRetries, 0)
    this.chat = { completions: { create: async body => { requests.push(body); throw denied } } }
  } }
  const index = new Function('Groq', 'process', load('lib/services/assetDescription.ts') + ';return indexAssetDescription')(Groq, { env: { GROQ_API_KEY: 'test', GROQ_DESCRIPTION_MODEL: ' custom-model ' } })
  await assert.rejects(index('Campo de trigo'), error => error === denied)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].model, 'custom-model')
})

test('description editing is brand scoped, avoids unchanged reindexing, and supports clearing', async () => {
  let calls = 0
  let asset = { _id: 'internal', id: 'a', brand_id: 'brand-a', tags: ['original'] }
  const db = { collection: () => ({
    findOne: async filter => filter.id === asset.id && filter.brand_id === asset.brand_id ? asset : null,
    updateOne: async (filter, update) => { assert.equal(filter.brand_id, 'brand-a'); asset = { ...asset, ...update.$set } }
  }) }
  const index = async description => { calls++; return { description, search_description: description ? 'wheat field' : '', description_tags: description ? ['wheat', 'field'] : [] } }
  const handle = new Function('NextResponse', 'corsify', 'indexAssetDescription', load('lib/handlers/assetHandlers.ts') + ';return handleUpdateAsset')({ json: (body, options) => ({ body, status: options?.status || 200 }) }, r => r, index)
  assert.equal((await handle(db, 'a', { brand_id: 'other', description: 'Campo' })).status, 404)
  assert.equal(calls, 0)
  const saved = await handle(db, 'a', { brand_id: 'brand-a', description: 'Campo' })
  assert.equal(saved.body.description, 'Campo')
  assert.deepEqual(saved.body.tags, ['original'])
  assert.equal(saved.body._id, undefined)
  await handle(db, 'a', { brand_id: 'brand-a', description: 'Campo' })
  assert.equal(calls, 1)
  const cleared = await handle(db, 'a', { brand_id: 'brand-a', description: '' })
  assert.deepEqual(cleared.body.description_tags, [])
  assert.equal(cleared.body.search_description, '')
  assert.equal((await handle(db, 'a', { brand_id: 'brand-a', description: 4 })).status, 400)
})

test('the owner’s description of a gallery cutout becomes the subject it is matched by, in English', async () => {
  let asset = { id: 'c', brand_id: 'brand-a', source: 'ai_generated', description: 'Generated subject', subject_description: 'Generated subject' }
  const db = { collection: () => ({
    findOne: async filter => filter.id === asset.id && filter.brand_id === asset.brand_id ? asset : null,
    updateOne: async (filter, update) => { asset = { ...asset, ...update.$set } },
  }) }
  const index = async description => ({ description, search_description: description ? 'Hard hat on rolled blueprints' : '', description_tags: description ? ['hard hat', 'blueprints'] : [] })
  const handle = new Function('NextResponse', 'corsify', 'indexAssetDescription', load('lib/handlers/assetHandlers.ts') + ';return handleUpdateAsset')({ json: (body, options) => ({ body, status: options?.status || 200 }) }, r => r, index)
  const saved = await handle(db, 'c', { brand_id: 'brand-a', description: 'Capacete sobre plantas enroladas' })
  assert.deepEqual([saved.body.description, saved.body.subject_description], ['Capacete sobre plantas enroladas', 'Hard hat on rolled blueprints'])
  await handle(db, 'c', { brand_id: 'brand-a', description: '' })
  assert.equal(asset.subject_description, 'Hard hat on rolled blueprints', 'clearing the words keeps the subject it is matched by')
})

test('planning never searches the brand’s images for photos: only a photo attached to the idea fills a slot', async () => {
  const brief = layout => ({ slot_id: layout.slot_id, needs_visual: true, preferred_source: 'unsplash', search_keywords: ['facade', 'restoration'] })
  const handle = new Function('localAssetBrief', 'NextResponse', 'corsify', ('const chooseBrandFamily = async () => null;\n' + load('lib/handlers/assetPlannerHandler.ts')) + ';return handlePlanAssets')(brief, { json: body => body }, r => r)
  const db = { collection: name => {
    assert.equal(name, 'flows', 'the asset library is never read')
    return { findOne: async () => ({ brandContext: {} }) }
  } }
  const slots = [1, 2].map(i => ({ slot_id: `slide_${i}`, needs_visual: true, treatment: 'environmental', background: true }))
  const upload = { id: 'asset_photo1aaaa', url: '/api/uploads/photo', thumbnail_url: '/api/uploads/thumb', description: 'A restored facade' }
  const result = await handle(db, { brandContext: { id: 'flow-a' }, copy: { slides: [{}, {}] }, idea: {}, uploads: [upload], layoutPlan: { slots } })
  assert.deepEqual(result.slots.map(slot => [slot.preferred_source, slot.selected?.asset_id ?? null, Boolean(slot.user_upload)]), [['uploaded_asset', upload.id, true], ['unsplash', null, false]])
  assert.equal(result.slots[0].subject_description, 'A restored facade')
  assert.deepEqual(result.slots[1].candidates, [])
})
