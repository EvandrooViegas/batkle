/*
 * Geometry for the editor's canvas: the visible box of a layer, resizing from any handle, snapping,
 * and lining several layers up. Pure functions, so they can be tested without a browser.
 */

const crops = node => (node.type === 'image'
  ? { l: node.cropLeft || 0, r: node.cropRight || 0, t: node.cropTop || 0, b: node.cropBottom || 0 }
  : { l: 0, r: 0, t: 0, b: 0 })

/** The part of a layer that shows, before rotation: a cropped image shows only its uncropped part. */
export function visibleBox(node) {
  const c = crops(node)
  return {
    x: node.x + node.width * c.l / 100,
    y: node.y + node.height * c.t / 100,
    width: node.width * (100 - c.l - c.r) / 100,
    height: node.height * (100 - c.t - c.b) / 100,
  }
}

/** The box around several layers' visible parts, ignoring rotation. */
export function selectionBounds(nodes) {
  if (!nodes?.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    const b = visibleBox(n)
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.width)
    maxY = Math.max(maxY, b.y + b.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * The handles a layer gets, as [hx, hy] with -1 for left/top, 1 for right/bottom and 0 for the middle.
 * Images keep their proportions, so they only get corners. Text grows downwards by itself, so it gets
 * corners (which scale the text) and sides (which change the width).
 */
export function handlesFor(node) {
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  if (node.type === 'image') return corners
  if (node.type === 'text' && node.autoSize !== false) return [...corners, [-1, 0], [1, 0]]
  return [...corners, [0, -1], [1, 0], [0, 1], [-1, 0]]
}

const CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize']

/** The resize cursor for a handle, turned with the layer. */
export function handleCursor(hx, hy, rotation = 0) {
  const angle = Math.atan2(hy, hx) * 180 / Math.PI + rotation
  return CURSORS[((Math.round(angle / 45) % 4) + 4) % 4]
}

/**
 * Resizes a layer by dragging one handle by (dx, dy) canvas pixels. The opposite handle stays put, also
 * when the layer is rotated or (for images) cropped. With keepRatio the layer keeps its proportions; a side
 * handle then grows the layer evenly about its middle. Returns the new box and how much it was scaled.
 */
export function resizeFromHandle(node, [hx, hy], dx, dy, { keepRatio = false, min = 20, maxWidth, maxHeight } = {}) {
  const W = node.width, H = node.height
  const c = crops(node)
  const fx = (100 - c.l - c.r) / 100, fy = (100 - c.t - c.b) / 100
  const visW = W * fx, visH = H * fy
  const angle = (node.rotation || 0) * Math.PI / 180
  const u = { x: Math.cos(angle), y: Math.sin(angle) }
  const v = { x: -Math.sin(angle), y: Math.cos(angle) }
  const at = (p, a, b) => ({ x: p.x + a * u.x + b * v.x, y: p.y + a * u.y + b * v.y })

  // Work in the layer's own axes.
  const localX = dx * u.x + dy * u.y
  const localY = dx * v.x + dy * v.y
  const minW = Math.min(min, visW), minH = Math.min(min, visH)
  let newW = hx ? Math.max(minW, visW + hx * localX) : visW
  let newH = hy ? Math.max(minH, visH + hy * localY) : visH

  if (keepRatio) {
    const sw = newW / visW, sh = newH / visH
    // A corner follows whichever direction moved more, so the layer can shrink as well as grow.
    let s = !hy ? sw : !hx ? sh : Math.abs(sw - 1) >= Math.abs(sh - 1) ? sw : sh
    s = Math.max(s, minW / visW, minH / visH)
    newW = visW * s
    newH = visH * s
  }
  const capW = maxWidth ? maxWidth * fx : Infinity, capH = maxHeight ? maxHeight * fy : Infinity
  if (newW > capW || newH > capH) {
    if (keepRatio) {
      const s = Math.min(capW / newW, capH / newH)
      newW *= s
      newH *= s
    } else {
      newW = Math.min(newW, capW)
      newH = Math.min(newH, capH)
    }
  }

  const center = { x: node.x + W / 2, y: node.y + H / 2 }
  const visCenter = at(center, W * (c.l - c.r) / 200, H * (c.t - c.b) / 200)
  const anchor = at(visCenter, -hx * visW / 2, -hy * visH / 2)
  const newVisCenter = at(anchor, hx * newW / 2, hy * newH / 2)
  const width = Math.round(newW / fx)
  const height = Math.round(newH / fy)
  const newCenter = at(newVisCenter, -width * (c.l - c.r) / 200, -height * (c.t - c.b) / 200)
  return {
    x: Math.round(newCenter.x - width / 2),
    y: Math.round(newCenter.y - height / 2),
    width,
    height,
    scale: newW / visW,
  }
}

/** The closest snap target within `threshold` of `pos`, or null. */
export function nearestTarget(pos, targets, threshold) {
  let best = null
  for (const t of targets) {
    const d = Math.abs(t - pos)
    if (d < threshold && (best === null || d < Math.abs(best - pos))) best = t
  }
  return best
}

/**
 * Adjusts a resize drag so the moving edges land on nearby guides. Only for unrotated layers.
 * Returns the adjusted drag and the guide lines it snapped to.
 */
export function snapResizeDrag(node, [hx, hy], dx, dy, targetsV, targetsH, threshold) {
  const b = visibleBox(node)
  const lines = []
  if (hx) {
    const edge = (hx > 0 ? b.x + b.width : b.x) + dx
    const t = nearestTarget(edge, targetsV, threshold)
    if (t !== null) { dx += t - edge; lines.push({ type: 'v', pos: t }) }
  }
  if (hy) {
    const edge = (hy > 0 ? b.y + b.height : b.y) + dy
    const t = nearestTarget(edge, targetsH, threshold)
    if (t !== null) { dy += t - edge; lines.push({ type: 'h', pos: t }) }
  }
  return { dx, dy, lines }
}

/** Keeps only the guide lines that an edge of `box` actually touches. */
export function touchingLines(lines, box) {
  const near = (a, b) => Math.abs(a - b) < 0.75
  return lines.filter(l => (l.type === 'v'
    ? [box.x, box.x + box.width / 2, box.x + box.width].some(e => near(e, l.pos))
    : [box.y, box.y + box.height / 2, box.y + box.height].some(e => near(e, l.pos))))
}

/**
 * New positions that line layers up inside `frame` (the selection, or the slide for a single layer).
 * `edge` is left, center or right (across) or top, middle or bottom (down). Returns [{ id, x, y }].
 */
export function alignNodes(nodes, edge, frame) {
  return nodes.map(n => {
    const b = visibleBox(n)
    let { x, y } = n
    if (edge === 'left') x += frame.x - b.x
    else if (edge === 'center') x += frame.x + (frame.width - b.width) / 2 - b.x
    else if (edge === 'right') x += frame.x + frame.width - (b.x + b.width)
    else if (edge === 'top') y += frame.y - b.y
    else if (edge === 'middle') y += frame.y + (frame.height - b.height) / 2 - b.y
    else if (edge === 'bottom') y += frame.y + frame.height - (b.y + b.height)
    return { id: n.id, x: Math.round(x), y: Math.round(y) }
  })
}

/** New positions that leave equal gaps between three or more layers along `axis` ('x' or 'y'). */
export function distributeNodes(nodes, axis) {
  if (nodes.length < 3) return []
  const pos = axis === 'x' ? 'x' : 'y'
  const size = axis === 'x' ? 'width' : 'height'
  const items = nodes.map(n => ({ n, b: visibleBox(n) })).sort((a, b) => a.b[pos] - b.b[pos])
  const first = items[0].b[pos]
  const last = Math.max(...items.map(i => i.b[pos] + i.b[size]))
  const gap = (last - first - items.reduce((sum, i) => sum + i.b[size], 0)) / (items.length - 1)
  let cursor = first
  return items.map(({ n, b }) => {
    const moved = { id: n.id, x: n.x, y: n.y }
    moved[pos] = Math.round(n[pos] + cursor - b[pos])
    cursor += b[size] + gap
    return moved
  })
}
