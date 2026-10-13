/*
 * The editor's working copy of a saved canvas.
 *
 * A single post is edited as saved. A carousel keeps its slides in `pages`; the open slide's layers are
 * lifted to the top level (nodes, groups, classes, background), where every editing tool reads them, and
 * written back to their page on save or when another slide opens. The carousel's own top-level fields are
 * kept in `_root`, and fields starting with "_" never reach the saved document.
 */

const PAGE_FIELDS = ['nodes', 'groups', 'classes', 'background']

/** Whether a saved canvas is a carousel with slides. */
export function isCarousel(doc) {
  return doc?.type === 'carousel' && Array.isArray(doc.pages) && doc.pages.length > 0
}

/** Slides in display order. */
export function orderedPages(pages) {
  return [...(pages || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

/** Slide roles follow position: the first is the cover, the last closes, the rest carry the content. */
export function withSlideRoles(pages) {
  return pages.map((page, i) => ({
    ...page,
    type: i === 0 ? 'top_peer' : i === pages.length - 1 ? 'bottom_peer' : 'content',
    order: i,
  }))
}

function pageView(page, root) {
  return {
    nodes: page.nodes || [],
    groups: page.groups || [],
    classes: page.classes || root?.classes || {},
    background: page.background || root?.background,
  }
}

/** The working copy of a loaded canvas, with the carousel slide `pageId` open (the first slide when absent). */
export function loadDocument(doc, pageId) {
  if (!isCarousel(doc)) return doc
  const root = Object.fromEntries(PAGE_FIELDS.map(key => [key, doc[key]]))
  const pages = orderedPages(doc.pages)
  const page = pages.find(p => p.id === pageId) || pages[0]
  return { ...doc, pages, _root: root, ...pageView(page, root), _pageId: page.id }
}

/** The open slide written back into its page. */
export function commitPage(state) {
  if (!state?._pageId) return state
  return {
    ...state,
    pages: state.pages.map(p => (p.id === state._pageId
      ? { ...p, nodes: state.nodes || [], groups: state.groups || [], classes: state.classes || {}, background: state.background }
      : p)),
  }
}

/** What is saved: the open slide committed, the carousel's top-level fields restored, editor-only fields dropped. */
export function toDocument(state) {
  if (!state) return state
  const committed = commitPage(state)
  const doc = {}
  for (const [key, value] of Object.entries(committed)) if (!key.startsWith('_')) doc[key] = value
  if (state._root) for (const key of PAGE_FIELDS) {
    if (state._root[key] === undefined) delete doc[key]
    else doc[key] = state._root[key]
  }
  return doc
}

/** Opens another slide, keeping the edits made to the current one. */
export function openPage(state, pageId) {
  if (!state?._pageId || pageId === state._pageId) return state
  const committed = commitPage(state)
  const page = committed.pages.find(p => p.id === pageId)
  if (!page) return state
  return { ...committed, ...pageView(page, committed._root), _pageId: page.id }
}

function withPages(state, pages, openId) {
  const committed = { ...commitPage(state), pages: withSlideRoles(pages) }
  const page = committed.pages.find(p => p.id === openId) || committed.pages[0]
  return { ...committed, ...pageView(page, committed._root), _pageId: page.id }
}

/**
 * Adds a blank slide after `afterId` (the open slide by default) with that slide's background.
 * The closing slide stays last, so a slide added after it goes just before it.
 */
export function addPage(state, newId, afterId = state._pageId) {
  const pages = commitPage(state).pages
  const index = pages.findIndex(p => p.id === afterId)
  const at = index === -1 ? pages.length : pages.length > 1 && index === pages.length - 1 ? index : index + 1
  const source = pages[index] || pages[pages.length - 1]
  const page = { id: newId(), type: 'content', name: `Slide ${pages.length + 1}`, order: at, nodes: [], groups: [], classes: {}, background: source?.background }
  return withPages(state, [...pages.slice(0, at), page, ...pages.slice(at)], page.id)
}

/** Copies a slide next to itself, with fresh ids for its layers and groups. */
export function duplicatePage(state, pageId, newId) {
  const pages = commitPage(state).pages
  const index = pages.findIndex(p => p.id === pageId)
  if (index === -1) return state
  const original = pages[index]
  const ids = new Map()
  const fresh = id => {
    if (!ids.has(id)) ids.set(id, newId())
    return ids.get(id)
  }
  const nodes = (original.nodes || []).map(n => ({ ...n, id: fresh(n.id), ...(n.groupId ? { groupId: fresh(n.groupId) } : {}) }))
  const groups = (original.groups || []).map(g => ({ ...g, id: fresh(g.id), nodeIds: (g.nodeIds || []).map(fresh) }))
  const copy = { ...original, id: newId(), name: `${original.name || `Slide ${index + 1}`} (copy)`, nodes, groups, classes: JSON.parse(JSON.stringify(original.classes || {})) }
  return withPages(state, [...pages.slice(0, index + 1), copy, ...pages.slice(index + 1)], copy.id)
}

/** Removes a slide; a carousel always keeps at least one. The neighbouring slide opens if it was the open one. */
export function deletePage(state, pageId) {
  const pages = commitPage(state).pages
  const index = pages.findIndex(p => p.id === pageId)
  if (index === -1 || pages.length <= 1) return state
  const rest = pages.filter(p => p.id !== pageId)
  const open = pageId === state._pageId ? rest[Math.min(index, rest.length - 1)].id : state._pageId
  return withPages(state, rest, open)
}

/** Moves a slide to position `to`. */
export function movePage(state, pageId, to) {
  const pages = [...commitPage(state).pages]
  const from = pages.findIndex(p => p.id === pageId)
  const target = Math.max(0, Math.min(pages.length - 1, to))
  if (from === -1 || from === target) return state
  const [page] = pages.splice(from, 1)
  pages.splice(target, 0, page)
  return withPages(state, pages, state._pageId)
}

export function renamePage(state, pageId, name) {
  return { ...state, pages: state.pages.map(p => (p.id === pageId ? { ...p, name } : p)) }
}

/**
 * The working copy after a design is applied. Slides keep their ids by position, and the open slide
 * stays open when the new design still has it.
 */
export function applyDesign(state, data) {
  const current = toDocument(state)
  const pages = data.pages?.map((p, i) => ({ ...p, id: current.pages?.[i]?.id || p.id }))
  const doc = { ...current, ...data, id: current.id, name: current.name, createdAt: current.createdAt, ...(pages ? { pages } : {}) }
  return loadDocument(doc, state._pageId)
}

/** The file name the render API gives each slide inside the carousel ZIP. */
export function slideFileName(page, index, total) {
  if (page.type === 'top_peer') return '00-top-peer.png'
  if (page.type === 'bottom_peer') return `${String(total - 1).padStart(2, '0')}-bottom-peer.png`
  return `${String(index).padStart(2, '0')}-${page.name || 'page'}.png`
}

const sampleValue = node => (node.type === 'image' ? 'https://example.com/image.png' : 'your text')

/** Example body for POST /api/render, using every dynamic key in the post. */
export function renderPayload(doc) {
  if (!isCarousel(doc)) {
    return { canva_id: doc.id, data: Object.fromEntries((doc.nodes || []).filter(n => n.dynamic_key).map(n => [n.dynamic_key, sampleValue(n)])) }
  }
  const pages = orderedPages(doc.pages)
  const keyed = (page, suffix) => Object.fromEntries((page?.nodes || []).filter(n => n.dynamic_key).map(n => [`${n.dynamic_key}${suffix}`, sampleValue(n)]))
  return {
    canva_id: doc.id,
    top_peer_data: keyed(pages.find(p => p.type === 'top_peer'), '_top'),
    content: pages.filter(p => p.type === 'content').map((p, i) => keyed(p, `_${i + 1}`)),
    bottom_peer_data: keyed(pages.find(p => p.type === 'bottom_peer'), '_bottom'),
  }
}

/** Every dynamic key in the post and the slides (by index) that use it. */
export function dynamicKeys(doc) {
  const pages = isCarousel(doc) ? orderedPages(doc.pages) : [doc]
  const keys = new Map()
  pages.forEach((page, index) => {
    for (const node of page.nodes || []) {
      const key = (node.dynamic_key || '').trim()
      if (!key) continue
      if (!keys.has(key)) keys.set(key, { key, type: node.type, slides: [] })
      const entry = keys.get(key)
      if (!entry.slides.includes(index)) entry.slides.push(index)
    }
  })
  return [...keys.values()]
}
