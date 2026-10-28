import sharp from 'sharp'

/**
 * Layout facts measured from a reference's pixels, in code. Vision models misread exactly these (centred copy read as
 * left-aligned, an outlined box read as a "thin rule", a headline on a colour panel read as plain), so they correct the
 * study after the model call.
 * Everything is relative to the image (0–1), measured on a 540px-wide copy.
 */
export interface ReferenceMetrics {
  /** Alignment of the copy lines, when enough lines agree. */
  align: 'left' | 'center' | 'right' | null
  /** A rectangle outlined in a saturated colour that encloses text. */
  box: { x: number; y: number; width: number; height: number } | null
  /** The largest solid block of one saturated colour that holds copy (a headline set on a colour panel). */
  panel: { x: number; y: number; width: number; height: number } | null
  /** Long thin saturated lines that are not part of a box (separators, accents). */
  rules: number
  /** Some copy is set in a saturated (accent) colour. */
  coloredText: boolean
  lines: { left: number; right: number; top: number; bottom: number }[]
}

const WIDTH = 540

export async function measureReference(bytes: Buffer): Promise<ReferenceMetrics> {
  const { data, info } = await sharp(bytes).rotate().resize({ width: WIDTH }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height, count = W * H
  const lum = new Float32Array(count), sat = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2]
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    lum[i] = (r * .299 + g * .587 + b * .114) / 255
    sat[i] = max ? (max - min) / max : 0
  }
  // Local contrast against a wide box blur: text strokes stand out sharply from what surrounds them.
  const blur = boxBlur(lum, W, H, 9)
  const edge = new Uint8Array(count)
  for (let i = 0; i < count; i++) edge[i] = Math.abs(lum[i] - blur[i]) > .2 ? 1 : 0
  const accent = new Uint8Array(count)
  for (let i = 0; i < count; i++) accent[i] = sat[i] > .4 && lum[i] > .18 && lum[i] < .95 ? 1 : 0

  // Saturated horizontal segments: thin ones are rules or box edges.
  const segments: { y0: number; y1: number; x0: number; x1: number }[] = []
  for (let y = 0; y < H; y++) {
    let start = -1, gap = 0
    for (let x = 0; x <= W; x++) {
      const on = x < W && accent[y * W + x]
      if (on) { if (start < 0) start = x; gap = 0 }
      else if (start >= 0 && ++gap > 3) {
        const end = x - gap
        if (end - start >= W * .28) {
          const open = segments.find(s => y - s.y1 <= 1 && Math.abs(s.x0 - start) < W * .03 && Math.abs(s.x1 - end) < W * .03)
          if (open) { open.y1 = y; open.x0 = Math.min(open.x0, start); open.x1 = Math.max(open.x1, end) } else segments.push({ y0: y, y1: y, x0: start, x1: end })
        }
        start = -1; gap = 0
      }
    }
  }
  // A rule or box edge is a thin stroke with no colour just above or below it, not the edge of a coloured area (sky).
  const densityAt = (y: number, x0: number, x1: number) => { if (y < 0 || y >= H) return 0; let on = 0; for (let x = x0; x <= x1; x++) on += accent[y * W + x]; return on / (x1 - x0 + 1) }
  const thin = segments.filter(s => s.y1 - s.y0 <= H * .012 && densityAt(s.y0 - 4, s.x0, s.x1) < .25 && densityAt(s.y1 + 4, s.x0, s.x1) < .25)
  // Two thin segments of the same span joined by saturated verticals at both ends form an outlined box.
  let box: ReferenceMetrics['box'] = null
  const paired = new Set<any>()
  for (const top of thin) for (const bottom of thin) {
    if (bottom === top || bottom.y0 - top.y1 < H * .03 || bottom.y0 - top.y1 > H * .3) continue
    if (Math.abs(top.x0 - bottom.x0) > W * .03 || Math.abs(top.x1 - bottom.x1) > W * .03) continue
    const side = (x0: number) => { let hits = 0; for (let y = top.y1; y <= bottom.y0; y++) { let on = 0; for (let x = Math.max(0, x0 - 3); x <= Math.min(W - 1, x0 + 3); x++) on |= accent[y * W + x]; hits += on } return hits / (bottom.y0 - top.y1 + 1) }
    if (side(top.x0) < .7 || side(top.x1) < .7) continue
    // It must enclose copy: the interior carries dense contrast (lettering), not empty space or more colour.
    let strokes = 0, area = 0
    for (let y = top.y1 + 3; y < bottom.y0 - 2; y++) for (let x = top.x0 + 6; x < top.x1 - 6; x++) { area++; strokes += edge[y * W + x] }
    if (!area || strokes / area < .04) continue
    box = { x: top.x0 / W, y: top.y0 / H, width: (top.x1 - top.x0) / W, height: (bottom.y1 - top.y0) / H }
    paired.add(top); paired.add(bottom)
  }
  const rules = thin.filter(s => !paired.has(s)).length
  const panel = findPanel()

  // Solid panels, on a grid of 6px cells: cells mostly in one saturated colour join into areas. Lettering leaves holes,
  // so each row of an area is filled from its first to its last cell. An area is a panel when its colour is uniform,
  // it holds lettering, and it is not the whole background (a coloured surface).
  function findPanel(): ReferenceMetrics['panel'] {
    const C = 6, cols = Math.ceil(W / C), rows = Math.ceil(H / C)
    const share = new Float32Array(cols * rows)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) share[Math.floor(y / C) * cols + Math.floor(x / C)] += accent[y * W + x]
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) share[r * cols + c] /= Math.min(C, W - c * C) * Math.min(C, H - r * C)
    const seen = new Uint8Array(cols * rows)
    let best: ReferenceMetrics['panel'] = null, bestArea = 0
    for (let start = 0; start < cols * rows; start++) {
      if (seen[start] || share[start] < .6) continue
      const spans = new Map<number, [number, number]>(), queue = [start]
      let cells = 0
      seen[start] = 1
      while (queue.length) {
        const i = queue.pop()!, r = Math.floor(i / cols), c = i % cols, span = spans.get(r)
        cells++
        spans.set(r, span ? [Math.min(span[0], c), Math.max(span[1], c)] : [c, c])
        for (const [rr, cc] of [[r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]]) {
          const j = rr * cols + cc
          if (rr >= 0 && cc >= 0 && rr < rows && cc < cols && !seen[j] && share[j] >= .6) { seen[j] = 1; queue.push(j) }
        }
      }
      if (cells < cols * rows * .03 || cells > cols * rows * .7) continue
      let area = 0, colour = 0, ink = 0, strokes = 0
      const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]
      const pixels = (visit: (i: number) => void) => {
        for (const [r, [c0, c1]] of spans) for (let y = r * C; y < Math.min(H, r * C + C); y++) for (let x = c0 * C; x < Math.min(W, c1 * C + C); x++) visit(y * W + x)
      }
      pixels(i => {
        area++; strokes += edge[i]
        if (accent[i]) { colour++; for (let k = 0; k < 3; k++) hist[k][data[i * 3 + k]]++ }
        else if (lum[i] < .35 || lum[i] > .9) ink++
      })
      // Lettering inside (dense contrast), and nothing but the colour and dark or light letters.
      if (colour / area < .5 || (colour + ink) / area < .85 || strokes / area < .03) continue
      const median = hist.map(h => { let n = 0; for (let v = 0; v < 256; v++) if ((n += h[v]) >= colour / 2) return v; return 255 })
      let near = 0
      pixels(i => { if (accent[i] && Math.hypot(data[i * 3] - median[0], data[i * 3 + 1] - median[1], data[i * 3 + 2] - median[2]) < 60) near++ })
      if (near / colour < .8 || area <= bestArea) continue
      // A word highlight hugs one line of letters; a panel holds several lines, or one with a margin of colour around
      // it. Rows near the area's edges are skipped: its border against the background reads as strokes.
      const textRows: number[] = []
      for (const [r, [c0, c1]] of spans) for (let y = r * C; y < Math.min(H, r * C + C); y++) {
        if (!spans.has(Math.floor((y - 5) / C)) || !spans.has(Math.floor((y + 5) / C))) continue
        let on = 0, n = 0
        for (let x = c0 * C + 5; x < Math.min(W, c1 * C + C) - 5; x++) { n++; on += edge[y * W + x] }
        if (n && on / n >= .04) textRows.push(y)
      }
      textRows.sort((a, b) => a - b)
      const bands = textRows.filter((y, i) => i === 0 || y - textRows[i - 1] > 3).length
      const areaTop = Math.min(...spans.keys()) * C, areaBottom = Math.min(H, (Math.max(...spans.keys()) + 1) * C)
      const margin = textRows.length ? (textRows[0] - areaTop + areaBottom - textRows[textRows.length - 1]) / (areaBottom - areaTop) : 0
      if (bands < 2 && margin < .35) continue
      const top = Math.min(...spans.keys()), bottom = Math.max(...spans.keys())
      const left = Math.min(...[...spans.values()].map(s => s[0])), right = Math.max(...[...spans.values()].map(s => s[1]))
      bestArea = area
      best = { x: left * C / W, y: top * C / H, width: Math.min(W, (right + 1) * C) / W - left * C / W, height: Math.min(H, (bottom + 1) * C) / H - top * C / H }
    }
    return best
  }
  // Within 2% of a panel counts as on it: the panel's own edge against a photo reads as a line of coloured strokes.
  const inPanel = (l: { left: number; right: number; top: number; bottom: number }) => {
    if (!panel) return false
    const x = (l.left + l.right) / 2, y = (l.top + l.bottom) / 2
    return x >= panel.x - .02 && x <= panel.x + panel.width + .02 && y >= panel.y - .02 && y <= panel.y + panel.height + .02
  }

  // Copy lines: bands of rows with dense, compact contrast. Full-width texture (photos) and the box edges are ignored.
  const rowSpan = (y: number) => {
    const xs: number[] = []
    for (let x = 0; x < W; x++) if (edge[y * W + x] && !inBoxEdge(x / W, y / H)) xs.push(x)
    if (xs.length < W * .025) return null
    // Keep the densest run of edge pixels (words are joined across gaps up to ~4% of the width).
    let best: [number, number, number] | null = null, s = xs[0], prev = xs[0], n = 1
    for (let i = 1; i <= xs.length; i++) {
      if (i < xs.length && xs[i] - prev <= W * .04) { prev = xs[i]; n++; continue }
      if (!best || n > best[2]) best = [s, prev, n]
      if (i < xs.length) { s = xs[i]; prev = xs[i]; n = 1 }
    }
    return best && best[2] >= W * .02 ? { left: best[0], right: best[1] } : null
  }
  function inBoxEdge(x: number, y: number) {
    if (!box) return false
    const near = (a: number, b: number) => Math.abs(a - b) < .015
    return (near(x, box.x) || near(x, box.x + box.width)) && y >= box.y && y <= box.y + box.height || (near(y, box.y) || near(y, box.y + box.height)) && x >= box.x && x <= box.x + box.width
  }
  const lines: ReferenceMetrics['lines'] = []
  let band: { y0: number; y1: number; lefts: number[]; rights: number[] } | null = null
  for (let y = 0; y <= H; y++) {
    const span = y < H ? rowSpan(y) : null
    if (span) { band ||= { y0: y, y1: y, lefts: [], rights: [] }; band.y1 = y; band.lefts.push(span.left); band.rights.push(span.right); continue }
    if (band) {
      const height = band.y1 - band.y0 + 1
      const left = median(band.lefts), right = median(band.rights)
      // A copy line is a short band that keeps clear of both canvas edges and of the branding rows (logo, handle).
      if (height >= H * .012 && height <= H * .12 && right - left >= W * .1 && left > W * .03 && right < W * .97 && band.y0 > H * .09 && band.y1 < H * .95) lines.push({ left: left / W, right: right / W, top: band.y0 / H, bottom: band.y1 / H })
      band = null
    }
  }

  // Alignment from lines narrower than the copy area: centred lines share a midpoint, left lines a left edge.
  const informative = lines.filter(l => l.right - l.left < .8)
  let align: ReferenceMetrics['align'] = null
  if (informative.length >= 2) {
    const minLeft = Math.min(...informative.map(l => l.left)), maxRight = Math.max(...informative.map(l => l.right))
    const votes = { left: 0, center: 0, right: 0 }
    for (const l of informative) {
      const mid = (l.left + l.right) / 2
      if (Math.abs(mid - .5) < .035) votes.center++
      else if (Math.abs(l.left - minLeft) < .025) votes.left++
      else if (Math.abs(l.right - maxRight) < .025) votes.right++
    }
    const winner = (Object.entries(votes) as [keyof typeof votes, number][]).sort((a, b) => b[1] - a[1])[0]
    if (winner[1] >= 2 && winner[1] >= informative.length * .5) align = winner[0]
  }

  // Coloured copy: saturated pixels make up a real share of a line's strokes (box edges excluded). Copy set on a colour
  // panel is not coloured: the panel's colour borders every letter.
  const coloredText = lines.filter(l => !inPanel(l)).some(l => {
    let strokes = 0, colored = 0
    for (let y = Math.round(l.top * H); y <= Math.round(l.bottom * H); y++) for (let x = Math.round(l.left * W); x <= Math.round(l.right * W); x++) {
      const i = y * W + x
      if (!edge[i] || inBoxEdge(x / W, y / H)) continue
      strokes++; if (accent[i]) colored++
    }
    return strokes > 40 && colored / strokes > .25
  })
  return { align, box, panel, rules, coloredText, lines }
}

function median(values: number[]) { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

function boxBlur(src: Float32Array, W: number, H: number, r: number) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length)
  for (let y = 0; y < H; y++) { let sum = 0; for (let x = -r; x <= r; x++) sum += src[y * W + Math.min(W - 1, Math.max(0, x))]; for (let x = 0; x < W; x++) { tmp[y * W + x] = sum / (2 * r + 1); sum += src[y * W + Math.min(W - 1, x + r + 1)] - src[y * W + Math.max(0, x - r)] } }
  for (let x = 0; x < W; x++) { let sum = 0; for (let y = -r; y <= r; y++) sum += tmp[Math.min(H - 1, Math.max(0, y)) * W + x]; for (let y = 0; y < H; y++) { out[y * W + x] = sum / (2 * r + 1); sum += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x] } }
  return out
}

const LEFT_RULE = /left[- ]aligned|align(?:ed)? (?:to the )?left|alinhad[oa]s? à esquerda/i
const CENTRE_RULE = /cent(?:er|re)(?:d|ing)?\b|centrad[oa]/i

/**
 * Corrects a model-written study with what the reference pixels show. Only facts measured with confidence change:
 * alignment when the measured references agree, a headline box or panel per reference that has one, emphasis colour when no
 * reference sets copy in colour, and accent lines that were really a box's edges. Contradicting prose is dropped.
 */
export function applyReferenceMetrics(study: any, metrics: ReferenceMetrics[]) {
  if (!study?.grammar || !metrics.length) return study
  const grammar = { ...study.grammar }, rules = { familyRules: [...(study.familyRules || [])], variantRules: [...(study.variantRules || [])], avoid: [...(study.avoid || [])] }
  let prose = { composition: study.composition || '', typography: study.typography || '', hierarchy: study.hierarchy || '', decorative: study.decorative || '' }
  const references = (grammar.references || []).map((r: any, i: number) => metrics[i] ? { ...r, ...(metrics[i].align ? { align: metrics[i].align } : {}), frame: !!(metrics[i].box || metrics[i].panel) } : r)
  grammar.references = references

  const measured = metrics.map(m => m.align).filter(Boolean) as string[]
  const align = measured.length && measured.every(a => a === measured[0]) ? measured[0] : null
  if (align) {
    grammar.alignment = [align]
    // References that could not be measured follow the ones that agree.
    grammar.references = grammar.references.map((r: any, i: number) => metrics[i]?.align ? r : { ...r, align })
    const contradicts = align === 'center' ? LEFT_RULE : CENTRE_RULE
    rules.familyRules = rules.familyRules.filter((r: string) => !contradicts.test(r))
    rules.variantRules = rules.variantRules.filter((r: string) => !contradicts.test(r))
    // An anti-pattern that forbids the measured alignment is wrong too.
    rules.avoid = rules.avoid.filter((r: string) => !(align === 'center' ? CENTRE_RULE : LEFT_RULE).test(r))
    if (align === 'center') {
      prose = Object.fromEntries(Object.entries(prose).map(([k, v]) => [k, v.replace(/left[- ]aligned/gi, 'centred')])) as typeof prose
      if (!rules.familyRules.some((r: string) => CENTRE_RULE.test(r))) rules.familyRules.push('Copy is centred on the canvas.')
    }
  }
  const panelled = metrics.some(m => m.panel)
  if (panelled || metrics.some(m => m.box)) {
    grammar.headline = { ...grammar.headline, frame: panelled || grammar.headline?.frame === 'solid' ? 'solid' : 'outline' }
    if (!rules.familyRules.some((r: string) => /box|frame|border|panel|block/i.test(r))) rules.familyRules.push(panelled ? 'The key headline sits on a solid panel in the accent colour.' : 'The key headline sits inside a thin outlined box in the accent colour.')
  }
  // Supporting copy the model put in a callout shares the panel's treatment: a card, not plain copy.
  if (panelled && grammar.containers?.style === 'none' && grammar.containers.use?.includes('callout')) grammar.containers = { ...grammar.containers, style: 'card' }
  if (!metrics.some(m => m.coloredText) && (grammar.emphasis === 'color' || grammar.emphasis === 'background')) grammar.emphasis = 'none'
  // A "thin rule" with no measured rule was a box's edges.
  if (!metrics.some(m => m.rules) && Array.isArray(grammar.decorations)) grammar.decorations = grammar.decorations.filter((d: any) => d?.kind !== 'line')
  return { ...study, ...prose, ...rules, grammar }
}
