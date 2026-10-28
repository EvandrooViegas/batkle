import sharp from 'sharp'
import { downloadLogo } from './logoBackground'

export async function generateLogoVariants(source: string) {
  let input: Buffer
  if (source.startsWith('data:image/')) {
    if (source.length > 8 * 1024 * 1024) throw new Error('Logo image is too large')
    const comma = source.indexOf(',')
    if (comma < 0) throw new Error('Invalid logo data URL')
    input = /;base64/i.test(source.slice(0,comma)) ? Buffer.from(source.slice(comma+1),'base64') : Buffer.from(decodeURIComponent(source.slice(comma+1)),'utf8')
  } else input = await downloadLogo(source)
  return { source, ...await createLogoVariants(input) }
}

/** Decode ICO containers before passing their pixels to Sharp. */
async function normalizeLogo(input: Buffer): Promise<Buffer> {
  if (input.length < 6 || input.readUInt32LE(0) !== 0x10000) return input
  const count = input.readUInt16LE(4)
  if (!count || count > 256 || input.length < 6+count*16) throw new Error('Invalid ICO logo')
  const entries = Array.from({length:count},(_,i)=>{
    const at=6+i*16
    return {width:input[at]||256,height:input[at+1]||256,size:input.readUInt32LE(at+8),offset:input.readUInt32LE(at+12)}
  }).sort((a,b)=>b.width*b.height-a.width*a.height)
  for (const entry of entries) {
    if (entry.offset < 6+count*16 || entry.offset+entry.size > input.length) continue
    const data=input.subarray(entry.offset,entry.offset+entry.size)
    if (data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return data
    if (data.length<40 || data.readUInt32LE(0)!==40 || data.readUInt16LE(14)!==32 || data.readUInt32LE(16)!==0) continue
    const w=data.readInt32LE(4),h=data.readInt32LE(8)/2
    if(w!==entry.width || h!==entry.height || 40+w*h*4>data.length) continue
    const pixels=Buffer.alloc(w*h*4)
    let hasAlpha=false
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      const from=40+((h-1-y)*w+x)*4,to=(y*w+x)*4
      pixels[to]=data[from+2];pixels[to+1]=data[from+1];pixels[to+2]=data[from];pixels[to+3]=data[from+3]
      if(data[from+3])hasAlpha=true
    }
    const mask=40+w*h*4,stride=Math.ceil(w/32)*4
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const at=mask+(h-1-y)*stride+(x>>3),to=(y*w+x)*4+3
      if(!hasAlpha)pixels[to]=255
      if(at<data.length && (data[at] & (128>>(x%8))))pixels[to]=0
    }
    return sharp(pixels,{raw:{width:w,height:h,channels:4}}).png().toBuffer()
  }
  throw new Error('This favicon encoding is unsupported. Use a PNG, SVG or WebP brand logo.')
}

const relativeLuminance = (r: number, g: number, b: number) => {
  const [lr, lg, lb] = [r, g, b].map(c => { const v = c / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 })
  return lr * .2126 + lg * .7152 + lb * .0722
}
// Batkle's dark surface (#14131A) and white, the grounds the versions are made for.
const DARK_GROUND = relativeLuminance(0x14, 0x13, 0x1a)

/**
 * The share of the visible mark that would vanish on a dark ground (contrast below 1.8 with #14131A) and on white
 * (below 1.5): the outer shapes of that colour (segmentMark's depth 0), which the ground touches. A dark wordmark
 * beside a yellow symbol mostly vanishes on dark even though the mark's average reads; a yellow symbol on its own
 * dark plate never meets the ground, and nor does a dark glyph inside a yellow tile whose stem grazes the tile's edge.
 */
export function legibility(data: Buffer, width: number, height: number, segments = segmentMark(data, width, height)) {
  let ink = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] >= 128) ink++
  const { label, regions } = segments
  const fades = (ground: 'dark' | 'light') => regions.map(r => {
    const l = relativeLuminance(r.mean[0], r.mean[1], r.mean[2])
    return r.depth === 0 && (ground === 'dark' ? (l + .05) / (DARK_GROUND + .05) < 1.8 : 1.05 / (l + .05) < 1.5)
  })
  const onDark = fades('dark'), onLight = fades('light')
  let dark = 0, light = 0
  for (let i = 0; i < width * height; i++) {
    if (data[i * 4 + 3] < 128 || label[i] < 0) continue
    if (onDark[label[i]]) dark++
    if (onLight[label[i]]) light++
  }
  const share = (n: number) => (ink ? Math.round(n / ink * 1000) / 1000 : 0)
  return { lostOnDark: share(dark), lostOnLight: share(light) }
}

/** Versions made before this are made again (lib/services/brandLogoVariants.ts compares the saved `version`). */
export const LOGO_VARIANTS_VERSION = 2

const distanceTo = (data: Buffer, i: number, colour: number[]) => Math.max(Math.abs(data[i * 4] - colour[0]), Math.abs(data[i * 4 + 1] - colour[1]), Math.abs(data[i * 4 + 2] - colour[2]))
// How much a pixel is the colour of a region: 1 at its colour, 0 from FALLOFF away (an anti-aliased edge is in between).
const FALLOFF = 150
const closeness = (data: Buffer, i: number, colour: number[]) => Math.max(0, 1 - distanceTo(data, i, colour) / FALLOFF)

interface Region { mean: number[]; size: number; outside: number; boundary: number; neighbours: Map<number, number>; depth: number }

/**
 * The mark split into regions of one colour: each grows against its own running colour, so a white glyph inside a
 * yellow tile is a region of its own even where anti-aliasing blends the two. Each region has a depth: 0 for a shape
 * the background touches along a fair share of its edge (a tile, a letter), 1 for a detail inside it (the glyph),
 * 2 for a detail inside that, and so on. A detail that only grazes the edge (a glyph's stem reaching the tile's
 * border) still counts as inside. Slivers of anti-aliasing join the region they look most like.
 */
export function segmentMark(data: Buffer, width: number, height: number, tolerance = 56) {
  const count = width * height, label = new Int32Array(count).fill(-1), queue = new Int32Array(count)
  const visible = (i: number) => data[i * 4 + 3] > 8
  const around = (i: number) => {
    const x = i % width
    return [x ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i >= width ? i - width : -1, i < count - width ? i + width : -1]
  }
  const regions: Region[] = []
  for (let seed = 0; seed < count; seed++) {
    if (label[seed] >= 0 || !visible(seed)) continue
    const id = regions.length, sum = [data[seed * 4], data[seed * 4 + 1], data[seed * 4 + 2]], mean = [...sum]
    let size = 1, head = 0, tail = 0
    label[seed] = id; queue[tail++] = seed
    while (head < tail) for (const j of around(queue[head++])) {
      if (j < 0 || label[j] >= 0 || !visible(j) || distanceTo(data, j, mean) >= tolerance) continue
      label[j] = id; size++; queue[tail++] = j
      for (let c = 0; c < 3; c++) { sum[c] += data[j * 4 + c]; mean[c] = sum[c] / size }
    }
    regions.push({ mean, size, outside: 0, boundary: 0, neighbours: new Map(), depth: -1 })
  }
  // Slivers (an anti-aliased ring between two colours) join the neighbour whose colour they are closest to.
  const sliver = Math.max(12, count * 0.0003)
  const neighboursOf = (id: number) => {
    const found = new Map<number, number>()
    for (let i = 0; i < count; i++) if (label[i] === id) for (const j of around(i)) if (j >= 0 && label[j] >= 0 && label[j] !== id) found.set(label[j], (found.get(label[j]) || 0) + 1)
    return found
  }
  const merged = new Int32Array(regions.length).map((_, i) => i)
  const root = (id: number): number => (merged[id] === id ? id : (merged[id] = root(merged[id])))
  for (let id = 0; id < regions.length; id++) {
    if (regions[id].size >= sliver) continue
    let best = -1, bestDistance = Infinity
    for (const other of neighboursOf(id).keys()) {
      const target = root(other)
      if (target === id || regions[target].size < sliver) continue
      const d = Math.max(...[0, 1, 2].map(c => Math.abs(regions[id].mean[c] - regions[target].mean[c])))
      if (d < bestDistance) { bestDistance = d; best = target }
    }
    if (best >= 0) { merged[id] = best; regions[best].size += regions[id].size }
  }
  for (let i = 0; i < count; i++) if (label[i] >= 0) label[i] = root(label[i])
  // Edges: what each region borders, the outside (transparency or the image's edge) or another region.
  for (let i = 0; i < count; i++) {
    const own = label[i]
    if (own < 0) continue
    for (const j of around(i)) {
      const region = regions[own]
      if (j < 0 || data[j * 4 + 3] < 64) { region.outside++; region.boundary++ } else if (label[j] !== own) { region.boundary++; region.neighbours.set(label[j], (region.neighbours.get(label[j]) || 0) + 1) }
    }
  }
  // Depth: outer shapes first, then whatever each level encloses.
  const live = regions.map((r, id) => (root(id) === id ? id : -1)).filter(id => id >= 0)
  let level = live.filter(id => regions[id].boundary && regions[id].outside / regions[id].boundary >= 0.25)
  for (let depth = 0; level.length; depth++) {
    for (const id of level) regions[id].depth = depth
    const next = new Set<number>()
    for (const id of level) for (const other of regions[id].neighbours.keys()) if (regions[other].depth < 0) next.add(other)
    level = [...next]
  }
  // A region reached from nowhere (a shape inside another that only touches through transparency) counts as outer.
  for (const id of live) if (regions[id].depth < 0) regions[id].depth = 0
  return { label, regions }
}

const luminanceOf = (c: number[]) => relativeLuminance(c[0], c[1], c[2])
const contrastOf = (a: number, b: number) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
const neutralColour = (c: number[]) => Math.max(...c) - Math.min(...c) < 40

/**
 * The mark made to read on a dark or a light ground, without keeping its exact colours. For each outer shape that
 * would fade on that ground (a dark tile or wordmark on dark; a yellow tile or a white wordmark on white):
 * - when it holds a main detail that reads on the ground (a yellow glyph in a dark tile), the shape and the detail
 *   swap colours, as a designer's reversed logo does: a dark tile with a yellow glyph becomes a yellow tile with a
 *   dark glyph, and back;
 * - otherwise it turns white (on dark) or black (on light), the parts of it showing through its details follow, and
 *   a colourless detail that would then vanish flips: black becomes white and white black.
 * Shapes that already read keep their colours. Null when nothing would change.
 */
export function adaptToGround(data: Buffer, width: number, height: number, ground: 'dark' | 'light', segments = segmentMark(data, width, height)): Buffer | null {
  const { label, regions } = segments
  const dark = ground === 'dark', ink = dark ? [255, 255, 255] : [0, 0, 0], groundLuminance = dark ? DARK_GROUND : 1
  const reads = (colour: number[]) => contrastOf(luminanceOf(colour), groundLuminance) >= (dark ? 1.8 : 1.5)
  const apart = (a: number[], b: number[]) => Math.max(...[0, 1, 2].map(c => Math.abs(a[c] - b[c])))
  const outer = regions.map((r, id) => id).filter(id => regions[id].depth === 0 && regions[id].size > 0 && !reads(regions[id].mean))
  if (!outer.length) return null
  // Each pixel's new colour: [regions it belongs to] → how it changes. Later shapes never undo earlier ones, since
  // a region belongs to one outer shape's inside at most.
  const plan = new Map<number, (i: number, out: Buffer) => void>()
  for (const id of outer) {
    const shape = regions[id], A = shape.mean
    // The shape's inside: the regions below it, reached through its neighbours.
    const inside: number[] = [], seen = new Set([id]), queue = [id]
    while (queue.length) {
      const at = queue.shift()!
      for (const other of regions[at].neighbours.keys()) if (!seen.has(other) && regions[other].depth > regions[at].depth) { seen.add(other); inside.push(other); queue.push(other) }
    }
    const details = inside.filter(other => regions[other].depth === shape.depth + 1).sort((a, b) => (shape.neighbours.get(b) || 0) - (shape.neighbours.get(a) || 0))
    const main = details.find(other => reads(regions[other].mean) && apart(regions[other].mean, A) > 60)
    if (main !== undefined) {
      // Swap the two colours across the shape and its inside; anti-aliased pixels between them stay in between.
      const B = regions[main].mean
      const swap = (i: number, out: Buffer) => {
        const toB = closeness(data, i, A), toA = closeness(data, i, B)
        for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(Math.min(255, Math.max(0, data[i * 4 + c] + (B[c] - A[c]) * toB + (A[c] - B[c]) * toA)))
      }
      for (const r of [id, ...inside]) plan.set(r, swap)
      continue
    }
    // To ink: the shape, and the parts of it showing through its details (its colour, deeper inside).
    const follows = new Set([id, ...inside.filter(other => (regions[other].depth - shape.depth) % 2 === 0 && apart(regions[other].mean, A) < 60)])
    for (const r of [id, ...inside]) {
      const flip = !follows.has(r) && neutralColour(regions[r].mean) && contrastOf(luminanceOf(regions[r].mean), luminanceOf(ink)) < 2
      plan.set(r, (i, out) => {
        // Where a pixel blends into the shape's colour (an edge) it moves with it, by how much it is that colour.
        const w = follows.has(r) ? 1 : closeness(data, i, A)
        for (let c = 0; c < 3; c++) {
          const shifted = w >= .9 ? ink[c] : data[i * 4 + c] + (ink[c] - A[c]) * w
          out[i * 4 + c] = Math.round(Math.min(255, Math.max(0, flip ? 255 - shifted : shifted)))
        }
      })
    }
  }
  const out = Buffer.from(data)
  for (let i = 0; i < width * height; i++) {
    const step = label[i] >= 0 ? plan.get(label[i]) : undefined
    if (step) step(i, out)
  }
  return out
}

/**
 * The alpha of a one-colour version: outer shapes are filled, the details inside them are cut out (so a glyph inside
 * a tile shows through), details inside those are filled again, and so on. Anti-aliased edges between them stay soft.
 */
export function oneColourAlpha(data: Buffer, width: number, height: number, segments = segmentMark(data, width, height)) {
  const { label, regions } = segments
  const count = width * height, alpha = new Uint8Array(count)
  const filled = (id: number) => regions[id].depth % 2 === 0
  for (let i = 0; i < count; i++) {
    const id = label[i]
    if (id < 0) continue
    const x = i % width
    // Only where a filled region meets a cut-out one is the edge softened by how much each pixel is its region's
    // colour; inside a region (a gradient too) it is fully filled or fully cut out.
    const edge = [x ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i >= width ? i - width : -1, i < count - width ? i + width : -1]
      .some(j => j >= 0 && label[j] >= 0 && filled(label[j]) !== filled(id))
    const share = edge ? Math.min(1, closeness(data, i, regions[id].mean) * 1.4) : 1
    alpha[i] = Math.round(data[i * 4 + 3] * (filled(id) ? share : 1 - share))
  }
  return alpha
}

/** Flood-fill a uniform border, preserving enclosed details and existing alpha. */
export async function createLogoVariants(input: Buffer) {
  const { data, info } = await sharp(await normalizeLogo(input), { limitInputPixels: 4000000 }).rotate()
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info, count = width * height
  const border: number[] = []
  for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x)
  for (let y = 1; y < height - 1; y++) border.push(y * width, y * width + width - 1)
  const opaqueCoverage=Array.from({length:count},(_,i)=>data[i*4+3]>=250?1:0).reduce((a,b)=>a+b,0)/count
  // A few transparent corner pixels do not make an otherwise solid logo transparent.
  if (!border.some(i => data[i * 4 + 3] < 250) || opaqueCoverage>.94) {
    const distance = (i: number, j: number) => Math.max(...[0, 1, 2].map(c => Math.abs(data[i * 4 + c] - data[j * 4 + c])))
    const seed = border.find(i => data[i*4+3]>=250 && border.filter(j => data[j*4+3]>=250&&distance(i, j) < 24).length / border.length >= .55)
    if (seed === undefined) throw new Error('Use a logo with transparency or a uniform background to generate variants.')
    const seen = new Uint8Array(count), queue = new Int32Array(count)
    let head = 0, tail = 0
    const visit = (i: number) => { if (!seen[i] && distance(seed, i) < 32) { seen[i] = 1; queue[tail++] = i } }
    border.forEach(visit)
    while (head < tail) {
      const i = queue[head++], x = i % width
      if (x) visit(i - 1)
      if (x < width - 1) visit(i + 1)
      if (i >= width) visit(i - width)
      if (i < count - width) visit(i + width)
    }
    for (let i = 0; i < count; i++) if (seen[i]) data[i * 4 + 3] = 0
  }
  if (!data.some((v, i) => i % 4 === 3 && v > 0)) throw new Error('No visible logo found.')
  // Variants are cropped to the visible mark: padding inside a logo file would make it look small and misaligned.
  let crop: { left: number; top: number; width: number; height: number } | null = null
  const encode = async (pixels: Buffer, background?: string) => {
    let image = sharp(pixels, { raw: { width, height, channels: 4 } })
    if (crop) image = sharp(await image.extract(crop).png().toBuffer())
    if (background) image = image.flatten({ background })
    return 'data:image/png;base64,' + (await image.png().toBuffer()).toString('base64')
  }
  const black = Buffer.from(data), white = Buffer.from(data)
  // A dark/light badge with contrasting lettering must not become one solid silhouette.
  // Keep the original artwork; extract its contrasting ink only for monochrome variants.
  let dark = 0, light = 0, opaque = 0
  for (let i=0;i<data.length;i+=4) {
    if (data[i+3]<220) continue
    opaque++
    const lo=Math.min(data[i],data[i+1],data[i+2]), hi=Math.max(data[i],data[i+1],data[i+2])
    if(hi-lo>35) continue
    if(hi<65) dark++
    if(lo>190) light++
  }
  const darkBadge = opaque/count>.45 && dark/opaque>.65 && light/opaque>.02 && light/opaque<.3
  const lightBadge = opaque/count>.45 && light/opaque>.65 && dark/opaque>.02 && dark/opaque<.3
  const segments = segmentMark(data, width, height)
  if(darkBadge || lightBadge) {
    for(let i=0;i<data.length;i+=4) {
      const luminance=(data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722)/255
      const ink=darkBadge?luminance:1-luminance
      black[i+3]=white[i+3]=Math.round(data[i+3]*ink)
    }
  } else {
    // One colour, but the details inside each shape are cut out instead of filled with it.
    const alpha = oneColourAlpha(data, width, height, segments)
    for (let i = 0; i < count; i++) black[i * 4 + 3] = white[i * 4 + 3] = alpha[i]
  }
  // Validate the extracted mark, not the badge before its background is removed.
  const markCoverage=Array.from({length:count},(_,i)=>black[i*4+3]>220?1:0).reduce((a,b)=>a+b,0)/count
  if(markCoverage>.94)throw new Error('Logo artwork could not be separated from its background.')
  // Relative luminance of the original artwork's ink, so a layout can tell whether it reads on a given surface.
  let inkSum = 0, inkCount = 0
  // The visible mark's box. Variants are cropped to it, so `bounds` (where the mark sits in the stored file) is the
  // whole image and `imageAspect` is the mark's own proportion.
  let left = width, top = height, right = -1, bottom = -1
  for (let i = 0; i < count; i++) if (data[i * 4 + 3] > 12) {
    const x = i % width, y = Math.floor(i / width)
    if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y
  }
  const round = (v: number) => Math.round(v * 10000) / 10000
  if (right >= 0) crop = { left, top, width: right - left + 1, height: bottom - top + 1 }
  const bounds = { x: 0, y: 0, width: 1, height: 1 }
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const [r, g, b] = [0, 1, 2].map(c => { const v = data[i + c] / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 })
    inkSum += r * .2126 + g * .7152 + b * .0722; inkCount++
  }
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) { black[i + c] = 0; white[i + c] = 255 }
  const { lostOnDark, lostOnLight } = legibility(data, width, height, segments)
  const reversed = adaptToGround(data, width, height, 'dark', segments), darkened = adaptToGround(data, width, height, 'light', segments)
  return {
    version: LOGO_VARIANTS_VERSION,
    inkLightness: inkCount ? Math.round(inkSum / inkCount * 1000) / 1000 : null, imageAspect: round(crop ? crop.width / crop.height : width / height), bounds,
    lostOnDark, lostOnLight,
    ...(reversed ? { reversedTransparent: await encode(reversed) } : {}),
    ...(darkened ? { darkenedTransparent: await encode(darkened) } : {}),
    originalTransparent: await encode(data), blackTransparent: await encode(black), whiteTransparent: await encode(white),
    blackOnWhite: await encode(black, '#ffffff'), whiteOnBlack: await encode(white, '#000000'),
    originalOnWhite: await encode(data, '#ffffff'), originalOnBlack: await encode(data, '#000000'),
  }
}
