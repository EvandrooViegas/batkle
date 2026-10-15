import fs from 'fs/promises'
import path from 'path'

// Per-font configuration. `local` fonts read from disk; CDN fonts use fontsource on jsdelivr.
const FONT_CONFIG = {
  'Inter': {
    local: true,
    weights: [400, 700],
    italic: false,
    files: {
      '400-normal': 'public/fonts/Inter-Regular.ttf',
      '700-normal': 'public/fonts/Inter-Bold.ttf',
    },
  },
  'Roboto': { cdn: 'roboto', weights: [300, 400, 500, 700, 900], italic: true },
  'Poppins': { cdn: 'poppins', weights: [300, 400, 500, 600, 700, 800, 900], italic: true },
  'Oswald': { cdn: 'oswald', weights: [300, 400, 500, 600, 700], italic: false },
  'Montserrat': { cdn: 'montserrat', weights: [400, 500, 600, 700, 800, 900], italic: true },
  'Playfair Display': { cdn: 'playfair-display', weights: [400, 500, 600, 700, 800, 900], italic: true },
  'Bebas Neue': { cdn: 'bebas-neue', weights: [400], italic: false },
  'Dancing Script': { cdn: 'dancing-script', weights: [400, 500, 600, 700], italic: false },
  'Pacifico': { cdn: 'pacifico', weights: [400], italic: false },
  'Lobster': { cdn: 'lobster', weights: [400], italic: false },
  'Raleway': { cdn: 'raleway', weights: [400, 500, 600, 700, 800, 900], italic: true },
  'Lato': { cdn: 'lato', weights: [300, 400, 700, 900], italic: true },
  'Open Sans': { cdn: 'open-sans', weights: [400, 500, 600, 700, 800], italic: true },
}

export const FONT_NAMES = Object.keys(FONT_CONFIG)
export function getFontMeta(name) { return FONT_CONFIG[name] || FONT_CONFIG['Inter'] }

// Brand fonts outside the list above (e.g. Anton) come from Fontsource by name; system fonts are not published there.
const SYSTEM_FONTS = new Set(['arial', 'helvetica', 'impact', 'georgia', 'times new roman', 'verdana', 'tahoma', 'trebuchet ms', 'courier new'])
function fontConfig(family) {
  if (FONT_CONFIG[family]) return FONT_CONFIG[family]
  if (typeof family !== 'string' || !/^[A-Za-z0-9 ]{2,60}$/.test(family) || SYSTEM_FONTS.has(family.toLowerCase())) return null
  return { cdn: family.trim().toLowerCase().replace(/\s+/g, '-'), weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], italic: false, dynamic: true }
}

const cache = new Map() // key -> Buffer

async function fetchToBuffer(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Font fetch failed ${url}: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

function nearestWeight(weights, target) {
  let best = weights[0]
  let bestDiff = Math.abs(best - target)
  for (const w of weights) {
    const d = Math.abs(w - target)
    if (d < bestDiff) { best = w; bestDiff = d }
  }
  return best
}

async function loadFontVariant(family, weight, style) {
  const cfg = fontConfig(family) || FONT_CONFIG['Inter']
  const wantStyle = (style === 'italic' && cfg.italic) ? 'italic' : 'normal'
  const wantWeight = nearestWeight(cfg.weights, weight)
  const key = `${family}:${wantWeight}:${wantStyle}`
  if (cache.has(key)) return { buf: cache.get(key), weight: wantWeight, style: wantStyle }

  let buf
  if (cfg.local) {
    const fileKey = `${wantWeight}-${wantStyle}`
    const fpath = cfg.files[fileKey] || cfg.files[`${wantWeight}-normal`] || cfg.files['400-normal']
    buf = await fs.readFile(path.join(process.cwd(), fpath))
  } else if (cfg.dynamic) {
    // Unknown weights: the requested one, then regular (single-weight display fonts such as Anton).
    let loaded = null
    for (const w of [...new Set([wantWeight, 400])]) {
      try { loaded = { buf: await fetchToBuffer(`https://cdn.jsdelivr.net/npm/@fontsource/${cfg.cdn}/files/${cfg.cdn}-latin-${w}-normal.woff`), weight: w }; break } catch {}
    }
    if (!loaded) throw new Error(`Font ${family} is not available on Fontsource`)
    cache.set(key, loaded.buf)
    return { buf: loaded.buf, weight: wantWeight, style: 'normal' }
  } else {
    const url = `https://cdn.jsdelivr.net/npm/@fontsource/${cfg.cdn}/files/${cfg.cdn}-latin-${wantWeight}-${wantStyle}.woff`
    try {
      buf = await fetchToBuffer(url)
    } catch (e) {
      // fallback: normal style
      const fallback = `https://cdn.jsdelivr.net/npm/@fontsource/${cfg.cdn}/files/${cfg.cdn}-latin-${wantWeight}-normal.woff`
      buf = await fetchToBuffer(fallback)
    }
  }
  cache.set(key, buf)
  return { buf, weight: wantWeight, style: wantStyle }
}

export async function loadFontsForCanvas(canvas) {
  // Always include Inter regular + bold as a baseline fallback
  const wanted = new Map() // key -> {family, weight, style}
  const add = (family, weight, style) => {
    const k = `${family}:${weight}:${style}`
    if (!wanted.has(k)) wanted.set(k, { family, weight, style })
  }
  add('Inter', 400, 'normal'); add('Inter', 700, 'normal')

  for (const n of canvas.nodes || []) {
    if (n.type !== 'text') continue
    const family = fontConfig(n.fontFamily) ? n.fontFamily : 'Inter'
    const weight = n.fontWeight || 400
    const style = n.fontStyle === 'italic' ? 'italic' : 'normal'
    add(family, weight, style)
    // Inline emphasis (<%inline:fontFamily=…|fontWeight=…:words%>) can use another font, weight or style, and each
    // one it uses must be in the exported PNG as well.
    for (const match of (n.text || '').matchAll(/<%inline:([^:]*):/g)) {
      const props = Object.fromEntries(match[1].split('|').map(part => part.split('=').map(s => s.trim())).filter(part => part.length === 2))
      const inlineFamily = props.fontFamily || props['font-family'] || family
      const inlineWeight = Number(props.fontWeight || props['font-weight']) || weight
      const inlineStyle = (props.fontStyle || props['font-style']) === 'italic' ? 'italic' : style
      if (fontConfig(inlineFamily)) add(inlineFamily, inlineWeight, inlineStyle)
    }
  }

  const fonts = []
  for (const { family, weight, style } of wanted.values()) {
    try {
      const v = await loadFontVariant(family, weight, style)
      fonts.push({ name: family, data: v.buf, weight: v.weight, style: v.style })
    } catch (e) {
      console.error('Font load failed', family, weight, style, e.message)
    }
  }
  return fonts
}
