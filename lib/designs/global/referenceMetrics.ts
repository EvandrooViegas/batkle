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
  /** Bands across the whole width repeating down the slide (blinds over a photo): thickness, strength, coloured or not. */
  stripes?: { scale: 'small' | 'medium' | 'large' | 'oversized'; opacity: number; colored: boolean } | null
}

const WIDTH = 540
// A stripe's height for each decoration scale, as compose draws it (share of the slide height).
const STRIPE_BAR = { small: .006, medium: .01, large: .016, oversized: .024 } as const

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
  return { align, box, panel, rules, coloredText, lines, stripes: findStripes(data, lum, W, H, lines) }
}

/**
 * Bands across the slide that repeat down it, like blinds over a photo. They are found from their edges: from one row to
 * the next a band's edge turns most of a stretch of row lighter (or darker) at once, however faint, where a photo's edges
 * do not line up. Half the width or more must repeat like that (a striped thing in a photo covers less), over a quarter
 * of the height or more, away from the copy lines (lines of type repeat too). Vision models read coloured bands as a
 * faint neutral texture, so whether they are coloured, and how strongly, is measured here as well.
 */
function findStripes(data: Buffer, lum: Float32Array, W: number, H: number, lines: ReferenceMetrics['lines']): ReferenceMetrics['stripes'] {
  const SLICES = 6, x0 = Math.round(W * .05), sliceW = Math.floor(W * .9 / SLICES)
  const win = Math.round(H * .16), maxLag = Math.round(H * .06)
  // Per column slice and row: the mean colour and lightness, and the share of pixels that get lighter from the row above
  // to the row below minus the share that get darker.
  const slices = Array.from({ length: SLICES }, (_, s) => {
    const colour = new Float32Array(H * 3), light = new Float32Array(H), edges = new Float32Array(H)
    for (let y = 0; y < H; y++) for (let x = x0 + s * sliceW; x < x0 + (s + 1) * sliceW; x++) {
      const i = y * W + x
      for (let c = 0; c < 3; c++) colour[y * 3 + c] += data[i * 3 + c] / sliceW
      light[y] += lum[i] / sliceW
      if (y > 0 && y < H - 1) { const d = lum[i + W] - lum[i - W]; if (d > .012) edges[y] += 1 / sliceW; else if (d < -.012) edges[y] -= 1 / sliceW }
    }
    return { colour, light, edges }
  })
  // The band period: the first lag at which a stretch of edges matches itself strongly, after an opposite-phase dip. Too
  // weak a signal is a sparse pattern (a dot grid flips only a few pixels per row), not bands.
  const periodOf = (edges: Float32Array, y0: number) => {
    let mean = 0, energy = 0
    for (let y = y0; y < y0 + win; y++) mean += edges[y] / win
    for (let y = y0; y < y0 + win; y++) energy += (edges[y] - mean) ** 2
    if (Math.sqrt(energy / win) < .2) return 0
    const at = (lag: number) => { let sum = 0; for (let y = y0; y + lag < y0 + win; y++) sum += (edges[y] - mean) * (edges[y + lag] - mean); return sum / energy * win / (win - lag) }
    let low = 1
    for (let lag = 2; lag <= maxLag; lag++) {
      const here = at(lag)
      low = Math.min(low, here)
      if (lag >= 4 && here > .4 && low < -.2 && here >= at(lag - 1) && here >= at(lag + 1)) return lag
    }
    return 0
  }
  const found: { y0: number; slice: number; period: number }[] = []
  for (let y0 = 0; y0 + win <= H; y0 += Math.round(win / 2)) {
    if (lines.some(l => l.top * H < y0 + win && l.bottom * H > y0)) continue
    const here = slices.map((s, slice) => ({ y0, slice, period: periodOf(s.edges, y0) })).filter(f => f.period)
    if (here.length >= SLICES / 2) found.push(...here)
  }
  const covered = new Set(found.flatMap(f => Array.from({ length: win }, (_, i) => f.y0 + i)))
  if (covered.size < H * .25) return null

  // In each banded stretch, rows lighter than the rows half a period away are one phase and darker ones the other. The
  // stretch reads as coloured bands when its lighter rows are clearly colourful, and clearly more so than the darker
  // ones (white bands over a warm photo are paler than the photo). Their strength is the lowest opacity that turns the
  // darker rows into the lighter ones.
  const chroma = (c: number[]) => Math.max(...c) - Math.min(...c)
  const parts = found.map(({ y0, slice, period }) => {
    const { colour, light } = slices[slice], h = Math.max(1, Math.round(period / 2)), phases = [[0, 0, 0, 0], [0, 0, 0, 0]]
    for (let y = Math.max(h, y0); y < Math.min(H - h, y0 + win); y++) {
      const d = light[y] - (light[y - h] + light[y + h]) / 2
      if (Math.abs(d) < .02) continue
      const p = phases[d > 0 ? 0 : 1]
      for (let c = 0; c < 3; c++) p[c] += colour[y * 3 + c]
      p[3]++
    }
    if (!phases[0][3] || !phases[1][3]) return null
    const [lighter, darker] = phases.map(p => p.slice(0, 3).map(v => v / p[3]))
    let reach = Infinity
    for (let c = 0; c < 3; c++) { const shift = lighter[c] - darker[c]; if (shift > .5) reach = Math.min(reach, (255 - darker[c]) / shift) }
    return { weight: Math.abs(lighter.reduce((a, b) => a + b) - darker.reduce((a, b) => a + b)), colored: chroma(lighter) > 45 && chroma(lighter) > chroma(darker) * 1.3, opacity: Number.isFinite(reach) ? 100 / Math.max(1, reach) : 0 }
  }).filter(Boolean) as { weight: number; colored: boolean; opacity: number }[]
  // The stripes look like their strongest stretches, so stronger stretches count for more.
  const total = parts.reduce((sum, p) => sum + p.weight ** 2, 0)
  const colored = total > 0 && parts.filter(p => p.colored).reduce((sum, p) => sum + p.weight ** 2, 0) >= total / 2
  // Bands may fade, so the strength is the strongest coloured stretch's. That lowest opacity assumes the brightest colour
  // of its hue; a brand colour is deeper and needs about a third more to look the same.
  const opacity = Math.max(0, ...parts.filter(p => p.colored).map(p => p.opacity))
  const bar = median(found.map(f => f.period)) / 2 / H
  const scale = (Object.keys(STRIPE_BAR) as (keyof typeof STRIPE_BAR)[]).reduce((best, s) => Math.abs(Math.log(bar / STRIPE_BAR[s])) < Math.abs(Math.log(bar / STRIPE_BAR[best])) ? s : best)
  return { scale, colored, opacity: Math.round(Math.min(85, Math.max(15, opacity * 1.35))) }
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
  // Bands across the slide keep their measured thickness; coloured ones are in the accent colour at their measured
  // strength (the model calls them a faint neutral texture), and are added when the model missed them.
  const banded = metrics.map(m => m.stripes).filter(Boolean) as NonNullable<ReferenceMetrics['stripes']>[]
  if (banded.length && Array.isArray(grammar.decorations)) {
    const listed = grammar.decorations.find((d: any) => d?.kind === 'stripes'), coloured = banded.filter(s => s.colored)
    if (listed || coloured.length) {
      const measured = {
        placement: 'background', ...listed, kind: 'stripes', scale: banded[0].scale,
        frequency: banded.length * 2 > metrics.length ? 'every' : 'some',
        ...(coloured.length ? { color: 'accent', opacity: Math.max(...coloured.map(s => s.opacity)) } : { color: listed.color || 'foreground', opacity: listed.opacity ?? 20 }),
      }
      grammar.decorations = listed ? grammar.decorations.map((d: any) => d === listed ? measured : d) : [...grammar.decorations.slice(0, 5), measured]
      if (coloured.length && rules.familyRules.length < 16 && !rules.familyRules.some((r: string) => /stripe|band|blind|scanline/i.test(r))) rules.familyRules.push('Bands in the accent colour run across the slide, over the photo, fading toward the copy.')
    }
  }
  return { ...study, ...prose, ...rules, grammar }
}
