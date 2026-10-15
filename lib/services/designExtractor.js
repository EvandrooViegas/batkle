import { load } from 'cheerio'
import sharp from 'sharp'
import { fetchWebsiteResource } from './websiteFetch'

// Brand colours and fonts read from the homepage HTML, its stylesheets and its logo. No browser: the server has none.

const NAMED_COLORS = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500',
  purple: '#800080', pink: '#ffc0cb', gray: '#808080', grey: '#808080', silver: '#c0c0c0', navy: '#000080', teal: '#008080',
  maroon: '#800000', olive: '#808000', lime: '#00ff00', aqua: '#00ffff', cyan: '#00ffff', fuchsia: '#ff00ff', magenta: '#ff00ff',
  gold: '#ffd700', crimson: '#dc143c', tomato: '#ff6347', coral: '#ff7f50', salmon: '#fa8072', indigo: '#4b0082', violet: '#ee82ee',
  darkblue: '#00008b', darkred: '#8b0000', darkgreen: '#006400', royalblue: '#4169e1', dodgerblue: '#1e90ff', steelblue: '#4682b4',
  skyblue: '#87ceeb', firebrick: '#b22222', orangered: '#ff4500', darkorange: '#ff8c00', seagreen: '#2e8b57', forestgreen: '#228b22',
  midnightblue: '#191970', whitesmoke: '#f5f5f5', gainsboro: '#dcdcdc', lightgray: '#d3d3d3', lightgrey: '#d3d3d3',
  darkgray: '#a9a9a9', darkgrey: '#a9a9a9', dimgray: '#696969', slategray: '#708090', beige: '#f5f5dc', ivory: '#fffff0',
}
// Framework defaults that sites ship whether or not they use them (Bootstrap, Elementor, WordPress admin, Swiper, Plyr).
const FRAMEWORK_DEFAULTS = new Set(['#0d6efd', '#007bff', '#6c757d', '#6ec1e4', '#54595f', '#7a7a7a', '#61ce70', '#0073aa', '#2271b1', '#3858e9', '#007aff', '#00b3ff'])
// Third-party widgets name their own variables "--swiper-theme-color", "--plyr-color-main"...; they say nothing about the brand.
const LIBRARY_VAR = /^--(swiper|plyr|toastify|splide|glide|fancybox|f-|lg-|pswp|tippy|select2|choices|flatpickr|cc-|cookie|klaro|onetrust|cky-|wp-admin|wp--style|tw-|rdp-|sonner)/i
const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace',
  'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'inherit', 'initial', 'unset', 'revert',
  'revert-layer', 'apple color emoji', 'segoe ui emoji', 'segoe ui symbol', 'noto color emoji', 'android emoji', 'none', 'sans'])
const SYSTEM_FONTS = new Set(['arial', 'helvetica', 'helvetica neue', 'times', 'times new roman', 'georgia', 'verdana', 'tahoma',
  'trebuchet ms', 'courier', 'courier new', 'lucida grande', 'lucida sans unicode', 'geneva'])
const ICON_FONT = /icon|awesome|^fa[srbld]?$|^fa |glyph|material symbols|dashicons|eicons|ionicons|feather|slick|swiper|revicons|fontello|icomoon|themify|linearicons|flaticon|socicon|etmodules|woocommerce|fancybox|^vc |simple line|entypo|elegant/i
const SKIP_STYLESHEET = /fonts\.googleapis|fonts\.bunny|p\.typekit|cookie|consent|gdpr|onetrust|cookiebot|intercom|hubspot|recaptcha|font-?awesome|dashicons|swiper|slick|owl\.carousel|animate(\.min)?\.css|aos\.css|lightbox|fancybox|magnific|photoswipe|select2|jquery-ui|flatpickr|leaflet|mapbox|tawk|zendesk|trustpilot|instagram-feed|wpforms|contact-form-7|elementor\/assets\/lib|eicons|revslider|block-library/i

const ROLE_WEIGHT = {
  button: { bg: 10, fg: 4, border: 5 },
  heading: { bg: 2, fg: 6, border: 1 },
  chrome: { bg: 6, fg: 3, border: 1.5 },
  link: { bg: 2, fg: 4, border: 1 },
  base: { bg: 3, fg: 1.5, border: 0 },
  text: { bg: 1, fg: 1, border: 0.5 },
  footer: { bg: 3, fg: 1, border: 0.5 },
  other: { bg: 1.5, fg: 1, border: 0.5 },
}
const FONT_WEIGHT = {
  heading: { heading: 6, body: 0 }, base: { heading: 1.5, body: 6 }, text: { heading: 0, body: 2.5 }, button: { heading: 0.5, body: 1.5 },
  chrome: { heading: 0.5, body: 1.5 }, link: { heading: 0, body: 1 }, footer: { heading: 0, body: 0.5 }, other: { heading: 0.5, body: 0.7 },
}
// Builders hash class names ("StylableButton2545352419__root"), so "button" counts anywhere in a name.
const BUTTON = /button|btn|(^|[^a-z])cta([^a-z]|$)|__submit/i
const HEADING = /(^|[^a-z])(h[1-3]|title|heading|headline|display)([^a-z]|$)/i
const CHROME = /(^|[^a-z])(header|navbar|nav|menu|masthead|topbar|top-bar|hero|banner|announcement)([^a-z]|$)/i
const FOOTER = /(^|[^a-z])footer([^a-z]|$)/i
const DARK_SELECTOR = /\.dark([^\w-]|$)|dark-mode|theme-dark|\[data-[\w-]*(theme|mode|scheme)[\w-]*=['"]?dark/i

// ---------------------------------------------------------------- colour maths

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value))
const toHex = ({ r, g, b }) => '#' + [r, g, b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')
const hexToRgb = hex => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) })

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360
  const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) }
  return { r: f(0), g: f(8), b: f(4) }
}

function oklabToRgb(L, A, B) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  const gamma = x => { x = clamp(x); return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055) }
  return { r: gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), g: gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), b: gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) }
}

export function rgbToOklab({ r, g, b }) {
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B), m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B), s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return { L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s }
}

const angle = token => { const v = parseFloat(token); return /turn$/.test(token) ? v * 360 : /grad$/.test(token) ? v * 0.9 : /rad$/.test(token) ? v * 180 / Math.PI : v }
const fraction = (token, scale = 1) => token === 'none' ? 0 : token.endsWith('%') ? parseFloat(token) / 100 * scale : parseFloat(token)

/** Any CSS colour this extractor understands, as { r, g, b, a } (0-255, alpha 0-1); null for everything else. */
export function parseColor(input) {
  const value = String(input || '').trim().toLowerCase()
  if (NAMED_COLORS[value]) return { ...hexToRgb(NAMED_COLORS[value]), a: 1 }
  let match = value.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/)
  if (match) {
    const hex = match[1].length <= 4 ? match[1].split('').map(c => c + c).join('') : match[1]
    return { ...hexToRgb('#' + hex), a: hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1 }
  }
  match = value.match(/^(rgba?|hsla?|oklch|oklab)\((.*)\)$/)
  if (!match) return null
  const parts = match[2].replace(/\//g, ' / ').split(/[\s,]+/).filter(Boolean), slash = parts.indexOf('/')
  const [x, y, z, w] = slash >= 0 ? [...parts.slice(0, 3), parts[slash + 1]] : parts
  if (z == null) return null
  const fn = match[1]
  const rgb = fn.startsWith('rgb') ? { r: fraction(x, 255), g: fraction(y, 255), b: fraction(z, 255) }
    : fn.startsWith('hsl') ? hslToRgb(angle(x), parseFloat(y) / 100, parseFloat(z) / 100)
    : fn === 'oklab' ? oklabToRgb(fraction(x), fraction(y, 0.4), fraction(z, 0.4))
    : oklabToRgb(fraction(x), fraction(y, 0.4) * Math.cos(angle(z) * Math.PI / 180), fraction(y, 0.4) * Math.sin(angle(z) * Math.PI / 180))
  const a = w == null ? 1 : clamp(fraction(w))
  return [rgb.r, rgb.g, rgb.b, a].some(Number.isNaN) ? null : { ...rgb, a }
}

/** Custom properties often hold bare channels for rgb()/hsl(): "18, 18, 18" or "222 47% 11%". */
function parseBareColor(value) {
  const match = String(value).trim().match(/^(-?[\d.]+)(?:deg)?(?:\s*,\s*|\s+)([\d.]+%?)(?:\s*,\s*|\s+)([\d.]+%?)$/)
  if (!match) return null
  if (match[2].endsWith('%') && match[3].endsWith('%')) return parseColor(`hsl(${match[1]} ${match[2]} ${match[3]})`)
  return [match[1], match[2], match[3]].every(v => !v.endsWith('%') && +v <= 255) ? parseColor(`rgb(${match[1]} ${match[2]} ${match[3]})`) : null
}

function colorsIn(value) {
  const text = value.replace(/url\([^)]*\)/gi, ' ')
  return [...text.matchAll(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\([^()]*\)|\b[a-z]+\b/gi)].map(m => parseColor(m[0])).filter(c => c && c.a >= 0.5)
}

// ---------------------------------------------------------------- CSS parsing

function splitTop(text, separator) {
  const parts = []
  let depth = 0, quote = null, start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue }
    if (c === '"' || c === "'") quote = c
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === separator && depth <= 0) { parts.push(text.slice(start, i)); start = i + 1 }
  }
  parts.push(text.slice(start))
  return parts
}

function blockEnd(text, open) {
  let depth = 0, quote = null
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null }
    else if (c === '"' || c === "'") quote = c
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i + 1
  }
  return text.length
}

function declarations(body) {
  return splitTop(body, ';').map(part => {
    const colon = part.indexOf(':')
    if (colon < 1) return null
    const prop = part.slice(0, colon).trim()
    return [prop.startsWith('--') ? prop : prop.toLowerCase(), part.slice(colon + 1).replace(/!\s*important\s*$/i, '').trim()]
  }).filter(Boolean)
}

/** Nested rules (native CSS nesting) are parsed separately; their parent keeps only its own declarations. */
function withoutBlocks(body) {
  let out = '', i = 0
  for (let open = body.indexOf('{'); open >= 0; open = body.indexOf('{', i)) {
    const head = Math.max(body.lastIndexOf(';', open), body.lastIndexOf('}', open)) + 1
    out += body.slice(i, Math.max(i, head)) + ';'
    i = blockEnd(body, open)
  }
  return out + body.slice(i)
}

/** Tolerant parser for minified production CSS: style rules with their media context, @font-face blocks and @import URLs. */
export function parseCss(css, sheet = { rules: [], fontFaces: [], imports: [] }, context = '', parent = '') {
  const text = parent ? css : css.replace(/\/\*[\s\S]*?\*\//g, '')
  let i = 0
  while (i < text.length) {
    let j = i, quote = null, depth = 0
    for (; j < text.length; j++) {
      const c = text[j]
      if (quote) { if (c === '\\') j++; else if (c === quote) quote = null; continue }
      if (c === '"' || c === "'") quote = c
      else if (c === '(') depth++
      else if (c === ')') depth--
      else if (depth <= 0 && (c === '{' || c === ';' || c === '}')) break
    }
    if (j >= text.length) break
    const head = text.slice(i, j).trim()
    if (text[j] !== '{') {
      const url = text[j] === ';' && /^@import\b/i.test(head) && head.match(/url\(\s*['"]?([^'")\s]+)|['"]([^'"]+)['"]/i)
      if (url) sheet.imports.push(url[1] || url[2])
      i = j + 1
      continue
    }
    const end = blockEnd(text, j), body = text.slice(j + 1, end - 1)
    i = end
    if (head.startsWith('@')) {
      const name = (head.match(/^@([\w-]+)/)?.[1] || '').toLowerCase()
      if (name === 'font-face') sheet.fontFaces.push(Object.fromEntries(declarations(body)))
      else if (name === 'media') { if (!/\bprint\b/i.test(head) || /\b(screen|all)\b/i.test(head)) parseCss(body, sheet, /prefers-color-scheme\s*:\s*dark/i.test(head) ? 'dark' : context, parent || ' ') }
      else if (['supports', 'layer', 'container', 'scope', 'document', '-moz-document'].includes(name)) parseCss(body, sheet, context, parent || ' ')
      continue
    }
    const selector = parent.trim() ? splitTop(head, ',').map(s => s.includes('&') ? s.replace(/&/g, parent.trim()) : `${parent.trim()} ${s.trim()}`).join(',') : head
    if (body.includes('{')) {
      parseCss(body, sheet, context, selector)
      sheet.rules.push({ selector, decls: declarations(withoutBlocks(body)), context })
    } else sheet.rules.push({ selector, decls: declarations(body), context })
  }
  return sheet
}

function replaceVars(text, lookup) {
  let result = '', i = 0
  for (let start = text.indexOf('var(', i); start >= 0; start = text.indexOf('var(', i)) {
    let depth = 0, end = start + 3
    for (; end < text.length; end++) { if (text[end] === '(') depth++; else if (text[end] === ')' && --depth === 0) break }
    const [name, ...fallback] = splitTop(text.slice(start + 4, end), ',')
    result += text.slice(i, start) + lookup(name.trim(), fallback.length ? fallback.join(',').trim() : '')
    i = end + 1
  }
  return result + text.slice(i)
}

function resolveVars(value, scopes) {
  let out = value
  for (let depth = 0; depth < 8 && out.includes('var('); depth++) {
    out = replaceVars(out, (name, fallback) => { for (const scope of scopes) if (scope.has(name)) return scope.get(name); return fallback })
  }
  return out
}

// ---------------------------------------------------------------- selectors and the document

const unescapeCss = text => text.replace(/\\([0-9a-f]{1,6}\s?|.)/gi, (_, c) => /^[0-9a-f]{1,6}\s?$/i.test(c) ? String.fromCodePoint(parseInt(c, 16)) : c)

function parseSelector(text) {
  const pseudo = (text.match(/(?<!\\)::?[\w-]+/g) || []).map(p => p.replace(/^:+/, '').toLowerCase())
  const stripped = text
    .replace(/(?<!\\):[\w-]+\((?:[^()]|\([^()]*\))*\)/g, '')
    .replace(/(?<!\\)::?[\w-]+/g, '')
    .replace(/(?<!\\)\[[^\]]*(?<!\\)\]/g, attribute => /^\[type=['"]?(submit|button)/i.test(attribute) ? '.__submit' : '')
  const compounds = stripped.trim().split(/\s*[>+~]\s*|\s+/).filter(Boolean).map(part => ({
    tag: (part.match(/^[a-z][\w-]*/i)?.[0] || '').toLowerCase(),
    classes: [...part.matchAll(/(?<!\\)\.((?:\\.|[\w-])+)/g)].map(m => unescapeCss(m[1])),
    ids: [...part.matchAll(/(?<!\\)#((?:\\.|[\w-])+)/g)].map(m => unescapeCss(m[1])),
  }))
  return { text: text.toLowerCase(), compounds, pseudo, root: /:root|:host/i.test(text), dark: DARK_SELECTOR.test(text) }
}

const addRole = (entry = { total: 0 }, role) => { entry.total++; entry[role] = (entry[role] || 0) + 1; return entry }

function elementRole(tag, label, attrs, context) {
  if (tag === 'button' || (tag === 'input' && /^(submit|button)$/i.test(attrs.type || '')) || attrs.role === 'button' || (/^(a|div|span)$/.test(tag) && BUTTON.test(label))) return 'button'
  if (/^h[1-3]$/.test(tag)) return 'heading'
  if (context.chrome) return 'chrome'
  if (context.footer) return 'footer'
  if (tag === 'a') return 'link'
  if (tag === 'html' || tag === 'body') return 'base'
  if (/^(p|li|main|article|blockquote|input|textarea|label)$/.test(tag)) return 'text'
  return 'other'
}

/** Which tags, classes and ids the page uses, in which role (button, heading, header...), plus inline styles and SVG colours. */
function indexDocument($) {
  const doc = { tags: new Map(), classes: new Map(), ids: new Set(), rootClasses: new Set(), inline: [], svgs: [], elements: 0, dark: false }
  const visit = (node, context) => {
    for (const child of node.children || []) {
      if (child.type !== 'tag') continue
      const tag = child.name.toLowerCase(), attrs = child.attribs || {}
      const classes = (attrs.class || '').split(/\s+/).filter(Boolean), label = `${classes.join(' ')} ${attrs.id || ''}`
      const next = {
        chrome: context.chrome || /^(header|nav)$/.test(tag) || /^(banner|navigation)$/.test(attrs.role || '') || /(^|[^a-z])(site-header|main-header|masthead|navbar|topbar|top-bar|hero|announcement-bar)([^a-z]|$)/i.test(label) || attrs.id === 'header',
        footer: context.footer || tag === 'footer' || attrs.role === 'contentinfo' || FOOTER.test(label),
        logo: context.logo || /logo|brand/i.test(`${label} ${attrs['aria-label'] || ''}`),
        svg: tag === 'svg' && !context.svg ? new Set() : context.svg,
      }
      if (tag === 'svg' && !context.svg) doc.svgs.push({ logo: next.logo || next.chrome, colors: next.svg })
      const role = elementRole(tag, label, attrs, next)
      doc.elements++
      doc.tags.set(tag, addRole(doc.tags.get(tag), role))
      for (const name of classes) doc.classes.set(name, addRole(doc.classes.get(name), role))
      if (attrs.id) doc.ids.add(attrs.id)
      if (tag === 'html' || tag === 'body') {
        classes.forEach(name => doc.rootClasses.add(name))
        if (/dark/i.test(`${label} ${attrs['data-theme'] || ''} ${attrs['data-mode'] || ''} ${attrs['data-color-scheme'] || ''}`)) doc.dark = true
      }
      if (attrs.style) doc.inline.push({ role, style: attrs.style })
      if (next.svg) for (const name of ['fill', 'stroke', 'stop-color']) if (attrs[name]) next.svg.add(attrs[name])
      visit(child, next)
    }
  }
  visit($.root()[0], {})
  return doc
}

const present = (compound, doc) => (!compound.tag || compound.tag === '*' || doc.tags.has(compound.tag)) && compound.classes.every(c => doc.classes.has(c)) && compound.ids.every(id => doc.ids.has(id))

/** Roles a selector plays, each with how many elements carry it; class selectors borrow the roles of the elements using them. */
function selectorRoles(selector, doc) {
  const roles = new Map(), add = (role, count = 1) => roles.set(role, Math.max(roles.get(role) || 0, count))
  const subject = selector.compounds[selector.compounds.length - 1] || { tag: '', classes: [], ids: [] }
  const subjectText = [subject.tag, ...subject.classes, ...subject.ids].join(' ')
  const tagCount = subject.tag ? doc.tags.get(subject.tag)?.total || 1 : 1
  if (selector.root || /^(html|body)$/.test(subject.tag)) add('base')
  else if (/^h[1-3]$/.test(subject.tag) || HEADING.test(subjectText)) add('heading', tagCount)
  if (subject.tag === 'button' || BUTTON.test(subjectText)) add('button', tagCount)
  if (subject.tag === 'a') add('link', tagCount)
  if (/^(p|li|main|article)$/.test(subject.tag)) add('text', tagCount)
  if (CHROME.test(selector.text)) add('chrome')
  if (FOOTER.test(selector.text)) add('footer')
  const users = subject.classes.map(name => doc.classes.get(name)).filter(Boolean).sort((a, b) => a.total - b.total)[0]
  if (users) for (const [role, count] of Object.entries(users)) if (role !== 'total') add(role, count)
  if (!roles.size) add('other')
  return roles
}

const usage = count => 1 + Math.min(1.5, Math.log2(Math.max(1, count)) / 3)
const pseudoWeight = pseudo => pseudo.some(p => /^(placeholder|disabled|-webkit|-moz)/.test(p)) ? 0.2 : pseudo.some(p => /^(hover|focus|active|visited|focus-visible|focus-within)$/.test(p)) ? 0.5 : pseudo.some(p => /^(before|after)$/.test(p)) ? 0.7 : 1
const colorKind = prop => prop === 'color' || prop === 'fill' || prop === '-webkit-text-fill-color' || prop === 'text-decoration-color' ? 'fg'
  : /^background(-color|-image)?$/.test(prop) || prop === 'accent-color' ? 'bg'
  : /^border(-(top|right|bottom|left|block|inline))?(-color)?$/.test(prop) || prop === 'outline' || prop === 'outline-color' || prop === 'stroke' ? 'border' : null
const customColorKind = name => /shadow|ring|outline|placeholder|scrollbar|caret|divide|selection|overlay|backdrop/i.test(name) ? null
  : /(^|-)(bg|background)(-|$)/i.test(name) ? 'bg' : /(^|-)border(-|$)/i.test(name) ? 'border'
  : /(color|fill|accent|primary|brand|button|btn|link|gradient-(from|to|via))/i.test(name) ? 'fg' : null

// ---------------------------------------------------------------- fonts

/** "__Inter_d65c78" → "Inter", "Montserrat-Bold" → "Montserrat", "proxima-nova" → "Proxima Nova". */
export function cleanFontName(raw) {
  let name = String(raw || '').trim().replace(/^['"]|['"]$/g, '').trim()
  const nextFont = name.match(/^__(.+?)_[0-9a-f]{5,8}$/i)
  if (nextFont) name = nextFont[1]
  const weights = /\s+(thin|hairline|extra ?light|ultra ?light|light|book|regular|normal|roman|medium|semi ?bold|demi ?bold|bold|extra ?bold|ultra ?bold|heavy|black|italic|oblique|variable|var|vf)$/i
  const strip = text => { for (let i = 0; i < 3; i++) text = text.replace(weights, ''); return text.trim() }
  name = strip(name.replace(/[_-]+/g, ' ').replace(/\s+fallback$/i, '').split(/\s+/).filter(word => !/\d{3,}|^[a-z]+\d+$|^\d+[a-z]*$/i.test(word)).join(' '))
  if (!/\s/.test(name)) name = strip(name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2'))
  return name.replace(/(^|\s)[a-z]/g, c => c.toUpperCase()).replace(/\s+/g, ' ').trim()
}

function fontFamilyOf(prop, value) {
  let stack = value
  if (prop === 'font') {
    const match = value.match(/^(?:.*\s)?(?:[\d.]+(?:px|r?em|%|pt|vw|vh|vmin|vmax|ch|ex)|calc\([^)]*\)|clamp\([^)]*\)|xx?-small|x{0,2}-large|small|medium|large|larger|smaller)(?:\s*\/\s*[^\s,]+)?\s+(.+)$/i)
    if (!match) return null
    stack = match[1]
  }
  const first = splitTop(stack, ',')[0]?.trim().replace(/^['"]|['"]$/g, '').trim()
  // Wix uploads ("wfont_8c5a1d_...") and hashed names carry no family to load.
  if (!first || !/^[a-z_]/i.test(first) || /var\(|^wf(ont)?[_-]/i.test(first) || GENERIC_FONTS.has(first.toLowerCase()) || /fallback$/i.test(first)) return null
  const name = cleanFontName(first)
  return name.length >= 2 && name.length <= 50 && !ICON_FONT.test(name) && !ICON_FONT.test(first) && !GENERIC_FONTS.has(name.toLowerCase()) ? name : null
}

function googleFamilies(href) {
  try {
    const url = new URL(href, 'https://fonts.googleapis.com')
    if (!/fonts\.(googleapis|bunny)\.(com|net)$/.test(url.hostname)) return []
    return url.searchParams.getAll('family').flatMap(value => value.split('|')).map(value => value.split(':')[0].replace(/\+/g, ' ').trim()).filter(Boolean)
  } catch { return [] }
}

// ---------------------------------------------------------------- logo colours

async function imageColors(bytes) {
  const { data } = await sharp(bytes, { density: 96, limitInputPixels: 40_000_000 }).resize(72, 72, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const buckets = new Map()
  let opaque = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue
    opaque++
    const key = (data[i] >> 4) << 8 | (data[i + 1] >> 4) << 4 | data[i + 2] >> 4
    const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 }
    bucket.r += data[i]; bucket.g += data[i + 1]; bucket.b += data[i + 2]; bucket.n++
    buckets.set(key, bucket)
  }
  const clusters = []
  for (const bucket of [...buckets.values()].sort((a, b) => b.n - a.n)) {
    const rgb = { r: bucket.r / bucket.n, g: bucket.g / bucket.n, b: bucket.b / bucket.n }, lab = rgbToOklab(rgb)
    const near = clusters.find(c => Math.hypot(c.lab.L - lab.L, c.lab.a - lab.a, c.lab.b - lab.b) < 0.08)
    if (near) near.n += bucket.n
    else clusters.push({ rgb, lab, n: bucket.n })
  }
  const shares = clusters.map(c => ({ hex: toHex(c.rgb), lab: c.lab, share: c.n / Math.max(1, opaque) })).filter(c => c.share >= 0.03)
  // A photograph (or a social banner) is not a logo; its colours say nothing about the brand.
  return shares.length > 8 ? [] : shares
}

function findLogo($, base) {
  const absolute = value => { try { return value ? new URL(value.trim().split(/\s+/)[0], base).href : null } catch { return null } }
  const source = img => absolute(img.attr('src')?.startsWith('data:image/gif') ? null : img.attr('src')) || absolute(img.attr('data-src')) || absolute(img.attr('data-lazy-src')) || absolute(img.attr('srcset')?.split(',')[0])
  const marked = ['img[src*="logo" i]', 'img[alt*="logo" i]', 'img[class*="logo" i]', '[class*="logo" i] img', '[id*="logo" i] img', '.navbar-brand img']
  for (const selectors of [marked.flatMap(s => [`header ${s}`, `nav ${s}`]), marked, ['header a[href="/"] img']]) {
    const img = $(selectors.join(', ')).first()
    if (img.length && source(img)) return source(img)
  }
  return absolute($('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').attr('href')) ||
    absolute($('link[rel~="icon"]').filter((_, el) => /\.(png|svg)(\?|$)/i.test($(el).attr('href') || '')).last().attr('href'))
}

async function logoColors(url, fetchResource) {
  if (!url) return []
  const data = url.match(/^data:image\/[\w+.-]+;base64,(.+)$/)
  const bytes = data ? Buffer.from(data[1], 'base64') : (await fetchResource(url, 'image')).bytes
  return imageColors(bytes)
}

// ---------------------------------------------------------------- stylesheets

async function fetchStylesheets($, base, fetchResource, deadline) {
  const links = []
  $('link[rel~="stylesheet"][href], link[rel="preload"][as="style"][href]').each((_, el) => {
    const media = $(el).attr('media') || ''
    if (/^print$/i.test(media.trim())) return
    try { links.push(new URL($(el).attr('href'), base).href) } catch { /* malformed href on the website */ }
  })
  const fonts = links.flatMap(googleFamilies)
  const queue = [...new Set(links)].filter(href => !SKIP_STYLESHEET.test(href))
  const host = new URL(base).hostname.replace(/^www\./, '')
  queue.sort((a, b) => Number(new URL(b).hostname.endsWith(host)) - Number(new URL(a).hostname.endsWith(host)))
  const sheets = []
  const fetchAll = async (urls, depth) => {
    const results = await Promise.allSettled(urls.map(async href => ({ href, css: (await fetchResource(href, 'css')).bytes.toString('utf8') })))
    const imports = []
    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      const sheet = parseCss(result.value.css)
      sheets.push(sheet)
      for (const href of sheet.imports) {
        try {
          const url = new URL(href, result.value.href).href
          fonts.push(...googleFamilies(url))
          if (depth === 0 && !SKIP_STYLESHEET.test(url)) imports.push(url)
        } catch { /* malformed @import */ }
      }
    }
    if (imports.length) await fetchAll([...new Set(imports)].slice(0, 4), depth + 1)
  }
  await Promise.race([fetchAll(queue.slice(0, 10), 0), new Promise(resolve => setTimeout(resolve, deadline))])
  return { sheets: [...sheets], fonts }
}

// ---------------------------------------------------------------- scoring

function addColor(scores, color, weight, fill) {
  if (!color || color.a < 0.5 || !(weight > 0)) return
  const hex = toHex(color), entry = scores.get(hex) || { hex, score: 0, fill: 0 }
  entry.score += weight
  if (fill) entry.fill += weight
  scores.set(hex, entry)
}

function addFont(scores, name, role, weight) {
  if (!name || !(weight > 0)) return
  const key = name.toLowerCase(), entry = scores.get(key) || { name, heading: 0, body: 0 }
  entry.heading += (FONT_WEIGHT[role]?.heading ?? 0.5) * weight
  entry.body += (FONT_WEIGHT[role]?.body ?? 0.7) * weight
  scores.set(key, entry)
}

/** Brand colours first (most used on buttons, headers, headings and in the logo); a dark neutral only for black-and-white brands. */
export function choosePalette(scores) {
  const clusters = []
  for (const entry of [...scores.values()].sort((a, b) => b.score - a.score)) {
    const lab = rgbToOklab(hexToRgb(entry.hex))
    const near = clusters.find(c => Math.hypot(c.lab.L - lab.L, c.lab.a - lab.a, c.lab.b - lab.b) < 0.07)
    if (near) { near.score += entry.score; near.fill += entry.fill }
    else clusters.push({ ...entry, lab })
  }
  // Pale tints (section backgrounds) and greys are not brand colours.
  const chroma = c => Math.hypot(c.lab.a, c.lab.b)
  const chromatic = clusters.filter(c => chroma(c) >= 0.04 && c.lab.L > 0.18 && c.lab.L < 0.93 && !(c.lab.L > 0.85 && chroma(c) < 0.08)).sort((a, b) => b.score - a.score)
  const top = chromatic[0]?.score || 0
  // A dark neutral painted on buttons and headers far more than any hue: a black-and-white brand, stray hues are noise.
  const dark = clusters.filter(c => !chromatic.includes(c) && c.lab.L < 0.45).sort((a, b) => b.fill - a.fill)[0]
  const darkLeads = dark && dark.fill >= 6 && dark.fill > top * 2
  const picked = chromatic.filter(c => c.score >= Math.max(2, top * 0.12, darkLeads ? dark.fill * 0.25 : 0)).slice(0, darkLeads ? 3 : 4)
  if (darkLeads) picked.unshift(dark)
  else if (dark && picked.length < 2 && dark.fill >= Math.max(4, top * 0.3)) picked.push(dark)
  return { colors: picked.slice(0, 4).map(c => c.hex), ranked: clusters.sort((a, b) => b.score - a.score).slice(0, 8).map(c => ({ hex: c.hex, score: Math.round(c.score * 10) / 10, fill: Math.round(c.fill * 10) / 10 })) }
}

export function chooseFonts(scores, webFonts) {
  const candidates = [...scores.values()].map(font => {
    const boost = webFonts.has(font.name.toLowerCase()) ? 1.6 : SYSTEM_FONTS.has(font.name.toLowerCase()) ? 0.35 : 1
    return { ...font, heading: font.heading * boost, body: font.body * boost }
  })
  const body = [...candidates].sort((a, b) => b.body - a.body)[0]
  const heading = [...candidates].sort((a, b) => b.heading - a.heading)[0]
  const fonts = [heading && heading.heading >= 2 ? heading.name : null, body?.name].filter(Boolean)
  if (!fonts.length) fonts.push(...[...webFonts.values()].filter(name => !ICON_FONT.test(name)).slice(0, 2))
  return { fonts: [...new Set(fonts)], ranked: candidates.sort((a, b) => b.heading + b.body - a.heading - a.body).slice(0, 6).map(f => ({ name: f.name, heading: Math.round(f.heading), body: Math.round(f.body) })) }
}

/**
 * Brand colours (hex, primary first) and fonts (heading, then body) of a website.
 * `html` is the already-fetched homepage and `url` its final address.
 */
export async function extractDesignSystem(html, url, { fetchResource = fetchWebsiteResource, deadline = 9000 } = {}) {
  const $ = load(html)
  const base = (() => { try { return new URL($('base[href]').attr('href') || url, url).href } catch { return url } })()
  const doc = indexDocument($)
  const shell = doc.elements < 40
  const logoUrl = findLogo($, base)
  const [{ sheets, fonts: googleFonts }, logo] = await Promise.all([
    fetchStylesheets($, base, fetchResource, deadline),
    logoColors(logoUrl, fetchResource).catch(() => []),
  ])
  $('style').each((_, el) => { sheets.push(parseCss($(el).text())) })
  for (const sheet of sheets) for (const href of sheet.imports) googleFonts.push(...googleFamilies(href))
  const rules = sheets.flatMap(sheet => sheet.rules).map(rule => ({ ...rule, selectors: splitTop(rule.selector, ',').map(parseSelector) }))
  rules.push(...doc.inline.map(({ role, style }) => ({ inlineRole: role, decls: declarations(style), context: '', selectors: [] })))

  const webFonts = new Map()
  for (const name of googleFonts) webFonts.set(name.toLowerCase(), name)
  for (const face of sheets.flatMap(sheet => sheet.fontFaces)) {
    const name = face['font-family'] && cleanFontName(face['font-family'])
    if (name && !ICON_FONT.test(name) && !ICON_FONT.test(face['font-family'])) webFonts.set(name.toLowerCase(), name)
  }

  // Custom properties: page-wide ones (declared on :root, html, body or a class they carry) and any declaration as a last resort.
  const rootRule = rule => rule.selectors.length && rule.selectors.every(s => s.root || s.compounds.every(c => (!c.tag || /^(html|body|\*)$/.test(c.tag)) && !c.ids.length && c.classes.every(name => doc.rootClasses.has(name))))
  const globalVars = new Map(), anyVars = new Map()
  for (const rule of rules) {
    const dark = rule.context === 'dark' || (rule.selectors.some(s => s.dark) && !doc.dark)
    for (const [prop, value] of rule.decls) {
      if (!prop.startsWith('--')) continue
      if (!dark || !anyVars.has(prop)) anyVars.set(prop, value)
      if (!dark && rule.selectors.length && rootRule(rule)) globalVars.set(prop, value)
    }
  }

  const colors = new Map(), fonts = new Map()
  for (const rule of rules) {
    const live = rule.inlineRole ? [null] : rule.selectors.filter(s => shell || s.compounds.every(c => present(c, doc)))
    if (!live.length) continue
    const root = !rule.inlineRole && rootRule(rule)
    const context = (rule.context === 'dark' || (live[0]?.dark && !doc.dark) ? 0.25 : 1) * (shell ? 0.6 : 1) * (rule.inlineRole ? 1.3 : 1)
    const roles = live.map(s => ({ pseudo: s ? pseudoWeight(s.pseudo) : 1, fontsAllowed: !s?.pseudo.some(p => p === 'before' || p === 'after'), roles: s ? selectorRoles(s, doc) : new Map([[rule.inlineRole, 1]]) }))
    const scopes = [new Map(rule.decls.filter(([prop]) => prop.startsWith('--'))), globalVars, anyVars]
    for (const [prop, value] of rule.decls) {
      if (prop === 'font-family' || prop === 'font') {
        const name = fontFamilyOf(prop, resolveVars(value, scopes))
        for (const entry of roles) if (entry.fontsAllowed) for (const [role, count] of entry.roles) addFont(fonts, name, role, context * usage(count))
        continue
      }
      const custom = prop.startsWith('--')
      if (custom && root) continue
      const kind = custom ? customColorKind(prop) : colorKind(prop)
      if (!kind) continue
      const resolved = resolveVars(value, scopes)
      const found = custom ? [parseBareColor(resolved) || colorsIn(resolved)].flat().filter(Boolean) : colorsIn(resolved)
      if (!found.length) continue
      let weight = 0, fill = false
      for (const entry of roles) for (const [role, count] of entry.roles) {
        const w = ROLE_WEIGHT[role][kind] * usage(count) * entry.pseudo
        if (w > weight) { weight = w; fill = kind !== 'fg' && (role === 'button' || role === 'chrome') }
      }
      for (const color of found) addColor(colors, color, weight * context * (custom ? 0.6 : 1) / found.length, fill)
    }
  }

  // Names that say what a variable is for: --primary, --brand-color, --e-global-color-accent, --font-heading...
  const counted = new Set()
  for (const [name, value] of globalVars) {
    if (LIBRARY_VAR.test(name)) continue
    const resolved = resolveVars(value, [globalVars, anyVars])
    if (/font/i.test(name) && !/size|weight|style|feature|smooth|spacing|height|tracking|leading|line|letter|colou?r|display$/i.test(name)) {
      const family = fontFamilyOf(/^\s*(normal|italic|bold|\d00|[\d.]+(px|r?em))/i.test(resolved) ? 'font' : 'font-family', resolved)
      const role = /heading|display|title|headline|e-global-typography-(primary|secondary)/i.test(name) ? 'heading' : /body|text|base|paragraph|copy|content/i.test(name) ? 'base' : 'other'
      addFont(fonts, family, role, role === 'other' ? 2 : 1)
      continue
    }
    const brand = name.match(/(^|[-_])(primary|brand|main|theme|key|accent|cta|highlight|secondary)([-_]|$)/i)
    if (!brand || /text|foreground|fg|(^|-)on-|contrast|shadow|border|radius|size|width|height|spacing|ring|focus|hover|active|disabled|muted|light|dark|opacity|alpha|font|transition|(?<!(5|6))\d{2}$/i.test(name)) continue
    const key = name.replace(/-(rgb|hsl)$/i, '')
    if (counted.has(key)) continue
    counted.add(key)
    const color = parseBareColor(resolved) || colorsIn(resolved)[0]
    if (!color) continue
    const weight = /primary|brand|main|theme|key/i.test(brand[2]) ? 12 : /accent|cta|highlight/i.test(brand[2]) ? 9 : 7
    addColor(colors, color, weight * (FRAMEWORK_DEFAULTS.has(toHex(color)) ? 0.2 : 1), true)
  }

  for (const [selector, weight] of [['meta[name="theme-color"]:not([media*="dark"])', 14], ['meta[name="msapplication-TileColor" i]', 10]]) {
    addColor(colors, parseColor($(selector).first().attr('content')), weight, true)
  }
  addColor(colors, parseColor($('link[rel="mask-icon"]').attr('color')), 10, true)
  for (const svg of doc.svgs) for (const value of svg.colors) addColor(colors, parseColor(value), svg.logo ? 6 : 1, svg.logo)
  const logoChromatic = logo.filter(c => Math.hypot(c.lab.a, c.lab.b) >= 0.04 && c.lab.L < 0.95)
  const logoShare = logoChromatic.reduce((sum, c) => sum + c.share, 0)
  for (const c of logoChromatic) addColor(colors, parseColor(c.hex), 26 * c.share / logoShare, true)
  for (const c of logo.filter(c => !logoChromatic.includes(c) && c.lab.L < 0.45)) addColor(colors, parseColor(c.hex), 10 * c.share, true)

  const palette = choosePalette(colors)
  const typography = chooseFonts(fonts, webFonts)
  return {
    colors: palette.colors,
    fonts: typography.fonts,
    evidence: { stylesheets: sheets.length, logo: logoUrl, shell, colors: palette.ranked, fonts: typography.ranked },
  }
}
