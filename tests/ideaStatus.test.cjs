const { test } = require('node:test')
const assert = require('node:assert/strict')
const source = require('node:fs').readFileSync('lib/client/ideaStatus.js', 'utf8').replace(/^export /gm, '')
const { ideaStatus, filterIdeas, retryCopy } = new Function(source + ';return {ideaStatus,filterIdeas,retryCopy}')()

const states = status => status.steps.map(s => s.state)
const carousel = { type: 'carousel', pages: [{}, {}, {}, {}, {}] }
const plan = { slots: [{ needs_visual: true }] }

test('a new idea has no progress', () => {
  const s = ideaStatus({})
  assert.equal(s.phase, 'idea')
  assert.deepEqual(states(s), ['pending', 'pending', 'pending'])
  assert.equal(s.slides, 0)
})

test('a finished carousel is ready with every stage done and its slide count', () => {
  const s = ideaStatus({ copy: { copy: { slides: [] } }, plan: { plan }, resolve: { resolved: {} }, design: { canvas: carousel } })
  assert.equal(s.phase, 'ready')
  assert.deepEqual(states(s), ['done', 'done', 'done'])
  assert.equal(s.slides, 5)
})

test('a design without imagery marks visuals as skipped', () => {
  const s = ideaStatus({ plan: { plan: { slots: [{ needs_visual: false }] } }, resolve: { resolved: {}, skipped: true }, design: { canvas: { type: 'single' } } })
  assert.deepEqual(states(s), ['done', 'skipped', 'done'])
  assert.equal(s.slides, 1)
})

test('rebuilding keeps the old post visible but never shows later stages as finished', () => {
  const s = ideaStatus({ stage: 'content', copy: { copy: {} }, design: { canvas: carousel } })
  assert.equal(s.phase, 'building')
  assert.deepEqual(states(s), ['active', 'pending', 'pending'])
  assert.equal(s.canvas, carousel, 'the previous post stays available for the preview')
  const later = ideaStatus({ stage: 'build', plan: { plan }, resolve: { resolved: {} }, design: { canvas: carousel } })
  assert.deepEqual(states(later), ['done', 'done', 'active'])
})

test('a failure in this session or a saved error from an earlier one is reported at its stage', () => {
  const live = ideaStatus({ failure: { stage: 'visuals', message: 'No images' }, plan: { plan } })
  assert.equal(live.phase, 'failed')
  assert.equal(live.error, 'No images')
  assert.deepEqual(states(live), ['done', 'error', 'pending'])
  const saved = ideaStatus({ plan: { plan }, resolve: { resolved: {} }, design: { error: 'Canvas failed', canvas: null } })
  assert.equal(saved.phase, 'failed')
  assert.equal(saved.failedStage, 'build')
  assert.equal(ideaStatus({ stage: 'content', failure: { stage: 'build', message: 'x' } }).error, null, 'a new run clears the failure')
})

test('retrying after the content stage keeps the copy; a content failure writes again', () => {
  const copy = { headline: 'Kept' }
  assert.equal(retryCopy(ideaStatus({ failure: { stage: 'build', message: 'x' }, copy: { copy }, plan: { plan } })), copy)
  assert.equal(retryCopy(ideaStatus({ failure: { stage: 'content', message: 'x' } })), null)
})

test('filters select by build phase and post format', () => {
  const ideas = [{ id: 'a', format: 'carousel' }, { id: 'b', format: 'single' }, { id: 'c' }]
  const phases = { a: 'ready', b: 'building', c: 'idea' }
  const statusOf = id => ({ phase: phases[id] })
  assert.deepEqual(filterIdeas(ideas, 'all', statusOf).map(i => i.id), ['a', 'b', 'c'])
  assert.deepEqual(filterIdeas(ideas, 'ready', statusOf).map(i => i.id), ['a'])
  assert.deepEqual(filterIdeas(ideas, 'building', statusOf).map(i => i.id), ['b'])
  assert.deepEqual(filterIdeas(ideas, 'carousel', statusOf).map(i => i.id), ['a'])
  assert.deepEqual(filterIdeas(ideas, 'single', statusOf).map(i => i.id), ['b', 'c'])
})

test('stories have their own filter and are left out of carousels and single posts', () => {
  const ideas = [{ id: 'post', format: 'carousel' }, { id: 'frames', format: 'carousel', surface: 'story' }, { id: 'frame', format: 'single', surface: 'story' }, { id: 'single', format: 'single' }]
  const statusOf = () => ({ phase: 'idea' })
  assert.deepEqual(filterIdeas(ideas, 'story', statusOf).map(i => i.id), ['frames', 'frame'])
  assert.deepEqual(filterIdeas(ideas, 'carousel', statusOf).map(i => i.id), ['post'])
  assert.deepEqual(filterIdeas(ideas, 'single', statusOf).map(i => i.id), ['single'])
  assert.equal(filterIdeas(ideas, 'all', statusOf).length, 4)
})

test('an older saved post with only its canvas shows every stage as done', () => {
  const s = ideaStatus({ design: { loading: false, error: null, canvas: carousel } })
  assert.equal(s.phase, 'ready')
  assert.deepEqual(states(s), ['done', 'done', 'done'])
})
