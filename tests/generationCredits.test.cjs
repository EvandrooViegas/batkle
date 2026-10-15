const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { stripTypeScriptTypes } = require('node:module')
const { fakeMongo, makeClock, loadAccount } = require('./billingAccount.test.cjs')

// How plan-post, resolve-assets and design-canvas charge for a post, run against the real billing code
// (lib/billing/account.ts) and an in-memory database. Brand limits on new brands are at the end.

const source = file => stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))
const response = { json: (body, init) => ({ body, status: init?.status || 200 }) }
const USER = 'user_1'
const quietConsole = { ...console, log() {}, info() {}, warn() {}, error() {} }

function world({ start = '2026-03-01T00:00:00Z' } = {}) {
  const clock = makeClock(start)
  const db = fakeMongo({ seed: { flows: [{ id: 'brand', ownerId: USER, brandContext: { name: 'Brand' } }] } })
  return { clock, db, billing: loadAccount(clock) }
}
const account = db => db.table('billingAccounts').find(a => a.id === USER)
const charges = db => db.table('creditCharges')
const subscribe = (billing, db, planId) => billing.applySubscription(db, USER, { planId, status: 'active', interval: 'month' })

// ─── PLAN ────────────────────────────────────────────────────────────────────

const slidesOf = copy => (copy.slides?.length ? copy.slides : [copy])
function planner(billing, { written } = {}) {
  const calls = { writeCopy: 0 }
  const deps = {
    NextResponse: response, corsify: r => r, randomUUID,
    loadGenerationBrandContext: async () => ({ id: 'brand', name: 'Brand' }),
    chooseBrandFamily: async () => null, DesignLibraryError: class extends Error {},
    studyForPlanning: () => ({}), familyGrammar: () => ({ compositions: [] }), familyImagery: () => ({ mode: 'none' }), familyPhotoLed: () => false, listItems: () => [],
    loadPostImages: async () => [], postImageIds: () => [], uploadPlanningBlock: () => '', assignUploads: slides => ({ slides }), ideaForCopy: idea => idea,
    writeCopy: async () => { calls.writeCopy++; return { copy: structuredClone(written || { format: 'single', headline: 'Fresh' }) } },
    copyErrorResponse: error => ({ body: { error: error.message }, status: error.status || 500 }),
    // One slot per slide, as planAssets makes them.
    planAssets: async (_db, { copy, idea }) => ({ post_id: idea.id, format: copy.format, slots: slidesOf(copy).map((_, i) => ({ slot_id: `slide_${i + 1}`, needs_visual: true })) }),
    billingError: billing.billingError, billingErrorBody: billing.billingErrorBody, chargeCredits: billing.chargeCredits, creditPeriod: billing.creditPeriod,
    creditsLeft: billing.creditsLeft, effectivePlan: billing.effectivePlan, loadBilling: billing.loadBilling, refundCharge: billing.refundCharge,
  }
  const handlers = new Function(...Object.keys(deps), source('lib/handlers/postPlanHandler.ts') + ';return { handlePlanPost, minimumSlides, postCredits }')(...Object.values(deps))
  return { ...handlers, calls }
}
const carousel = n => ({ format: 'carousel', slides: Array.from({ length: n }, (_, i) => ({ headline: `Slide ${i + 1}` })) })

test('planning a post charges one credit per slide and returns a charge reference of its own', async () => {
  const { db, billing } = world()
  const { handlePlanPost, calls } = planner(billing, { written: carousel(4) })
  const first = await handlePlanPost(db, { idea: { id: 'idea-1', topic: 'T' }, flowId: 'brand' }, USER)
  assert.equal(first.status, 200)
  assert.deepEqual(first.body.credits, { charged: 4, left: 26 })
  assert.match(first.body.chargeRef, /^post_[0-9a-f-]{36}$/)
  assert.equal(first.body.plan.post_id, 'idea-1', 'the plan still mirrors the idea')
  assert.deepEqual(charges(db).map(c => [c.ref, c.credits, c.status, c.reason]), [[first.body.chargeRef, 4, 'held', 'post']])
  // A rebuild of the same idea is a new charge with a new reference: plan.post_id repeats, so it cannot be the ref.
  const again = await handlePlanPost(db, { idea: { id: 'idea-1', topic: 'T' }, flowId: 'brand' }, USER)
  assert.notEqual(again.body.chargeRef, first.body.chargeRef)
  assert.equal(again.body.plan.post_id, first.body.plan.post_id)
  assert.equal(account(db).creditsUsed, 8)
  assert.equal(calls.writeCopy, 2)
})

test('re-planning kept copy writes nothing but still pays for the new images', async () => {
  const { db, billing } = world()
  const { handlePlanPost, calls } = planner(billing)
  const res = await handlePlanPost(db, { idea: { id: 'idea-1', topic: 'T' }, flowId: 'brand', copy: carousel(3) }, USER)
  assert.equal(res.status, 200)
  assert.equal(calls.writeCopy, 0)
  assert.deepEqual(res.body.credits, { charged: 3, left: 27 })
})

test('an account without enough credits is refused before the model is asked, with the error a charge gives', async () => {
  const { db, billing } = world()
  await billing.chargeCredits(db, USER, 30)
  const { handlePlanPost, calls } = planner(billing)
  const res = await handlePlanPost(db, { idea: { id: 'i', topic: 'T' } }, USER)
  const charged = await billing.chargeCredits(db, USER, 1).catch(e => billing.billingErrorBody(e))
  assert.equal(res.status, 402)
  assert.deepEqual(res.body, charged, 'the same message, code and details as chargeCredits')
  assert.equal(res.body.code, 'insufficient_credits')
  assert.equal(calls.writeCopy, 0, 'no model call is spent')

  // A slide count chosen for the idea, and kept copy, are known before writing.
  await billing.grantExtraCredits(db, USER, 3, { ref: 'cs_1' })
  const chosen = await handlePlanPost(db, { idea: { id: 'i', topic: 'T', format: 'carousel', slideCount: 5 } }, USER)
  assert.equal(chosen.status, 402)
  assert.deepEqual([chosen.body.needed, chosen.body.available, chosen.body.error], [5, 3, 'This needs 5 credits and you have 3 left. Buy extra credits or upgrade your plan to keep creating.'])
  assert.equal((await handlePlanPost(db, { idea: { id: 'i', topic: 'T' }, copy: carousel(4) }, USER)).body.needed, 4)
  assert.equal(calls.writeCopy, 0)
  assert.equal(charges(db).length, 1, 'only the setup charge')
})

test('a plan that comes out longer than the credits left is refused and takes nothing', async () => {
  const { db, billing } = world()
  await billing.chargeCredits(db, USER, 26)
  const { handlePlanPost, calls } = planner(billing, { written: carousel(6) })
  const res = await handlePlanPost(db, { idea: { id: 'i', topic: 'T' } }, USER)
  assert.equal(res.status, 402)
  assert.equal(res.body.error, 'This needs 6 credits and you have 4 left. Buy extra credits or upgrade your plan to keep creating.')
  assert.equal(calls.writeCopy, 1)
  assert.equal(account(db).creditsUsed, 26)
})

test('internal callers without an account plan for free, and slide counts are read safely', async () => {
  const { db, billing } = world()
  const { handlePlanPost, minimumSlides, postCredits } = planner(billing, { written: carousel(2) })
  const res = await handlePlanPost(db, { idea: { id: 'i', topic: 'T' } })
  assert.equal(res.status, 200)
  assert.equal(res.body.chargeRef, undefined)
  assert.equal(db.table('billingAccounts').length, 0)
  assert.equal(minimumSlides({ format: 'carousel', slideCount: 7 }), 7)
  assert.equal(minimumSlides({ format: 'single', slideCount: 7 }), 1)
  assert.equal(minimumSlides({ slideCount: 'lots' }), 1)
  assert.equal(minimumSlides({ slideCount: 9 }, { format: 'single', headline: 'x' }), 1, 'kept copy wins')
  assert.equal(minimumSlides({}, carousel(5)), 5)
  assert.equal(postCredits({ slots: [] }), 1)
  assert.equal(postCredits({ slots: [{}, {}, {}] }), 3)
})

// ─── VISUALS ─────────────────────────────────────────────────────────────────

function resolver(billing, { prepare } = {}) {
  const calls = { openai: 0, fallback: 0, saved: 0 }
  const resolverSource = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '../lib/handlers/assetResolverHandler.ts'), 'utf8').replace(/^import .*$/gm, '').replace(/export /g, ''))
  const context = {
    hasWatermarkMetadata: () => false, persistInlineImages: async (_db, value) => value,
    findGeneratedAsset: async () => null, saveGeneratedAsset: async () => { calls.saved++ },
    prepareSubjectAssets: prepare || (async (_db, plan) => plan),
    NextResponse: response, corsify: r => r, console: quietConsole, URL, Buffer, AbortSignal, process: { env: {} },
    fetch: async () => { throw Error('no network in tests') }, sharp: () => { throw Error('no images in tests') },
    billingErrorBody: billing.billingErrorBody, findCharge: billing.findCharge, imageQualityFor: billing.imageQualityFor, refundCharge: billing.refundCharge,
    openai: async () => { calls.openai++; return { source: 'ai_generated', url: `data:image/png;base64,openai${calls.openai}`, width: 1024, height: 1024 } },
    fallback: async () => { calls.fallback++; return { asset: { source: 'ai_generated', url: `data:image/png;base64,fal${calls.fallback}`, width: 1024, height: 1024 }, provider: 'fal', skipped: [] } },
  }
  const handlers = vm.runInNewContext(resolverSource + '\ngenerateImage = openai; generateFallbackImage = fallback;\n({ handleResolveAssets, NO_CHARGE })', context)
  return { ...handlers, calls }
}
const plan = n => ({ post_id: 'idea-1', format: n > 1 ? 'carousel' : 'single', slots: Array.from({ length: n }, (_, i) => ({ slot_id: `slide_${i + 1}`, slot_label: `Slide ${i + 1}`, needs_visual: true, preferred_source: 'ai_generated', treatment: 'isolated_subject', subject_description: 'a hand holding a phone' })) })

test('images are never made without the charge the plan made, and one charge pays for one set of images', async () => {
  const { db, billing } = world()
  const { handleResolveAssets, NO_CHARGE, calls } = resolver(billing)
  for (const body of [{ plan: plan(2) }, { plan: plan(2), chargeRef: 'post_unknown' }, { plan: plan(2), chargeRef: { $ne: null } }]) {
    const refused = await handleResolveAssets(db, body, USER)
    assert.deepEqual([refused.status, refused.body.error], [409, NO_CHARGE])
  }
  const charge = await billing.chargeCredits(db, USER, 2, { ref: 'post_a' })
  assert.equal((await handleResolveAssets(db, { plan: plan(3), chargeRef: 'post_a' }, USER)).status, 409, 'a plan with more slides than were paid for')
  assert.equal((await handleResolveAssets(db, { plan: plan(2), chargeRef: 'post_a' }, 'someone_else')).status, 409, 'another account’s charge')
  assert.equal(calls.openai + calls.fallback, 0)

  const ok = await handleResolveAssets(db, { plan: plan(2), chargeRef: 'post_a' }, USER)
  assert.equal(ok.status, 200)
  assert.equal(ok.body.slots.length, 2)
  assert.equal(calls.fallback, 2)
  assert.equal((await handleResolveAssets(db, { plan: plan(2), chargeRef: 'post_a' }, USER)).status, 409, 'the same charge cannot pay for images twice')
  assert.equal(calls.fallback, 2)
  assert.equal(charges(db).find(c => c.id === charge.id).status, 'held', 'still held for the build')

  await billing.refundCharge(db, USER, (await billing.chargeCredits(db, USER, 1, { ref: 'post_refunded' })).id)
  assert.equal((await handleResolveAssets(db, { plan: plan(1), chargeRef: 'post_refunded' }, USER)).status, 409, 'a refunded charge pays for nothing')
})

test('Free makes standard images without OpenAI; paid plans keep the high-quality model first', async () => {
  const { db, billing } = world()
  assert.equal(await billing.imageQualityFor(db, USER), 'standard')
  const free = resolver(billing)
  await billing.chargeCredits(db, USER, 2, { ref: 'post_free' })
  const standard = await free.handleResolveAssets(db, { plan: plan(2), chargeRef: 'post_free' }, USER)
  assert.deepEqual([free.calls.openai, free.calls.fallback], [0, 2])
  assert.ok(standard.body.slots.every(s => s.resolvedAsset && s.warning === null), 'a standard image is not a fallback to warn about')

  await subscribe(billing, db, 'pro')
  assert.equal(await billing.imageQualityFor(db, USER), 'high')
  const paid = resolver(billing)
  await billing.chargeCredits(db, USER, 2, { ref: 'post_pro' })
  const high = await paid.handleResolveAssets(db, { plan: plan(2), chargeRef: 'post_pro' }, USER)
  assert.deepEqual([paid.calls.openai, paid.calls.fallback], [2, 0])
  assert.match(high.body.slots[0].resolvedAsset.url, /openai/)
})

test('a failed request gives the credits back; a slide that falls back to no image is not a failure', async () => {
  const { db, billing } = world()
  const broken = resolver(billing, { prepare: async () => { throw Error('background removal crashed') } })
  await billing.chargeCredits(db, USER, 2, { ref: 'post_a' })
  const failed = await broken.handleResolveAssets(db, { plan: plan(2), chargeRef: 'post_a' }, USER)
  assert.equal(failed.status, 500)
  assert.equal(charges(db)[0].status, 'refunded')
  assert.equal(account(db).creditsUsed, 0)

  await billing.chargeCredits(db, USER, 1, { ref: 'post_b' })
  const res = await resolver(billing).handleResolveAssets(db, { plan: { ...plan(1), slots: [{ ...plan(1).slots[0], preferred_source: 'unsplash', treatment: 'environmental' }] }, chargeRef: 'post_b' }, USER)
  assert.equal(res.status, 200)
  assert.equal(res.body.slots[0].resolvedAsset, null, 'no stock key: the slide has no image')
  assert.equal(charges(db).find(c => c.ref === 'post_b').status, 'held', 'still paid for: the post is built without that image')
})

test('resolving without an account keeps today’s behaviour for internal callers', async () => {
  const { db, billing } = world()
  const { handleResolveAssets, calls } = resolver(billing)
  const res = await handleResolveAssets(db, { plan: plan(1) })
  assert.equal(res.status, 200)
  assert.deepEqual([calls.openai, calls.fallback], [1, 0], 'high quality, as before')
  assert.equal(db.table('billingAccounts').length, 0)
})

// ─── BUILD ───────────────────────────────────────────────────────────────────

function designer(billing, { render } = {}) {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const lib = (file, names) => vm.runInNewContext(stripTypeScriptTypes(read(file).replace(/^import .*$/gm, '').replace(/export /g, '')) + `\n({${names}})`)
  const calls = { render: 0 }
  const context = {
    ...lib('lib/designs/library.ts', 'DESIGN_LIBRARY,librarySpec,splitBulletItems'),
    ...lib('lib/designs/palettes.ts', 'PALETTE_PICKS,paletteColors,choosePalette,constrainBrandPalette'),
    ...lib('lib/designs/brandBlueprint.ts', 'blueprintSpec,complementaryAccent'),
    ...lib('lib/designs/postLayout.ts', 'arrangeReadableBody,backgroundCompositionForDesign,fitResolvedSlide,fitPlannedLayout,subjectOverlaps,parseDesignSequence,parseDesignBullets,planPostLayout'),
    chooseBrandFamily: async () => ({ family: { id: 'family' }, design: { id: 'global-design' } }),
    renderGlobalPost: render || ((_family, _brand, copy, resolvedPlan, _design, uuid) => { calls.render++; return { id: uuid(), type: 'single', nodes: [], slots: resolvedPlan.slots.length } }),
    ensureBrandLogoVariants: async () => null, canvasBrand: async () => ({}),
    persistInlineImages: async (_db, value) => value, prepareSubjectAssets: async (_db, p) => p, hydrateSubjectCrops: async (_db, p) => p,
    uuidv4: randomUUID, console: quietConsole, process: { env: {} }, NextResponse: response, corsify: r => r,
    findCharge: billing.findCharge, settleCharge: billing.settleCharge, refundCharge: billing.refundCharge,
  }
  const code = stripTypeScriptTypes(read('lib/handlers/canvasDesignerHandler.ts').replace(/^import .*$/gm, '').replace(/export async function/g, 'async function'))
  return { ...vm.runInNewContext(code + '\n({ handleDesignCanvas, handleSwitchDesign })', context), calls }
}
const resolved = n => ({ ...plan(n), slots: plan(n).slots.map(s => ({ ...s, resolvedAsset: null, warning: null })) })
const build = n => ({ brandContext: { id: 'brand' }, copy: n > 1 ? carousel(n) : { format: 'single', headline: 'H' }, resolvedPlan: resolved(n) })

test('building a post needs its charge, settles it when the post is made and gives it back when it fails', async () => {
  const { db, billing } = world()
  const { handleDesignCanvas, calls } = designer(billing)
  assert.equal((await handleDesignCanvas(db, build(2), true, USER)).status, 409, 'no charge')
  assert.equal((await handleDesignCanvas(db, { ...build(2), chargeRef: 'post_missing' }, true, USER)).status, 409)
  await billing.chargeCredits(db, USER, 2, { ref: 'post_a' })
  assert.equal((await handleDesignCanvas(db, { ...build(3), chargeRef: 'post_a' }, true, USER)).status, 409, 'more slides than were paid for')
  assert.equal(calls.render, 0)
  assert.equal(db.table('canvases').length, 0)

  const made = await handleDesignCanvas(db, { ...build(2), chargeRef: 'post_a' }, true, USER)
  assert.equal(made.status, 200)
  assert.equal(made.body.ownerId, USER)
  assert.equal(db.table('canvases').length, 1)
  assert.equal(charges(db)[0].status, 'settled')
  assert.equal(account(db).creditsUsed, 2)
  // A settled charge may build again (a retried request), and nothing is charged twice.
  assert.equal((await handleDesignCanvas(db, { ...build(2), chargeRef: 'post_a' }, true, USER)).status, 200)
  assert.equal(charges(db).length, 1)

  const broken = designer(billing, { render: () => { throw Error('layout failed') } })
  await billing.chargeCredits(db, USER, 1, { ref: 'post_b' })
  const failed = await broken.handleDesignCanvas(db, { ...build(1), chargeRef: 'post_b' }, true, USER)
  assert.equal(failed.status, 500)
  assert.equal(charges(db).find(c => c.ref === 'post_b').status, 'refunded')
  assert.equal(account(db).creditsUsed, 2, 'the failed post’s credit came back')
  const invalid = await designer(billing).handleDesignCanvas(db, { brandContext: {}, copy: null, resolvedPlan: resolved(1), chargeRef: (await billing.chargeCredits(db, USER, 1, { ref: 'post_c' })).ref }, true, USER)
  assert.equal(invalid.status, 400)
  assert.equal(charges(db).find(c => c.ref === 'post_c').status, 'refunded', 'a request that cannot build gives the credit back too')
})

test('switching a post’s design and internal previews never charge or need a charge', async () => {
  const { db, billing } = world()
  const { handleDesignCanvas, handleSwitchDesign, calls } = designer(billing)
  db.table('canvases').push({ id: 'old', name: 'Old post', ownerId: USER, designInput: build(3), designSelection: { paletteId: 'brand' } })
  const switched = await handleSwitchDesign(db, 'old', { designId: 'global-other' })
  assert.equal(switched.status, 200)
  assert.equal(calls.render, 1)
  assert.equal((await handleDesignCanvas(db, build(1), false, USER)).status, 200, 'a preview for an account')
  assert.equal((await handleDesignCanvas(db, build(1))).status, 200, 'an internal caller')
  assert.equal(db.table('billingAccounts').length, 0, 'billing is never read')
  assert.equal(charges(db).length, 0)
  assert.equal(db.table('canvases').length, 2, 'only the internal persisted build saved a canvas; switching saves nothing')
})

test('a whole post: 4 slides take 4 credits, held through the images and settled with the post', async () => {
  const { db, billing } = world()
  const planned = await planner(billing, { written: carousel(4) }).handlePlanPost(db, { idea: { id: 'idea-1', topic: 'T' }, flowId: 'brand' }, USER)
  const images = await resolver(billing).handleResolveAssets(db, { plan: planned.body.plan, brand_id: 'brand_brand', chargeRef: planned.body.chargeRef }, USER)
  assert.equal(images.status, 200)
  const post = await designer(billing).handleDesignCanvas(db, { brandContext: { id: 'brand' }, copy: planned.body.copy, resolvedPlan: images.body, chargeRef: planned.body.chargeRef }, true, USER)
  assert.equal(post.status, 200)
  assert.deepEqual(charges(db).map(c => [c.credits, c.status]), [[4, 'settled']])
  assert.deepEqual(billing.creditsLeft(account(db)), { monthly: 26, extra: 0, total: 26 })
})

// ─── Brand limits ────────────────────────────────────────────────────────────

function brandHandlers(billing) {
  const deps = {
    persistInlineImages: async (_db, value) => value, ensureMinimumBrandDesigns: async (_db, flow) => flow, withMinimumBrandDesigns: brand => brand,
    NextResponse: response, uuidv4: randomUUID, corsify: r => r, billingErrorBody: billing.billingErrorBody, requireBrandSlot: billing.requireBrandSlot,
  }
  const flows = new Function(...Object.keys(deps), source('lib/handlers/flowHandlers.ts') + ';return { handleCreateFlow, unfinishedBrand, billingResponse, onboardingMarker }')(...Object.values(deps))
  const research = { runs: 0 }
  const extractor = { extractBusinessInfo: async () => { research.runs++; return { name: 'Researched', about: 'About', designSystem: { colors: [], fonts: [] }, websiteImages: [] } } }
  const infoDeps = {
    NextResponse: response, corsify: r => r, generateLogoVariants: async () => null, importWebsiteImages: async () => ({ imported: 0 }), getBaseUrl: () => 'http://localhost',
    withMinimumBrandDesigns: brand => brand, randomUUID, persistInlineImages: async (_db, value) => value, extractor, console: quietConsole,
    billingResponse: flows.billingResponse, onboardingMarker: flows.onboardingMarker, unfinishedBrand: flows.unfinishedBrand, requireBrandSlot: billing.requireBrandSlot,
  }
  const code = source('lib/handlers/businessInfoHandler.ts').replace("await import('@/lib/business-info-extractor-complete')", 'extractor')
  const { handleExtractBusinessInfo } = new Function(...Object.keys(infoDeps), code + ';return { handleExtractBusinessInfo }')(...Object.values(infoDeps))
  return { ...flows, handleExtractBusinessInfo, research }
}
const brandWorld = flows => { const clock = makeClock(); return { db: fakeMongo({ seed: { flows } }), billing: loadAccount(clock) } }
const owned = db => db.table('flows').filter(f => f.ownerId === USER).map(f => f.id).sort()

test('a new brand needs a free brand slot; the 402 says how to get one', async () => {
  const { db, billing } = brandWorld([{ id: 'theirs', ownerId: 'someone_else' }])
  const { handleCreateFlow } = brandHandlers(billing)
  const first = await handleCreateFlow(db, { name: 'First' }, USER)
  assert.equal(first.status, 200)
  const second = await handleCreateFlow(db, { name: 'Second' }, USER)
  assert.equal(second.status, 402)
  assert.deepEqual(second.body, { error: 'Your Free plan includes 1 brand. Upgrade to Pro to add another, or delete a brand you no longer use.', code: 'limit_reached', limit: 'brands', max: 1, used: 1, requiredPlan: 'pro' })
  assert.deepEqual(owned(db), [first.body.id])
  await subscribe(billing, db, 'pro')
  assert.equal((await handleCreateFlow(db, { name: 'Second' }, USER)).status, 200)
})

test('researching a website for a new brand at the limit is refused before the research runs; re-researching a brand is not', async () => {
  const { db, billing } = brandWorld([{ id: 'mine', ownerId: USER, brandContext: { name: 'Mine' } }])
  const { handleExtractBusinessInfo, research } = brandHandlers(billing)
  const refused = await handleExtractBusinessInfo({ url: 'https://new.test', onboarding: true }, db, {}, USER)
  assert.deepEqual([refused.status, refused.body.code, refused.body.limit], [402, 'limit_reached', 'brands'])
  assert.equal(research.runs, 0, 'no research is spent on a brand that cannot be saved')
  const again = await handleExtractBusinessInfo({ url: 'https://mine.test', flowId: 'mine' }, db, {}, USER)
  assert.equal(again.status, 200)
  assert.equal(research.runs, 1)
  assert.deepEqual(owned(db), ['mine'])
})

test('onboarding may replace the brand it left unfinished without a free slot, and only that kind of brand', async () => {
  const { db, billing } = brandWorld([
    { id: 'draft', ownerId: USER, onboarding: { step: 'review' } },
    { id: 'theirs', ownerId: 'someone_else', onboarding: { step: 'review' } },
  ])
  const { handleExtractBusinessInfo, handleCreateFlow, research } = brandHandlers(billing)
  const replaced = await handleExtractBusinessInfo({ url: 'https://other.test', onboarding: true, replaces: 'draft' }, db, {}, USER)
  assert.equal(replaced.status, 200)
  assert.deepEqual(owned(db), [replaced.body.flow.id], 'the new brand took the unfinished one’s place')
  assert.deepEqual(replaced.body.flow.onboarding.step, 'review')

  // The replacement is unfinished too, so setting it up by hand may replace it in turn.
  const manual = await handleCreateFlow(db, { name: 'By hand', onboarding: { step: 'design', manual: true }, replaces: replaced.body.flow.id }, USER)
  assert.equal(manual.status, 200)
  assert.deepEqual(owned(db), [manual.body.id])

  // A finished brand, another account's brand or an unknown ID is no replacement.
  db.table('flows').find(f => f.id === manual.body.id).onboarding = null
  for (const replaces of [manual.body.id, 'theirs', 'missing']) {
    assert.equal((await handleExtractBusinessInfo({ url: 'https://x.test', replaces }, db, {}, USER)).status, 402, replaces)
    assert.equal((await handleCreateFlow(db, { name: 'X', replaces }, USER)).status, 402, replaces)
  }
  assert.equal(research.runs, 1)
  assert.deepEqual(owned(db), [manual.body.id])
  assert.ok(db.table('flows').some(f => f.id === 'theirs'), 'another account’s brand is never touched')
})
