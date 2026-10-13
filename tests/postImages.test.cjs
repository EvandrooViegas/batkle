const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { load, types, generation, study, compose } = require('./globalDesigns.test.cjs')

const images = load('lib/services/postImages.ts', ['postImageIds', 'loadPostImages', 'prepareIdeaImages', 'postImagesBlock', 'uploadPlanningBlock', 'assignUploads', 'ideaForCopy', 'MAX_POST_IMAGES'], { hydrateBrandFamilies: async () => [], familyImagery: study.familyImagery })
const planner = load('lib/handlers/postPlanHandler.ts', ['sanitizeDesignPlan', 'designPlanningPrompt', 'unplacedUploads'], { ...study, listItems: compose.listItems, ...images })

// A cutout-only study (shaped like the published "Deep Forest"): its own imagery is always cut out.
const STUDY = { personality: 'p', composition: 'c', spaceDensity: 's', typography: 't', colorContrast: 'cc', colorRoles: {}, decorative: 'd', hierarchy: 'h', logoPlacement: 'Small top-left anchor', distinctive: [], familyRules: [], variantRules: [], avoid: [] }
const forest = study.reconcileStudy(types.familySchema.parse({
  id: 'forest', schemaVersion: 1, version: 1, name: 'Forest', description: 'Dark field with a large subject.', tags: [], width: 1080, height: 1350,
  typography: { headingFallback: 'Inter', bodyFallback: 'Inter' }, referenceStyle: { primary: '#123b26', secondary: '#0b2a1a', accent: '#b6f23a', background: '#0b2a1a', textPrimary: '#ffffff' },
  referenceImages: [{ id: 'r1', url: '/api/uploads/ref-1', name: 'r1.png', width: 1080, height: 1350 }], analysis: '', variants: [],
  study: { ...STUDY, imagery: { mode: 'fullBleed', usage: 'Large photographic cutout that runs off the bottom and side edges', placement: 'bottom, full width', cropBehavior: 'full-bleed', frequency: 'some' },
    grammar: { compositions: ['statement', 'stacked', 'image-led', 'list', 'closing'], headline: { scale: 'large', weight: 'black' }, alignment: ['left'], anchors: ['top'], surfaces: ['dark'],
      imagery: { scale: 'dominant', positions: ['bottom', 'full'], shape: 'rect', overlap: 'text', dominance: 'dominates', overlay: 'none', frequency: 'some', tone: 'color' } } },
}))
const brand = { id: 'kachica', name: 'KACHICA', designTokens: { primary: '#a62800', accent: '#a62800', background: '#ffffff', textPrimary: '#111827' }, fonts: ['Oswald', 'Space Grotesk'] }
const photo = (n, description) => ({ id: `asset_photo${n}aaaa`, ref: `u${n}`, url: `/api/uploads/photo-${n}`, description })
const before = photo(1, 'A worn barbershop website on a phone, with a phone number to book.')
const after = photo(2, 'A modern barbershop website with an online booking calendar.')

test('photo ids are validated: unique, valid uploads, at most four', () => {
  assert.deepEqual(images.postImageIds(undefined), [])
  assert.deepEqual(images.postImageIds(['asset_abc12345', 'asset_def67890']), ['asset_abc12345', 'asset_def67890'])
  assert.throws(() => images.postImageIds(['asset_abc12345', 'asset_abc12345']), /only once/)
  assert.throws(() => images.postImageIds(['asset_a1b2c3d4', 'asset_b1b2c3d4', 'asset_c1b2c3d4', 'asset_d1b2c3d4', 'asset_e1b2c3d4']), /up to 4 photos/)
  assert.throws(() => images.postImageIds(['https://evil.example/x.png']), /not a valid upload/)
  assert.throws(() => images.postImageIds('asset_abc12345'), e => e.status === 400)
})

test('photos load in the order added, only from this brand, and never from another post', async () => {
  const docs = [
    { id: 'asset_two22222', brand_id: 'brand_k', source: 'post_upload', url: '/u/2', search_description: 'after' },
    { id: 'asset_one11111', brand_id: 'brand_k', source: 'post_upload', url: '/u/1', description: 'before' },
    { id: 'asset_used3333', brand_id: 'brand_k', source: 'post_upload', url: '/u/3', reserved_for: 'idea-other' },
  ]
  const db = { collection: () => ({ find: query => ({ toArray: async () => docs.filter(d => query.id.$in.includes(d.id) && d.brand_id === query.brand_id && d.source === query.source) }) }) }
  const loaded = await images.loadPostImages(db, 'k', ['asset_one11111', 'asset_two22222'])
  assert.deepEqual(loaded.map(i => [i.ref, i.id, i.description]), [['u1', 'asset_one11111', 'before'], ['u2', 'asset_two22222', 'after']])
  await assert.rejects(images.loadPostImages(db, 'k', ['asset_used3333']), e => e.status === 409 && /already used in another post/.test(e.message))
  assert.equal((await images.loadPostImages(db, 'k', ['asset_used3333'], 'idea-other'))[0].id, 'asset_used3333', 'the post that owns a photo may rebuild with it')
  await assert.rejects(images.loadPostImages(db, 'other', ['asset_one11111']), /no longer available/)
})

test('a brand whose designs are all typography-only is told before any idea is written', async () => {
  const db = { collection: () => ({ find: () => ({ toArray: async () => [{ id: 'asset_one11111', brand_id: 'brand_k', source: 'post_upload', url: '/u/1' }] }) }) }
  const typeOnly = { family: { study: { imagery: { mode: 'none' } }, variants: [] } }
  const strict = load('lib/services/postImages.ts', ['prepareIdeaImages'], { hydrateBrandFamilies: async () => [typeOnly], familyImagery: study.familyImagery })
  await assert.rejects(strict.prepareIdeaImages(db, { id: 'k' }, ['asset_one11111']), e => e.status === 422 && /typography only/.test(e.message))
  const pictured = load('lib/services/postImages.ts', ['prepareIdeaImages'], { hydrateBrandFamilies: async () => [typeOnly, { family: forest }], familyImagery: study.familyImagery })
  assert.equal((await pictured.prepareIdeaImages(db, { id: 'k' }, ['asset_one11111'])).length, 1)
})

test('each photo lands on exactly one slide: the plan is kept, repeats are removed, missed photos are placed, lists are skipped', () => {
  const slides = [
    { headline: 'Cover', design: { composition: 'statement', image: { subject: 'phone' } } },
    { headline: 'Before', design: { composition: 'image-led', image: { upload: 'u1' } } },
    { headline: 'Again', design: { composition: 'stacked', image: { upload: 'u1' } } },
    { headline: 'Steps', body: '1. Um\n2. Dois\n3. Três', design: { composition: 'list', image: null } },
  ]
  const isList = s => compose.listItems(s).length >= 3
  const { slides: out, unplaced } = images.assignUploads(slides, [before, after], ['statement', 'stacked', 'image-led', 'list'], isList)
  assert.equal(out[1].design.image.upload, before.id, 'the planned photo stays on its slide')
  assert.equal(out[2].design.image.upload, after.id, 'a repeated photo is removed, and the missed photo goes to the slide that asked for one')
  assert.equal(out[2].design.composition, 'stacked', 'an image composition the plan chose is kept')
  assert.equal(out[0].design.image.upload, undefined, 'a slide that only wanted a generated image keeps it')
  const lone = images.assignUploads([{ headline: 'Cover', design: { composition: 'statement', image: { subject: 'phone' } } }, { headline: 'Text', design: { composition: 'statement', image: null } }], [after], ['statement', 'image-led'])
  assert.equal(lone.slides[0].design.image.upload, after.id, 'otherwise a slide that already wanted an image is preferred')
  assert.equal(lone.slides[0].design.composition, 'image-led', 'a photo slide always gets an image composition')
  assert.equal(out[3].design.image, null, 'a list slide never receives a photo')
  assert.deepEqual(unplaced, [])
  const ids = out.map(s => s.design?.image?.upload).filter(Boolean)
  assert.equal(new Set(ids).size, ids.length, 'no photo appears twice')
  assert.deepEqual(images.assignUploads([{ headline: 'Only', design: {} }], [before, after], ['image-led']).unplaced.map(i => i.id), [after.id], 'more photos than slides are reported, not doubled up')
  assert.equal(images.assignUploads(slides, [before], ['statement', 'list']).unplaced.length, 1, 'a study without image compositions cannot place photos')
})

test('in a cutout-only study the user photos stay photographs, one per slide, and render once each', () => {
  const copy = { format: 'carousel', slides: [
    { headline: 'Da chamada à reserva', body: 'O novo site da Barber PH.', design: { composition: 'statement', image: { subject: 'barber chair' } } },
    { headline: 'Antes', body: 'Marcações só por telefone.', design: { composition: 'stacked', image: { upload: 'u1' } } },
    { headline: 'Depois', body: 'Agenda online em segundos.', design: { composition: 'image-led', image: { upload: 'u1' } } },
    { headline: 'Fale connosco', body: 'Veja a diferença.', cta: 'Fale connosco', design: { composition: 'closing', image: null } },
  ] }
  const planned = planner.sanitizeDesignPlan(forest, copy, [], [before, after])
  const uploads = planned.slides.map(s => s.design.image?.upload || null)
  assert.equal(uploads.filter(Boolean).length, 2)
  assert.equal(uploads[1], before.id)
  assert.equal(uploads[2], after.id, 'the repeated "before" photo was replaced by the missed "after" photo on the after slide')
  const layout = generation.globalLayoutPlan(forest, 'global-forest', planned, brand)
  const photoSlots = layout.slots.filter(s => s.planned?.upload)
  assert.equal(photoSlots.length, 2)
  for (const slot of photoSlots) {
    assert.equal(slot.needs_visual, true)
    assert.equal(slot.treatment, 'environmental', 'a user photo is never cut out')
    assert.notEqual(slot.imageMode, 'cutout')
  }
  const urls = Object.fromEntries([before, after].map(i => [i.id, i.url]))
  const resolved = { slots: layout.slots.map(s => ({ slot_id: s.slot_id, treatment: s.treatment, resolvedAsset: s.planned?.upload ? { source: 'uploaded_asset', url: urls[s.planned.upload], width: 1600, height: 1200 } : null })) }
  const post = generation.renderGlobalPost(forest, brand, planned, resolved, { id: 'global-forest' }, crypto.randomUUID)
  const shown = post.pages.flatMap(p => p.nodes.filter(n => n.type === 'image' && [before.url, after.url].includes(n.src)).map(n => n.src))
  assert.deepEqual(shown.sort(), [before.url, after.url].sort(), 'each photo appears in the post exactly once')
})

test('a photo slide keeps its photo even when its copy reads as a list', () => {
  const copy = { format: 'carousel', slides: [
    { headline: 'Capa', body: 'Texto.', design: { composition: 'statement', image: null } },
    { headline: 'O que mudou', body: '1. Reservas online\n2. Lembretes\n3. Menos chamadas', design: { composition: 'image-led', image: { upload: before.id, subject: before.description } } },
  ] }
  const plans = compose.planSlides(forest, copy)
  assert.equal(plans[1].withImage, true)
  assert.notEqual(plans[1].composition, 'list')
  assert.equal(plans[1].cutout, false)
})

test('the planner is told which photo goes where, and the copywriter sees what the photos show', () => {
  const prompt = planner.designPlanningPrompt(forest, [], [before, after])
  assert.match(prompt, /THE USER'S PHOTOS/)
  assert.match(prompt, /u1 = "A worn barbershop website/)
  assert.match(prompt, /exactly one slide; never repeat a photo/)
  assert.match(prompt, /\{"upload": "<user photo ref>"\}/)
  assert.doesNotMatch(planner.designPlanningPrompt(forest), /USER'S PHOTOS/)
  const brief = images.ideaForCopy({ topic: 'T', images: [{ id: before.id, url: before.url }] }, [before])
  assert.equal(brief.images, undefined, 'file links never reach the copywriter')
  assert.match(brief.userPhotos[0], /u1: A worn barbershop website/)
  assert.match(images.postImagesBlock([before, after]), /Use format "carousel"/)
  assert.deepEqual(planner.unplacedUploads({ slots: [{ user_upload: true, selected: { asset_id: before.id } }] }, [before, after]).map(i => i.id), [after.id])
})

// The content-ideas handler with a fake model and an in-memory brand: what it asks for, and what it reserves.
function ideasHandler({ outputs, assets = [], families = [{ family: forest }] }) {
  const fs = require('node:fs')
  const { stripTypeScriptTypes } = require('node:module')
  const src = path => stripTypeScriptTypes(fs.readFileSync(path, 'utf8').replace(/^import .*$/gm, '').replace(/export /g, ''))
  const helpers = new Function('hydrateBrandFamilies', 'familyImagery', src('lib/services/contentLanguage.ts') + src('lib/services/contentAngles.ts') + src('lib/services/ideaRequest.ts') + src('lib/services/postImages.ts') + src('lib/services/copyFacts.ts')
    + ';return {postLanguage,readSlideCount,slideCountRule,fitOutline,readLanguageChoice,lengthOf,contentLanguage,languageIssues,copyTexts,chooseAngle,ideaHistory,topicSimilarity,readIdeaRequest,ideaRequestBlock,formatRule,finalFormat,IDEA_REQUEST_RULE,postImageIds,prepareIdeaImages,postImagesBlock,inventedFigures,ideaOutline,outlineIssue,recurringSubjects,mentionsSubject,chooseCarouselLength,CAROUSEL_LENGTHS}')(async () => families, study.familyImagery)
  const requests = [], updates = []
  const brandProfile = { id: 'k', name: 'KACHICA', language: 'Portuguese', website: 'https://www.kachica.pt/', about: 'Digital marketing agency.', services: ['Website Development — Conversion-focused sites.'], projects: [{ name: 'Barber PH', description: 'Website with booking.' }] }
  const db = { collection: name => name === 'assets'
    ? { find: query => ({ toArray: async () => assets.filter(a => query.id.$in.includes(a.id) && a.brand_id === query.brand_id && a.source === query.source) }),
        updateMany: async (filter, change) => { updates.push([filter, change]); const hit = assets.filter(a => filter.id.$in.includes(a.id) && !a.reserved_for); hit.forEach(a => { a.reserved_for = change.$set.reserved_for }); return { modifiedCount: hit.length } } }
    : { findOne: async () => ({ brandContext: brandProfile }) } }
  const completion = async (_client, request) => { requests.push(request); return { choices: [{ message: { content: JSON.stringify(outputs.shift()) }, finish_reason: 'stop' }] } }
  const run = new Function('Groq', 'process', 'loadGenerationBrandContext', 'EXTRACTED_CONTEXT_RULES', 'compactBrand', 'NextResponse', 'corsify', 'randomUUID', 'retrySeconds', 'availableGroqCompletion', ...Object.keys(helpers), src('lib/handlers/contentIdeasHandler.ts') + ';return handleGenerateContentIdeas')(
    class {}, { env: { GROQ_API_KEY: 'test' } }, async () => ({ ...brandProfile }), '', x => x,
    { json: (body, options) => ({ body, status: options?.status || 200 }) }, r => r, () => 'fixed', () => 60, completion, ...Object.values(helpers))
  return { requests, updates, run: body => run(body, db) }
}
const uploadDoc = (id, description) => ({ id, brand_id: 'brand_k', source: 'post_upload', url: `/api/uploads/${id}`, thumbnail_url: `/api/uploads/t-${id}`, search_description: description, width: 1600, height: 1200 })
const brief = { ideas: [{ topic: 'Antes e depois do site da Barber PH', hook: 'Da chamada à reserva online', coreMessage: 'Um caso real da KACHICA.', format: 'single', outline: ['Capa: da chamada à reserva online', 'Antes: reservas por telefone', 'Depois: reserva online', 'O que muda para o cliente'] }] }

test('attached photos shape the idea: described in the prompt, a carousel for several, returned with the idea and reserved for it', async () => {
  const assets = [uploadDoc('asset_before111', 'A phone showing an old booking page.'), uploadDoc('asset_after2222', 'A laptop showing a new online booking calendar.')]
  const h = ideasHandler({ outputs: [structuredClone(brief)], assets })
  const result = await h.run({ flowId: 'k', userIdea: 'Before and after of the Barber PH website', format: 'auto', images: ['asset_before111', 'asset_after2222'] })
  assert.equal(result.status, 200)
  const prompt = h.requests[0].messages[1].content
  assert.match(prompt, /THE USER'S PHOTOS[\s\S]*u1: "A phone showing an old booking page\."[\s\S]*u2: "A laptop showing a new online booking calendar\."/)
  assert.match(prompt, /- Format: carousel \(required: the user attached several photos\)/)
  const idea = result.body.ideas[0]
  assert.equal(idea.format, 'carousel', 'several photos always make a carousel')
  assert.deepEqual(idea.images.map(i => i.id), ['asset_before111', 'asset_after2222'])
  assert.equal(idea.images[0].ref, undefined, 'prompt refs are not stored')
  assert.ok(assets.every(a => a.reserved_for === idea.id), 'both photos now belong to this idea')
})

test('photos are refused when they cannot be used: a single post with several, a photo another idea took, or more than four', async () => {
  const assets = [uploadDoc('asset_before111', 'old'), uploadDoc('asset_after2222', 'new')]
  const single = await ideasHandler({ outputs: [structuredClone(brief)], assets }).run({ flowId: 'k', format: 'single', images: ['asset_before111', 'asset_after2222'] })
  assert.equal(single.status, 400)
  assert.match(single.body.error, /single post shows one photo/)
  const taken = ideasHandler({ outputs: [structuredClone(brief)], assets: [{ ...uploadDoc('asset_before111', 'old'), reserved_for: 'idea-other' }] })
  const conflict = await taken.run({ flowId: 'k', images: ['asset_before111'] })
  assert.equal(conflict.status, 409)
  assert.equal(taken.requests.length, 0, 'no AI call is spent on photos that cannot be used')
  const five = await ideasHandler({ outputs: [] }).run({ flowId: 'k', images: ['asset_a1b2c3d4', 'asset_b1b2c3d4', 'asset_c1b2c3d4', 'asset_d1b2c3d4', 'asset_e1b2c3d4'] })
  assert.equal(five.status, 400)
  const typeOnly = await ideasHandler({ outputs: [structuredClone(brief)], assets: [uploadDoc('asset_before111', 'old')], families: [{ family: { study: { imagery: { mode: 'none' } }, variants: [] } }] }).run({ flowId: 'k', images: ['asset_before111'] })
  assert.equal(typeOnly.status, 422)
})

test('a photo-only suggestion is built around the photo instead of a code-chosen angle', async () => {
  const h = ideasHandler({ outputs: [structuredClone(brief)], assets: [uploadDoc('asset_team33333', 'The team around a laptop in the office.')] })
  const result = await h.run({ flowId: 'k', images: ['asset_team33333'] })
  assert.equal(result.status, 200)
  assert.doesNotMatch(h.requests[0].messages[1].content, /ANGLE FOR THIS IDEA/)
  assert.match(h.requests[0].messages[1].content, /u1: "The team around a laptop in the office\."/)
  assert.equal(result.body.ideas[0].format, 'single', 'one photo may stay a single post')
})
