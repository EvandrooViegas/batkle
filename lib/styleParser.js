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

const lineRowStyle = (align, lineHeight, hang = 0) => ({
  display: 'flex',
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
  // With `hang`, the row reaches that far past the text box on the right (it stretches across the box's column), so
  // the space after a line's last word hangs there, as in a browser, instead of pushing the word to the next line.
  ...(hang > 0 ? { alignSelf: 'stretch', marginRight: -hang } : { width: '100%' }),
  lineHeight,
  gap: 0,
})

const SPACE = /^[ \t]+$/

/**
 * Each word with the spaces that follow it, so a line never starts with a space: Satori 0.33 moves a space that no
 * longer fits at the end of a line to the start of the next one, where it shows as an indent. Spaces before the first
 * word stay a group of their own.
 */
export function wordGroups(segments) {
  const groups = []
  for (const segment of segments) {
    const space = typeof segment === 'string' && SPACE.test(segment)
    if (space && groups.length && !groups[groups.length - 1].leading) groups[groups.length - 1].push(segment)
    else groups.push(Object.assign([segment], space ? { leading: true } : {}))
  }
  return groups
}

/**
 * Build per-line Satori nodes (explicit \\n + width-aware word wrap). `hang` (px, the renderer passes a fraction of the
 * font size) lets the space at a line's end hang past the box; centred and right-aligned lines then all end with one,
 * so every line sits the same way against the box.
 */
export function buildSatoriTextLines(parsedTokens, canvasClasses, { align = 'left', lineHeight = 1.2, hang = 0 } = {}) {
  const lines = splitTokensByNewlines(parsedTokens)
  return lines.map((lineTokens) => {
    const segments = expandTokensToWordSegments(lineTokens)
    if (hang > 0 && align !== 'left' && segments.length && !SPACE.test(String(segments[segments.length - 1]))) segments.push(' ')
    const children = wordGroups(segments).map(group => {
      const rendered = renderStyledText(group, null, { forSatori: true, canvasClasses })
      return group.length === 1 ? rendered[0] : { type: 'div', props: { style: { display: 'flex', flexDirection: 'row', alignItems: 'baseline' }, children: rendered } }
    })
    return {
      type: 'div',
      props: {
        style: lineRowStyle(align, lineHeight, hang),
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
