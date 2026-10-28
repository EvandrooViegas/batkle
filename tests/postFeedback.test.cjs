const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')

const load = file => stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))
const api = new Function(load('lib/services/postFeedback.ts') + ';return {FEEDBACK_REASONS,MAX_FEEDBACK,NOTE_LIMIT,feedbackKey,readFeedback,feedbackBlock,withoutDislikedDesigns,loadPostFeedback,savePostFeedback}')()

const post = (over = {}) => ({ ideaId: 'idea-1', canvasId: 'canvas-1', surface: 'post', format: 'carousel', topic: 'Roof checks before winter', hook: 'Moss on the tiles is the first sign', hookShape: 'mistake', pillar: 'Education', headline: 'Moss on the tiles is the first sign', caption: 'Three things to check before the rain starts.', designId: 'global-sunset', ...over })
const rating = (rating, over = {}, extra = {}) => ({ rating, reasons: [], note: '', post: post(over), ...extra })

/** A flows collection in memory. */
function database(postFeedback) {
  const flow = { id: 'flow-a', ...(postFeedback ? { postFeedback } : {}) }
  return { flow, db: { collection: () => ({ findOne: async query => (query.id === flow.id ? structuredClone(flow) : null), updateOne: async (_q, update) => { Object.assign(flow, structuredClone(update.$set)) } }) } }
}

test('a rating keeps a snapshot of the post it is for, cleaned, keyed by the version rated', () => {
  const entry = api.readFeedback({ rating: 'dislike', reasons: ['hook', 'nonsense', 'hook', 'design'], note: '  too   vague  ', post: post({ caption: 'x'.repeat(900), hookShape: 'mistake' }) }, new Date('2026-10-24T10:00:00Z'))
  assert.deepEqual(entry.reasons, ['hook', 'design'])
  assert.equal(entry.note, 'too vague')
  assert.equal(entry.key, 'canvas-1')
  assert.equal(entry.caption.length, 400)
  assert.equal(entry.at, '2026-10-24T10:00:00.000Z')
  assert.equal(api.feedbackKey({ ideaId: 'idea-1' }), 'idea-1', 'an idea not built yet')
  assert.equal(api.readFeedback({ rating: 'love', post: post() }), null)
  assert.equal(api.readFeedback({ rating: 'like', post: { ideaId: '<script>' } }), null)
  assert.equal(api.readFeedback({ rating: 'like', note: 'n'.repeat(500), post: post() }).note.length, api.NOTE_LIMIT)
})

test('one rating per version: rating again replaces it, null takes it away, and only the newest are kept', async () => {
  const { db, flow } = database()
  await api.savePostFeedback(db, 'flow-a', rating('like'))
  let list = await api.savePostFeedback(db, 'flow-a', rating('dislike', {}, { reasons: ['text'] }))
  assert.equal(list.length, 1)
  assert.equal(list[0].rating, 'dislike')
  // A new version of the same idea is rated on its own.
  list = await api.savePostFeedback(db, 'flow-a', rating('like', { canvasId: 'canvas-2' }))
  assert.deepEqual(list.map(e => e.key), ['canvas-2', 'canvas-1'])
  list = await api.savePostFeedback(db, 'flow-a', { rating: null, post: post() })
  assert.deepEqual(list.map(e => e.key), ['canvas-2'])
  for (let i = 0; i < 50; i++) await api.savePostFeedback(db, 'flow-a', rating('like', { canvasId: `c${i}` }))
  assert.equal(flow.postFeedback.length, api.MAX_FEEDBACK)
  assert.equal(flow.postFeedback[0].key, 'c49', 'newest first')
  await assert.rejects(api.savePostFeedback(db, 'missing', rating('like')), /Brand not found/)
  await assert.rejects(api.savePostFeedback(db, 'flow-a', { rating: 'like', post: {} }), /missing/)
  assert.equal((await api.loadPostFeedback(db, 'flow-a')).length, api.MAX_FEEDBACK)
  assert.deepEqual(await api.loadPostFeedback({ collection: () => ({ findOne: async () => { throw new Error('down') } }) }, 'flow-a'), [], 'never stops a post')
})

test('the idea writer is told what was liked and what was disliked, and why', () => {
  const entries = [
    api.readFeedback(rating('like', { canvasId: 'a', hook: 'Pintar sem tratar fissuras sai caro', topic: 'Fissuras na fachada', hookShape: 'mistake' }, { reasons: ['hook', 'topic'] })),
    api.readFeedback(rating('dislike', { canvasId: 'b', hook: 'Your feed repeats itself', topic: 'Content variety', format: 'single', hookShape: 'scene' }, { reasons: ['hook'], note: 'too vague' })),
    api.readFeedback(rating('dislike', { canvasId: 'c', hook: 'Some story', topic: 'A story', surface: 'story' })),
  ]
  const block = api.feedbackBlock(entries, 'ideas')
  assert.match(block, /^WHAT THE OWNER THOUGHT OF RECENT POSTS/)
  assert.match(block, /Liked:\n- a carousel opening as a mistake: "Pintar sem tratar fissuras sai caro" \(topic: "Fissuras na fachada"\) — liked the hook and the topic/)
  assert.match(block, /Disliked:\n- a single opening as a scene: "Your feed repeats itself" \(topic: "Content variety"\) — disliked the hook; the owner said: "too vague"/)
  assert.match(block, /- a carousel story opening as a mistake: "Some story" \(topic: "A story"\) — disliked the post overall/)
  assert.match(block, /Make more posts like the liked ones[\s\S]*A request the owner typed for this post still comes first/)
  assert.equal(api.feedbackBlock([], 'ideas'), '')
  assert.equal(api.feedbackBlock(null, 'copy'), '')
})

test('the copywriter sees only ratings about the words: liked posts and text dislikes', () => {
  const entries = [
    api.readFeedback(rating('like', { canvasId: 'a', headline: 'Moss is the first sign', caption: 'Check the north side first.' })),
    api.readFeedback(rating('like', { canvasId: 'b', headline: 'Liked for its design only' }, { reasons: ['design'] })),
    api.readFeedback(rating('dislike', { canvasId: 'c', headline: 'Unlock your roof potential' }, { reasons: ['text'], note: 'too salesy' })),
    api.readFeedback(rating('dislike', { canvasId: 'd', headline: 'Disliked for its topic' }, { reasons: ['topic'] })),
  ]
  const block = api.feedbackBlock(entries, 'copy')
  assert.match(block, /Liked:\n- headline "Moss is the first sign", caption beginning "Check the north side first\." — liked the post overall/)
  assert.match(block, /Disliked:\n- headline "Unlock your roof potential", caption beginning "Three things[^"]*" — disliked the text; the owner said: "too salesy"/)
  assert.doesNotMatch(block, /design only|its topic/)
  assert.match(block, /never reusing their sentences/)
})

test('a design whose look was disliked sits out Batkle’s pick, until it is liked again or nothing else is left', () => {
  const brand = { id: 'b', designs: [{ id: 'global-sunset', source: 'global' }, { id: 'global-mono', source: 'global' }, { id: 'starter', source: 'starter' }] }
  const disliked = [api.readFeedback(rating('dislike', { canvasId: 'a', designId: 'global-sunset' }, { reasons: ['design'] }))]
  assert.deepEqual(api.withoutDislikedDesigns(brand, disliked).designs.map(d => d.id), ['global-mono', 'starter'])
  assert.equal(api.withoutDislikedDesigns(brand, [api.readFeedback(rating('dislike', { canvasId: 'a', designId: 'global-sunset' }, { reasons: ['text'] }))]), brand, 'a dislike of the text keeps the design')
  const likedAgain = [api.readFeedback(rating('like', { canvasId: 'b', designId: 'global-sunset' })), ...disliked]
  assert.equal(api.withoutDislikedDesigns(brand, likedAgain), brand, 'the newest rating decides')
  const both = [...disliked, api.readFeedback(rating('dislike', { canvasId: 'c', designId: 'global-mono' }, { reasons: ['design'] }))]
  assert.equal(api.withoutDislikedDesigns(brand, both), brand, 'never every studied design')
})
