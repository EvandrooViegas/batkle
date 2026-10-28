const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createHash } = require('node:crypto')
const { stripTypeScriptTypes } = require('node:module')

const load = file => stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))
const NAMES = 'MAX_BRAND_POSTS,MAX_SLIDES,CAPTION_LIMIT,uploadIdOf,slidesOf,readBrandPosts,onlyRemoves,voiceBasis,ownPostsVoice,postsForVoice,copiedQuotes,readVoice,readPostImage,learnPostVoice,updateBrandPosts'

/**
 * The service with its imports stood in for: model calls are recorded. `read` answers each image read (a list of
 * blocks, or a function of the call number that returns one or throws).
 */
function service({ upload = { bytes: Buffer.from('img'), contentType: 'image/png' }, read = ['Obras sem  surpresas', 'Peça já o seu orçamento', ''], note, fail } = {}) {
  const calls = { read: 0, learn: 0, prompts: [] }
  const sharp = () => ({ rotate: () => ({ resize: () => ({ jpeg: () => ({ toBuffer: async () => Buffer.from('jpeg') }) }) }) })
  const budgetedCompletion = async () => {
    const n = calls.read++
    const blocks = typeof read === 'function' ? read(n) : read
    return { choices: [{ message: { content: JSON.stringify({ blocks }) } }] }
  }
  const availableGroqCompletion = async (_groq, request) => {
    calls.learn++
    calls.prompts.push(request.messages[1].content)
    if (fail) throw fail
    return { choices: [{ message: { content: JSON.stringify(note || { summary: 'Plain and close, like a builder talking to a neighbour.', traits: ['Opens with the problem the reader has', 'Short sentences', 'Ends by asking for a site visit'] }) } }] }
  }
  const loadUpload = async () => upload
  const api = new Function('Groq', 'sharp', 'createHash', 'budgetedCompletion', 'retrySeconds', 'availableGroqCompletion', 'loadUpload', 'process', load('lib/services/brandPosts.ts') + `;return {${NAMES}}`)(
    class {}, sharp, createHash, budgetedCompletion, () => 90, availableGroqCompletion, loadUpload, { env: { GROQ_API_KEY: 'test' } })
  return { api, calls }
}

/** A flows and uploads collection pair in memory. */
function database(postExamples) {
  const flow = { id: 'flow-a', brandContext: { name: 'PRUMO', ...(postExamples ? { postExamples } : {}) } }
  const released = []
  const db = {
    collection: name => name === 'flows'
      ? { findOne: async query => (query.id === flow.id ? structuredClone(flow) : null), updateOne: async (_q, update) => { flow.brandContext.postExamples = structuredClone(update.$set['brandContext.postExamples']) } }
      : { updateMany: async (query, update) => { released.push({ query, update }) } },
  }
  return { db, flow, released }
}

const up = id => `/api/uploads/${id.padEnd(8, '0')}`
const sendable = posts => posts.map(post => ({ id: post.id, images: post.slides.map(slide => slide.image), caption: post.caption }))
const { api } = service()

test('only Batkle uploads are kept as post images, on any host', () => {
  assert.equal(api.uploadIdOf('/api/uploads/0f9c2a6e-1d2b'), '0f9c2a6e-1d2b')
  assert.equal(api.uploadIdOf('https://batkle.com/api/uploads/0f9c2a6e-1d2b'), '0f9c2a6e-1d2b')
  for (const url of ['https://evil.example/photo.png', '/api/uploads/../flows', 'data:image/png;base64,AAAA', '', null]) assert.equal(api.uploadIdOf(url), '', String(url))
})

test('posts from the browser: eight at most, each with images or a caption, and never with words the server did not read', () => {
  const previous = [{ id: 'a', slides: [{ image: up('a'), text: 'Read before' }], caption: 'Old' }]
  const posts = api.readBrandPosts([
    { id: 'a', images: [up('a')], caption: '  New caption \r\n second line ' },
    { id: 'b', images: ['https://elsewhere.example/x.png'], caption: 'Only the caption is kept' },
    { id: 'c', images: [], caption: '' },
    { id: 'a', caption: 'Duplicate id' },
    { id: 'd', images: [up('d')], caption: '', slides: [{ image: up('d'), text: 'Sent by the browser' }] },
    { id: 'bad id!', caption: 'Invalid id' },
    ...Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, caption: `Caption ${i}` })),
  ], previous)
  assert.equal(posts.length, api.MAX_BRAND_POSTS)
  assert.deepEqual(posts[0], { id: 'a', slides: [{ image: up('a'), text: 'Read before' }], caption: 'New caption \n second line' })
  assert.deepEqual(posts[1], { id: 'b', slides: [], caption: 'Only the caption is kept' })
  assert.deepEqual(posts[2], { id: 'd', slides: [{ image: up('d') }], caption: '' }, 'words read from an image come only from the server')
  assert.ok(!posts.some(post => post.id === 'c' || post.id === 'bad id!'))
  assert.equal(api.readBrandPosts([{ id: 'a', images: [up('b')], caption: '' }], previous)[0].slides[0].text, undefined, 'a new image is read again')
  assert.equal(api.readBrandPosts([{ id: 'x', caption: 'x'.repeat(5000) }])[0].caption.length, api.CAPTION_LIMIT)
  assert.deepEqual(api.readBrandPosts('not a list'), [])
})

test('a carousel keeps its slides in order, at most ten, and a moved slide keeps what was read from it', () => {
  const previous = [{ id: 'c', slides: [{ image: up('s1'), text: 'Cover' }, { image: up('s2'), text: 'Step one' }, { image: up('s3'), text: 'Book now' }], caption: '' }]
  const [moved] = api.readBrandPosts([{ id: 'c', images: [up('s1'), up('s3'), up('s2'), up('s1')], caption: '' }], previous)
  assert.deepEqual(moved.slides, [{ image: up('s1'), text: 'Cover' }, { image: up('s3'), text: 'Book now' }, { image: up('s2'), text: 'Step one' }], 'a repeated image is one slide')
  const [many] = api.readBrandPosts([{ id: 'm', images: Array.from({ length: 14 }, (_, i) => up(`m${i}`)), caption: '' }])
  assert.equal(many.slides.length, api.MAX_SLIDES)
  // Posts saved before carousels: one image and its words.
  assert.deepEqual(api.slidesOf({ id: 'old', image: up('o'), text: 'Old words', caption: '' }), [{ image: up('o'), text: 'Old words' }])
  assert.deepEqual(api.readBrandPosts([{ id: 'old', images: [up('o')], caption: '' }], [{ id: 'old', image: up('o'), text: 'Old words', caption: '' }])[0].slides, [{ image: up('o'), text: 'Old words' }])
})

test('the note writer reads a carousel slide by slide, and eight full carousels stay within the budget', () => {
  const carousel = { id: 'c', slides: [{ image: up('s1'), text: 'Your roof has 3 warning signs' }, { image: up('s2'), text: '1. Moss on the tiles' }, { image: up('s3') }, { image: up('s4'), text: 'Book a free look' }], caption: 'Swipe to check yours.' }
  const single = { id: 's', slides: [{ image: up('x'), text: 'One line' }], caption: '' }
  const text = api.postsForVoice([carousel, single])
  assert.match(text, /^POST 1: a carousel of 4 slides[^\n]*\nSlide 1 \(cover\):\nYour roof has 3 warning signs\nSlide 2:\n1\. Moss on the tiles\nSlide 4 \(last\):\nBook a free look\nCaption: Swipe to check yours\./)
  assert.match(text, /POST 2\nOn the image \(one block of text per line\):\nOne line$/)
  const full = Array.from({ length: 8 }, (_, p) => ({ id: `p${p}`, caption: 'c'.repeat(2200), slides: Array.from({ length: 10 }, (_, s) => ({ image: up(`p${p}s${s}`), text: 'w'.repeat(600) })) }))
  assert.ok(api.postsForVoice(full).length < 14000, `${api.postsForVoice(full).length} characters`)
})

test('the voice is learned again only when the words it comes from change', () => {
  const posts = [{ id: 'a', slides: [{ image: up('a'), text: 'On image' }], caption: 'Hello' }]
  const basis = api.voiceBasis(posts)
  assert.match(basis, /^[0-9a-f]{40}$/)
  assert.equal(api.voiceBasis([{ ...posts[0], id: 'renamed' }]), basis, 'the same words')
  assert.notEqual(api.voiceBasis([{ ...posts[0], caption: 'Hello!' }]), basis)
  assert.notEqual(api.voiceBasis([{ ...posts[0], slides: [{ image: up('b'), text: 'A second slide' }, ...posts[0].slides] }]), basis, 'a carousel’s order counts')
  assert.equal(api.voiceBasis([{ id: 'a', slides: [{ image: up('a'), text: '' }], caption: '' }]), '', 'no words, nothing to learn from')
})

test('the note reaches prompts only while the switch is on', () => {
  const voice = { summary: 'Plain and close.', traits: ['Short sentences', '', 'Ends with a site visit'] }
  assert.equal(api.ownPostsVoice({ postExamples: { enabled: true, posts: [], voice } }), 'Plain and close.\n- Short sentences\n- Ends with a site visit')
  assert.equal(api.ownPostsVoice({ postExamples: { enabled: false, posts: [], voice } }), null)
  assert.equal(api.ownPostsVoice({ postExamples: { enabled: true, posts: [], voice: null } }), null)
  assert.equal(api.ownPostsVoice({}), null)
  const compactBrand = new Function('globalThis', load('lib/services/brandPosts.ts') + load('lib/services/ai/requestBudget.ts') + ';return compactBrand')({})
  const profile = compactBrand({ name: 'PRUMO', postExamples: { enabled: true, posts: [{ id: 'a', slides: [], caption: 'A caption that must never be copied' }], voice } })
  assert.equal(profile.voiceFromOwnPosts, 'Plain and close.\n- Short sentences\n- Ends with a site visit')
  assert.ok(!JSON.stringify(profile).includes('must never be copied'), 'the posts themselves never reach a prompt')
  assert.equal(compactBrand({ name: 'PRUMO', postExamples: { enabled: false, posts: [], voice } }).voiceFromOwnPosts, undefined)
  assert.equal(api.readVoice({ summary: 'x', traits: ['only one'] }), null, 'too thin to use')
  // From a real run: a trait quoting the brand's own sentences invites copying them, so it is left out.
  const source = "Caption: you already wrote the hard part.\nit's sitting on your website.\nlink in bio."
  const read = api.readVoice({ summary: 'Casual and lowercase.', traits: ['Short lines', 'Repeats key phrases like “skip it.”, “you already wrote the hard part.”', 'Ends with “link in bio.”'] }, source)
  assert.deepEqual(read.traits, ['Short lines', 'Ends with “link in bio.”'])
  assert.deepEqual(api.copiedQuotes('Likes “sitting on your website”', source), ['sitting on your website'])
  assert.deepEqual(api.copiedQuotes('Likes “paste your own link”', source), [], 'not in the posts')
})

test('saving posts reads each new slide once and learns the voice once', async () => {
  const { api, calls } = service({ read: n => [`Slide words ${n + 1}`] })
  const { db, flow } = database()
  const first = await api.updateBrandPosts(db, 'flow-a', { posts: [{ id: 'a', images: [up('a1'), up('a2'), up('a3')], caption: '' }, { id: 'b', images: [], caption: 'Fazemos a obra contigo.' }] }, 'user-1')
  assert.equal(calls.read, 3, 'one read per slide')
  assert.equal(calls.learn, 1)
  assert.match(calls.prompts[0], /^Brand: PRUMO\n\nPOST 1: a carousel of 3 slides[^\n]*\nSlide 1 \(cover\):\nSlide words 1\nSlide 2:\nSlide words 2\nSlide 3 \(last\):\nSlide words 3\n\nPOST 2\nCaption: Fazemos a obra contigo\./)
  assert.equal(first.enabled, true, 'on by default')
  assert.deepEqual(first.posts[0].slides.map(slide => slide.text), ['Slide words 1', 'Slide words 2', 'Slide words 3'])
  assert.equal(first.voice.count, 2)
  assert.equal(first.voice.basis, api.voiceBasis(first.posts))
  assert.deepEqual(flow.brandContext.postExamples, first)

  // The same posts again, and the switch: nothing to read or learn.
  await api.updateBrandPosts(db, 'flow-a', { posts: sendable(first.posts) }, 'user-1')
  const off = await api.updateBrandPosts(db, 'flow-a', { enabled: false }, 'user-1')
  assert.equal(off.enabled, false)
  assert.deepEqual(off.voice, first.voice, 'the note is kept for when it is turned back on')
  assert.equal(calls.read, 3)
  assert.equal(calls.learn, 1)

  // A slide added to the carousel: only it is read; the voice is learned again.
  await api.updateBrandPosts(db, 'flow-a', { posts: [{ id: 'a', images: [up('a1'), up('a2'), up('a3'), up('a4')], caption: '' }, { id: 'b', images: [], caption: 'Fazemos a obra contigo.' }] }, 'user-1')
  assert.equal(calls.read, 4)
  assert.equal(calls.learn, 2)
  assert.equal(flow.brandContext.postExamples.enabled, false, 'saving posts leaves the switch as it was')
  await api.updateBrandPosts(db, 'flow-a', { retry: true }, 'user-1')
  assert.equal(calls.learn, 3, 'read again on request')
})

test('once the vision model is busy, the other slides wait for the next save', async () => {
  const busy = Object.assign(new Error('rate limited'), { status: 429 })
  const { api, calls } = service({ read: n => { if (n === 1) throw busy; return [`Words ${n}`] } })
  const { db } = database()
  const saved = await api.updateBrandPosts(db, 'flow-a', { posts: [{ id: 'a', images: [up('a1'), up('a2'), up('a3'), up('a4')], caption: '' }] }, 'user-1')
  assert.equal(calls.read, 2, 'no call after the busy one')
  assert.deepEqual(saved.posts[0].slides.map(slide => slide.text ?? slide.readError.slice(0, 18)), ['Words 0', 'Batkle was too bus', 'Batkle was too bus', 'Batkle was too bus'])
  assert.equal(calls.learn, 1, 'the voice is learned from what was read')
})

test('a removed post or slide gives its image back to the owner’s allowance', async () => {
  const { api } = service()
  const { db, released } = database({ enabled: true, posts: [{ id: 'a', slides: [{ image: up('a1'), text: '' }, { image: up('a2'), text: 'Dois' }], caption: 'Uma legenda' }, { id: 'b', image: up('b'), text: 'Texto', caption: '' }], voice: null })
  const saved = await api.updateBrandPosts(db, 'flow-a', { posts: [{ id: 'a', images: [up('a2')], caption: 'Uma legenda' }] }, 'user-1')
  assert.deepEqual(saved.posts.map(post => post.id), ['a'])
  assert.equal(released.length, 1)
  assert.deepEqual(released[0].query, { id: { $in: [up('a1').split('/').pop(), up('b').split('/').pop()] }, ownerId: 'user-1' })
  assert.equal(released[0].update.$set.userUpload, false)
})

test('without the feature only removals pass, and they call no model', async () => {
  const current = [{ id: 'a', slides: [{ image: up('a1'), text: 'Um' }, { image: up('a2'), text: 'Dois' }], caption: 'Legenda' }, { id: 'b', slides: [], caption: 'Só legenda' }]
  assert.equal(api.onlyRemoves({ posts: [{ id: 'a', images: [up('a2')], caption: 'Legenda' }] }, current), true, 'a slide taken out')
  assert.equal(api.onlyRemoves({ posts: [] }, current), true, 'every post taken out')
  assert.equal(api.onlyRemoves({ enabled: false }, current), true)
  assert.equal(api.onlyRemoves({ enabled: true }, current), false)
  assert.equal(api.onlyRemoves({ retry: true }, current), false)
  assert.equal(api.onlyRemoves({ posts: [{ id: 'a', images: [up('a1'), up('a2'), up('a3')], caption: 'Legenda' }] }, current), false, 'a slide added')
  assert.equal(api.onlyRemoves({ posts: [{ id: 'b', images: [], caption: 'Outra legenda' }] }, current), false, 'a caption changed')
  assert.equal(api.onlyRemoves({ posts: [{ id: 'new', images: [], caption: 'Nova' }] }, current), false, 'a post added')

  const { api: free, calls } = service()
  const { db } = database({ enabled: true, posts: [{ id: 'a', slides: [{ image: up('a1') }, { image: up('a2'), text: 'Dois' }], caption: 'Legenda' }], voice: null, voiceError: 'Old error' })
  const saved = await free.updateBrandPosts(db, 'flow-a', { posts: [{ id: 'a', images: [up('a1')], caption: 'Legenda' }] }, 'user-1', { learn: false })
  assert.deepEqual(saved.posts[0].slides, [{ image: up('a1') }])
  assert.equal(calls.read + calls.learn, 0)
})

test('the handler refuses accounts without the feature unless they only remove', async () => {
  const refused = Object.assign(new Error('Writing in the voice of your own posts is part of Pro and Business. Upgrade to use it.'), { status: 402, code: 'upgrade_required' })
  const run = (plan, body, saved) => {
    const updates = []
    const db = { collection: () => ({ findOne: async () => ({ brandContext: { postExamples: { posts: saved } } }) }) }
    const handler = new Function('NextResponse', 'corsify', 'hasFeature', 'requireFeature', 'onlyRemoves', 'updateBrandPosts', load('lib/handlers/brandPostsHandler.ts') + ';return handleBrandPosts')(
      { json: (body, options) => ({ body, status: options?.status || 200 }) }, r => r,
      async () => plan !== 'free', async () => { throw refused }, api.onlyRemoves,
      async (_db, flowId, sent, userId, options) => { updates.push(options); return { enabled: true, posts: [], voice: null } })
    return handler(db, { flowId: 'flow-a', ...body }, 'user-1').then(result => ({ result, updates }), error => ({ error, updates }))
  }
  const saved = [{ id: 'a', slides: [{ image: up('a1') }], caption: '' }]
  assert.deepEqual((await run('pro', { posts: [{ id: 'n', caption: 'New' }] }, saved)).updates, [{ learn: true }])
  const refusal = await run('free', { posts: [{ id: 'n', caption: 'New' }] }, saved)
  assert.equal(refusal.error, refused, 'the billing error reaches the route, which answers 402 with its code')
  assert.deepEqual(refusal.updates, [])
  assert.deepEqual((await run('free', { posts: [] }, saved)).updates, [{ learn: false }], 'a Free account can still clear its posts')
})

test('a busy model keeps the posts, keeps the old note and says to try again', async () => {
  const { api } = service({ fail: Object.assign(new Error('rate limited'), { status: 429 }) })
  const voice = { summary: 'Old note', traits: ['a', 'b'], count: 1, basis: 'old', updatedAt: '2026-10-01T00:00:00.000Z' }
  const { db } = database({ enabled: true, posts: [], voice })
  const saved = await api.updateBrandPosts(db, 'flow-a', { posts: [{ id: 'b', images: [], caption: 'Nova legenda' }] }, 'user-1')
  assert.equal(saved.posts.length, 1)
  assert.deepEqual(saved.voice, voice)
  assert.match(saved.voiceError, /too busy/)
  const missing = service({ upload: null }).api
  const result = await missing.updateBrandPosts(database().db, 'flow-a', { posts: [{ id: 'a', images: [up('a')], caption: '' }] }, 'user-1')
  assert.match(result.posts[0].slides[0].readError, /no longer stored/)
  assert.equal(result.voice, null)
  await assert.rejects(api.updateBrandPosts(database().db, 'missing', {}, 'user-1'), /Brand not found/)
})
