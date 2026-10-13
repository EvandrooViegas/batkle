const { test } = require('node:test')
const assert = require('node:assert/strict')
const source = require('node:fs').readFileSync('lib/client/editorGeometry.js', 'utf8').replace(/^export /gm, '')
const geo = new Function(source + ';return {visibleBox,selectionBounds,handlesFor,handleCursor,resizeFromHandle,nearestTarget,snapResizeDrag,touchingLines,alignNodes,distributeNodes}')()

const box = (extra = {}) => ({ id: 'a', type: 'shape', x: 100, y: 100, width: 200, height: 100, ...extra })
const corner = (n, [hx, hy]) => {
  const a = n.rotation * Math.PI / 180
  const cx = n.x + n.width / 2, cy = n.y + n.height / 2
  const lx = hx * n.width / 2, ly = hy * n.height / 2
  return { x: cx + lx * Math.cos(a) - ly * Math.sin(a), y: cy + lx * Math.sin(a) + ly * Math.cos(a) }
}

test('every side and corner handle keeps the opposite edge in place', () => {
  const n = box()
  assert.deepEqual(geo.resizeFromHandle(n, [1, 1], 50, 20), { x: 100, y: 100, width: 250, height: 120, scale: 1.25 })
  const left = geo.resizeFromHandle(n, [-1, 0], -30, 999)
  assert.deepEqual([left.x, left.y, left.width, left.height], [70, 100, 230, 100])
  const top = geo.resizeFromHandle(n, [0, -1], 999, 40)
  assert.deepEqual([top.x, top.y, top.width, top.height], [100, 140, 200, 60])
  const topLeft = geo.resizeFromHandle(n, [-1, -1], 20, 10)
  assert.equal(topLeft.x + topLeft.width, 300)
  assert.equal(topLeft.y + topLeft.height, 200)
})

test('a layer never shrinks below the minimum size or past the opposite edge', () => {
  const r = geo.resizeFromHandle(box(), [1, 1], -500, -500)
  assert.deepEqual([r.x, r.y, r.width, r.height], [100, 100, 20, 20])
  const l = geo.resizeFromHandle(box(), [-1, 0], 500, 0)
  assert.equal(l.x + l.width, 300)
})

test('keeping proportions follows the direction that moved most, so a corner can shrink too', () => {
  const grow = geo.resizeFromHandle(box(), [1, 1], 100, 0, { keepRatio: true })
  assert.deepEqual([grow.width, grow.height], [300, 150])
  const shrink = geo.resizeFromHandle(box(), [1, 1], -100, 5, { keepRatio: true })
  assert.deepEqual([shrink.width, shrink.height], [100, 50])
  const side = geo.resizeFromHandle(box(), [1, 0], 100, 0, { keepRatio: true })
  assert.deepEqual([side.x, side.y, side.width, side.height], [100, 75, 300, 150])
})

test('a rotated layer resizes along its own axes with the far corner fixed', () => {
  const n = box({ rotation: 90 })
  const fixed = corner(n, [-1, -1])
  // Rotated 90°, the layer's own right is the canvas's down.
  const r = geo.resizeFromHandle(n, [1, 1], 0, 50)
  assert.equal(r.width, 250)
  const after = corner({ ...n, ...r }, [-1, -1])
  assert.ok(Math.abs(after.x - fixed.x) <= 1 && Math.abs(after.y - fixed.y) <= 1)
})

test('a cropped image resizes its visible part and keeps the crop', () => {
  const n = box({ type: 'image', width: 200, height: 200, cropLeft: 25, cropRight: 25 })
  const before = geo.visibleBox(n)
  assert.deepEqual(before, { x: 150, y: 100, width: 100, height: 200 })
  const r = geo.resizeFromHandle(n, [1, 1], 100, 0, { keepRatio: true })
  const after = geo.visibleBox({ ...n, ...r })
  assert.deepEqual([after.x, after.y, after.width, after.height], [150, 100, 200, 400])
})

test('the flow box caps how far a layer can grow', () => {
  const r = geo.resizeFromHandle(box(), [1, 0], 500, 0, { maxWidth: 260 })
  assert.equal(r.width, 260)
})

test('images get corners only and text gets corners and sides', () => {
  assert.equal(geo.handlesFor({ type: 'image' }).length, 4)
  assert.equal(geo.handlesFor({ type: 'text' }).length, 6)
  assert.equal(geo.handlesFor({ type: 'text', autoSize: false }).length, 8)
  assert.equal(geo.handlesFor({ type: 'shape' }).length, 8)
})

test('resize cursors turn with the layer', () => {
  assert.equal(geo.handleCursor(1, 0, 0), 'ew-resize')
  assert.equal(geo.handleCursor(1, 0, 90), 'ns-resize')
  assert.equal(geo.handleCursor(1, 1, 0), 'nwse-resize')
  assert.equal(geo.handleCursor(-1, 1, 0), 'nesw-resize')
  assert.equal(geo.handleCursor(-1, -1, -360), 'nwse-resize')
})

test('a resize drag snaps the moving edge to the nearest guide', () => {
  const { dx, dy, lines } = geo.snapResizeDrag(box(), [1, 0], 95, 0, [0, 400, 540], [0], 8)
  assert.equal(dx, 100)
  assert.equal(dy, 0)
  assert.deepEqual(lines, [{ type: 'v', pos: 400 }])
  assert.equal(geo.nearestTarget(10, [0, 12, 30], 8), 12)
  assert.deepEqual(geo.touchingLines([{ type: 'v', pos: 400 }, { type: 'h', pos: 7 }], { x: 100, y: 100, width: 300, height: 100 }), [{ type: 'v', pos: 400 }])
})

test('layers line up on the selection or the slide', () => {
  const a = box({ id: 'a', x: 0, y: 0, width: 100, height: 50 })
  const b = box({ id: 'b', x: 300, y: 200, width: 50, height: 100 })
  const frame = geo.selectionBounds([a, b])
  assert.deepEqual(frame, { x: 0, y: 0, width: 350, height: 300 })
  assert.deepEqual(geo.alignNodes([a, b], 'left', frame), [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 200 }])
  assert.deepEqual(geo.alignNodes([a, b], 'right', frame).map(p => p.x), [250, 300])
  assert.deepEqual(geo.alignNodes([a, b], 'middle', frame).map(p => p.y), [125, 100])
  assert.deepEqual(geo.alignNodes([a], 'center', { x: 0, y: 0, width: 1080, height: 1080 }), [{ id: 'a', x: 490, y: 0 }])
})

test('a cropped image aligns by what shows, not by its hidden edges', () => {
  const img = box({ type: 'image', x: 0, y: 0, width: 200, height: 100, cropLeft: 50 })
  assert.deepEqual(geo.alignNodes([img], 'left', { x: 0, y: 0, width: 1000, height: 1000 }), [{ id: 'a', x: -100, y: 0 }])
})

test('distributing leaves equal gaps and keeps the outer layers in place', () => {
  const nodes = [
    box({ id: 'c', x: 500, width: 100 }),
    box({ id: 'a', x: 0, width: 100 }),
    box({ id: 'b', x: 120, width: 50 }),
  ]
  const moved = Object.fromEntries(geo.distributeNodes(nodes, 'x').map(p => [p.id, p.x]))
  assert.deepEqual(moved, { a: 0, b: 275, c: 500 })
  assert.deepEqual(geo.distributeNodes(nodes.slice(0, 2), 'x'), [])
})
