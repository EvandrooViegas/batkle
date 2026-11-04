// lib/styleParser.js

// Parse an inline style string like "color=#ff0000|font-size=24px|textDecoration=underline"
export function resolveCanvasClass(canvasClasses = {}, className = '') {
  if (!className) return null
  if (canvasClasses[className]) return { key: className, style: canvasClasses[className] }
  const withDot = className.startsWith('.') ? className : `.${className}`
  if (canvasClasses[withDot]) return { key: withDot, style: canvasClasses[withDot] }
  const withoutDot = className.startsWith('.') ? className.slice(1) : className
  if (canvasClasses[withoutDot]) return { key: withoutDot, style: canvasClasses[withoutDot] }
  return null
}

export function isVisibleBackground(bg) {
  if (!bg || typeof bg !== 'string') return false
  const b = bg.trim().toLowerCase()
  if (b === 'transparent' || b === 'none') return false
  if (b === 'rgba(0,0,0,0)' || b === 'rgba(0, 0, 0, 0)') return false
  if (/^#[0-9a-f]{8}$/i.test(b) && b.slice(-2) === '00') return false
  return true
}

function classTextStyleBase(cls = {}) {
  const py = typeof cls.paddingY === 'number' ? cls.paddingY : 0
  const px = typeof cls.paddingX === 'number' ? cls.paddingX : 0
  const bg = cls.background || cls.backgroundColor
  // A visible background should always render — padding only controls how much
  // space surrounds the text, not whether the highlight box appears at all.
  const showBgBox = isVisibleBackground(bg)

  const style = {}
  if (cls.color) style.color = cls.color
  if (cls.fontFamily) style.fontFamily = cls.fontFamily
  if (typeof cls.backgroundImage === 'string' && /^linear-gradient\([0-9.]+deg, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/i.test(cls.backgroundImage)) {
    style.backgroundImage=cls.backgroundImage
    if (cls.backgroundClip === 'text') { style.backgroundClip='text'; style.color='transparent' }
  }
  if (showBgBox) {
    style.backgroundColor = bg
    style.paddingTop = py
    style.paddingBottom = py
    style.paddingLeft = px
    style.paddingRight = px
    style.lineHeight = 1
    if (cls.borderRadius) style.borderRadius = `${cls.borderRadius}px`
  }
  // The colour rides in the shorthand as well: the image renderer's shorthand resets a separate colour.
  if (cls.textDecoration) style.textDecoration = cls.textDecorationColor ? `${cls.textDecoration} ${cls.textDecorationColor}` : cls.textDecoration
  if (cls.textDecorationColor) style.textDecorationColor = cls.textDecorationColor
  if (cls.textDecorationThickness) style.textDecorationThickness = cls.textDecorationThickness
  if (cls.textUnderlineOffset) style.textUnderlineOffset = cls.textUnderlineOffset
  if (cls.letterSpacing != null) style.letterSpacing = `${cls.letterSpacing}px`
  if (cls.fontWeight) style.fontWeight = cls.fontWeight
  if (cls.fontStyle) style.fontStyle = cls.fontStyle
  if (cls.textTransform) style.textTransform = cls.textTransform
  if (cls.textShadow?.enabled) {
    style.textShadow = `${cls.textShadow.offsetX || 0}px ${cls.textShadow.offsetY || 0}px ${cls.textShadow.blur || 0}px ${cls.textShadow.color || '#000'}`
  }
  if (showBgBox && cls.boxShadow?.enabled) {
    style.boxShadow = `${cls.boxShadow.offsetX || 0}px ${cls.boxShadow.offsetY || 0}px ${cls.boxShadow.blur || 0}px ${cls.boxShadow.color || '#000'}`
  }
  return style
}

/** Browser editor — inline flow */
export function classTextStyleForEditor(cls = {}) {
  return {
    ...classTextStyleBase(cls),
    display: 'inline',
    verticalAlign: 'baseline',
    lineHeight: 'inherit',
    boxDecorationBreak: 'clone',
    WebkitBoxDecorationBreak: 'clone',
  }
}

/** Satori PNG export — no display:inline (unsupported) */
export function classTextStyleForSatori(cls = {}) {
  return classTextStyleBase(cls)
}

function sanitizeInlineStyleForSatori(style = {}) {
  const { display, verticalAlign, lineHeight, boxDecorationBreak, WebkitBoxDecorationBreak, ...rest } = style
  return rest
}

function parseInlineStyleString(str) {
  const style = {}
  str.split('|').forEach(part => {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) return
    const prop = part.slice(0, eqIdx).trim()
    const val = part.slice(eqIdx + 1).trim()
    // Convert kebab-case to camelCase
    const camelProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    style[camelProp] = val
  })
  return style
}

// Finds the next <%kind: or <%inline: opening tag after currentIndex
function findNextOpenTag(text, currentIndex) {
  const kindIdx = text.indexOf('<%kind:', currentIndex)
  const inlineIdx = text.indexOf('<%inline:', currentIndex)
  if (kindIdx === -1 && inlineIdx === -1) return null
  if (kindIdx === -1) return { idx: inlineIdx, type: 'inline', prefixLen: 9 }
  if (inlineIdx === -1) return { idx: kindIdx, type: 'kind', prefixLen: 7 }
  return kindIdx <= inlineIdx
    ? { idx: kindIdx, type: 'kind', prefixLen: 7 }
    : { idx: inlineIdx, type: 'inline', prefixLen: 9 }
}

// Recursively parses text containing <%kind:.classname:content%> and <%inline:prop=val|...:content%>
// Returns an array of token objects/strings.
export function parseStyledText(text, canvasClasses = {}) {
  if (!text) return []

  const tokens = []
  let currentIndex = 0

  while (currentIndex < text.length) {
    const next = findNextOpenTag(text, currentIndex)
    if (!next) {
      tokens.push(text.slice(currentIndex))
      break
    }

    const openIdx = next.idx
    const tagType = next.type
    const prefixLen = next.prefixLen

    if (openIdx > currentIndex) {
      tokens.push(text.slice(currentIndex, openIdx))
    }

    // Find the separator colon that ends the class name / style string
    // prefixLen already covers the full prefix (e.g. '<%kind:' = 7 chars),
    // so the class name / style string starts at openIdx + prefixLen.
    const separatorIdx = text.indexOf(':', openIdx + prefixLen)
    if (separatorIdx === -1) {
      tokens.push(text.slice(openIdx))
      break
    }

    const tagValue = text.slice(openIdx + prefixLen, separatorIdx)

    // Now find the matching closing %> using balanced counting for nested <%kind: or <%inline:
    let balance = 1
    let contentStartIdx = separatorIdx + 1
    let searchIdx = contentStartIdx
    let matchIdx = -1

    while (searchIdx < text.length) {
      const nextOpen = findNextOpenTag(text, searchIdx)
      const nextClose = text.indexOf('%>', searchIdx)

      if (nextClose === -1) break

      if (nextOpen !== null && nextOpen.idx < nextClose) {
        balance++
        searchIdx = nextOpen.idx + nextOpen.prefixLen
      } else {
        balance--
        if (balance === 0) {
          matchIdx = nextClose
          break
        }
        searchIdx = nextClose + 2
      }
    }

    if (matchIdx === -1) {
      tokens.push(text.slice(openIdx))
      break
    }

    const innerContent = text.slice(contentStartIdx, matchIdx)
    const parsedInner = parseStyledText(innerContent, canvasClasses)

    if (tagType === 'kind') {
      const className = tagValue
      tokens.push({ type: 'styled', className, children: parsedInner })
    } else {
      // inline type — tagValue is the style string
      const elementStyle = parseInlineStyleString(tagValue)
      tokens.push({ type: 'styled', style: elementStyle, children: parsedInner })
    }

    currentIndex = matchIdx + 2
  }

  return tokens
}

const EDITOR_INLINE_STYLE = { display: 'inline', verticalAlign: 'baseline', lineHeight: 'inherit' }

function resolveTokenStyle(token, canvasClasses, forSatori) {
  if (token.className) {
    const cls = resolveCanvasClass(canvasClasses, token.className)?.style || {}
    return forSatori ? classTextStyleForSatori(cls) : classTextStyleForEditor(cls)
  }
  const style = token.style || {}
  return forSatori ? sanitizeInlineStyleForSatori(style) : style
}

// Convert AST to React/Satori elements
export function renderStyledText(tokens, ReactCreateElement = null, options = {}) {
  const { forSatori = false, canvasClasses = {} } = options

  return tokens.map((token, i) => {
    if (typeof token === 'string') {
      // Satori drops whitespace-only text siblings beside styled spans. Give each
      // separator its own non-collapsing flex item so highlighted words stay apart.
      if (forSatori && /^[ \t]+$/.test(token)) return {
        type: 'span',
        props: { style: { whiteSpace: 'pre', flexShrink: 0 }, children: token.replace(/[ \t]/g, '\u00a0') },
      }
      // Keep a percentage together even in narrow flex-wrapped text boxes.
      const pieces = token.split(/(\d+(?:[.,]\d+)?[ \t]*%)/g)
      if (pieces.length > 1) return pieces.filter(Boolean).map((piece,j) => {
        const percentage = /^\d+(?:[.,]\d+)?[ \t]*%$/.test(piece)
        const style = percentage ? {whiteSpace:'nowrap',wordBreak:'normal',flexShrink:0} : EDITOR_INLINE_STYLE
        const text = percentage ? piece.replace(/[ \t]+/g,'') : piece
        return ReactCreateElement ? ReactCreateElement('span',{key:i+'-'+j,style},text) : {type:'span',props:{style,children:text}}
      })
      if (forSatori) return token
      if (ReactCreateElement) {
        return ReactCreateElement('span', { key: i, style: EDITOR_INLINE_STYLE }, token)
      }
      return { type: 'span', props: { style: EDITOR_INLINE_STYLE, children: token } }
    }

    const style = forSatori
      ? resolveTokenStyle(token, canvasClasses, true)
      : { ...EDITOR_INLINE_STYLE, ...resolveTokenStyle(token, canvasClasses, false) }

    const childOpts = { forSatori, canvasClasses }

    if (ReactCreateElement) {
      return ReactCreateElement('span', { key: i, style }, renderStyledText(token.children, ReactCreateElement, childOpts))
    }
    return {
      type: 'span',
      props: {
        style,
        children: renderStyledText(token.children, null, childOpts),
      },
    }
  }).flat()
}

/** Split token list at literal \\n (including inside styled spans). */
export function splitTokensByNewlines(tokens) {
  const lines = [[]]

  const pushToLine = (token) => {
    lines[lines.length - 1].push(token)
  }

  for (const token of tokens) {
    if (typeof token === 'string') {
      const parts = token.split('\n')
      parts.forEach((part, i) => {
        if (i > 0) lines.push([])
        if (part) pushToLine(part)
      })
      continue
    }

    const sublines = splitTokensByNewlines(token.children || [])
    sublines.forEach((subline, i) => {
      if (i > 0) lines.push([])
      if (subline.length) pushToLine({ ...token, children: subline })
    })
  }

  if (lines.length === 0) lines.push([])
  return lines
}

/** Break strings into words/spaces so Satori flex-wrap breaks at spaces, not at styled spans. */
export function expandTokensToWordSegments(tokens) {
  const expanded = []
  for (const token of tokens) {
    if (typeof token === 'string') {
      const parts = token.split(/(\s+)/)
      for (const part of parts) {
        if (part) expanded.push(part)
      }
    } else {
      expanded.push(token)
    }
  }
  return expanded
}

const lineRowStyle = (align, lineHeight) => ({
  display: 'flex',
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
  width: '100%',
  lineHeight,
  gap: 0,
})

/** Build per-line Satori nodes (explicit \\n + width-aware word wrap). */
export function buildSatoriTextLines(parsedTokens, canvasClasses, { align = 'left', lineHeight = 1.2 } = {}) {
  const lines = splitTokensByNewlines(parsedTokens)
  return lines.map((lineTokens) => {
    const segments = expandTokensToWordSegments(lineTokens)
    const children = renderStyledText(segments, null, { forSatori: true, canvasClasses })
    return {
      type: 'div',
      props: {
        style: lineRowStyle(align, lineHeight),
        children,
      },
    }
  })
}

// Extract URL and merged filters from nested class tags for images
export function parseImageTags(urlStr, canvasClasses = {}) {
  if (typeof urlStr !== 'string') return { url: urlStr, filters: null }
  
  let currentStr = urlStr
  const filters = {
    brightness: 100, contrast: 100, saturate: 100, grayscale: 0, 
    blur: 0, sepia: 0, hueRotate: 0, opacity: 100
  }
  let modified = false

  while (currentStr && currentStr.startsWith('<%kind:')) {
    const classEndIdx = currentStr.indexOf(':')
    if (classEndIdx === -1) break
    
    const colon2Idx = currentStr.indexOf(':', classEndIdx + 1)
    if (colon2Idx === -1) break

    const className = currentStr.slice(7, colon2Idx)
    const cls = resolveCanvasClass(canvasClasses, className)?.style || {}
    
    if (cls.filters) {
      modified = true
      Object.keys(cls.filters).forEach(k => {
        filters[k] = cls.filters[k]
      })
    }

    const endTagIdx = currentStr.lastIndexOf('%>')
    if (endTagIdx !== -1) {
      currentStr = currentStr.slice(colon2Idx + 1, endTagIdx)
    } else {
      break
    }
  }

  return {
    url: currentStr,
    filters: modified ? filters : null
  }
}
