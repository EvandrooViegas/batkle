import { textGradientStyle } from './textGradient'
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'
import { loadFontsForCanvas } from './fonts'
import { parseStyledText, buildSatoriTextLines, parseImageTags, resolveCanvasClass } from './styleParser'
import { getNodeEffectiveDimensions, applyGroupLayoutToNodes } from './groups'

/**
 * Estimates the rendered height of a text node given its content and style.
 * Used at render time to reflow grouped nodes when dynamic text is longer than
 * the stored design height.
 */
function plainTextLength(line) {
  // Recursively strip styled text tags (<%kind:...%> / <%inline:...%>) to count visible chars.
  let prev
  let out = line
  do {
    prev = out
    out = out.replace(/<%(?:kind|inline):[^:]*:([\s\S]*?)%>/g, '$1')
  } while (out !== prev)
  return out.length
}

function estimateTextHeight(text, node) {
  if (!text) return node.height
  const fontSize = node.fontSize || 48
  const lineHeight = node.lineHeight || 1.2
  const width = node.width || 200
  
  // Use Inter font character width metrics for accurate estimation.
  // These ratios match actual rendering for Inter font:
  // - Smaller sizes (≤20px): characters are relatively wider (0.54)
  // - Medium sizes (21-32px): 0.53 ratio
  // - Large sizes (33-48px): 0.52 ratio  
  // - Extra large (>48px): 0.51 ratio (characters narrower at large sizes)
  const fontWidthRatio = fontSize <= 20 ? 0.54 : fontSize <= 32 ? 0.53 : fontSize <= 48 ? 0.52 : 0.51
  const charWidth = fontSize * fontWidthRatio
  
  // Account for padding inside the container (typically 8-16px depending on design)
  const containerPadding = Math.max(0, fontSize * 0.15)
  const effectiveWidth = width - (containerPadding * 2)
  const charsPerLine = Math.max(1, Math.floor(effectiveWidth / charWidth))
  
  const lines = text.split('\n').reduce((total, line) => {
    if (!line) return total + 1
    const plainLen = plainTextLength(line)
    return total + Math.ceil(Math.max(1, plainLen) / charsPerLine)
  }, 0)
  
  // Calculate height accounting for line-height multiplier.
  // Each line of text takes up (fontSize * lineHeight) vertical space.
  // But the LAST line doesn't have trailing line-height, so subtract one line's worth of line-height padding.
  // This matches Satori's flex layout behavior.
  const lineSpacePerLine = fontSize * lineHeight
  const totalHeight = lines > 0 
    ? (lineSpacePerLine * (lines - 1)) + fontSize
    : fontSize
  
  return Math.ceil(totalHeight)
}

// text height calculation removed as Satori will handle flex layouts natively

function resolveImageUrl(url) {
  if (!url) return null
  // Already a data URL
  if (url.startsWith('data:')) return url
  // Get the base URL, ensuring it has a protocol
  let base = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  if (base && !base.startsWith('http')) base = 'http://' + base
  // Relative path like /api/uploads/...
  if (url.startsWith('/')) return base + url
  // Protocol-missing like localhost:3000/api/...
  if (!url.startsWith('http')) return 'http://' + url
  // Absolute URL - use as-is but replace production base with the server-accessible base if needed
  return url
}

function sanitizeExternalUrl(url) {
  try {
    const u = new URL(url)
    // Google Drive: remove authuser param so server fetches publicly without a user session
    if (u.hostname.includes('drive.usercontent.google.com') || u.hostname.includes('drive.google.com')) {
      u.searchParams.delete('authuser')
    }
    return u.toString()
  } catch {
    return url
  }
}

async function fetchImageBuffer(url) {
  if (!url) return null
  try {
    if (url.startsWith('data:')) {
      const m = url.match(/^data:[^;]+;base64,(.+)$/)
      if (!m) return null
      return Buffer.from(m[1], 'base64')
    }
    const sanitized = sanitizeExternalUrl(url)
    const finalUrl = resolveImageUrl(sanitized)
    if (!finalUrl) return null
    const res = await fetch(finalUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (!res.ok) {
      console.error('fetchImageBuffer failed:', finalUrl, res.status)
      return null
    }
    // Reject non-image responses (e.g. HTML login pages from Google Drive)
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) {
      console.error('fetchImageBuffer: expected image but got', contentType, 'for', finalUrl)
      return null
    }
    return Buffer.from(await res.arrayBuffer())
  } catch (e) {
    console.error('fetchImageBuffer error', url, e.message)
    return null
  }
}


/**
 * A photo turned the way its EXIF orientation says, as the browser shows it in the editor. Phone photos are stored as
 * taken, with only a tag saying how to turn them, and converting them to PNG drops that tag. The turned copy is a
 * lossless PNG used for this render only; the stored image never changes.
 */
export async function uprightImage(buf) {
  try {
    const { orientation } = await sharp(buf, { failOn: 'none' }).metadata()
    if (!orientation || orientation === 1) return buf
    return await sharp(buf, { failOn: 'none' }).rotate().png().toBuffer()
  } catch {
    return buf
  }
}

async function applyImageFilters(buf, filters = {}) {
  const f = {
    brightness: 100, contrast: 100, saturate: 100, grayscale: 0,
    blur: 0, sepia: 0, hueRotate: 0, opacity: 100,
    ...filters,
  }
  const hasAny = f.brightness !== 100 || f.contrast !== 100 || f.saturate !== 100
    || f.grayscale > 0 || f.blur > 0 || f.sepia > 0 || f.hueRotate !== 0 || f.opacity !== 100
  if (!hasAny) return buf

  let p = sharp(buf, { failOn: 'none' }).ensureAlpha()
  if (f.brightness !== 100 || f.saturate !== 100 || f.hueRotate !== 0) {
    p = p.modulate({
      brightness: Math.max(0.01, f.brightness / 100),
      saturation: Math.max(0, f.saturate / 100),
      hue: f.hueRotate || 0,
    })
  }
  if (f.contrast !== 100) {
    const c = f.contrast / 100
    p = p.linear(c, 128 * (1 - c))
  }
  if (f.grayscale > 0) {
    if (f.grayscale >= 100) p = p.grayscale()
    else p = p.modulate({ saturation: Math.max(0, 1 - f.grayscale / 100) })
  }
  if (f.sepia > 0) {
    const intensity = f.sepia / 100
    p = p.modulate({ saturation: 1 - intensity * 0.7 }).tint({ r: 112 + 30 * intensity, g: 66 + 30 * intensity, b: 20 + 20 * intensity })
  }
  if (f.blur > 0) p = p.blur(Math.max(0.3, f.blur))
  if (f.opacity !== 100) {
    const alpha = Math.max(0, Math.min(1, f.opacity / 100))
    // Multiply alpha channel
    const raw = await p.png().toBuffer()
    const img = sharp(raw).ensureAlpha()
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
    for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * alpha)
    return await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
  }
  return await p.png().toBuffer()
}

async function applyCanvasColorMode(buf, mode) {
  if (!mode || mode === 'color') return buf
  let p = sharp(buf)
  if (mode === 'grayscale') p = p.grayscale()
  else if (mode === 'sepia') p = p.modulate({ saturation: 0.3 }).tint({ r: 112, g: 66, b: 20 })
  else if (mode === 'invert') p = p.negate({ alpha: false })
  else if (mode === 'high-contrast') p = p.linear(1.6, -50)
  return await p.png().toBuffer()
}

function buildGradientCss(node) {
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

// maskBorderRadius removed

// Returns CSS clip-path or borderRadius for a given image mask/shape
function getImageMaskStyle(mask, w, h) {
  const min = Math.min(w, h)
  switch (mask) {
    case 'circle':   return { borderRadius: '50%' }
    case 'rounded':  return { borderRadius: Math.round(min * 0.15) }
    case 'pill':     return { borderRadius: Math.round(min * 0.5) }
    case 'triangle': return { clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' }
    case 'triangle-down': return { clipPath: 'polygon(0% 0%, 100% 0%, 50% 100%)' }
    case 'diamond':  return { clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' }
    case 'pentagon': return { clipPath: 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)' }
    case 'hexagon':  return { clipPath: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)' }
    case 'star':     return { clipPath: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)' }
    case 'arrow-right': return { clipPath: 'polygon(0% 20%, 60% 20%, 60% 0%, 100% 50%, 60% 100%, 60% 80%, 0% 80%)' }
    case 'parallelogram': return { clipPath: 'polygon(15% 0%, 100% 0%, 85% 100%, 0% 100%)' }
    default:         return {}
  }
}

// Applies a polygon SVG mask to a PNG buffer using sharp (for renderCanvas)
async function applyShapeMaskToPng(pngBuf, mask, w, h) {
  if (!mask || mask === 'none') return pngBuf

  let svgShape = ''
  switch (mask) {
    case 'circle':
      svgShape = `<ellipse cx="${w/2}" cy="${h/2}" rx="${w/2}" ry="${h/2}" fill="white"/>`
      break
    case 'rounded': {
      const r = Math.round(Math.min(w, h) * 0.15)
      svgShape = `<rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="white"/>`
      break
    }
    case 'pill': {
      const r = Math.round(Math.min(w, h) * 0.5)
      svgShape = `<rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="white"/>`
      break
    }
    case 'triangle':
      svgShape = `<polygon points="${w*0.5},0 0,${h} ${w},${h}" fill="white"/>`
      break
    case 'triangle-down':
      svgShape = `<polygon points="0,0 ${w},0 ${w*0.5},${h}" fill="white"/>`
      break
    case 'diamond':
      svgShape = `<polygon points="${w*0.5},0 ${w},${h*0.5} ${w*0.5},${h} 0,${h*0.5}" fill="white"/>`
      break
    case 'pentagon':
      svgShape = `<polygon points="${w*0.5},0 ${w},${h*0.38} ${w*0.82},${h} ${w*0.18},${h} 0,${h*0.38}" fill="white"/>`
      break
    case 'hexagon':
      svgShape = `<polygon points="${w*0.25},0 ${w*0.75},0 ${w},${h*0.5} ${w*0.75},${h} ${w*0.25},${h} 0,${h*0.5}" fill="white"/>`
      break
    case 'star':
      svgShape = `<polygon points="${w*0.5},0 ${w*0.61},${h*0.35} ${w*0.98},${h*0.35} ${w*0.68},${h*0.57} ${w*0.79},${h*0.91} ${w*0.5},${h*0.70} ${w*0.21},${h*0.91} ${w*0.32},${h*0.57} ${w*0.02},${h*0.35} ${w*0.39},${h*0.35}" fill="white"/>`
      break
    case 'arrow-right':
      svgShape = `<polygon points="0,${h*0.2} ${w*0.6},${h*0.2} ${w*0.6},0 ${w},${h*0.5} ${w*0.6},${h} ${w*0.6},${h*0.8} 0,${h*0.8}" fill="white"/>`
      break
    case 'parallelogram':
      svgShape = `<polygon points="${w*0.15},0 ${w},0 ${w*0.85},${h} 0,${h}" fill="white"/>`
      break
    default:
      return pngBuf
  }

  const maskSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svgShape}</svg>`
  )
  try {
    // Resize image to target dimensions, then composite SVG mask as alpha channel
    const resized = await sharp(pngBuf).resize(w, h).ensureAlpha().png().toBuffer()
    const maskBuf = await sharp(maskSvg).resize(w, h).ensureAlpha().png().toBuffer()
    // Multiply alpha: keep only pixels where mask is white
    const { data: imgData, info } = await sharp(resized).raw().toBuffer({ resolveWithObject: true })
    const { data: maskData } = await sharp(maskBuf).raw().toBuffer({ resolveWithObject: true })
    const out = Buffer.from(imgData)
    for (let i = 0; i < info.width * info.height; i++) {
      // mask alpha is stored at index i*4+3 but mask is RGB; use red channel (i*4) as alpha weight
      const maskAlpha = maskData[i * 4] / 255
      out[i * 4 + 3] = Math.round(imgData[i * 4 + 3] * maskAlpha)
    }
    return await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
  } catch (e) {
    console.error('applyShapeMaskToPng error', e.message)
    return pngBuf
  }
}

const VERTICAL_ALIGN = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }

function getCanvasClassStyle(canvasClasses = {}, className = '') {
  return resolveCanvasClass(canvasClasses, className)?.style || {}
}

export async function renderCanvasToPng(canvas, data = {}) {
  const fonts = await loadFontsForCanvas(canvas)
  const width = canvas.width || 1080
  const height = canvas.height || 1080
  const background = canvas.background || '#ffffff'

  let nodes = canvas.nodes || []

  // Apply group layout to resolve final x/y for all grouped nodes.
  // First, update heights of grouped text nodes based on dynamic content
  // so vertical stacking positions are correct when text wraps more lines.
  if (canvas.groups && canvas.groups.length > 0) {
    const groupedIds = new Set(canvas.groups.flatMap(g => g.nodeIds))
    nodes = nodes.map(node => {
      if (!groupedIds.has(node.id) || node.type !== 'text') return node
      const hasDynKey = node.dynamic_key && Object.prototype.hasOwnProperty.call(data, node.dynamic_key)
      // Only re-estimate height for DYNAMIC text whose content differs from the design.
      // Static grouped text keeps its editor-measured height, which is accurate and
      // keeps layout (stacking) in sync with the rendered box height (no overlap).
      if (!hasDynKey) return node
      const dynVal = data[node.dynamic_key]
      const hasValue = dynVal !== undefined && dynVal !== null && dynVal !== ''
      const text = hasValue ? String(dynVal) : (node.text || '')
      const estimatedH = estimateTextHeight(text, node)
      // Only grow the height — never shrink below design height
      return estimatedH > node.height ? { ...node, height: estimatedH, _dynamicGrown: true } : node
    })
    for (const group of canvas.groups) {
      nodes = applyGroupLayoutToNodes(nodes, group)
      
      // ── INTELLIGENT GROUP OVERFLOW HANDLING ──
      // After layout, check if any grouped nodes exceed canvas boundaries
      // If so, intelligently reposition the entire group to stay in bounds
      const groupMembers = (group.nodeIds || [])
        .map(id => nodes.find(n => n.id === id))
        .filter(Boolean)
      
      if (groupMembers.length > 0) {
        let minGroupX = Infinity, minGroupY = Infinity
        let maxGroupX = -Infinity, maxGroupY = -Infinity
        
        // Calculate group bounds (visible area including crops)
        for (const node of groupMembers) {
          const dims = getNodeEffectiveDimensions(node)
          const visibleX = node.x + dims.offsetX
          const visibleY = node.y + dims.offsetY
          const visibleRight = visibleX + dims.width
          const visibleBottom = visibleY + dims.height
          
          minGroupX = Math.min(minGroupX, visibleX)
          minGroupY = Math.min(minGroupY, visibleY)
          maxGroupX = Math.max(maxGroupX, visibleRight)
          maxGroupY = Math.max(maxGroupY, visibleBottom)
        }
        
        // Check if group exceeds canvas boundaries
        let offsetX = 0
        let offsetY = 0
        
        // If group extends beyond right edge, push it left
        if (maxGroupX > width) {
          offsetX = width - maxGroupX
        }
        // If group extends beyond left edge, push it right
        if (minGroupX + offsetX < 0) {
          offsetX = -minGroupX
        }
        
        // If group extends beyond bottom edge, push it up
        if (maxGroupY > height) {
          offsetY = height - maxGroupY
        }
        // If group extends beyond top edge, push it down
        if (minGroupY + offsetY < 0) {
          offsetY = -minGroupY
        }
        
        // Apply adjustment to all group members
        if (offsetX !== 0 || offsetY !== 0) {
          nodes = nodes.map(n => {
            if (group.nodeIds.includes(n.id)) {
              return { ...n, x: n.x + offsetX, y: n.y + offsetY }
            }
            return n
          })
        }
      }
    }
  }

  const groupNodeIds = new Set()
  if (canvas.groups) {
    for (const g of canvas.groups) {
      for (const id of g.nodeIds) groupNodeIds.add(id)
    }
  }

  const childPromises = nodes.map(async (node) => {
    // Hidden layers still take part in group layout above, so the others keep their places.
    if (node.hidden) return null
    const hasDynKey = node.dynamic_key && Object.prototype.hasOwnProperty.call(data, node.dynamic_key)
    const dynVal = hasDynKey ? data[node.dynamic_key] : undefined
    const hasValue = dynVal !== undefined && dynVal !== null && dynVal !== ''

    // All nodes use absolute positioning — groups are already laid out via applyGroupLayoutToNodes
    const position = 'absolute'
    const left = node.x
    const top = node.y

    if (node.type === 'text') {
      const text = hasValue ? String(dynVal) : (node.text || '')
      if (!text) return null
      
      const align = node.textAlign || 'left'
      const isGrouped = groupNodeIds.has(node.id)
      const nodeClassStyles = getCanvasClassStyle(canvas.classes || {}, node.className)

      const style = {
        position, left, top,
        width: node.width,
        // Static grouped text uses its accurate editor-measured height (matches the
        // layout stacking exactly). Dynamic text that was grown uses minHeight so it
        // can wrap further without overlapping the next member. Ungrouped nodes keep
        // their fixed design height (overflow:hidden crops as designed).
        ...(isGrouped
          ? (node._dynamicGrown ? { minHeight: node.height } : { height: node.height })
          : { height: node.height }),
        color: nodeClassStyles.color || node.color || '#000000', ...textGradientStyle(node, false),
        backgroundColor: nodeClassStyles.background || nodeClassStyles.backgroundColor || 'transparent',
        fontSize: node.fontSize || 48,
        fontWeight: nodeClassStyles.fontWeight || node.fontWeight || 400,
        fontStyle: nodeClassStyles.fontStyle || (node.fontStyle === 'italic' ? 'italic' : 'normal'),
        fontFamily: node.fontFamily || 'Inter',
        display: 'flex', flexDirection: 'column',
        // verticalAlign (set by the developer API) places the lines in the box; saved designs have none, and keep
        // centred text in the middle of the box and right-aligned text at the bottom.
        justifyContent: VERTICAL_ALIGN[node.verticalAlign] || (align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start'),
        textAlign: align,
        lineHeight: node.lineHeight || 1.2,
        letterSpacing: `${nodeClassStyles.letterSpacing || node.letterSpacing || 0}px`,
        textTransform: nodeClassStyles.textTransform || node.textTransform || 'none',
        textDecoration: nodeClassStyles.textDecoration || node.textDecoration || 'none',
        overflow: isGrouped ? 'visible' : 'hidden',
        whiteSpace: 'normal',
        wordBreak: 'break-word',
        overflowWrap: 'break-word',
      }
      if (node.rotation) style.transform = `rotate(${node.rotation}deg)`
      
      const ts = nodeClassStyles.textShadow && nodeClassStyles.textShadow.enabled ? nodeClassStyles.textShadow : (node.textShadow && node.textShadow.enabled ? node.textShadow : null)
      if (ts) {
        style.textShadow = `${ts.offsetX || 0}px ${ts.offsetY || 0}px ${ts.blur || 0}px ${ts.color || '#000'}`
      }

      const parsedTokens = parseStyledText(text, canvas.classes || {})
      const lineNodes = buildSatoriTextLines(parsedTokens, canvas.classes || {}, {
        align,
        lineHeight: node.lineHeight || 1.2,
      })

      return {
        nodeId: node.id,
        element: {
          type: 'div',
          props: {
            style,
            children: lineNodes.length === 1 ? lineNodes[0] : lineNodes,
          },
        }
      }
    }

    if (node.type === 'image') {
      const rawImageSrc = hasValue ? String(dynVal) : node.src
      const { url: imageSrc, filters: inlineFilters } = parseImageTags(rawImageSrc, canvas.classes || {})
      
      let buf = await fetchImageBuffer(imageSrc)
      if (buf) buf = await uprightImage(buf)
      // Flip before cropping: the editor crops the flipped picture.
      if (buf && (node.flipX || node.flipY)) {
        try {
          let flipped = sharp(buf, { failOn: 'none' })
          if (node.flipX) flipped = flipped.flop()
          if (node.flipY) flipped = flipped.flip()
          buf = await flipped.png().toBuffer()
        } catch (e) { console.error('flip error', e.message) }
      }

      let finalFilters = { ...(node.filters || {}) }
      const classStyle = getCanvasClassStyle(canvas.classes || {}, node.className)
      if (classStyle.filters) finalFilters = { ...finalFilters, ...classStyle.filters }
      if (inlineFilters) finalFilters = { ...finalFilters, ...inlineFilters }
      if (buf && Object.keys(finalFilters).length > 0) {
        try { buf = await applyImageFilters(buf, finalFilters) } catch (e) { console.error('filter error', e.message) }
      }

      const clsStyle = getCanvasClassStyle(canvas.classes || {}, node.className)
      const mask = clsStyle.mask || node.mask || 'none'
      const hasMask = mask !== 'none'
      const radius = clsStyle.borderRadius ?? node.borderRadius ?? 0

      // Placeholder when image fails to load
      if (!buf) {
        const borderRadius = hasMask
          ? (mask === 'circle' ? Math.round(Math.min(node.width, node.height) / 2)
            : mask === 'rounded' ? Math.round(Math.min(node.width, node.height) * 0.15)
            : mask === 'pill' ? Math.round(Math.min(node.width, node.height) * 0.5)
            : radius)
          : radius
        const style = { position, left, top, width: node.width, height: node.height, background: '#e5e7eb', display: 'flex', borderRadius }
        if (node.rotation) style.transform = `rotate(${node.rotation}deg)`
        return { nodeId: node.id, element: { type: 'div', props: { style } } }
      }

      // Convert to PNG
      let pngBuf = buf
      try { pngBuf = await sharp(buf).png().toBuffer() } catch (e) { console.error('png convert error', e.message) }

      // Apply physical crop
      const cL = node.cropLeft || 0
      const cR = node.cropRight || 0
      const cT = node.cropTop || 0
      const cB = node.cropBottom || 0
      if (cL > 0 || cR > 0 || cT > 0 || cB > 0) {
        try {
          const meta = await sharp(pngBuf).metadata()
          const imgW = meta.width || node.width
          const imgH = meta.height || node.height
          pngBuf = await sharp(pngBuf)
            .extract({
              left: Math.round((cL / 100) * imgW),
              top: Math.round((cT / 100) * imgH),
              width: Math.max(1, Math.round(((100 - cL - cR) / 100) * imgW)),
              height: Math.max(1, Math.round(((100 - cT - cB) / 100) * imgH)),
            })
            .png()
            .toBuffer()
        } catch (e) { console.error('crop extract error', e.message) }
      }

      // ── MASKED IMAGE ──────────────────────────────────────────────────────────
      if (hasMask) {
        // Use effective (post-crop) dimensions and offset position correctly
        const effDims = getNodeEffectiveDimensions(node)
        const rW = Math.round(effDims.width)
        const rH = Math.round(effDims.height)
        const rLeft = left + effDims.offsetX
        const rTop = top + effDims.offsetY
        try { pngBuf = await sharp(pngBuf).resize(rW, rH, { fit: 'cover' }).png().toBuffer() } catch (e) { console.error('mask resize error', e.message) }

        const svgMasks = ['triangle','triangle-down','diamond','pentagon','hexagon','star','arrow-right','parallelogram']
        if (svgMasks.includes(mask)) {
          try { pngBuf = await applyShapeMaskToPng(pngBuf, mask, rW, rH) } catch (e) { console.error('shape mask error', e.message) }
        }

        const borderRadius =
          mask === 'circle'  ? Math.round(Math.min(rW, rH) / 2) :
          mask === 'rounded' ? Math.round(Math.min(rW, rH) * 0.15) :
          mask === 'pill'    ? Math.round(Math.min(rW, rH) * 0.5) : radius

        const dataUrl = `data:image/png;base64,${pngBuf.toString('base64')}`
        const style = { position, left: rLeft, top: rTop, width: rW, height: rH, display: 'flex', overflow: 'hidden', borderRadius }
        if (node.rotation) style.transform = `rotate(${node.rotation}deg)`
        return {
          nodeId: node.id,
          element: { type: 'div', props: { style, children: { type: 'img', props: { src: dataUrl, style: { width: '100%', height: '100%', objectFit: 'fill' } } } } }
        }
      }

      // ── NORMAL IMAGE (no mask) ───────────────────────────────────────────────
      // Use effective (post-crop) dimensions and offset the position so the
      // visible content lands at the correct location on the canvas.
      const effDimsNormal = getNodeEffectiveDimensions(node)
      const nW = Math.round(effDimsNormal.width)
      const nH = Math.round(effDimsNormal.height)
      const nLeft = left + effDimsNormal.offsetX
      const nTop = top + effDimsNormal.offsetY
      const dataUrl = `data:image/png;base64,${pngBuf.toString('base64')}`
      const style = { position, left: nLeft, top: nTop, width: nW, height: nH, display: 'flex', overflow: 'hidden', borderRadius: radius }
      if (node.rotation) style.transform = `rotate(${node.rotation}deg)`
      return {
        nodeId: node.id,
        element: { type: 'div', props: { style, children: { type: 'img', props: { src: dataUrl, style: { width: '100%', height: '100%', objectFit: node.objectFit || 'cover' } } } } }
      }
    }

    if (node.type === 'shape') {
      const clsStyle = getCanvasClassStyle(canvas.classes || {}, node.className)
      const shape = clsStyle.shape || node.shape || 'rect'
      const fill = clsStyle.fill || node.fill || '#6366f1'
      const borderRadius = shape === 'ellipse' ? Math.max(node.width, node.height) : (clsStyle.borderRadius ?? node.borderRadius ?? 0)
      const strokeWidth = clsStyle.strokeWidth ?? node.strokeWidth ?? 0
      const stroke = clsStyle.stroke || node.stroke || '#000000'
      const style = {
        position, left, top, width: node.width, height: node.height,
        background: fill, borderRadius, display: 'flex',
      }
      if (node.rotation) style.transform = `rotate(${node.rotation}deg)`
      if (strokeWidth > 0) style.border = `${strokeWidth}px solid ${stroke}`
      return { nodeId: node.id, element: { type: 'div', props: { style } } }
    }

    if (node.type === 'gradient') {
      const clsStyle = getCanvasClassStyle(canvas.classes || {}, node.className)
      const shape = clsStyle.shape || node.shape || 'rect'
      const borderRadius = shape === 'ellipse' ? Math.max(node.width, node.height) : (clsStyle.borderRadius ?? node.borderRadius ?? 0)
      const style = {
        position, left, top, width: node.width, height: node.height,
        backgroundImage: buildGradientCss({ ...node, ...clsStyle }), borderRadius, display: 'flex',
      }
      if (node.rotation) style.transform = `rotate(${node.rotation}deg)`
      return {
        nodeId: node.id,
        element: { type: 'div', props: { style } }
      }
    }
    return null
  })

  const resolvedChildren = (await Promise.all(childPromises)).filter(Boolean)

  const opacityById = new Map(nodes.filter(n => typeof n.opacity === 'number' && n.opacity < 100).map(n => [n.id, Math.max(0, n.opacity) / 100]))
  const finalChildren = resolvedChildren
    .filter(item => item && item.element)
    .map(item => (opacityById.has(item.nodeId)
      ? { ...item.element, props: { ...item.element.props, style: { ...item.element.props.style, opacity: opacityById.get(item.nodeId) } } }
      : item.element))

  const tree = {
    type: 'div',
    props: {
      style: { width, height, background, position: 'relative', display: 'flex', fontFamily: 'Inter' },
      children: finalChildren
    }
  }

  const svg = await satori(tree, { width, height, fonts })
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width } })
  let png = resvg.render().asPng()

  // Apply canvas-level color mode as a final pass
  if (canvas.colorMode && canvas.colorMode !== 'color') {
    try { png = await applyCanvasColorMode(png, canvas.colorMode) } catch (e) { console.error('colorMode error', e.message) }
  }
  return png
}
