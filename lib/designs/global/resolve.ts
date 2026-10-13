import type { GlobalDesignFamily, DesignVariant, TemplateNode } from './types'

export const hex = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  if (/^#[a-f\d]{6}$/i.test(value)) return value
  if (/^#[a-f\d]{3}$/i.test(value)) return '#' + value.slice(1).split('').map(c => c + c).join('')
}
export function lightness(color: string) {
  const c = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722
}
export const on = (color: string) => lightness(color) > .179 ? '#101010' : '#ffffff'
const font = (value: any, fallback: string) => (typeof value === 'string' ? value : value?.family || value?.name || fallback).replace(/-?(Regular|SemiBold|Bold|Italic)$/i, '')

export function resolveBrandTokens(brand: any = {}, family?: GlobalDesignFamily): Record<string, string> {
  const colors = (Array.isArray(brand.colors) ? brand.colors : []).map(hex).filter(Boolean) as string[]
  const roles = brand.designTokens || {}
  const primary = hex(roles.primary) || colors[0] || '#3154d5'
  const secondary = hex(roles.secondary) || colors[1] || primary
  const accent = hex(roles.accent) || colors[2] || colors[1] || primary
  const background = hex(roles.background) || colors.find(c => lightness(c) > .8) || '#ffffff'
  const text = hex(roles.textPrimary) || colors.find(c => lightness(c) < .08) || on(background)
  return {
    'brand.primary': primary, 'brand.secondary': secondary, 'brand.accent': accent,
    'brand.background': background, 'brand.textPrimary': text,
    'brand.textSecondary': hex(roles.textSecondary) || text,
    'brand.onPrimary': lightness(primary) <= .3 ? '#ffffff' : '#101010', 'brand.onAccent': on(accent), 'brand.onImage': '#ffffff', 'brand.overlay': '#000000', transparent: '#00000000',
    // Fonts always come from the brand. Reference fonts are preview metadata and never a generation fallback.
    'brand.headingFont': font(brand.headingFont || brand.fonts?.[0], 'Inter'),
    'brand.bodyFont': font(brand.bodyFont || brand.fonts?.[1] || brand.fonts?.[0], 'Inter'),
  }
}

/** Unbranded previews may show the reference look; brand posts never receive it. */
export const referencePreviewBrand = (family: GlobalDesignFamily) => ({ ...(family.referenceStyle ? { designTokens: family.referenceStyle } : {}), headingFont: family.typography.headingFallback, bodyFont: family.typography.bodyFallback })

// Width of a font against the generic estimate below. Condensed display faces set their capitals far narrower than
// their lowercase, so capitals get their own factor. Measured in Chrome; like the generic estimate for regular fonts,
// each still errs about 10% wide, so copy never runs past its box.
const FONT_WIDTH: Record<string, { lower: number; caps: number }> = {
  Anton: { lower: .82, caps: .72 },
  'Bebas Neue': { lower: .68, caps: .6 },
  Oswald: { lower: .82, caps: .82 },
}
const fontFactor = (font: string) => FONT_WIDTH[font] || (['Playfair Display', 'Dancing Script', 'Pacifico', 'Lobster'].includes(font) ? { lower: 1.12, caps: 1.12 } : { lower: 1, caps: 1 })

/** Estimated wrapped line count. Shared by template fitting and the study composer. */
export function countLines(text: string, size: number, width: number, font: string, letterSpacing = 0): number {
  const factor = fontFactor(font)
  let lines = 0
  for (const paragraph of text.split('\n')) {
    let used = 0
    lines++
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      // Accented capitals (\u00ca, \u00c1, \u00c7) are as wide as their plain letters. Tracking applies as rendered, tight included
      // (it narrows the estimate and the real text alike), within a floor.
      const length = [...word].reduce((sum, c) => {
        const caps = /[0-9\p{Lu}]/u.test(c)
        const em = /[ilI.,'!:;]/.test(c) ? .32 : /[MW@#%]|[^\u0000-\u024f]/.test(c) ? 1 : caps ? .74 : .65
        return sum + size * em * (caps ? factor.caps : factor.lower) + Math.max(-size * .08, letterSpacing)
      }, 0)
      const gap = used ? size * .34 * factor.lower : 0
      if (used && used + gap + length > width) { lines++; used = 0 }
      if (length > width) { lines += Math.ceil(length / width) - 1; used = length % width || width }
      else used += (used ? gap : 0) + length
    }
  }
  return lines
}

function fitSize(text: string, node: TemplateNode, resolvedFont: string): number {
  const preferred = node.fontSize || 40
  const designedMinimum = Math.min(preferred, node.minFontSize || 22)
  // Imported templates use minFontSize as their ideal visual floor. Real post
  // copy can be longer than reference copy, so keep shrinking within a readable
  // range before rejecting it. Geometry and the complete text stay unchanged.
  const minimum = Math.min(designedMinimum, Math.max(14, Math.floor(preferred * .34)))
  const width = node.width - (node.highlight === 'background' ? 28 : 8)
  for (let size = preferred; size >= minimum; size--) {
    if (countLines(text, size, width, resolvedFont, node.letterSpacing || 0) * size * (node.lineHeight || 1.15) + 8 <= node.height) return size
  }
  throw Object.assign(new Error(`The ${node.id} text is too long for this design. Shorten it or split it into another slide.`), { status: 422 })
}

// Content is text data, never executable inline-style markup supplied by a model.
// Unicode hyphens (models write "Contacte‑nos" with U+2011) are missing from many brand fonts and render as boxes.
export const clean = (value: any) => String(value ?? '').replace(/<%|%>|\{\{|\}\}/g, '').replace(/[‐‑]/g, '-').slice(0, 8000)
export function contentSlots(brand: any, slide: any, index = 0, image = ''): Record<string, string> {
  let website = clean(brand.website || '')
  try { if (website) website = new URL(website).hostname } catch {}
  const steps = Array.isArray(slide.steps) ? slide.steps : Array.isArray(slide.items) ? slide.items : []
  return {
    headline: clean(slide.headline || slide.title), body: clean(slide.body || slide.supportingText || (Array.isArray(slide.items) ? slide.items.join('\n') : '')),
    cta: clean(slide.cta), eyebrow: clean(slide.eyebrow || slide.subheadline), number: String(index + 1).padStart(2, '0'),
    author: clean(slide.author || brand.author || brand.name), 'brand.name': clean(brand.name), 'brand.website': website,
    'brand.logo': typeof brand.logo === 'string' ? brand.logo : '', 'image.primary': image,
    ...Object.fromEntries([1, 2, 3, 4].map(i => [`step.${i}`, clean(steps[i - 1])])),
  }
}

/** Compile a reference reconstruction into editable Canvas nodes. Used for review previews only. */
export function resolveVariant(family: GlobalDesignFamily, variant: DesignVariant, brand: any = {}, slide: any = {}, index = 0, image = '', options: { preview?: boolean; placeholders?: boolean } = {}) {
  const tokens = resolveBrandTokens(brand, family), slots = contentSlots(brand, slide, index, image)
  const surface = tokens[variant.background]
  const contrast = (a: string, b: string) => (Math.max(lightness(a), lightness(b)) + .05) / (Math.min(lightness(a), lightness(b)) + .05)
  // The same brand may use a dark primary surface and a light editorial surface.
  if (contrast(tokens['brand.textPrimary'], surface) < 4.5) tokens['brand.textPrimary'] = on(surface)
  if (contrast(tokens['brand.textSecondary'], surface) < 4.5) tokens['brand.textSecondary'] = tokens['brand.textPrimary']
  const classes: Record<string, any> = {
    'family-highlight': { background: tokens['brand.accent'], color: tokens['brand.onAccent'], paddingX: 8, paddingY: 0 },
    'family-emphasis': { color: variant.background === 'brand.primary' ? (tokens['brand.onPrimary'] === tokens['brand.textPrimary'] && contrast(tokens['brand.accent'], surface) >= 3 ? tokens['brand.accent'] : tokens['brand.onPrimary']) : tokens['brand.accent'], fontWeight: 700 },
  }
  const nodes = variant.nodes.flatMap(template => {
    const n: any = { ...template }
    for (const key of ['color', 'fill', 'stroke', 'fontFamily']) if (n[key]) n[key] = tokens[n[key]] || n[key]
    if (n.fillAlpha !== undefined && n.fill === surface) n.fill = tokens['brand.textPrimary']
    if (n.stops) n.stops = n.stops.map((stop: any) => ({ ...stop, color: tokens[stop.color] }))
    if (n.fillAlpha !== undefined && /^#[a-f\d]{6}$/i.test(n.fill)) n.fill += Math.round(n.fillAlpha * 2.55).toString(16).padStart(2, '0')
    if (n.type === 'image') {
      n.src = slots[template.src!.slice(2, -2)]
      if (!n.src) {
        if (options.placeholders) { n.src = ''; return [{ ...n, templateBinding: { src: template.src } }] }
        if (template.optional) return []
        if (!options.preview) throw new Error('This design needs a photograph. Resolve the image before generating the canvas.')
        return [{ id: n.id, type: 'shape', shape: 'rect', x: n.x, y: n.y, width: n.width, height: n.height, fill: tokens['brand.secondary'] }]
      }
    }
    if (n.type === 'text') {
      if (!options.placeholders && template.id === 'brand-name' && slots['brand.logo'] && variant.nodes.some(v => v.src === '{{brand.logo}}')) return []
      n.text = template.text!.replace(/\{\{([^}]+)\}\}/g, (_match, key) => slots[key] || '').trim()
      if (!n.text && !options.placeholders) return []
      if (template.textTransform === 'uppercase') n.text = n.text.toUpperCase()
      if (template.textTransform === 'lowercase') n.text = n.text.toLowerCase()
      try { n.fontSize = fitSize(n.text, template, n.fontFamily) }
      catch (error) { if (!options.preview) throw error; n.fontSize = template.minFontSize || 22 }
      if (template.highlight && template.highlight !== 'none') {
        const words = n.text.split(/\s+/)
        const requested = Array.isArray(slide.emphasis) ? slide.emphasis.map((w: any) => clean(w).toLowerCase()) : []
        const selected = requested.length ? words.filter((w: string) => requested.includes(w.toLowerCase())).slice(0, template.highlightCount || 1)
          : template.highlightCount === 2 ? [words[Math.min(1, words.length - 1)], words[words.length - 1]] : [words[Math.min(words.length - 1, Math.floor(words.length * .55))]]
        n.text = n.text.split(/(\s+)/).map((word: string) => selected.includes(word) ? `<%kind:${template.highlight === 'background' ? 'family-highlight' : 'family-emphasis'}:${word}%>` : word).join('')
      }
      if (options.placeholders) { n.text = template.text; n.fontSize = template.fontSize }
    }
    // Keep role bindings on editable nodes for the admin Canvas round trip.
    n.templateBinding = { text: template.text, src: template.src, color: template.color, fill: template.fill, stroke: template.stroke, fontFamily: template.fontFamily, stops: template.stops, minFontSize: template.minFontSize, highlight: template.highlight, highlightCount: template.highlightCount, optional: template.optional, fillAlpha: template.fillAlpha }
    delete n.highlight; delete n.highlightCount; delete n.minFontSize; delete n.optional; delete n.fillAlpha
    return [n]
  })
  return { width: family.width, height: family.height, background: tokens[variant.background], nodes, groups: [], classes }
}

export const SAMPLE_COPY = { headline: 'Make your next move matter', body: 'A thoughtful approach turns a clear idea into meaningful progress. Start with one practical step and build from there.', cta: 'Link in bio', eyebrow: 'Start here', author: 'Your name', steps: ['Decide', 'Start', 'Keep going', 'Finish'] }
