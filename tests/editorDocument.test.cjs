const { test } = require('node:test')
const assert = require('node:assert/strict')
const source = require('node:fs').readFileSync('lib/client/editorDocument.js', 'utf8').replace(/^export /gm, '')
const doc = new Function(source + ';return {isCarousel,loadDocument,toDocument,openPage,addPage,duplicatePage,deletePage,movePage,renamePage,applyDesign,renderPayload,dynamicKeys,slideFileName}')()

const ids = () => { let n = 0; return () => `new-${++n}` }
const node = (id, extra = {}) => ({ id, type: 'text', text: id, x: 0, y: 0, width: 10, height: 10, ...extra })
const carousel = () => ({
  id: 'c1', name: 'Post', type: 'carousel', width: 1080, height: 1350, background: '#fff', nodes: [], groups: [], classes: {},
  pages: [
    { id: 'p2', type: 'content', name: 'Slide 1', order: 1, nodes: [node('b')], groups: [], classes: {}, background: '#222' },
    { id: 'p1', type: 'top_peer', name: 'Cover', order: 0, nodes: [node('a', { dynamic_key: 'title' })], groups: [], classes: {}, background: '#111' },
    { id: 'p3', type: 'bottom_peer', name: 'CTA', order: 2, nodes: [node('c', { dynamic_key: 'title' })], groups: [], classes: {}, background: '#333' },
  ],
})

test('a single post is edited exactly as saved', () => {
  const single = { id: 's', type: 'single', nodes: [node('a')], background: '#fff' }
  const state = doc.loadDocument(single)
  assert.equal(state, single)
  assert.deepEqual(doc.toDocument(state), single)
})

test('a carousel opens its first slide in order, or the requested one', () => {
  const state = doc.loadDocument(carousel())
  assert.equal(state._pageId, 'p1')
  assert.deepEqual(state.nodes.map(n => n.id), ['a'])
  assert.equal(state.background, '#111')
  assert.equal(doc.loadDocument(carousel(), 'p3')._pageId, 'p3')
  assert.equal(doc.loadDocument(carousel(), 'missing')._pageId, 'p1')
})

test('saving writes the open slide into its page and restores the carousel root', () => {
  const state = { ...doc.loadDocument(carousel()), nodes: [node('a2')], background: '#abc' }
  const saved = doc.toDocument(state)
  assert.deepEqual(saved.nodes, [])
  assert.equal(saved.background, '#fff')
  assert.equal(saved.pages[0].id, 'p1')
  assert.deepEqual(saved.pages[0].nodes.map(n => n.id), ['a2'])
  assert.equal(saved.pages[0].background, '#abc')
  assert.ok(!Object.keys(saved).some(k => k.startsWith('_')))
})

test('switching slides keeps the edits made to the previous slide', () => {
  let state = doc.loadDocument(carousel())
  state = { ...state, nodes: [...state.nodes, node('extra')] }
  state = doc.openPage(state, 'p2')
  assert.equal(state._pageId, 'p2')
  assert.deepEqual(state.nodes.map(n => n.id), ['b'])
  assert.deepEqual(doc.toDocument(state).pages[0].nodes.map(n => n.id), ['a', 'extra'])
  assert.equal(doc.openPage(state, 'nope'), state)
})

test('unsaved edits survive switching away and back', () => {
  let state = doc.loadDocument(carousel())
  state = { ...state, nodes: [node('unsaved edit')] }
  state = doc.openPage(doc.openPage(state, 'p2'), 'p1')
  assert.deepEqual(state.nodes.map(n => n.id), ['unsaved edit'])
})

test('opening another slide alone is not a change to save', () => {
  const state = doc.loadDocument(carousel())
  const saved = JSON.stringify(doc.toDocument(state))
  assert.equal(JSON.stringify(doc.toDocument(doc.openPage(state, 'p3'))), saved)
})

test('a newly added slide opens empty and keeps its place when you come back to it', () => {
  let state = doc.addPage(doc.loadDocument(carousel()), () => 'fresh')
  assert.deepEqual(state.nodes, [])
  state = { ...state, nodes: [node('typed')] }
  state = doc.openPage(doc.openPage(state, 'p3'), 'fresh')
  assert.deepEqual(state.nodes.map(n => n.id), ['typed'])
})

test('a new slide goes after the open one, before the closing slide, and opens', () => {
  let state = doc.loadDocument(carousel())
  state = doc.addPage(state, ids())
  assert.deepEqual(state.pages.map(p => p.id), ['p1', 'new-1', 'p2', 'p3'])
  assert.equal(state._pageId, 'new-1')
  assert.equal(state.background, '#111')
  assert.deepEqual(state.pages.map(p => p.type), ['top_peer', 'content', 'content', 'bottom_peer'])
  const fromLast = doc.addPage(doc.openPage(state, 'p3'), () => 'new-2')
  assert.deepEqual(fromLast.pages.map(p => p.id), ['p1', 'new-1', 'p2', 'new-2', 'p3'])
})

test('duplicating a slide gives its layers and groups fresh ids', () => {
  let state = doc.loadDocument(carousel())
  state = { ...state, nodes: [node('a', { groupId: 'g' }), node('z', { groupId: 'g' })], groups: [{ id: 'g', nodeIds: ['a', 'z'] }] }
  const next = doc.duplicatePage(state, 'p1', ids())
  const copy = next.pages[1]
  assert.equal(next._pageId, copy.id)
  assert.equal(copy.name, 'Cover (copy)')
  assert.notEqual(copy.nodes[0].id, 'a')
  assert.equal(copy.groups[0].nodeIds[0], copy.nodes[0].id)
  assert.equal(copy.nodes[0].groupId, copy.groups[0].id)
  assert.deepEqual(next.pages[0].nodes.map(n => n.id), ['a', 'z'])
})

test('deleting the open slide opens its neighbour and never removes the last slide', () => {
  let state = doc.openPage(doc.loadDocument(carousel()), 'p3')
  state = doc.deletePage(state, 'p3')
  assert.deepEqual(state.pages.map(p => p.id), ['p1', 'p2'])
  assert.equal(state._pageId, 'p2')
  assert.equal(state.pages[1].type, 'bottom_peer')
  const one = doc.deletePage(state, 'p1')
  assert.equal(doc.deletePage(one, 'p2'), one)
})

test('moving a slide updates order and roles', () => {
  const state = doc.movePage(doc.loadDocument(carousel()), 'p3', 0)
  assert.deepEqual(state.pages.map(p => [p.id, p.type, p.order]), [['p3', 'top_peer', 0], ['p1', 'content', 1], ['p2', 'bottom_peer', 2]])
  assert.equal(state._pageId, 'p1')
})

test('renaming changes only that slide', () => {
  const state = doc.renamePage(doc.loadDocument(carousel()), 'p2', 'Details')
  assert.deepEqual(state.pages.map(p => p.name), ['Cover', 'Details', 'CTA'])
})

test('applying a design keeps slide ids by position, the post name and the open slide', () => {
  const state = doc.openPage(doc.loadDocument(carousel()), 'p2')
  const data = { name: 'Design name', designSelection: { id: 'd1' }, pages: [0, 1, 2].map(i => ({ id: `d${i}`, order: i, nodes: [node(`n${i}`)], background: '#000' })) }
  const next = doc.applyDesign(state, data)
  assert.equal(next.name, 'Post')
  assert.equal(next.designSelection.id, 'd1')
  assert.deepEqual(next.pages.map(p => p.id), ['p1', 'p2', 'p3'])
  assert.equal(next._pageId, 'p2')
  assert.deepEqual(next.nodes.map(n => n.id), ['n1'])
})

test('the render payload uses suffixed keys per slide role', () => {
  const payload = doc.renderPayload(doc.toDocument(doc.loadDocument(carousel())))
  assert.deepEqual(payload, { canva_id: 'c1', top_peer_data: { title_top: 'your text' }, content: [{}], bottom_peer_data: { title_bottom: 'your text' } })
  assert.deepEqual(doc.renderPayload({ id: 's', nodes: [node('a', { dynamic_key: 'k' }), node('i', { type: 'image', dynamic_key: 'pic' })] }), { canva_id: 's', data: { k: 'your text', pic: 'https://example.com/image.png' } })
})

test('dynamic keys list the slides that use them', () => {
  assert.deepEqual(doc.dynamicKeys(carousel()), [{ key: 'title', type: 'text', slides: [0, 2] }])
})

test('slide file names match the render ZIP', () => {
  assert.equal(doc.slideFileName({ type: 'top_peer' }, 0, 4), '00-top-peer.png')
  assert.equal(doc.slideFileName({ type: 'content', name: 'Slide 1' }, 1, 4), '01-Slide 1.png')
  assert.equal(doc.slideFileName({ type: 'bottom_peer' }, 3, 4), '03-bottom-peer.png')
})
