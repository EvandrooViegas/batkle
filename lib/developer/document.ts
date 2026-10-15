import { parseStyledText, resolveCanvasClass, parseImageTags } from '../styleParser'
import { apiError } from './validate'

/**
 * The post document of POST /v1/posts, and its translation to the canvas the renderer draws (lib/renderCanvas.js).
 *
 * A document describes one post (`nodes`) or a carousel (`slides`, each with its own `nodes`). Nodes are the
 * editor's layers: text, image, shape and gradient, drawn in order, so later nodes sit on top. Only the documented
 * properties are read, each one checked; an unknown property is an error, so a typo never fails silently.
 * The docs page (/developers) and toApiDocument (the editor's "use this design in the API") follow this file.
 */

export const LIMITS = { minSize: 320, maxWidth: 2160, maxHeight: 2700, maxSlides: 10, maxNodes: 100, maxText: 5000, maxSpans: 200, maxStops: 10 }
/** What the renderer loads for image nodes (lib/developer/render.ts). */
export const IMAGE_LIMITS = { maxImages: 40, maxBytes: 10 * 1024 * 1024, maxRedirects: 3, timeoutMs: 15_000 }
export const DEFAULT_SIZE = { width: 1080, height: 1350 }
export const NODE_TYPES = ['text', 'image', 'shape', 'gradient'] as const
export const MASKS = ['none', 'circle', 'rounded', 'pill', 'triangle', 'triangle-down', 'diamond', 'pentagon', 'hexagon', 'star', 'arrow-right', 'parallelogram'] as const
export const FITS = ['cover', 'contain', 'fill'] as const
export const FILTER_RANGES: Record<string, [number, number]> = { brightness: [0, 300], contrast: [0, 300], saturate: [0, 300], grayscale: [0, 100], sepia: [0, 100], blur: [0, 50], hueRotate: [-360, 360] }

const COLOR = /^(#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgb|rgba|hsl|hsla)\([0-9.,%\s/+-]{1,60}\)|[a-z]{3,20})$/i
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const FONT = /^[A-Za-z0-9 ]{2,60}$/

const fail = (path: string, message: string) => { throw apiError(400, 'invalid_request', `"${path}" ${message}`) }
const isObject = (value: any) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Refuses properties a node does not have, suggesting the right spelling when only the case differs. */
function onlyKnown(value: any, path: string, known: string[]) {
  for (const key of Object.keys(value)) {
    if (known.includes(key)) continue
    const near = known.find(k => k.toLowerCase() === key.toLowerCase())
    fail(`${path}.${key}`, near ? `is not a property here. Did you mean "${near}"?` : `is not a property here. Allowed: ${known.join(', ')}.`)
  }
}

function num(value: any, path: string, { min, max, fallback, integer = false }: { min: number; max: number; fallback?: number; integer?: boolean }) {
  if (value == null) {
    if (fallback === undefined) fail(path, 'is required.')
    return fallback as number
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isInteger(value))) fail(path, `must be a ${integer ? 'whole number' : 'number'}.`)
  if (value < min || value > max) fail(path, `must be from ${min} to ${max}.`)
  return value
}

function choice(value: any, path: string, choices: readonly string[], fallback: string) {
  if (value == null) return fallback
  if (!choices.includes(value)) fail(path, `must be one of: ${choices.join(', ')}.`)
  return value
}

function color(value: any, path: string, fallback?: string) {
  if (value == null) {
    if (fallback === undefined) fail(path, 'is required.')
    return fallback as string
  }
  if (typeof value !== 'string' || !COLOR.test(value.trim())) fail(path, 'must be a colour such as "#F2A900", "rgba(0,0,0,0.5)" or "white".')
  return value.trim()
}

function bool(value: any, path: string) {
  if (value == null) return false
  if (typeof value !== 'boolean') fail(path, 'must be true or false.')
  return value
}

const fullHex = (hex: string) => (hex.length === 4 ? '#' + hex.slice(1).split('').map(c => c + c).join('') : hex).toUpperCase()

/** A gradient: linear at an angle, or radial around a centre, with 2 to 10 colour stops. */
function gradient(value: any, path: string) {
  if (!isObject(value)) fail(path, 'must be an object with "stops".')
  onlyKnown(value, path, ['type', 'angle', 'center', 'stops'])
  const type = choice(value.type, `${path}.type`, ['linear', 'radial'], 'linear')
  if (!Array.isArray(value.stops) || value.stops.length < 2 || value.stops.length > LIMITS.maxStops) fail(`${path}.stops`, `must list 2 to ${LIMITS.maxStops} colour stops.`)
  const stops = value.stops.map((stop: any, i: number) => {
    const at = `${path}.stops[${i}]`
    if (!isObject(stop)) fail(at, 'must be an object with "color" and "position".')
    onlyKnown(stop, at, ['color', 'position', 'opacity'])
    if (typeof stop.color !== 'string' || !HEX.test(stop.color)) fail(`${at}.color`, 'must be a hex colour such as "#F2A900".')
    return { color: fullHex(stop.color), position: num(stop.position, `${at}.position`, { min: 0, max: 100, fallback: Math.round((i / (value.stops.length - 1)) * 100) }), alpha: Math.round(num(stop.opacity, `${at}.opacity`, { min: 0, max: 1, fallback: 1 }) * 100) }
  })
  const center = value.center == null ? { x: 50, y: 50 } : isObject(value.center) ? value.center : fail(`${path}.center`, 'must be an object with "x" and "y" in percent.')
  if (value.center != null) onlyKnown(center, `${path}.center`, ['x', 'y'])
  return {
    gradientType: type,
    angle: num(value.angle, `${path}.angle`, { min: -360, max: 360, fallback: 90 }),
    focalX: num(center.x, `${path}.center.x`, { min: 0, max: 100, fallback: 50 }),
    focalY: num(center.y, `${path}.center.y`, { min: 0, max: 100, fallback: 50 }),
    stops,
  }
}

/** The text a renderer tag can hold: the markers that open and close styled spans are broken with a zero-width space. */
const plainText = (text: string) => text.replace(/<%/g, '<​%').replace(/%>/g, '%​>')

const SPAN_PROPS = ['text', 'color', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'textDecoration', 'background', 'padding']

/** Spans become the renderer's inline style tags: <%inline:color=#F2A900|fontWeight=800:words%>. */
function spansToText(spans: any[], path: string): string {
  if (spans.length > LIMITS.maxSpans) fail(path, `can have at most ${LIMITS.maxSpans} spans.`)
  return spans.map((span, i) => {
    const at = `${path}[${i}]`
    if (typeof span === 'string') return plainText(span)
    if (!isObject(span)) fail(at, 'must be a string or an object with "text".')
    onlyKnown(span, at, SPAN_PROPS)
    if (typeof span.text !== 'string') fail(`${at}.text`, 'is required and must be a string.')
    const style: string[] = []
    if (span.color != null) style.push(`color=${color(span.color, `${at}.color`)}`)
    if (span.fontFamily != null) {
      if (typeof span.fontFamily !== 'string' || !FONT.test(span.fontFamily)) fail(`${at}.fontFamily`, 'must be a font name of letters, digits and spaces.')
      style.push(`fontFamily=${span.fontFamily.trim()}`)
    }
    if (span.fontSize != null) style.push(`fontSize=${num(span.fontSize, `${at}.fontSize`, { min: 6, max: 600 })}px`)
    if (span.fontWeight != null) style.push(`fontWeight=${num(span.fontWeight, `${at}.fontWeight`, { min: 100, max: 900, integer: true })}`)
    if (span.fontStyle != null) style.push(`fontStyle=${choice(span.fontStyle, `${at}.fontStyle`, ['normal', 'italic'], 'normal')}`)
    if (span.letterSpacing != null) style.push(`letterSpacing=${num(span.letterSpacing, `${at}.letterSpacing`, { min: -50, max: 200 })}px`)
    if (span.textDecoration != null) style.push(`textDecoration=${choice(span.textDecoration, `${at}.textDecoration`, ['none', 'underline', 'line-through'], 'none')}`)
    if (span.background != null) style.push(`backgroundColor=${color(span.background, `${at}.background`)}`)
    if (span.padding != null) {
      const padding = num(span.padding, `${at}.padding`, { min: 0, max: 100 })
      style.push(`paddingLeft=${padding}px`, `paddingRight=${padding}px`)
    }
    const text = plainText(span.text)
    return style.length ? `<%inline:${style.join('|')}:${text}%>` : text
  }).join('')
}

const BASE_PROPS = ['type', 'x', 'y', 'width', 'height', 'rotation', 'opacity']
const TEXT_PROPS = [...BASE_PROPS, 'text', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'color', 'gradient', 'textAlign', 'verticalAlign', 'lineHeight', 'letterSpacing', 'textTransform', 'textDecoration', 'shadow']
const IMAGE_PROPS = [...BASE_PROPS, 'src', 'fit', 'borderRadius', 'mask', 'crop', 'flipX', 'flipY', 'filters']
const SHAPE_PROPS = [...BASE_PROPS, 'shape', 'fill', 'borderRadius', 'stroke']
const GRADIENT_PROPS = [...BASE_PROPS, 'shape', 'gradient', 'borderRadius']

/** One node of the public document as a renderer node. `size` is the post's size, for the defaults. */
export function readNode(node: any, path: string, size: { width: number; height: number }, id: string) {
  if (!isObject(node)) fail(path, 'must be an object with a "type".')
  if (!NODE_TYPES.includes(node.type)) fail(`${path}.type`, `must be one of: ${NODE_TYPES.join(', ')}.`)
  onlyKnown(node, path, node.type === 'text' ? TEXT_PROPS : node.type === 'image' ? IMAGE_PROPS : node.type === 'shape' ? SHAPE_PROPS : GRADIENT_PROPS)
  const x = num(node.x, `${path}.x`, { min: -5000, max: 5000, fallback: 0 })
  const y = num(node.y, `${path}.y`, { min: -5000, max: 5000, fallback: 0 })
  // Text fills the post's width between equal margins and runs to the bottom unless sized; other nodes need a size.
  const text = node.type === 'text'
  const width = num(node.width, `${path}.width`, { min: 1, max: 10000, ...(text ? { fallback: Math.max(1, size.width - 2 * Math.max(0, x)) } : {}) })
  const height = num(node.height, `${path}.height`, { min: 1, max: 10000, ...(text ? { fallback: Math.max(1, size.height - Math.max(0, y)) } : {}) })
  const base: any = { id, type: node.type, x, y, width, height }
  const rotation = num(node.rotation, `${path}.rotation`, { min: -360, max: 360, fallback: 0 })
  if (rotation) base.rotation = rotation
  const opacity = num(node.opacity, `${path}.opacity`, { min: 0, max: 1, fallback: 1 })
  if (opacity < 1) base.opacity = Math.round(opacity * 100)

  if (node.type === 'text') {
    let content = ''
    if (typeof node.text === 'string') content = plainText(node.text)
    else if (Array.isArray(node.text)) content = spansToText(node.text, `${path}.text`)
    else fail(`${path}.text`, 'is required: a string, or an array of spans.')
    if (content.length > LIMITS.maxText) fail(`${path}.text`, `must be at most ${LIMITS.maxText} characters.`)
    const fontFamily = node.fontFamily == null ? 'Inter' : typeof node.fontFamily === 'string' && FONT.test(node.fontFamily) ? node.fontFamily.trim() : fail(`${path}.fontFamily`, 'must be a font name of letters, digits and spaces, such as "Playfair Display".')
    Object.assign(base, {
      text: content,
      fontFamily,
      fontSize: num(node.fontSize, `${path}.fontSize`, { min: 6, max: 600, fallback: 48 }),
      fontWeight: num(node.fontWeight, `${path}.fontWeight`, { min: 100, max: 900, fallback: 400, integer: true }),
      fontStyle: choice(node.fontStyle, `${path}.fontStyle`, ['normal', 'italic'], 'normal'),
      color: color(node.color, `${path}.color`, '#000000'),
      textAlign: choice(node.textAlign, `${path}.textAlign`, ['left', 'center', 'right'], 'left'),
      verticalAlign: choice(node.verticalAlign, `${path}.verticalAlign`, ['top', 'middle', 'bottom'], 'top'),
      lineHeight: num(node.lineHeight, `${path}.lineHeight`, { min: 0.5, max: 4, fallback: 1.2 }),
      letterSpacing: num(node.letterSpacing, `${path}.letterSpacing`, { min: -50, max: 200, fallback: 0 }),
      textTransform: choice(node.textTransform, `${path}.textTransform`, ['none', 'uppercase', 'lowercase', 'capitalize'], 'none'),
      textDecoration: choice(node.textDecoration, `${path}.textDecoration`, ['none', 'underline', 'line-through'], 'none'),
    })
    if (node.gradient != null) Object.assign(base, { fillType: 'gradient', textGradient: gradient(node.gradient, `${path}.gradient`) })
    if (node.shadow != null) {
      if (!isObject(node.shadow)) fail(`${path}.shadow`, 'must be an object with "x", "y", "blur" and "color".')
      onlyKnown(node.shadow, `${path}.shadow`, ['x', 'y', 'blur', 'color'])
      base.textShadow = {
        enabled: true,
        offsetX: num(node.shadow.x, `${path}.shadow.x`, { min: -200, max: 200, fallback: 0 }),
        offsetY: num(node.shadow.y, `${path}.shadow.y`, { min: -200, max: 200, fallback: 4 }),
        blur: num(node.shadow.blur, `${path}.shadow.blur`, { min: 0, max: 200, fallback: 8 }),
        color: color(node.shadow.color, `${path}.shadow.color`, 'rgba(0,0,0,0.35)'),
      }
    }
    return base
  }

  if (node.type === 'image') {
    if (typeof node.src !== 'string' || !node.src.trim()) fail(`${path}.src`, 'is required: an https image URL, a data:image URL, or a Batkle /api/uploads/… path.')
    Object.assign(base, {
      src: node.src.trim(),
      objectFit: choice(node.fit, `${path}.fit`, FITS, 'cover'),
      borderRadius: num(node.borderRadius, `${path}.borderRadius`, { min: 0, max: 5000, fallback: 0 }),
      mask: choice(node.mask, `${path}.mask`, MASKS, 'none'),
    })
    if (bool(node.flipX, `${path}.flipX`)) base.flipX = true
    if (bool(node.flipY, `${path}.flipY`)) base.flipY = true
    if (node.crop != null) {
      if (!isObject(node.crop)) fail(`${path}.crop`, 'must be an object with "top", "right", "bottom" and "left" in percent.')
      onlyKnown(node.crop, `${path}.crop`, ['top', 'right', 'bottom', 'left'])
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const value = num(node.crop[side], `${path}.crop.${side}`, { min: 0, max: 90, fallback: 0 })
        if (value) base[`crop${side[0].toUpperCase()}${side.slice(1)}`] = value
      }
      if ((base.cropLeft || 0) + (base.cropRight || 0) >= 100 || (base.cropTop || 0) + (base.cropBottom || 0) >= 100) fail(`${path}.crop`, 'must leave part of the image: opposite sides add up to less than 100.')
    }
    if (node.filters != null) {
      if (!isObject(node.filters)) fail(`${path}.filters`, 'must be an object such as {"brightness": 110}.')
      onlyKnown(node.filters, `${path}.filters`, Object.keys(FILTER_RANGES))
      base.filters = {}
      for (const [name, [min, max]] of Object.entries(FILTER_RANGES)) {
        if (node.filters[name] != null) base.filters[name] = num(node.filters[name], `${path}.filters.${name}`, { min, max })
      }
    }
    return base
  }

  const shape = choice(node.shape, `${path}.shape`, ['rectangle', 'ellipse'], 'rectangle') === 'ellipse' ? 'ellipse' : 'rect'
  const borderRadius = num(node.borderRadius, `${path}.borderRadius`, { min: 0, max: 5000, fallback: 0 })
  if (node.type === 'shape') {
    Object.assign(base, { shape, fill: color(node.fill, `${path}.fill`, '#000000'), borderRadius })
    if (node.stroke != null) {
      if (!isObject(node.stroke)) fail(`${path}.stroke`, 'must be an object with "color" and "width".')
      onlyKnown(node.stroke, `${path}.stroke`, ['color', 'width'])
      Object.assign(base, { stroke: color(node.stroke.color, `${path}.stroke.color`, '#000000'), strokeWidth: num(node.stroke.width, `${path}.stroke.width`, { min: 0, max: 200, fallback: 2 }) })
    }
    return base
  }
  if (node.gradient == null) fail(`${path}.gradient`, 'is required: an object with "stops".')
  return { ...base, shape, borderRadius, ...gradient(node.gradient, `${path}.gradient`) }
}

/** A slide's background: a colour, or a gradient drawn as a full-size gradient node below the others. */
function background(value: any, path: string, size: { width: number; height: number }, fallback: any) {
  if (value == null) return fallback
  if (typeof value === 'string') return { color: color(value, path) }
  return { color: '#FFFFFF', gradient: { id: 'background', type: 'gradient', x: 0, y: 0, ...size, shape: 'rect', borderRadius: 0, ...gradient(value, path) } }
}

function readNodes(nodes: any, path: string, size: { width: number; height: number }, prefix: string) {
  if (!Array.isArray(nodes)) fail(path, 'must be an array of nodes.')
  if (nodes.length > LIMITS.maxNodes) fail(path, `can have at most ${LIMITS.maxNodes} nodes.`)
  return nodes.map((node: any, i: number) => readNode(node, `${path}[${i}]`, size, `${prefix}${i}`))
}

export interface PostDocument {
  width: number
  height: number
  carousel: boolean
  /** The slides to render, each a canvas the renderer can draw (a single post has one). */
  slides: { index: number; canvas: any }[]
  /** Every image the slides need, by source as given. */
  images: string[]
}

/** Checks a request body and returns the canvases to render. Every error names the property at fault. */
export function readPostDocument(body: any): PostDocument {
  onlyKnown(body, 'body', ['width', 'height', 'background', 'nodes', 'slides', 'slide'])
  const size = {
    width: num(body.width, 'width', { min: LIMITS.minSize, max: LIMITS.maxWidth, fallback: DEFAULT_SIZE.width, integer: true }),
    height: num(body.height, 'height', { min: LIMITS.minSize, max: LIMITS.maxHeight, fallback: DEFAULT_SIZE.height, integer: true }),
  }
  if (body.nodes != null && body.slides != null) fail('body', 'has both "nodes" and "slides": send "nodes" for a single post, or "slides" for a carousel.')
  if (body.nodes == null && body.slides == null) fail('body', 'needs "nodes" (a single post) or "slides" (a carousel).')
  const base = background(body.background, 'background', size, { color: '#FFFFFF' })

  let slides: { background: any; nodes: any[] }[]
  if (body.nodes != null) {
    if (body.slide != null) fail('slide', 'only applies to a carousel ("slides").')
    slides = [{ background: base, nodes: readNodes(body.nodes, 'nodes', size, 'n') }]
  } else {
    if (!Array.isArray(body.slides) || body.slides.length < 2 || body.slides.length > LIMITS.maxSlides) fail('slides', `must be an array of 2 to ${LIMITS.maxSlides} slides. For one image, send "nodes" instead.`)
    slides = body.slides.map((slide: any, i: number) => {
      if (!isObject(slide)) fail(`slides[${i}]`, 'must be an object with "nodes".')
      onlyKnown(slide, `slides[${i}]`, ['background', 'nodes'])
      return { background: background(slide.background, `slides[${i}].background`, size, base), nodes: readNodes(slide.nodes ?? [], `slides[${i}].nodes`, size, `s${i}n`) }
    })
  }
  const only = body.slide == null ? null : num(body.slide, 'slide', { min: 1, max: slides.length, integer: true })
  const chosen = slides.map((slide, i) => ({ slide, index: i + 1 })).filter(({ index }) => only == null || index === only)
  const canvases = chosen.map(({ slide, index }) => ({
    index,
    canvas: { width: size.width, height: size.height, background: slide.background.color, nodes: slide.background.gradient ? [slide.background.gradient, ...slide.nodes] : slide.nodes, groups: [], classes: {} },
  }))
  const images = [...new Set(canvases.flatMap(({ canvas }) => canvas.nodes.filter((n: any) => n.type === 'image').map((n: any) => n.src)))] as string[]
  return { width: size.width, height: size.height, carousel: body.slides != null, slides: canvases, images }
}

// ─── From a saved design to a document ───────────────────────────────────────

const round = (n: any) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : n)
const px = (value: any) => { const n = parseFloat(String(value)); return Number.isFinite(n) ? round(n) : undefined }

/** Span properties from a renderer style: an editor class or an inline tag. */
function spanStyle(style: any = {}, cls = false) {
  const out: any = {}
  if (style.color && COLOR.test(String(style.color))) out.color = String(style.color)
  if (style.fontFamily && FONT.test(String(style.fontFamily))) out.fontFamily = String(style.fontFamily)
  if (style.fontSize != null && px(style.fontSize)) out.fontSize = px(style.fontSize)
  if (style.fontWeight != null && Number(style.fontWeight) >= 100) out.fontWeight = Math.min(900, Math.round(Number(style.fontWeight) / 100) * 100)
  if (style.fontStyle === 'italic') out.fontStyle = 'italic'
  if (style.letterSpacing != null && px(style.letterSpacing) != null) out.letterSpacing = px(style.letterSpacing)
  if (['underline', 'line-through'].includes(style.textDecoration)) out.textDecoration = style.textDecoration
  const bg = style.background || style.backgroundColor
  if (bg && COLOR.test(String(bg)) && !/^transparent$/i.test(bg)) {
    out.background = String(bg)
    const padding = cls ? style.paddingX : px(style.paddingLeft)
    if (typeof padding === 'number' && padding > 0) out.padding = round(padding)
  }
  return out
}

/** A saved text (with the editor's class and inline tags) as a string, or as spans when parts are styled. */
function textToApi(text: string, classes: any) {
  const spans: any[] = []
  const walk = (tokens: any[], inherited: any) => {
    for (const token of tokens) {
      if (typeof token === 'string') { spans.push({ text: token, ...inherited }); continue }
      const style = token.className ? spanStyle(resolveCanvasClass(classes, token.className)?.style, true) : spanStyle(token.style)
      walk(token.children || [], { ...inherited, ...style })
    }
  }
  walk(parseStyledText(text || '', classes || {}), {})
  // Neighbouring spans with the same style are one span.
  const merged: any[] = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    const { text: _a, ...a } = span
    if (last) { const { text: _b, ...b } = last; if (JSON.stringify(a) === JSON.stringify(b)) { last.text += span.text; continue } }
    merged.push({ ...span })
  }
  // Unstyled parts are plain strings, and an unstyled text is one string.
  const parts = merged.map(span => (Object.keys(span).length === 1 ? span.text : span))
  if (parts.length === 0) return ''
  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts
}

function gradientToApi(node: any) {
  const stops = (node.stops || []).map((s: any) => ({ color: s.color, position: round(s.position ?? 0), ...(typeof s.alpha === 'number' && s.alpha < 100 ? { opacity: round(s.alpha / 100) } : {}) }))
  return { type: node.gradientType === 'radial' ? 'radial' : 'linear', ...(node.gradientType === 'radial' ? { center: { x: round(node.focalX ?? 50), y: round(node.focalY ?? 50) } } : { angle: round(node.angle ?? 90) }), stops }
}

/** One saved editor node as a document node; null for nodes the API does not draw. */
function nodeToApi(node: any, classes: any, origin: string) {
  if (!node || node.hidden || !NODE_TYPES.includes(node.type)) return null
  const cls = resolveCanvasClass(classes || {}, node.className)?.style || {}
  const out: any = { type: node.type, x: round(node.x || 0), y: round(node.y || 0), width: round(node.width), height: round(node.height) }
  if (node.rotation) out.rotation = round(node.rotation)
  if (typeof node.opacity === 'number' && node.opacity < 100) out.opacity = round(Math.max(0, node.opacity) / 100)

  if (node.type === 'text') {
    out.text = textToApi(node.text || '', classes)
    out.fontFamily = node.fontFamily || 'Inter'
    out.fontSize = round(node.fontSize || 48)
    out.fontWeight = Number(cls.fontWeight || node.fontWeight || 400)
    if ((cls.fontStyle || node.fontStyle) === 'italic') out.fontStyle = 'italic'
    out.color = cls.color || node.color || '#000000'
    if (node.fillType === 'gradient' && node.textGradient) out.gradient = gradientToApi(node.textGradient)
    const align = node.textAlign || 'left'
    out.textAlign = align
    // Saved designs place centred text in the middle of its box and right-aligned text at the bottom.
    out.verticalAlign = node.verticalAlign || (align === 'center' ? 'middle' : align === 'right' ? 'bottom' : 'top')
    out.lineHeight = round(node.lineHeight || 1.2)
    const spacing = cls.letterSpacing ?? node.letterSpacing
    if (spacing) out.letterSpacing = round(Number(spacing))
    const transform = cls.textTransform || node.textTransform
    if (transform && transform !== 'none') out.textTransform = transform
    const decoration = cls.textDecoration || node.textDecoration
    if (decoration && decoration !== 'none') out.textDecoration = decoration
    const shadow = cls.textShadow?.enabled ? cls.textShadow : node.textShadow?.enabled ? node.textShadow : null
    if (shadow) out.shadow = { x: round(shadow.offsetX || 0), y: round(shadow.offsetY || 0), blur: round(shadow.blur || 0), color: shadow.color || '#000000' }
    return out
  }
  if (node.type === 'image') {
    const { url } = parseImageTags(node.src, classes || {})
    if (typeof url !== 'string' || !url) return null
    out.src = url.startsWith('/') ? origin + url : url
    if (node.objectFit && node.objectFit !== 'cover') out.fit = node.objectFit
    const mask = cls.mask || node.mask
    if (mask && mask !== 'none') out.mask = mask
    const radius = cls.borderRadius ?? node.borderRadius
    if (radius) out.borderRadius = round(radius)
    if (node.flipX) out.flipX = true
    if (node.flipY) out.flipY = true
    const crop: any = {}
    for (const side of ['top', 'right', 'bottom', 'left']) { const v = node[`crop${side[0].toUpperCase()}${side.slice(1)}`]; if (v) crop[side] = round(v) }
    if (Object.keys(crop).length) out.crop = crop
    const filters: any = {}
    const neutral: Record<string, number> = { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0, blur: 0, hueRotate: 0 }
    for (const name of Object.keys(FILTER_RANGES)) { const v = { ...(node.filters || {}), ...(cls.filters || {}) }[name]; if (typeof v === 'number' && v !== neutral[name]) filters[name] = round(v) }
    if (Object.keys(filters).length) out.filters = filters
    return out
  }
  const shape = (cls.shape || node.shape) === 'ellipse' ? 'ellipse' : 'rectangle'
  if (shape === 'ellipse') out.shape = 'ellipse'
  const radius = cls.borderRadius ?? node.borderRadius
  if (radius && shape !== 'ellipse') out.borderRadius = round(radius)
  if (node.type === 'shape') {
    out.fill = cls.fill || node.fill || '#6366F1'
    const width = cls.strokeWidth ?? node.strokeWidth
    if (width > 0) out.stroke = { color: cls.stroke || node.stroke || '#000000', width: round(width) }
    return out
  }
  out.gradient = gradientToApi({ ...node, ...cls })
  return out
}

/** A saved editor design as the request body that renders it through POST /v1/posts. */
export function toApiDocument(canvas: any, origin = '') {
  const pages = canvas?.type === 'carousel' && Array.isArray(canvas.pages) && canvas.pages.length ? [...canvas.pages].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)) : null
  const size = { width: canvas?.width || DEFAULT_SIZE.width, height: canvas?.height || DEFAULT_SIZE.height }
  const nodesOf = (page: any) => (page.nodes || []).map((n: any) => nodeToApi(n, page.classes || canvas.classes || {}, origin)).filter(Boolean)
  const bg = (value: any) => (typeof value === 'string' && COLOR.test(value) ? value : '#FFFFFF')
  if (!pages || pages.length < 2) return { ...size, background: bg((pages?.[0] || canvas).background), nodes: nodesOf(pages?.[0] || canvas) }
  return { ...size, background: bg(canvas.background), slides: pages.slice(0, LIMITS.maxSlides).map((page: any) => ({ background: bg(page.background || canvas.background), nodes: nodesOf(page) })) }
}
