import { parseStyledText, resolveCanvasClass } from '@/lib/styleParser'

/* Constants and pure helpers shared by the editor's canvas and panels. */

export const STACKED_COPY = /^(eyebrow|eyebrow-pill|headline|headline-frame|body|cta|item|item-card|marker|marker-glyph|marker-dot|badge|badge-logo|badge-mark|callout-card|accent-line)$/
export const MIN_ZOOM = 0.08
export const MAX_ZOOM = 4
export const ZOOM_STEP = 0.1
export const SNAP_THRESHOLD = 8
export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024

/** Selection colours on the canvas: a tool convention, readable on light and dark posts alike. */
export const SELECT = '#6366f1'
export const SNAP = '#ec4899'
export const CROP = '#f59e0b'

export function collectSnapTargets(nodes, excludeIds = [], canvasW, canvasH) {
  const v = [0, canvasW / 2, canvasW]
  const h = [0, canvasH / 2, canvasH]
  for (const n of nodes || []) {
    if (excludeIds.includes(n.id)) continue
    v.push(n.x, n.x + n.width / 2, n.x + n.width)
    h.push(n.y, n.y + n.height / 2, n.y + n.height)
  }
  return { v, h }
}

export function snapMovePosition(rawX, rawY, w, h, targetsV, targetsH, threshold = SNAP_THRESHOLD) {
  let newX = rawX
  let newY = rawY
  const lines = []
  const xEdges = [
    { get: () => newX, set: (v) => { newX = v } },
    { get: () => newX + w / 2, set: (v) => { newX = v - w / 2 } },
    { get: () => newX + w, set: (v) => { newX = v - w } },
  ]
  const yEdges = [
    { get: () => newY, set: (v) => { newY = v } },
    { get: () => newY + h / 2, set: (v) => { newY = v - h / 2 } },
    { get: () => newY + h, set: (v) => { newY = v - h } },
  ]
  for (const edge of xEdges) {
    for (const pos of targetsV) {
      if (Math.abs(edge.get() - pos) < threshold) {
        edge.set(pos)
        if (!lines.some((l) => l.type === 'v' && l.pos === pos)) lines.push({ type: 'v', pos })
        break
      }
    }
  }
  for (const edge of yEdges) {
    for (const pos of targetsH) {
      if (Math.abs(edge.get() - pos) < threshold) {
        edge.set(pos)
        if (!lines.some((l) => l.type === 'h' && l.pos === pos)) lines.push({ type: 'h', pos })
        break
      }
    }
  }
  return { x: Math.round(newX), y: Math.round(newY), lines }
}

export function snapResizeBox(x, y, w, h, targetsV, targetsH, threshold = SNAP_THRESHOLD) {
  let nx = x
  let ny = y
  let nw = w
  let nh = h
  const lines = []
  const right = x + w
  const bottom = y + h
  for (const pos of targetsV) {
    if (Math.abs(right - pos) < threshold) { nw = pos - x; if (!lines.some((l) => l.type === 'v' && l.pos === pos)) lines.push({ type: 'v', pos }); break }
  }
  for (const pos of targetsH) {
    if (Math.abs(bottom - pos) < threshold) { nh = pos - y; if (!lines.some((l) => l.type === 'h' && l.pos === pos)) lines.push({ type: 'h', pos }); break }
  }
  for (const pos of targetsV) {
    if (Math.abs(x - pos) < threshold) { const delta = pos - x; nx = pos; nw = w - delta; if (!lines.some((l) => l.type === 'v' && l.pos === pos)) lines.push({ type: 'v', pos }); break }
  }
  for (const pos of targetsH) {
    if (Math.abs(y - pos) < threshold) { const delta = pos - y; ny = pos; nh = h - delta; if (!lines.some((l) => l.type === 'h' && l.pos === pos)) lines.push({ type: 'h', pos }); break }
  }
  return { x: Math.round(nx), y: Math.round(ny), w: Math.max(20, Math.round(nw)), h: Math.max(20, Math.round(nh)), lines }
}

// Font config (mirrors lib/fonts.js)
export const FONT_META = {
  'Inter': { weights: [400, 700], italic: false },
  'Roboto': { weights: [300, 400, 500, 700, 900], italic: true },
  'Poppins': { weights: [300, 400, 500, 600, 700, 800, 900], italic: true },
  'Oswald': { weights: [300, 400, 500, 600, 700], italic: false },
  'Montserrat': { weights: [400, 500, 600, 700, 800, 900], italic: true },
  'Playfair Display': { weights: [400, 500, 600, 700, 800, 900], italic: true },
  'Bebas Neue': { weights: [400], italic: false },
  'Dancing Script': { weights: [400, 500, 600, 700], italic: false },
  'Pacifico': { weights: [400], italic: false },
  'Lobster': { weights: [400], italic: false },
  'Raleway': { weights: [400, 500, 600, 700, 800, 900], italic: true },
  'Lato': { weights: [300, 400, 700, 900], italic: true },
  'Open Sans': { weights: [400, 500, 600, 700, 800], italic: true },
}
export const WEIGHT_LABELS = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' }

/** Font choices for a text layer: the known fonts, plus a brand font the design brought in. */
export function fontChoices(current) {
  const names = Object.keys(FONT_META)
  return current && !names.includes(current) ? [current, ...names] : names
}

export const getCanvasClassStyle = (classes = {}, className = '') => resolveCanvasClass(classes, className)?.style || {}
export const normalizeClassTagName = (classes = {}, className = '') => {
  if (!className) return ''
  const resolved = resolveCanvasClass(classes, className)
  if (resolved?.key) return resolved.key.startsWith('.') ? resolved.key : `.${resolved.key}`
  return className.startsWith('.') ? className : `.${className}`
}
export const classAttr = className => (className ? (className.startsWith('.') ? className.slice(1) : className) : '')

export const GRADIENT_PRESETS = [
  { name: 'Sunset', stops: [{ color: '#ff7e5f', position: 0, alpha: 100 }, { color: '#feb47b', position: 100, alpha: 100 }], angle: 135 },
  { name: 'Purple Haze', stops: [{ color: '#667eea', position: 0, alpha: 100 }, { color: '#764ba2', position: 100, alpha: 100 }], angle: 135 },
  { name: 'Ocean', stops: [{ color: '#2193b0', position: 0, alpha: 100 }, { color: '#6dd5ed', position: 100, alpha: 100 }], angle: 135 },
  { name: 'Pink Bloom', stops: [{ color: '#ec4899', position: 0, alpha: 100 }, { color: '#8b5cf6', position: 100, alpha: 100 }], angle: 90 },
  { name: 'Forest', stops: [{ color: '#134e5e', position: 0, alpha: 100 }, { color: '#71b280', position: 100, alpha: 100 }], angle: 135 },
  { name: 'Fire', stops: [{ color: '#f12711', position: 0, alpha: 100 }, { color: '#f5af19', position: 100, alpha: 100 }], angle: 45 },
  { name: 'Glass', stops: [{ color: '#ffffff', position: 0, alpha: 80 }, { color: '#ffffff', position: 100, alpha: 0 }], angle: 180 },
  { name: 'Fade Out', stops: [{ color: '#000000', position: 0, alpha: 0 }, { color: '#000000', position: 100, alpha: 80 }], angle: 180 },
  { name: 'Solar', gradientType: 'radial', radialShape: 'circle', focalX: 50, focalY: 50, stops: [{ color: '#ffd700', position: 0, alpha: 100 }, { color: '#ff4500', position: 100, alpha: 100 }], angle: 0 },
  { name: 'Neon Glow', gradientType: 'radial', radialShape: 'circle', focalX: 50, focalY: 50, stops: [{ color: '#00f5ff', position: 0, alpha: 100 }, { color: '#7b00ff', position: 100, alpha: 100 }], angle: 0 },
  { name: 'Spotlight', gradientType: 'radial', radialShape: 'ellipse', focalX: 50, focalY: 30, stops: [{ color: '#ffffff', position: 0, alpha: 90 }, { color: '#000000', position: 100, alpha: 100 }], angle: 0 },
  { name: 'Halo', gradientType: 'radial', radialShape: 'circle', focalX: 50, focalY: 50, stops: [{ color: '#ffffff', position: 0, alpha: 100 }, { color: '#6366f1', position: 60, alpha: 80 }, { color: '#000000', position: 100, alpha: 100 }], angle: 0 },
]

/** Post sizes worth offering for social posts; every slide of a carousel shares one size. */
export const SIZE_PRESETS = [
  { label: 'Portrait', ratio: '4:5', w: 1080, h: 1350 },
  { label: 'Square', ratio: '1:1', w: 1080, h: 1080 },
  { label: 'Story', ratio: '9:16', w: 1080, h: 1920 },
  { label: 'Landscape', ratio: '16:9', w: 1920, h: 1080 },
]

export const IMAGE_MASKS = [
  { value: 'none', label: 'None', css: { borderRadius: 2 } },
  { value: 'rounded', label: 'Rounded', css: { borderRadius: 6 } },
  { value: 'pill', label: 'Pill', css: { borderRadius: 999 } },
  { value: 'circle', label: 'Circle', css: { borderRadius: '50%' } },
  { value: 'triangle', label: 'Triangle', css: { clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' } },
  { value: 'triangle-down', label: 'Triangle down', css: { clipPath: 'polygon(0% 0%, 100% 0%, 50% 100%)' } },
  { value: 'diamond', label: 'Diamond', css: { clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' } },
  { value: 'pentagon', label: 'Pentagon', css: { clipPath: 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)' } },
  { value: 'hexagon', label: 'Hexagon', css: { clipPath: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)' } },
  { value: 'star', label: 'Star', css: { clipPath: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)' } },
  { value: 'arrow-right', label: 'Arrow', css: { clipPath: 'polygon(0% 20%, 60% 20%, 60% 0%, 100% 50%, 60% 100%, 60% 80%, 0% 80%)' } },
  { value: 'parallelogram', label: 'Slant', css: { clipPath: 'polygon(15% 0%, 100% 0%, 85% 100%, 0% 100%)' } },
]
export const POLYGON_MASKS = Object.fromEntries(IMAGE_MASKS.filter(m => m.css.clipPath).map(m => [m.value, m.css.clipPath]))

export const DEFAULT_FILTERS = { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, blur: 0, sepia: 0, hueRotate: 0, opacity: 100 }

export function plainTextFromStyled(text = '') {
  const walk = (tokens) => tokens.map((t) => {
    if (typeof t === 'string') return t
    if (t?.children?.length) return walk(t.children)
    return ''
  }).join('')
  // Collapse multiple consecutive spaces to single space, but preserve leading/trailing spaces
  return walk(parseStyledText(text || '', {})).replace(/[ \t]+/g, ' ')
}

export function buildGradientCssClient(node) {
  const stops = (node.stops || [{ color: '#6366f1', position: 0, alpha: 100 }, { color: '#ec4899', position: 100, alpha: 100 }])
    .slice()
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map((s) => {
      const a = (typeof s.alpha === 'number' ? s.alpha : 100) / 100
      const hex = s.color || '#000000'
      const r = parseInt(hex.slice(1, 3), 16) || 0
      const g = parseInt(hex.slice(3, 5), 16) || 0
      const b = parseInt(hex.slice(5, 7), 16) || 0
      return `rgba(${r},${g},${b},${a}) ${s.position || 0}%`
    })
    .join(', ')
  if (node.gradientType === 'radial') {
    const fx = typeof node.focalX === 'number' ? node.focalX : 50
    const fy = typeof node.focalY === 'number' ? node.focalY : 50
    return `radial-gradient(circle at ${fx}% ${fy}%, ${stops})`
  }
  const angle = typeof node.angle === 'number' ? node.angle : 90
  return `linear-gradient(${angle}deg, ${stops})`
}

export function buildFilterCss(filters) {
  const f = { ...DEFAULT_FILTERS, ...(filters || {}) }
  return `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%) grayscale(${f.grayscale}%) sepia(${f.sepia}%) hue-rotate(${f.hueRotate}deg) blur(${f.blur}px) opacity(${f.opacity}%)`
}

export function nodeLayerLabel(n) {
  if (n.name?.trim()) return n.name.trim()
  if (n.type === 'text') return plainTextFromStyled(n.text || '').trim() || 'Empty text'
  if (n.type === 'image') return 'Image'
  if (n.type === 'gradient') return 'Gradient'
  return n.shape === 'ellipse' ? 'Circle' : 'Rectangle'
}

export const NODE_KIND = { text: 'Text', image: 'Image', gradient: 'Gradient', shape: 'Shape' }

/** Text to add from the Add panel, sized to the post. */
export const TEXT_PRESETS = {
  heading: { label: 'Heading', text: 'Add a heading', size: 0.085, weight: 700, width: 0.8 },
  subheading: { label: 'Subheading', text: 'Add a subheading', size: 0.05, weight: 600, width: 0.7 },
  body: { label: 'Body text', text: 'Add a little body text', size: 0.033, weight: 400, width: 0.6 },
}

/**
 * A new text layer that matches the post: headings take the font and colour of its largest text,
 * body text those of its smallest.
 */
export function textPreset(canvas, kind) {
  const preset = TEXT_PRESETS[kind] || TEXT_PRESETS.body
  const texts = (canvas.nodes || []).filter(n => n.type === 'text').sort((a, b) => (b.fontSize || 0) - (a.fontSize || 0))
  const model = kind === 'heading' ? texts[0] : kind === 'body' ? texts[texts.length - 1] : texts[Math.floor(texts.length / 2)]
  const fontSize = Math.max(12, Math.round(canvas.width * preset.size))
  const width = Math.round(canvas.width * preset.width)
  return {
    type: 'text', text: preset.text, width, height: Math.round(fontSize * 1.3),
    fontFamily: model?.fontFamily || 'Inter', fontSize, fontWeight: preset.weight, fontStyle: 'normal',
    color: model?.fillType === 'gradient' ? '#111111' : model?.color || '#111111', textAlign: 'center', lineHeight: 1.2,
    textShadow: { enabled: false, offsetX: 0, offsetY: 4, blur: 12, color: '#00000055' },
  }
}

/** "#ABC" or "#aabbcc" as "#aabbcc"; anything else (gradients, rgba, 8-digit hex) as null. */
export function normalizeHex(value) {
  if (typeof value !== 'string') return null
  const hex = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex
  if (/^#[0-9a-f]{3}$/.test(hex)) return `#${hex.slice(1).split('').map(c => c + c).join('')}`
  return null
}

/** The brand's colours, when the post was made for a brand. */
export function brandColors(canvas) {
  const colors = canvas?.designInput?.brandContext?.colors ?? canvas?.brandContext?.colors
  return [...new Set((Array.isArray(colors) ? colors : []).map(normalizeHex).filter(Boolean))].slice(0, 10)
}

/** Colours already used anywhere in the post (every slide), most used first. */
export function documentColors(doc, limit = 16) {
  const counts = new Map()
  const add = value => {
    const hex = normalizeHex(value)
    if (hex) counts.set(hex, (counts.get(hex) || 0) + 1)
  }
  const pages = doc?.pages?.length ? doc.pages : [doc]
  for (const page of pages) {
    add(page?.background)
    for (const n of page?.nodes || []) {
      if (n.hidden) continue
      add(n.color)
      add(n.fill)
      if (n.strokeWidth > 0) add(n.stroke)
      for (const s of n.stops || []) add(s.color)
      for (const s of n.textGradient?.stops || []) add(s.color)
    }
    for (const cls of Object.values(page?.classes || {})) {
      add(cls?.color)
      add(cls?.background || cls?.backgroundColor)
      add(cls?.fill)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex).slice(0, limit)
}

/** Where a new layer goes: the given spot, nudged along while another layer already starts there. */
export function freeSpot(nodes, x, y, step = 24) {
  let spot = { x, y }
  while ((nodes || []).some(n => n.x === spot.x && n.y === spot.y)) spot = { x: spot.x + step, y: spot.y + step }
  return spot
}

export function isValidHex(hex) {
  return /^#[0-9A-F]{6}$/i.test(hex) || /^#[0-9A-F]{3}$/i.test(hex)
}

export const CHECKER = 'repeating-conic-gradient(#d9d5ca 0% 25%, #ffffff 0% 50%) 50% / 8px 8px'

/** Reads a picked file as a data URL for the upload endpoint. */
export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** Uploads an image file and returns its URL. */
export async function uploadImage(file) {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image`)
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is larger than 6 MB`)
  const data = await readAsDataUrl(file)
  const res = await fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) })
  const result = await res.json().catch(() => ({}))
  if (!res.ok || !result.url) throw new Error(result.error || `Could not upload ${file.name}`)
  return result.url
}
