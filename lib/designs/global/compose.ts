/**
 * Composition planner: study grammar + brand + content → editable Canvas nodes.
 * The study supplies relationships (scale, alignment, density, decoration, imagery behaviour);
 * this module decides concrete coordinates from the actual content. No model calls, no templates.
 */
import { resolveBrandTokens, countLines, clean, lightness, on, hex } from './resolve'
import { familyGrammar, familyImagery, familyCutouts, familyPhotoLed } from './study'
import type { GlobalDesignFamily, DesignGrammar, Composition } from './types'

type Align = 'left' | 'center' | 'right'
type Anchor = 'top' | 'center' | 'bottom'
type ImagePos = 'full' | 'top' | 'bottom' | 'left' | 'right' | 'center'
type Box = { x: number; y: number; width: number; height: number }
/** `cutout`: the slide's image is a transparent PNG subject standing on the design surface, not a photograph. */
/** `fill`: a cutout placed in the empty band the copy leaves on a text slide. `frame: false`: no headline box here. */
export interface SlidePlan { composition: Composition; withImage: boolean; align: Align; anchor: Anchor; imagePos: ImagePos; surface: 'dark' | 'light' | 'brand'; beat?: number; callout?: boolean; badge?: boolean; cutout?: boolean; fill?: boolean; frame?: boolean; variant?: TextVariant; listStyle?: ListVariant; photo?: PhotoVariant; number?: string; closing?: boolean }

/**
 * Layout variants inside a composition, so posts in one design do not repeat the same structure. They use only the
 * study's palette, fonts and cues. Text: a quote mark, an accent rule, a side bar, the body in a panel
 * or in a colour band. Lists: rows, large numerals, a connected timeline or a two-column grid. Photos: full bleed,
 * an inset rounded card or a circle.
 */
export type TextVariant = 'classic' | 'rule' | 'quote' | 'panel' | 'sidebar' | 'band'
export type ListVariant = 'rows' | 'numerals' | 'timeline' | 'grid'
export type PhotoVariant = 'bleed' | 'card' | 'circle'

/** How a post uses imagery: as the design decides, on as many slides as the design can hold, or none at all. */
export type ImageChoice = 'auto' | 'on' | 'off'
export const imageChoiceOf = (copy: any): ImageChoice => copy?.imageChoice === 'on' || copy?.imageChoice === 'off' ? copy.imageChoice : 'auto'

/** Fonts published in a single (regular) weight. */
const SINGLE_WEIGHT = new Set(['anton', 'bebas neue', 'impact', 'archivo black', 'alfa slab one', 'abril fatface', 'lobster', 'pacifico', 'dela gothic one', 'bungee', 'righteous', 'russo one', 'black ops one', 'titan one', 'luckiest guy', 'staatliches', 'ultra'])
/** Share of image slots that may use stock photography; the rest are AI-generated transparent cutouts. */
export const STOCK_SHARE = .2
const IMAGE_CAPABLE: Composition[] = ['image-led', 'split', 'stacked']
const TEXT_ONLY: Composition[] = ['statement', 'stacked', 'backdrop-type', 'list', 'closing']
const IMAGE_ONLY: Composition[] = ['image-led', 'split']
const hash = (text: string) => [...text].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 7)
const slidesOf = (copy: any) => Array.isArray(copy?.slides) && copy.slides.length ? copy.slides : [copy || {}]

const MARKED = /^(?:[-•–]|\d+[.)])\s+/
const LAST_AND = /\s+(?:e|and|y|et|ou|or|&)\s+/i
/**
 * Items of a list slide and the short lead that introduces them: explicit arrays, numbered or bulleted body lines,
 * or an inline enumeration written as a sentence ("Each phase: Discovery, Strategy, Delivery and Growth").
 */
export function listParts(slide: any): { items: string[]; lead: string } {
  const body = String(slide?.body || slide?.supportingText || '')
  const explicit = Array.isArray(slide?.items) ? slide.items : Array.isArray(slide?.steps) ? slide.steps : null
  if (explicit) return { items: explicit.map((s: any) => clean(s).trim()).filter(Boolean).slice(0, 6), lead: clean(body).trim() }
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean)
  const marked = lines.filter(l => MARKED.test(l))
  if (marked.length >= 2) return { items: marked.map(l => clean(l.replace(MARKED, ''))).slice(0, 6), lead: clean(lines.filter(l => !MARKED.test(l)).join(' ')).trim() }
  // 3–6 short items after a colon, separated by commas or semicolons and a final "and".
  const inline = clean(body).replace(/\s+/g, ' ').trim().match(/^([^:]{0,140}):\s*(.+?)\.?$/)
  if (inline) {
    const chunks = inline[2].split(/\s*[;,]\s*/)
    const parts = [...chunks.slice(0, -1), ...chunks[chunks.length - 1].split(LAST_AND)].map(p => p.trim().replace(/\.$/, '')).filter(Boolean)
    if (parts.length >= 3 && parts.length <= 6 && parts.every(p => p.split(' ').length <= 5 && p.length <= 42)) return { items: parts, lead: inline[1].trim() }
  }
  return { items: [], lead: '' }
}
export const listItems = (slide: any): string[] => listParts(slide).items

/**
 * Chooses a composition per slide inside the grammar. A model-proposed composition is honoured when the
 * grammar allows it; otherwise selection is deterministic for the same copy. Consecutive slides avoid
 * repeating the same composition so a carousel varies while keeping one visual language.
 */
export function planSlides(family: GlobalDesignFamily, copy: any): SlidePlan[] {
  const g = familyGrammar(family), imagery = familyImagery(family), slides = slidesOf(copy)
  const hasImagery = imagery.mode !== 'none', cutouts = familyCutouts(family), photoLed = familyPhotoLed(family)
  const choice = imageChoiceOf(copy)
  // One seed per post: different posts start their variant rotation, and their cover, at different points.
  const postSeed = hash(slides.map((s: any) => String(s?.headline || '')).join('|'))
  // Counted carousels number every content slide (01, 02, 03…), never just one: a lone number reads as random.
  // Only carousels with at least two content slides, and only when the study does not number slides in a corner.
  const counted = slides.length >= 4 && g.branding.slideNumber === 'none' && postSeed % 3 === 0
  const plans: SlidePlan[] = []
  const observedUses = new Map<any, number>()
  slides.forEach((slide: any, index: number) => {
    const total = slides.length, last = total > 1 && index === total - 1
    const seed = hash(String(slide?.headline || '') + index)
    const proposed = g.compositions.includes(slide?.design?.composition) ? slide.design.composition as Composition : undefined
    const listy = listItems(slide).length >= 2
    // "With images" asks for imagery wherever a slide can hold it; lists keep their items readable.
    const frequencyWants = choice === 'on' ? !listy : { every: true, most: index === 0 || (!last && !listy), some: index % 2 === 0 && !last, rare: index === 0, never: false }[g.imagery.frequency]
    // A photo the user attached always shows on its slide, as a photograph, even when images are switched off.
    const upload = hasImagery && !!slide?.design?.image?.upload
    let wantImage = upload || (choice !== 'off' && hasImagery && (choice === 'on' ? frequencyWants : proposed ? proposed === 'image-led' || proposed === 'split' || (proposed === 'stacked' && (slide?.design?.image ? true : frequencyWants)) : slide?.design?.image === null ? g.imagery.frequency === 'every' : frequencyWants))
    const pool = (image: boolean) => g.compositions.filter(c => image ? IMAGE_CAPABLE.includes(c) : TEXT_ONLY.includes(c))
    if (wantImage && !pool(true).length) wantImage = false
    // The references' own arrangements come first: list slides follow the list reference, the closing beat the last
    // reference, and other slides rotate through the rest. Sizes still come from the copy. The cover follows
    // reference 1 in two posts out of three; the others open with another arrangement, so covers are not all alike.
    const refs = g.references
    const followCover = postSeed % 3 !== 2
    const observed = !refs.length ? undefined : index === 0 ? (followCover ? refs[0] : undefined)
      : listy && refs.some(r => r.composition === 'list') ? refs.find(r => r.composition === 'list')
      : last && refs.length > 1 ? refs[refs.length - 1]
      : (() => { const rest = refs.filter((r, i) => i > 0 && r.composition !== 'list'); return rest.length ? rest[(index - 1) % rest.length] : refs[index % refs.length] })()
    const observedFits = !!observed && g.compositions.includes(observed.composition) && (observed.composition !== 'list' || listy) && (!IMAGE_ONLY.includes(observed.composition) || (hasImagery && observed.image && (choice !== 'off' || upload)))
    let composition: Composition
    // Three or more items read better as a designed list (markers, cards) than as a sentence, whatever was proposed.
    if (listItems(slide).length >= 3 && !upload) { composition = 'list'; wantImage = false }
    else if (proposed && (wantImage ? IMAGE_CAPABLE : TEXT_ONLY).includes(proposed)) composition = proposed
    else if (!proposed && observedFits) {
      composition = observed!.composition
      wantImage = hasImagery && IMAGE_CAPABLE.includes(composition) && (upload || (choice !== 'off' && (observed!.image || choice === 'on')))
    } else {
      const options = pool(wantImage)
      const prefer = (...wanted: Composition[]) => wanted.find(c => options.includes(c))
      const previous = plans[index - 1]?.composition
      const used = (c: Composition) => plans.filter(p => p.composition === c).length
      const eligible = options.filter(c => c !== previous && (c !== 'list' || listy) && (c !== 'closing' || last))
      const fewest = Math.min(...eligible.map(used))
      const rotating = eligible.filter(c => used(c) === fewest)
      composition = (index === 0 ? prefer(wantImage ? 'image-led' : 'backdrop-type', wantImage ? 'split' : 'statement', 'stacked') : undefined)
        || (listy && !wantImage ? prefer('list') : undefined)
        || (last && !wantImage ? prefer('closing') : undefined)
        || rotating[seed % Math.max(1, rotating.length)] || options[0] || 'statement'
    }
    // The last slide always reads as the end: it takes the study's closing arrangement, unless it follows the study's own
    // closing reference, shows a photo the person attached, is a list, or images were asked for on every slide.
    const followsClosingRef = last && refs.length > 1 && observed === refs[refs.length - 1] && composition === observed?.composition
    if (last && composition !== 'closing' && g.compositions.includes('closing') && !followsClosingRef && !upload && composition !== 'list'
      && !(wantImage && (choice === 'on' || g.imagery.frequency === 'every'))) { composition = 'closing'; wantImage = false }
    // "With images" on a typography-only study: copy keeps to the top of a plain statement, so the space below it can
    // take a cutout (a spread or backdrop layout never leaves that room). List slides keep their own layout.
    const roomForCutout = choice === 'on' && !hasImagery && composition !== 'list'
    if (roomForCutout && (composition === 'stacked' || composition === 'backdrop-type')) composition = 'statement'
    const positions = g.imagery.positions as ImagePos[]
    const sides = composition === 'split' ? positions.filter(p => p === 'left' || p === 'right') : composition === 'stacked' ? positions.filter(p => p === 'top' || p === 'bottom') : positions
    const imagePos: ImagePos = composition === 'image-led' ? (positions.includes('full') ? 'full' : positions[0])
      : sides.length ? sides[(index + seed) % sides.length] : composition === 'split' ? (index % 2 ? 'left' : 'right') : (index % 2 ? 'top' : 'bottom')
    const alignments = composition === 'split' || composition === 'list' ? g.alignment.filter(a => a !== 'center') : g.alignment
    const align = (index === 0 ? alignments[0] : alignments[(index + seed) % Math.max(1, alignments.length)]) || 'left'
    const anchors = g.anchors as Anchor[]
    let anchor = index === 0 ? anchors[postSeed % anchors.length] : anchors[(index + seed) % anchors.length]
    // A reference arrangement used for this composition sets alignment, anchor and image side; a repeat use varies the anchor.
    const follows = observed && observed.composition === composition ? observed : undefined
    const uses = follows ? observedUses.get(follows) || 0 : 0
    if (follows) observedUses.set(follows, uses + 1)
    const followedAlign = follows && (composition !== 'split' && composition !== 'list' || follows.align !== 'center') ? follows.align : undefined
    if (follows) anchor = uses ? anchors[(anchors.indexOf(follows.anchor as Anchor) + uses) % anchors.length] || follows.anchor : follows.anchor
    if (roomForCutout) anchor = 'top'
    const followedPos = follows?.image && (composition === 'stacked' ? ['top', 'bottom'] : composition === 'split' ? ['left', 'right'] : ['full', 'top', 'bottom']).includes(follows.imagePos) ? follows.imagePos as ImagePos : undefined
    const callout = follows ? follows.callout : g.containers.style !== 'none' && g.containers.use.includes('callout') && index % 2 === 1 && !last
    const badge = follows ? follows.badge : g.badge === 'logo' && index === 0
    // When the references say which of them box the headline, only slides following those get the box (the cover
    // follows the first reference). Studies without that measurement box every headline when the grammar has a box.
    const measuredFrames = refs.some(r => typeof r.frame === 'boolean')
    const frame = !measuredFrames ? undefined : follows ? !!follows.frame : index === 0 && refs[0]?.frame === true
    // Surfaces: the dominant role carries the family; a second role marks the closing beat when the study allows one.
    const surface = (last && g.surfaces.length > 1 ? g.surfaces[1] : g.surfaces[0]) as SlidePlan['surface']
    // AI cutouts are the preferred imagery. Unless the study is cutout-only, about one image in five stays a stock
    // photograph, chosen per slide so the same copy always gets the same decision.
    // Studies built on a full-canvas photograph keep photographs: a cutout cannot recreate that look.
    // A user's photo is never cut out: its scene is the point (a finished project, the team at work).
    const stockPhoto = upload || photoLed || (cutouts !== 'always' && hash(`stock:${slide?.headline || ''}:${index}`) % 100 < STOCK_SHARE * 100)
    const cutout = wantImage && !stockPhoto
    const finalAlign = followedAlign || align, finalPos = followedPos || imagePos

    // Variants: the least used eligible one, never the previous slide's, starting from the post's own seed.
    const pick = <T extends string>(options: T[], key: 'variant' | 'listStyle' | 'photo'): T => {
      const previous = plans[index - 1]?.[key]
      const fresh = options.length > 1 ? options.filter(v => v !== previous) : options
      const used = (v: T) => plans.filter(p => p[key] === v).length
      const fewest = Math.min(...fresh.map(used))
      const least = fresh.filter(v => used(v) === fewest)
      return least[(postSeed + index) % least.length]
    }
    const variants: Partial<SlidePlan> = {}
    if (composition === 'list') {
      const items = listItems(slide)
      const lists: ListVariant[] = ['rows', 'numerals', 'timeline']
      if ([2, 4, 6].includes(items.length) && items.every(item => item.length <= 48)) lists.push('grid')
      variants.listStyle = pick(lists, 'listStyle')
    } else {
      const words = String(slide?.headline || '').trim().split(/\s+/).filter(Boolean).length
      const body = !!String(slide?.body || slide?.supportingText || '').trim()
      const bottomBranding = [g.branding.logo, g.branding.slideNumber, g.branding.handle].some(pos => String(pos).startsWith('bottom'))
      const ruled = g.decorations.some(d => d.kind === 'line')
      // Copy over a full-bleed photograph can take a quote mark or an accent band along the bottom; other image
      // slides are already busy, so they keep to the light treatments.
      const overPhoto = wantImage && !cutout && composition === 'image-led' && finalPos === 'full'
      const lowerCopy = (body || String(slide?.cta || '').trim()) && !bottomBranding
      const text: TextVariant[] = ['classic']
      if (!ruled) text.push('rule')
      if (!wantImage || overPhoto) {
        // The slide number already sits above the headline of a counted slide; a quote mark would compete with it.
        if (words && words <= 9 && !last && !(counted && index > 0)) text.push('quote')
        if (lowerCopy) text.push('band')
      }
      if (!wantImage) {
        if (finalAlign === 'left') text.push('sidebar')
        if (body && !callout) text.push('panel')
      }
      variants.variant = pick(text, 'variant')
      // Photographs (not transparent cutouts) can be full bleed, an inset rounded card or a circle. A study built on a
      // full-canvas photograph behind the copy keeps it: that photograph is its look.
      if (wantImage && !cutout && !photoLed && IMAGE_CAPABLE.includes(composition)) {
        const photos: PhotoVariant[] = ['bleed', 'card']
        if (composition === 'image-led') photos.push('circle')
        variants.photo = pick(photos, 'photo')
      }
    }
    if (counted && index > 0 && !last) variants.number = String(index).padStart(2, '0')
    plans.push({ composition, withImage: wantImage, align: finalAlign, anchor, imagePos: finalPos, surface, beat: plans.filter(p => p.withImage).length, callout, badge, cutout, ...(frame === undefined ? {} : { frame }), ...(last ? { closing: true } : {}), ...variants })
  })
  return plans
}

// ---------------------------------------------------------------- color

const mix = (a: string, b: string, t: number) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('')
const alpha = (color: string, pct: number) => color.slice(0, 7) + Math.round(Math.max(0, Math.min(100, pct)) * 2.55).toString(16).padStart(2, '0')
const contrast = (a: string, b: string) => (Math.max(lightness(a), lightness(b)) + .05) / (Math.min(lightness(a), lightness(b)) + .05)

/** Maps the study's color roles to the current brand. Reference colors never enter here. */
export function brandPalette(tokens: Record<string, string>, surfaceRole: SlidePlan['surface']) {
  const brand = [...new Set(['brand.primary', 'brand.secondary', 'brand.accent', 'brand.background', 'brand.textPrimary'].map(k => tokens[k]).filter(c => hex(c)))]
  const darkest = brand.reduce((a, b) => lightness(b) < lightness(a) ? b : a, brand[0] || '#101010')
  const lightest = brand.reduce((a, b) => lightness(b) > lightness(a) ? b : a, brand[0] || '#ffffff')
  // The dominant dark is the brand's own dark color; a brand without one gets its main color deepened, not a generic black.
  const chromatic = [tokens['brand.primary'], tokens['brand.secondary'], tokens['brand.accent']].filter(c => hex(c))
  const deepest = chromatic.reduce((a, b) => lightness(b) < lightness(a) ? b : a, chromatic[0] || darkest)
  const dark = lightness(deepest) < .05 ? deepest : tokens['brand.textPrimary'] !== '#101010' && lightness(tokens['brand.textPrimary']) < .05 ? tokens['brand.textPrimary'] : mix(deepest, '#000000', .72)
  const light = lightness(lightest) > .75 ? lightest : mix(lightest, '#ffffff', .9)
  const surface = surfaceRole === 'dark' ? dark : surfaceRole === 'brand' ? tokens['brand.primary'] : light
  const readable = (c: string, min: number) => contrast(c, surface) >= min
  const foreground = [tokens['brand.textPrimary'], light, dark].find(c => readable(c, 4.5)) || on(surface)
  // The accent keeps the brand's hue: a brand color too close to the surface is tinted toward legibility, not replaced.
  const toward = lightness(surface) < .4 ? '#ffffff' : '#000000'
  const legible = (c: string) => { for (let t = 0; t <= .6; t += .05) { const tinted = t ? mix(c, toward, t) : c; if (readable(tinted, 3)) return tinted } return null }
  const accent = [tokens['brand.accent'], tokens['brand.primary'], tokens['brand.secondary']].filter(c => hex(c) && c !== surface && contrast(c, surface) > 1.1).map(legible).find(Boolean) || foreground
  const onAccent = [dark, light].find(c => contrast(c, accent) >= 4.5) || on(accent)
  return { surface, foreground, accent, onAccent, dark, light, muted: mix(foreground, surface, .22), tone: mix(surface, foreground, .12) }
}

// ---------------------------------------------------------------- composition

const HEADLINE = { medium: .072, large: .092, veryLarge: .116, oversized: .145 }
const BODY = { small: .029, medium: .034, large: .041 }
const MARGIN = { tight: .06, standard: .08, generous: .105 }
const DENSITY = { airy: 1.35, balanced: 1, dense: .72 }
const IMAGE_SHARE = { none: 0, small: .3, medium: .38, large: .46, dominant: .56 }
const WEIGHT = { regular: 400, bold: 700, black: 900 }
const LEADING = { tight: 1.02, normal: 1.12, loose: 1.25 }

interface ComposeOptions { preview?: boolean; image?: string; logo?: boolean; imageSize?: { width: number; height: number } }
interface TextSpec { role: string; text: string; font: string; size: number; min: number; weight: number; lineHeight: number; letterSpacing?: number; color: string; uppercase?: boolean; italic?: boolean; highlight?: 'color' | 'background'; pad?: number; padY?: number }

function emphasize(text: string, slide: any, kind: 'color' | 'background') {
  const words = text.split(/\s+/)
  const requested = Array.isArray(slide.emphasis) ? slide.emphasis.map((w: any) => clean(w).toLowerCase()) : []
  // Without a planned word, accent the most substantial word (longest, later on ties), never a short article.
  const strip = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, '')
  const fallback = words.map((w, i) => ({ w, i, n: strip(w).length })).filter(x => x.n >= 4).sort((a, b) => b.n - a.n || b.i - a.i)[0]?.w || words[words.length - 1]
  const selected = requested.length ? words.filter(w => requested.includes(strip(w).toLowerCase()) || requested.includes(w.toLowerCase())).slice(0, 2) : [fallback]
  return text.split(/(\s+)/).map(word => selected.includes(word) ? `<%kind:${kind === 'background' ? 'family-highlight' : 'family-emphasis'}:${word}%>` : word).join('')
}

/** Shrinks a group of text blocks together until it fits the zone; complete copy is never cut. */
function fitGroup(specs: TextSpec[], width: number, height: number, gap: number) {
  for (let scale = 1; scale >= .3; scale -= .03) {
    const sized = specs.map(s => {
      const size = Math.max(s.min, Math.round(s.size * scale))
      const text = s.uppercase ? s.text.toUpperCase() : s.text
      const usable = width - 8 - (s.pad || 0)
      const lines = countLines(text, size, usable, s.font, s.letterSpacing || 0)
      const wordsFit = text.split(/\s+/).every(word => !word || countLines(word, size, usable, s.font, s.letterSpacing || 0) === 1)
      return { ...s, text, size, wordsFit, height: Math.ceil(lines * size * s.lineHeight + 10) + 2 * (s.padY || 0) }
    })
    const total = sized.reduce((n, s) => n + s.height, 0) + gap * (sized.length - 1)
    if (total <= height && sized.every(s => s.wordsFit)) return { sized, total }
    if (sized.every(s => s.size === s.min)) break
  }
  throw Object.assign(new Error(`The ${specs[0]?.role || 'slide'} copy is too long for this design. Shorten it or split it into another slide.`), { status: 422 })
}

/** Deterministic image frame for a plan, shared with asset planning so briefs match the final crop. */
export function imageFrame(family: GlobalDesignFamily, plan: SlidePlan): Box | null {
  if (!plan.withImage) return null
  const g = familyGrammar(family), W = family.width, H = family.height
  const M = Math.round(W * MARGIN[g.margin]), bleed = g.imagery.overlap !== 'none' || g.imagery.shape === 'rect'
  const share = (IMAGE_SHARE[g.imagery.scale] || .46) * ((plan.beat || 0) % 2 ? .82 : 1.08)
  // Photo variants: a circle beside the copy's alignment, or an inset card inside the margins. The copy never sits on them.
  if (!plan.cutout && plan.photo === 'circle') {
    const s = Math.round(Math.min(W - 2 * M, H * .42))
    return { x: plan.align === 'center' ? Math.round((W - s) / 2) : plan.align === 'right' ? W - M - s : M, y: plan.imagePos === 'bottom' ? H - M - s : M, width: s, height: s }
  }
  if (!plan.cutout && plan.photo === 'card') {
    if (plan.composition === 'split') {
      const w = Math.round((W - 2 * M) * .46)
      return { x: plan.imagePos === 'left' ? M : W - M - w, y: M, width: w, height: H - 2 * M }
    }
    const h = Math.round(H * (plan.composition === 'image-led' ? .5 : .4))
    return { x: M, y: plan.imagePos === 'bottom' ? H - M - h : M, width: W - 2 * M, height: h }
  }
  if (plan.composition === 'image-led') {
    // A cutout cannot sit behind the copy like a photograph: it takes the lower band and the copy stays above it.
    if (plan.imagePos === 'full' && !plan.cutout) return { x: 0, y: 0, width: W, height: H }
    const h = Math.round(H * Math.min(.6, Math.max(.45, share)))
    return plan.imagePos === 'top' ? { x: 0, y: 0, width: W, height: h } : { x: 0, y: H - h, width: W, height: h }
  }
  if (plan.composition === 'split') {
    const w = Math.round(W * Math.min(.48, Math.max(.38, share * .85)))
    const x = plan.imagePos === 'left' ? (bleed ? 0 : M) : (bleed ? W - w : W - M - w)
    return bleed ? { x, y: 0, width: w, height: H } : { x, y: M, width: w - M / 2, height: H - 2 * M }
  }
  const h = Math.round(H * Math.min(.5, Math.max(.3, share)))
  const y = plan.imagePos === 'top' ? (bleed ? 0 : M) : (bleed ? H - h : H - M - h)
  return bleed ? { x: 0, y, width: W, height: h } : { x: M, y, width: W - 2 * M, height: h }
}

/** Builds one editable slide. Throws 422 when copy cannot fit readably. */
export function composeSlide(family: GlobalDesignFamily, brand: any, slide: any, plan: SlidePlan, index: number, total: number, options: ComposeOptions = {}) {
  const g: DesignGrammar = familyGrammar(family), imagery = familyImagery(family)
  const W = family.width, H = family.height
  const tokens = resolveBrandTokens(brand, family)
  const p = brandPalette(tokens, plan.surface)
  const heading = tokens['brand.headingFont'], bodyFont = tokens['brand.bodyFont']
  const M = Math.round(W * MARGIN[g.margin]), gap = Math.round(W * .034 * DENSITY[g.density])
  const nodes: any[] = []
  let n = 0
  const id = (role: string) => `${role}-${++n}`
  // Display fonts that ship one weight are set at that weight: a requested bold would be faked by the browser,
  // wider than measured, and wrap onto extra lines.
  const push = (role: string, node: any) => {
    const weight = node.type === 'text' && SINGLE_WEIGHT.has(String(node.fontFamily || '').toLowerCase()) ? { fontWeight: 400 } : {}
    nodes.push({ id: id(role), designRole: role, ...node, ...weight }); return nodes[nodes.length - 1]
  }
  // A single line of text sized to its own line box and centred in a band or shape. The editor draws text from the
  // top of its box, so a box taller than the line would leave the text high inside its shape.
  const line = (top: number, boxHeight: number, fontSize: number, lineHeight: number) => {
    const height = Math.ceil(fontSize * lineHeight) + 2
    return { y: Math.round(top + (boxHeight - height) / 2), height }
  }

  // Image and the colors that sit on it.
  // A fill cutout never moves the copy: the slide is laid out as text-only and the cutout takes the space left over.
  let frame = plan.fill ? null : imageFrame(family, plan)
  const cutout = plan.cutout ?? imagery.mode === 'cutout'
  const shapedPhoto = !!frame && !cutout && (plan.photo === 'card' || plan.photo === 'circle')
  const textOnImage = !!frame && plan.composition === 'image-led' && plan.imagePos === 'full' && !cutout && !shapedPhoto
  const fg = textOnImage ? '#ffffff' : p.foreground
  const accent = textOnImage ? (contrast(p.accent, p.dark) >= 3 ? p.accent : '#ffffff') : p.accent
  const muted = textOnImage ? '#ffffffd9' : p.muted
  // Study color roles resolved for this brand and surface.
  const roleColor = (role: string) => (({
    surface: p.surface, light: p.light, dark: p.dark, primary: tokens['brand.primary'], accent, foreground: fg, white: '#ffffff',
    tint: lightness(p.surface) < .4 ? mix(tokens['brand.primary'], p.surface, .65) : mix(tokens['brand.primary'], '#ffffff', .8),
  } as Record<string, string>)[role] || p.surface)
  const legibleOn = (color: string, ground: string, min: number) => {
    const toward = lightness(ground) < .4 ? '#ffffff' : '#000000'
    for (let t = 0; t <= .8; t += .05) { const c = t ? mix(color, toward, t) : color; if (contrast(c, ground) >= min) return c }
    return on(ground)
  }
  const headlineGradient = g.headline.fill === 'gradient' && !textOnImage ? { gradientType: 'linear', angle: g.headline.gradient.angle, stops: [
    { color: legibleOn(roleColor(g.headline.gradient.from), p.surface, 4.5), position: 0, alpha: 100 },
    { color: legibleOn(roleColor(g.headline.gradient.to), p.surface, 3.5), position: 100, alpha: 100 },
  ] } : null
  const box = g.containers
  const cardsFor = (use: string) => box.style !== 'none' && (box.use as string[]).includes(use)
  const cardFill = (() => { const c = roleColor(box.fill); return contrast(c, p.surface) < 1.08 ? mix(p.surface, fg, .07) : c })()
  const cardGround = box.style === 'card' ? cardFill : p.surface
  const cardText = contrast(fg, cardGround) >= 4.5 ? fg : on(cardGround)
  const radiusFor = (h: number) => box.radius === 'pill' ? Math.round(h / 2) : Math.round(W * ({ small: .012, medium: .024, large: .04 } as any)[box.radius])
  const glass = lightness(p.surface) < .4 ? alpha('#ffffff', 10) : alpha('#ffffff', 55)

  // Branding rows reserve their own bands so content never collides with them.
  const logoUrl = typeof brand.logo === 'string' && brand.logo ? brand.logo : ''
  const variants = brand.logoVariants?.source === logoUrl ? brand.logoVariants : null
  const showLogo = !!logoUrl && options.logo !== false
  /** The original artwork when it reads on this ground; otherwise its white or black silhouette. */
  const logoOn = (ground: string) => {
    const ink = typeof variants?.inkLightness === 'number' ? variants.inkLightness : null
    const g = lightness(ground)
    if (ink !== null && (Math.max(ink, g) + .05) / (Math.min(ink, g) + .05) >= 2.5) return variants.originalTransparent || logoUrl
    return (ink === null && g >= .4 ? variants?.originalTransparent : g < .4 ? variants?.whiteTransparent : variants?.blackTransparent) || logoUrl
  }
  // The logo is measured by its visible mark, not by its file's padding.
  const mark = variants?.bounds && variants.imageAspect ? { bounds: variants.bounds, imageAspect: variants.imageAspect as number } : null
  const markAspect = mark ? mark.bounds.width / mark.bounds.height * mark.imageAspect : 0
  // One brand mark per slide, always in a corner: never inside the copy and never centred. A brand with a logo is
  // identified by the logo, not its website: the logo takes the handle's place when the study has no logo position,
  // and the website link is dropped when the logo is shown. A study that places no branding still gets the logo
  // (or the name) top-left.
  const corner = (pos: string) => pos === 'top-center' ? 'top-left' : pos === 'bottom-center' ? 'bottom-left' : pos
  const logoPos = corner(g.branding.logo !== 'none' ? g.branding.logo
    : g.branding.handle !== 'none' ? (showLogo ? g.branding.handle : 'none')
    : showLogo || clean(brand.name || '').trim() ? 'top-left' : 'none')
  const branding = [
    { kind: 'logo', pos: logoPos },
    { kind: 'number', pos: total > 1 ? g.branding.slideNumber : 'none' },
    { kind: 'handle', pos: showLogo ? 'none' : g.branding.handle },
  ].filter((b, i, all) => b.pos !== 'none' && all.findIndex(o => o.pos === b.pos) === i)
  const band = Math.round(W * .05)
  // Logos are sized by area, so a wide wordmark carries the same visual weight as a square mark (8% of the width
  // tall) instead of the same height: a 4:1 wordmark is about 4% tall and 16% wide. Very wide marks are capped.
  const logoHeight = !showLogo ? 0 : markAspect ? Math.round(Math.max(W * .03, Math.min(W * .08 / Math.sqrt(Math.max(1, markAspect)), W * .3 / markAspect))) : Math.round(W * .06)
  const rowHeight = (v: string) => Math.max(band, branding.some(b => b.kind === 'logo' && b.pos.startsWith(v)) ? logoHeight : 0)
  const topBand = branding.some(b => b.pos.startsWith('top')) ? rowHeight('top') + gap : 0
  const bottomBand = branding.some(b => b.pos.startsWith('bottom')) ? rowHeight('bottom') + gap : 0
  const content: Box = { x: M, y: M + topBand, width: W - 2 * M, height: H - 2 * M - topBand - bottomBand }
  // A card or circle sits inside the content area, clear of the branding rows (a full-bleed photo runs under them).
  if (frame && shapedPhoto) {
    const top = Math.max(frame.y, content.y), bottom = Math.min(frame.y + frame.height, content.y + content.height)
    frame = plan.photo === 'circle'
      ? (() => { const s = Math.min(frame!.width, bottom - top); return { x: frame!.x, y: frame!.y < content.y ? content.y : bottom - s, width: s, height: s } })()
      : { ...frame, y: top, height: bottom - top }
  }

  // Text zone: the part of the content box the composition leaves for copy.
  let zone: Box = { ...content }
  if (frame && !textOnImage) {
    if (plan.composition === 'split') {
      zone = plan.imagePos === 'left' ? { ...content, x: frame.x + frame.width + gap, width: W - M - (frame.x + frame.width + gap) } : { ...content, width: frame.x - gap - M }
    } else if (frame.y <= content.y + 1) {
      const top = frame.y + frame.height + gap
      zone = { ...content, y: Math.max(top, content.y), height: content.y + content.height - Math.max(top, content.y) }
    } else zone = { ...content, height: frame.y - gap - content.y }
  }

  // Copy.
  const headlineRatio = HEADLINE[g.headline.scale] * (plan.composition === 'list' ? .78 : plan.composition === 'image-led' ? .9 : plan.composition === 'backdrop-type' ? .88 : 1) * (frame && !textOnImage ? .82 : 1)
  const hSize = Math.round(W * headlineRatio), bSize = Math.round(W * BODY[g.body.scale])
  const headlineText = clean(slide.headline || slide.title).trim()
  const parts = plan.composition === 'list' ? listParts(slide) : { items: [] as string[], lead: '' }
  const items = parts.items
  const bodyText = clean(items.length ? parts.lead : slide.body || slide.supportingText).trim()
  const eyebrowText = clean(slide.eyebrow || slide.subheadline).trim()
  const ctaText = clean(slide.cta).trim()
  const emphasis = g.emphasis === 'none' ? undefined : g.emphasis === 'background' ? 'background' as const : 'color' as const
  const specs: TextSpec[] = []
  const boxed = g.headline.frame !== 'none' && plan.frame !== false
  if (eyebrowText) specs.push({ role: 'eyebrow', text: eyebrowText, font: bodyFont, size: Math.round(bSize * .8), min: 18, weight: 600, lineHeight: 1.2, letterSpacing: 2, color: textOnImage ? '#ffffffd9' : accent, uppercase: true })
  if (headlineText) specs.push({ role: 'headline', text: headlineText, font: heading, size: hSize, min: Math.max(34, Math.round(hSize * .42)), weight: WEIGHT[g.headline.weight], lineHeight: LEADING[g.headline.leading], letterSpacing: g.headline.tracking === 'tight' ? -Math.round(hSize * .025) : g.headline.tracking === 'wide' ? Math.round(hSize * .04) : 0, color: fg, uppercase: g.headline.case === 'uppercase', highlight: emphasis, pad: boxed ? Math.round(hSize * .7) : emphasis === 'background' ? 28 : 0, padY: boxed ? Math.round(hSize * .2) : 0 })
  if (bodyText) specs.push({ role: 'body', text: bodyText, font: bodyFont, size: bSize, min: 22, weight: 400, lineHeight: 1.32, color: textOnImage ? '#ffffff' : mix(fg, p.surface, .12) })

  // The closing slide's call to action is its sign-off: larger, set off by a short accent rule, at the foot of the copy.
  const ctaProminent = plan.composition === 'closing' || !!plan.closing
  const signOff = !!plan.closing
  const ctaScale = signOff ? 1.3 : ctaProminent ? 1.08 : .92
  const ctaRuleH = signOff ? Math.max(5, Math.round(W * .006)) : 0, ctaRuleGap = signOff ? Math.round(bSize * .7) : 0
  const ctaLine = signOff ? Math.round(bSize * ctaScale * 1.45) : Math.round(bSize * 1.6)
  const ctaHeight = ctaText ? ctaLine + ctaRuleH + ctaRuleGap : 0
  if (frame && !textOnImage && plan.composition !== 'split' && frame.width >= W * .9) {
    const comfortable = specs.map(s => ({ ...s, size: Math.round(s.size * .82), min: Math.round(s.size * .82) }))
    const reserve = (ctaText ? ctaHeight + gap : 0) + (g.decorations.some(d => d.kind === 'line') ? Math.round(W * .012) + gap : 0)
    let need = 0
    try { need = fitGroup(comfortable, zone.width, 10000, gap).total + reserve } catch { need = 0 }
    const shortfall = need - zone.height
    const give = Math.min(Math.max(0, shortfall), frame.height - Math.round(H * .3))
    if (give > 0) {
      const top = frame.y <= M + 1
      frame = top ? { ...frame, height: frame.height - give } : { ...frame, y: frame.y + give, height: frame.height - give }
      zone = top ? { ...zone, y: zone.y + give, height: zone.height + give } : { ...zone, height: zone.height + give }
    }
  }

  // A studied headline box: the headline sits inside a border (outline) or on a filled panel (solid) spanning the copy.
  const textNode = (spec: any, area: Box, align: Align) => {
    if (spec.role === 'headline' && boxed) {
      const solid = g.headline.frame === 'solid', padY = spec.padY || 0, padX = Math.round((spec.pad || 0) / 2)
      push('headline-frame', { type: 'shape', shape: 'rect', ...area, borderRadius: 0, fill: solid ? accent : '#00000000', ...(solid ? {} : { stroke: accent, strokeWidth: Math.max(3, Math.round(spec.size * .035)) }) })
      area = { x: area.x + padX, y: area.y + padY, width: area.width - 2 * padX, height: area.height - 2 * padY }
      if (solid) spec = { ...spec, color: on(accent), solidFrame: true }
    }
    return placeText(spec, area, align)
  }
  const placeText = (spec: any, area: Box, align: Align) => push(spec.role, {
    type: 'text', ...area, text: spec.highlight ? emphasize(spec.text, slide, spec.highlight) : spec.text,
    fontFamily: spec.font, fontSize: spec.size, fontWeight: spec.weight, lineHeight: spec.lineHeight, letterSpacing: spec.letterSpacing || 0,
    color: spec.color, textAlign: align, ...(spec.italic ? { fontStyle: 'italic' } : {}),
    // Gradient-filled headlines stay editable text: the editor's text-fill gradient, not a picture of text.
    ...(spec.role === 'headline' && headlineGradient && !spec.solidFrame ? { fillType: 'gradient', textGradient: headlineGradient } : {}),
  })
  const card = (area: Box, role = 'card', maxRadius = Infinity) => push(role, {
    type: 'shape', shape: 'rect', ...area, borderRadius: Math.min(radiusFor(area.height), maxRadius),
    fill: box.style === 'outline' ? '#00000000' : box.style === 'glass' ? glass : cardFill,
    ...(box.style === 'outline' || box.style === 'glass' ? { stroke: alpha(fg, box.style === 'glass' ? 18 : 30), strokeWidth: 2 } : {}),
  })
  // List markers follow the study (numbers, checks, arrows or dots in circles or rounded squares). Families
  // without a studied list style keep their decorative cue: rings read as outlined circles.
  const studiedList = !!(family.study as any)?.grammar?.list
  const ringCue = g.decorations.some(d => d.kind === 'ring' || d.kind === 'circle')
  const listStyle = studiedList ? g.list : { ...g.list, shape: ringCue ? 'circle' : 'square', fill: ringCue ? 'outline' : 'solid' }
  const markerColor = legibleOn(roleColor(listStyle.color), cardsFor('list') ? cardGround : p.surface, 3)
  const drawMarker = (x: number, y: number, size: number, i: number, glyphOverride?: string, ground?: string) => {
    const color = ground ? legibleOn(roleColor(listStyle.color), ground, 3) : markerColor
    // Numerals: the item's number itself, large and in the accent, with no shape around it.
    if (plan.listStyle === 'numerals' && glyphOverride === undefined) {
      const size2 = Math.round(size * .62)
      push('marker-glyph', { type: 'text', x, ...line(y, size, size2, 1), width: Math.round(size * 1.15), text: String(i + 1).padStart(2, '0'), fontFamily: heading, fontSize: size2, fontWeight: 900, lineHeight: 1, color, textAlign: 'left' })
      return
    }
    const glyph = glyphOverride ?? ({ number: String(i + 1), check: '✓', arrow: '→', dot: '' } as any)[listStyle.marker]
    const solid = listStyle.fill === 'solid' && listStyle.shape !== 'none'
    if (listStyle.shape !== 'none') push('marker', { type: 'shape', shape: listStyle.shape === 'circle' ? 'ellipse' : 'rect', x, y, width: size, height: size, fill: solid ? color : '#00000000', ...(solid ? {} : { stroke: color, strokeWidth: Math.max(3, Math.round(size * .08)) }), ...(listStyle.shape === 'square' ? { borderRadius: Math.round(size * .24) } : {}) })
    if (glyph) push('marker-glyph', { type: 'text', x, ...line(y, size, Math.round(size * (glyph.length > 1 ? .42 : .5)), 1), width: size, text: glyph, fontFamily: heading, fontSize: Math.round(size * (glyph.length > 1 ? .42 : .5)), fontWeight: 700, lineHeight: 1, color: solid ? ([p.light, p.dark].find(c => contrast(c, color) >= 4.5) || on(color)) : color, textAlign: 'center' })
    else push('marker-dot', { type: 'shape', shape: 'ellipse', x: x + size * .35, y: y + size * .35, width: size * .3, height: size * .3, fill: solid ? on(color) : color })
  }

  // Decorations sit behind everything and keep to the side the copy does not use.
  const freeCorners = (() => {
    const vertical = plan.anchor === 'top' ? ['bottom'] : plan.anchor === 'bottom' ? ['top'] : ['top', 'bottom']
    const horizontal = plan.align === 'left' ? ['right'] : plan.align === 'right' ? ['left'] : ['left', 'right']
    return vertical.flatMap(v => horizontal.map(h => `${v}-${h}`))
  })()
  const decorations = g.decorations.filter(d => d.frequency === 'every' || index % 2 === 0)
  const decoColor = (d: any) => alpha(d.color === 'accent' ? accent : d.color === 'foreground' ? fg : (textOnImage ? '#ffffff' : p.tone), d.color === 'surfaceTone' ? Math.max(d.opacity, 60) : d.opacity)
  const sizeOf = (scale: string) => W * ({ small: .16, medium: .3, large: .5, oversized: .78 } as any)[scale]
  const behind: any[] = []
  decorations.forEach((d, i) => {
    const corner = freeCorners[(i + index) % freeCorners.length]
    const [v, h] = corner.split('-')
    const size = sizeOf(d.scale)
    const cx = h === 'left' ? (d.placement === 'edge' ? 0 : M + size / 2) : (d.placement === 'edge' ? W : W - M - size / 2)
    const cy = v === 'top' ? (d.placement === 'edge' ? 0 : M + size / 2) : (d.placement === 'edge' ? H : H - M - size / 2)
    const color = decoColor(d)
    if (d.kind === 'ring' || d.kind === 'circle') behind.push({ role: 'decoration', type: 'shape', shape: 'ellipse', x: cx - size / 2, y: cy - size / 2, width: size, height: size, fill: d.kind === 'ring' ? '#00000000' : color, ...(d.kind === 'ring' ? { stroke: color, strokeWidth: Math.max(4, Math.round(size * .022)) } : {}) })
    else if (d.kind === 'arc') { const r = W * 1.05; behind.push({ role: 'decoration', type: 'shape', shape: 'ellipse', x: (h === 'left' ? -r * .62 : W - r * .38), y: (v === 'top' ? -r * .62 : H - r * .38), width: r, height: r, fill: '#00000000', stroke: color, strokeWidth: Math.max(3, Math.round(W * .006)) }) }
    else if (d.kind === 'glow') behind.push({ role: 'decoration', type: 'gradient', gradientType: 'radial', x: cx - size, y: cy - size, width: size * 2, height: size * 2, stops: [{ color: color.slice(0, 7), position: 0, alpha: d.opacity }, { color: color.slice(0, 7), position: 70, alpha: 0 }] })
    else if (d.kind === 'cornerBlock') { const s = Math.round(W * .13); behind.push({ role: 'decoration', type: 'shape', shape: 'rect', x: h === 'left' ? 0 : W - s, y: v === 'top' ? 0 : H - s, width: s, height: s, fill: color }) }
    else if (d.kind === 'frame') { const inset = Math.round(M * .45); behind.push({ role: 'decoration', type: 'shape', shape: 'rect', x: inset, y: inset, width: W - 2 * inset, height: H - 2 * inset, fill: '#00000000', stroke: color, strokeWidth: Math.max(2, Math.round(W * .003)) }) }
    else if (d.kind === 'dotGrid') {
      const field = d.scale === 'oversized', step = Math.round(W * (field ? .045 : .034)), dot = Math.max(4, Math.round(W * .007))
      const cols = field ? Math.ceil(W / step) : 6, rows = field ? Math.ceil(H / step) : 6
      const x0 = field ? step / 2 : (h === 'left' ? M : W - M - step * (cols - 1)), y0 = field ? step / 2 : (v === 'top' ? M + topBand : H - M - bottomBand - step * (rows - 1))
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        // Large fields fade toward the copy so texture never competes with it.
        const fade = field ? 1 - (v === 'top' ? r / rows : 1 - r / rows) * .85 : 1
        behind.push({ role: 'decoration', type: 'shape', shape: 'ellipse', x: x0 + c * step - dot / 2, y: y0 + r * step - dot / 2, width: dot, height: dot, fill: alpha(color, d.opacity * fade) })
      }
    }
  })
  // Oversized background typography: from the study, or always for the backdrop-type composition.
  const backdrop = g.decorations.find(d => d.kind === 'oversizedType')
  if (plan.composition === 'backdrop-type' || (backdrop && (backdrop.frequency === 'every' || index % 2 === 0))) {
    const word = (headlineText.split(/\s+/).sort((a, b) => b.length - a.length)[0] || String(index + 1)).replace(/[^\p{L}\p{N}]/gu, '').slice(0, 9) || String(index + 1).padStart(2, '0')
    const glyph = total > 1 && plan.composition !== 'backdrop-type' ? String(index + 1).padStart(2, '0') : word.toUpperCase()
    const size = Math.round(Math.min(H * .42, (W * .96) / Math.max(1, glyph.length * .74)))
    const y = plan.anchor === 'top' ? H - M - bottomBand - size : plan.anchor === 'bottom' ? M + topBand : (H - size) / 2
    behind.push({ role: 'backdrop-type', type: 'text', x: Math.round(W * .02), y: Math.max(0, Math.round(y)), width: Math.round(W * .96), height: Math.round(size * 1.02), text: glyph, fontFamily: heading, fontSize: size, fontWeight: 900, lineHeight: 1, letterSpacing: -Math.round(size * .03), color: alpha(textOnImage ? '#ffffff' : fg, Math.min(14, backdrop?.opacity ?? 9)), textAlign: plan.align === 'right' ? 'right' : plan.align === 'center' ? 'center' : 'left' })
  }
  // Surface treatment: a gradient between two studied roles, kept legible against the copy at both ends.
  let pageBackground = p.surface
  if (g.background.type !== 'flat' && !textOnImage) {
    let from = roleColor(g.background.from), to = roleColor(g.background.to)
    to = mix(to, from, ({ subtle: .45, medium: .2, strong: 0 } as any)[g.background.intensity])
    for (let t = .15; contrast(from, fg) < 4.5 && t <= 1; t += .15) from = mix(from, p.surface, t)
    for (let t = .15; contrast(to, fg) < 4.5 && t <= 1; t += .15) to = mix(to, from, t)
    pageBackground = from
    push('background', { type: 'gradient', gradientType: g.background.type, angle: g.background.angle, x: 0, y: 0, width: W, height: H, stops: [{ color: from, position: 0, alpha: 100 }, { color: to, position: 100, alpha: 100 }] })
  }
  if (!frame || !textOnImage) for (const d of behind) push(d.role, d)

  // Imagery.
  if (frame) {
    const radius = shapedPhoto && plan.photo === 'card' ? Math.round(W * .035) : g.imagery.shape === 'rounded' ? Math.round(W * .03) : 0
    const mask = shapedPhoto && plan.photo === 'circle' ? 'circle' : g.imagery.shape === 'circle' ? 'circle' : g.imagery.shape === 'pill' || g.imagery.shape === 'arch' ? 'rounded' : undefined
    const tone = g.imagery.tone === 'monochrome' ? { filters: { saturate: 0, contrast: 108, brightness: 100, opacity: 100 } } : {}
    if (options.image && cutout) {
      // The node hugs the subject (its real proportions), standing on the lower edge of its area; side columns keep it to the outer edge.
      const size = options.imageSize
      const scale = size?.width && size?.height ? Math.min(frame.width / size.width, frame.height / size.height) : 0
      const width = scale ? Math.round(size!.width * scale) : frame.width, height = scale ? Math.round(size!.height * scale) : frame.height
      const x = plan.imagePos === 'left' ? frame.x : plan.imagePos === 'right' ? frame.x + frame.width - width : frame.x + Math.round((frame.width - width) / 2)
      const y = plan.imagePos === 'top' ? frame.y + Math.round((frame.height - height) / 2) : frame.y + frame.height - height
      push('image', { type: 'image', x, y, width, height, ...(scale ? { aspectRatio: size!.width / size!.height } : {}), src: options.image, objectFit: 'contain', ...tone })
    } else if (options.image) push('image', { type: 'image', ...frame, src: options.image, objectFit: 'cover', ...(radius ? { borderRadius: radius } : {}), ...(mask ? { mask } : {}), ...tone })
    else if (options.preview && cutout) push('image-placeholder', { type: 'shape', shape: 'ellipse', x: frame.x + Math.round(frame.width * .2), y: frame.y + Math.round(frame.height * .08), width: Math.round(frame.width * .6), height: Math.round(frame.height * .92), fill: p.tone })
    else if (options.preview) push('image-placeholder', { type: 'shape', shape: mask === 'circle' ? 'ellipse' : 'rect', ...frame, fill: textOnImage ? mix(p.dark, '#808080', .25) : p.tone, borderRadius: radius })
    else throw Object.assign(new Error('This design needs a photograph. Resolve the image before generating the canvas.'), { status: 409 })
    if (textOnImage && g.imagery.overlay !== 'none') {
      const solid = g.imagery.overlay === 'solid' || plan.anchor === 'center'
      push('overlay', { type: 'gradient', gradientType: 'linear', ...frame, angle: plan.anchor === 'top' ? 0 : 180, stops: solid ? [{ color: p.dark, position: 0, alpha: 52 }, { color: p.dark, position: 100, alpha: 52 }] : [{ color: p.dark, position: 0, alpha: 8 }, { color: p.dark, position: 55, alpha: 38 }, { color: p.dark, position: 100, alpha: 88 }] })
    } else if (textOnImage) push('overlay', { type: 'gradient', gradientType: 'linear', ...frame, angle: plan.anchor === 'top' ? 0 : 180, stops: [{ color: p.dark, position: 0, alpha: 0 }, { color: p.dark, position: 100, alpha: 70 }] })
    if (textOnImage) for (const d of behind.filter(d => d.role === 'backdrop-type')) push(d.role, d)
  }

  // Copy placement.
  const align = plan.align
  const ctaReserve = ctaText ? ctaHeight + gap : 0
  const lineAccent = g.decorations.find(d => d.kind === 'line')
  const lineReserve = lineAccent ? Math.round(W * .012) + gap : 0
  // A counted carousel's number, above the copy of every content slide.
  const numberLead = plan.number ? { text: plan.number, size: Math.round(hSize * .72) } : null
  const numberReserve = numberLead ? numberLead.size + 2 + Math.round(gap * .4) : 0
  const placeNumber = (y: number) => {
    if (numberLead) push('lead', { type: 'text', x: zone.x, y, width: zone.width, height: numberLead.size + 2, text: numberLead.text, fontFamily: heading, fontSize: numberLead.size, fontWeight: 900, lineHeight: 1, color: accent, textAlign: align })
    return y + numberReserve
  }
  if (plan.composition === 'list' && items.length) {
    // A two-column grid when the items are few and short enough; otherwise rows.
    if (!(plan.listStyle === 'grid' && placeGrid())) placeRows()
  } else placeCopy()

  function listHead(share: number) {
    // The lead line keeps a readable size; the headline is what gives way.
    const headSpecs = specs.map(s => s.role === 'body' ? { ...s, min: Math.max(s.min, Math.round(bSize * .85)) } : s)
    return fitGroup(headSpecs, zone.width, Math.round(zone.height * share), Math.round(gap * .6))
  }
  function placeListHead(headFit: any, groupHeight: number) {
    groupHeight += numberReserve
    let y = Math.round(plan.anchor === 'top' ? zone.y : plan.anchor === 'bottom' ? zone.y + zone.height - groupHeight : zone.y + (zone.height - groupHeight) / 2)
    if (lineAccent) { push('accent-line', { type: 'shape', shape: 'rect', x: zone.x, y, width: Math.round(W * .12), height: Math.max(6, Math.round(W * .008)), fill: accent }); y += lineReserve }
    y = placeNumber(y)
    for (const s of headFit.sized) { textNode(s, { x: zone.x, y, width: zone.width, height: s.height }, align); y += s.height + Math.round(gap * .6) }
    return y + Math.round(gap * .8)
  }

  function placeRows() {
    const inCards = cardsFor('list'), pad = inCards ? Math.round(gap * .55) : 0
    const rowGap = Math.round(gap * (inCards ? .45 : .8))
    // Eyebrow, headline and the list's lead line sit above the items. Rows are as tall as their marker, so markers,
    // padding and text scale together; the headline gives up room first, so items stay readable before they shrink.
    const ATTEMPTS = [[.45, 1], [.38, 1], [.45, .9], [.32, 1], [.38, .9], [.32, .9], [.27, 1], [.32, .8], [.27, .8], [.27, .7], [.27, .6], [.27, .5]]
    let headFit: any = null, itemSize = 0, marker = 0, textX = 0, fit: any = null, rows: number[] = []
    // Each marker is centred on its item's first line and the text starts at the top of the row, so numbers stay
    // aligned even when the real font wraps an item onto fewer or more lines than estimated.
    const rowGeometry = (s: any) => {
      const first = s.size * s.lineHeight, centre = Math.max(marker, first) / 2
      return { marker: centre - marker / 2, text: centre - first / 2, inner: Math.max(centre + marker / 2, centre - first / 2 + s.height) }
    }
    for (const [share, scale] of ATTEMPTS) {
      try { headFit = listHead(share) } catch { continue }
      const available = zone.height - ctaReserve - lineReserve - numberReserve - headFit.total - gap * 1.4
      itemSize = Math.round(bSize * 1.2 * scale); marker = Math.round(itemSize * 1.6); textX = zone.x + pad + marker + Math.round(gap * .7)
      const itemSpecs = items.map(text => ({ role: 'item', text, font: bodyFont, size: itemSize, min: itemSize, weight: 500, lineHeight: 1.25, color: inCards ? cardText : fg }))
      try { fit = fitGroup(itemSpecs, zone.x + zone.width - pad - textX, available - pad * 2 * items.length, rowGap) } catch { fit = null; continue }
      rows = fit.sized.map((s: any) => rowGeometry(s).inner + pad * 2)
      if (rows.reduce((n, h) => n + h, 0) + rowGap * (rows.length - 1) <= available) break
      fit = null
    }
    if (!fit || !headFit) throw Object.assign(new Error('The list has too many or too long items for this design. Shorten them or split the slide.'), { status: 422 })
    const groupHeight = lineReserve + headFit.total + gap * 1.4 + rows.reduce((n, h) => n + h, 0) + rowGap * (rows.length - 1) + ctaReserve
    let y = placeListHead(headFit, groupHeight)
    // Timeline: a line joins each marker to the next, drawn first so the markers sit on it.
    if (plan.listStyle === 'timeline' && fit.sized.length > 1) {
      let ty = y
      const centres = fit.sized.map((s: any, i: number) => { const c = ty + pad + rowGeometry(s).marker + marker / 2; ty += rows[i] + rowGap; return c })
      const lw = Math.max(4, Math.round(marker * .08)), lx = Math.round(zone.x + pad + marker / 2 - lw / 2)
      for (let i = 0; i < centres.length - 1; i++) push('timeline', { type: 'shape', shape: 'rect', x: lx, y: Math.round(centres[i] + marker / 2), width: lw, height: Math.max(1, Math.round(centres[i + 1] - centres[i] - marker)), fill: alpha(markerColor, 55) })
    }
    fit.sized.forEach((s: any, i: number) => {
      const rowH = rows[i]
      if (inCards) card({ x: zone.x, y, width: zone.width, height: rowH }, 'item-card')
      const geometry = rowGeometry(s)
      drawMarker(zone.x + pad, y + pad + geometry.marker, marker, i)
      textNode(s, { x: textX, y: y + pad + geometry.text, width: zone.x + zone.width - pad - textX, height: s.height }, 'left')
      y += rowH + rowGap
    })
    if (ctaText) placeCta(y - rowGap + gap)
  }

  /** Two columns of cards, a marker above each item. False when the items do not fit, so rows are used instead. */
  function placeGrid(): boolean {
    const n = items.length, rowsN = Math.ceil(n / 2), colGap = Math.round(gap * .7), cellW = Math.floor((zone.width - colGap) / 2)
    const pad = Math.round(gap * .6), ground = box.style === 'outline' || box.style === 'glass' ? p.surface : cardFill
    const ink = contrast(fg, ground) >= 4.5 ? fg : on(ground)
    for (const share of [.42, .34, .27]) {
      let headFit: any
      try { headFit = listHead(share) } catch { continue }
      const available = zone.height - ctaReserve - lineReserve - numberReserve - headFit.total - gap * 1.4
      for (const scale of [1, .9, .8, .7]) {
        const itemSize = Math.round(bSize * 1.1 * scale), size = Math.round(itemSize * 1.5)
        let cells: any[]
        try { cells = items.map(text => fitGroup([{ role: 'item', text, font: bodyFont, size: itemSize, min: itemSize, weight: 500, lineHeight: 1.25, color: ink }], cellW - 2 * pad, 10000, 0).sized[0]) } catch { continue }
        const rowH = Array.from({ length: rowsN }, (_, r) => Math.max(...cells.slice(r * 2, r * 2 + 2).map(c => c.height)) + size + Math.round(gap * .5) + 2 * pad)
        const gridH = rowH.reduce((a, b) => a + b, 0) + colGap * (rowsN - 1)
        if (gridH > available) continue
        let y = placeListHead(headFit, lineReserve + headFit.total + gap * 1.4 + gridH + ctaReserve)
        cells.forEach((s, i) => {
          const r = Math.floor(i / 2), cx = zone.x + (i % 2) * (cellW + colGap)
          const cy = y + rowH.slice(0, r).reduce((a, b) => a + b, 0) + colGap * r
          // A pill radius suits a one-line row, not a tall cell.
          card({ x: cx, y: cy, width: cellW, height: rowH[r] }, 'item-card', Math.round(W * .035))
          drawMarker(cx + pad, cy + pad, size, i, undefined, ground)
          textNode(s, { x: cx + pad, y: cy + pad + size + Math.round(gap * .5), width: cellW - 2 * pad, height: s.height }, 'left')
        })
        y += gridH
        if (ctaText) placeCta(y + gap)
        return true
      }
    }
    return false
  }

  function placeCopy() {
    const variant = plan.variant || 'classic'
    // Callout: supporting copy in a card with an icon, anchored to the bottom of the copy area, as studied.
    // Panel: the same card without the icon, in the study's tint.
    const panel = variant === 'panel' && !textOnImage && !plan.callout
    let ctaPlaced = false
    if (((plan.callout && cardsFor('callout')) || panel) && specs.some(s => s.role === 'body')) {
      const body = specs.find(s => s.role === 'body')!
      const pad = Math.round(gap * .7), icon = panel ? 0 : Math.round(bSize * 1.9), iconGap = icon ? Math.round(gap * .7) : 0
      const ink = panel ? (contrast(fg, cardFill) >= 4.5 ? fg : on(cardFill)) : cardText
      const bodyFit = fitGroup([{ ...body, color: ink }], zone.width - 2 * pad - icon - iconGap, Math.round(zone.height * .42), 0)
      // A panel carries the CTA under its body, so the CTA never floats between the headline and the panel.
      const panelCta = panel && !!ctaText, ctaGap = Math.round(gap * .5)
      const inner = bodyFit.total + (panelCta ? ctaGap + ctaHeight : 0)
      const cardH = Math.max(inner, icon) + 2 * pad, cardY = zone.y + zone.height - cardH
      if (panel) push('panel-card', { type: 'shape', shape: 'rect', x: zone.x, y: cardY, width: zone.width, height: cardH, borderRadius: Math.round(W * .028), fill: cardFill })
      else card({ x: zone.x, y: cardY, width: zone.width, height: cardH }, 'callout-card')
      if (icon) drawMarker(zone.x + pad, cardY + (cardH - icon) / 2, icon, 0, listStyle.marker === 'number' ? '→' : undefined)
      const textY = cardY + (cardH - inner) / 2
      textNode(bodyFit.sized[0], { x: zone.x + pad + icon + iconGap, y: textY, width: zone.width - 2 * pad - icon - iconGap, height: bodyFit.total }, panel ? align : 'left')
      if (panelCta) { placeCta(textY + bodyFit.total + ctaGap, legibleOn(accent, cardFill, 4.5), { x: zone.x + pad, width: zone.width - 2 * pad }); ctaPlaced = true }
      specs.splice(specs.indexOf(body), 1)
      zone = { ...zone, height: zone.height - cardH - gap }
    }
    // Band: the supporting copy and CTA on a full-width accent band along the bottom edge.
    const body = specs.find(s => s.role === 'body')
    // Over a full-bleed photograph the band sits on the photo's lower edge, a classic lower third.
    if (variant === 'band' && !bottomBand && (textOnImage || !(frame && frame.y + frame.height > H * .55)) && (body || ctaText)) {
      const pad = Math.round(M * .75), inner = W - 2 * M
      const bodyFit = body ? fitGroup([{ ...body, color: p.onAccent }], inner, Math.round(H * .28), 0) : null
      const bandH = (bodyFit ? bodyFit.total : 0) + (ctaText ? ctaHeight + (bodyFit ? Math.round(gap * .5) : 0) : 0) + 2 * pad
      const bandY = H - bandH
      push('band', { type: 'shape', shape: 'rect', x: 0, y: bandY, width: W, height: bandH, fill: p.accent })
      let by = bandY + pad
      if (bodyFit) { textNode(bodyFit.sized[0], { x: M, y: by, width: inner, height: bodyFit.total }, align); by += bodyFit.total + Math.round(gap * .5) }
      if (ctaText) { placeCta(by, p.onAccent, { x: M, width: inner }); ctaPlaced = true }
      if (body) specs.splice(specs.indexOf(body), 1)
      zone = { ...zone, height: Math.min(zone.height, bandY - gap - zone.y) }
    }
    // Side bar: an accent bar runs beside the whole copy block; the copy moves in to make room.
    const sidebar = variant === 'sidebar' && align === 'left'
    const barW = Math.max(6, Math.round(W * .008)), barGap = Math.round(gap * .9)
    if (sidebar) zone = { ...zone, x: zone.x + barW + barGap, width: zone.width - barW - barGap }
    // Lead: a large quote mark, or the slide's number, above the copy.
    const lead = numberLead || (variant === 'quote' ? { text: '“', size: Math.round(hSize * 1.15) } : null)
    const leadReserve = lead ? lead.size + 2 + Math.round(gap * .4) : 0
    // Rule: a short accent rule between the headline and the supporting copy.
    const rule = variant === 'rule' && !lineAccent && specs.some(s => s.role === 'headline')
    const ruleH = Math.max(5, Math.round(W * .006)), ruleReserve = rule ? ruleH + gap : 0
    const ctaRoom = ctaPlaced ? 0 : ctaReserve

    // Stacked text-only slides spread the copy: headline to one edge, supporting copy to the other.
    const spread = plan.composition === 'stacked' && !frame && specs.length > 1
    const textBudget = zone.height - ctaRoom - lineReserve - leadReserve - ruleReserve
    const fit = fitGroup(specs, zone.width, Math.max(120, textBudget - (spread ? gap * 2 : 0)), gap)
    const groupHeight = fit.total + ctaRoom + lineReserve + leadReserve + ruleReserve
    let y = plan.anchor === 'top' || spread ? zone.y : plan.anchor === 'bottom' ? zone.y + zone.height - groupHeight : zone.y + (zone.height - groupHeight) / 2
    y = Math.max(zone.y, Math.round(y))
    const groupTop = y
    if (lineAccent) { push('accent-line', { type: 'shape', shape: 'rect', x: align === 'center' ? W / 2 - W * .06 : align === 'right' ? zone.x + zone.width - W * .12 : zone.x, y, width: Math.round(W * .12), height: Math.max(6, Math.round(W * .008)), fill: accent }); y += lineReserve }
    if (lead) {
      push('lead', { type: 'text', x: zone.x, y, width: zone.width, height: lead.size + 2, text: lead.text, fontFamily: heading, fontSize: lead.size, fontWeight: 900, lineHeight: 1, color: accent, textAlign: align })
      y += leadReserve
    }
    const pill = g.decorations.find(d => d.kind === 'pill')
    fit.sized.forEach((s, i) => {
      if (spread && s.role === 'body') y = Math.max(y, zone.y + zone.height - ctaRoom - fit.sized.slice(i).reduce((n, o) => n + o.height + gap, -gap))
      if (s.role === 'eyebrow' && pill) {
        const textW = Math.min(zone.width, Math.round(s.text.length * s.size * .68 + s.size * 1.6))
        const px = align === 'center' ? W / 2 - textW / 2 : align === 'right' ? zone.x + zone.width - textW : zone.x
        push('eyebrow-pill', { type: 'shape', shape: 'rect', x: px, y: y - 4, width: textW, height: s.height + 8, fill: '#00000000', stroke: fg, strokeWidth: 3, borderRadius: Math.round((s.height + 8) / 2) })
        textNode(s, { x: px, y, width: textW, height: s.height }, 'center')
      } else textNode(s, { x: zone.x, y, width: zone.width, height: s.height }, align)
      y += s.height + gap
      if (rule && s.role === 'headline') {
        const ruleW = Math.round(W * .1)
        push('rule', { type: 'shape', shape: 'rect', x: align === 'center' ? Math.round(zone.x + (zone.width - ruleW) / 2) : align === 'right' ? zone.x + zone.width - ruleW : zone.x, y: y - Math.round(gap * .35), width: ruleW, height: ruleH, fill: accent })
        y += ruleReserve
      }
    })
    if (ctaText && !ctaPlaced) placeCta(spread || plan.anchor === 'bottom' || ctaProminent ? Math.min(zone.y + zone.height - ctaHeight, y) : y)
    if (sidebar) {
      const bottom = Math.max(groupTop + gap, (ctaText && !ctaPlaced ? Math.max(y, nodes.filter(n => n.designRole === 'cta').reduce((b, n) => Math.max(b, n.y + n.height), 0)) : y - gap))
      push('sidebar', { type: 'shape', shape: 'rect', x: zone.x - barW - barGap, y: groupTop, width: barW, height: Math.round(bottom - groupTop), fill: accent })
    }
  }


  // Nothing on an Instagram graphic is clickable, so the CTA is typography in the accent color: never a button
  // shape, a link underline or an arrow. It stays on one line, shrinking a little when it has to.
  function placeCta(y: number, color = accent, area: { x: number; width: number } = zone) {
    let size = Math.round(bSize * ctaScale)
    while (size > 22 && countLines(ctaText, size, area.width - 8, bodyFont, 0) > 1) size -= 2
    if (signOff) {
      const ruleW = Math.round(W * .08)
      push('cta-rule', { type: 'shape', shape: 'rect', x: align === 'center' ? Math.round(area.x + (area.width - ruleW) / 2) : align === 'right' ? area.x + area.width - ruleW : area.x, y: Math.round(y), width: ruleW, height: ctaRuleH, fill: color })
      y += ctaRuleH + ctaRuleGap
    }
    push('cta', { type: 'text', x: area.x, ...line(y, ctaLine, size, 1.15), width: area.width, text: ctaText, fontFamily: bodyFont, fontSize: size, fontWeight: 700, lineHeight: 1.15, color, textAlign: align })
  }

  // The largest empty band the copy leaves inside the content area (above or below it). A fill cutout stands in it:
  // on the bottom edge below the copy, or just above the headline, on the side away from the copy's alignment.
  const COPY = /^(eyebrow|eyebrow-pill|headline|headline-frame|body|cta|cta-rule|item|item-card|marker|marker-glyph|marker-dot|badge|badge-logo|badge-mark|callout-card|accent-line|panel-card|band|lead|rule|sidebar|timeline)$/
  const copyNodes = nodes.filter(n => COPY.test(n.designRole || ''))
  let free: { side: 'top' | 'bottom'; box: Box } | null = null
  if (copyNodes.length) {
    const top = Math.min(...copyNodes.map(n => n.y)), bottom = Math.max(...copyNodes.map(n => n.y + n.height))
    const above = top - gap - content.y, below = content.y + content.height - bottom - gap
    const bottomEdge = bottomBand ? content.y + content.height : H
    if (Math.max(above, below) >= H * .22) free = below >= above
      ? { side: 'bottom', box: { x: M, y: bottom + gap, width: W - 2 * M, height: bottomEdge - bottom - gap } }
      : { side: 'top', box: { x: M, y: content.y, width: W - 2 * M, height: above } }
  }
  if (plan.fill && options.image && free) {
    const size = options.imageSize
    const tone = g.imagery.tone === 'monochrome' ? { filters: { saturate: 0, contrast: 108, brightness: 100, opacity: 100 } } : {}
    const scale = size?.width && size?.height ? Math.min(free.box.width * .7 / size.width, free.box.height / size.height) : 0
    const width = scale ? Math.round(size!.width * scale) : Math.round(free.box.width * .5), height = scale ? Math.round(size!.height * scale) : free.box.height
    const x = plan.align === 'left' ? free.box.x + free.box.width - width : plan.align === 'right' ? free.box.x : free.box.x + Math.round((free.box.width - width) / 2)
    push('image', { type: 'image', x, y: free.box.y + free.box.height - height, width, height, ...(scale ? { aspectRatio: size!.width / size!.height } : {}), src: options.image, objectFit: 'contain', ...tone })
  }

  // Icons: a small header icon and/or a scatter of faint marks in the space the copy leaves free.
  const iconInk = (opacity: number) => alpha(textOnImage ? '#ffffff' : fg, opacity)
  const glyphIcon = (kind: string, x: number, y: number, s: number, color: string, role: string) => {
    if (kind === 'link') for (const d of [-1, 1]) push(role, { type: 'shape', shape: 'rect', x: x + s * .19 + d * s * .13, y: y + s * .34 + d * s * .13, width: s * .62, height: s * .3, rotation: -45, fill: '#00000000', stroke: color, strokeWidth: Math.max(2, Math.round(s * .07)), borderRadius: Math.round(s * .15) })
    else if (kind === 'plus') { push(role, { type: 'shape', shape: 'rect', x: x + s * .2, y: y + s * .44, width: s * .6, height: s * .12, fill: color }); push(role, { type: 'shape', shape: 'rect', x: x + s * .44, y: y + s * .2, width: s * .12, height: s * .6, fill: color }) }
    else push(role, { type: 'text', x, ...line(y, s, Math.round(s * .62), 1), width: s, text: ({ spark: '✦', arrow: '↗', check: '✓' } as any)[kind] || '↗', fontFamily: bodyFont, fontSize: Math.round(s * .62), fontWeight: 700, lineHeight: 1, color, textAlign: 'center' })
  }
  let topRightInset = 0
  if (g.icons.header !== 'none') {
    const s = band
    push('header-icon-ring', { type: 'shape', shape: 'ellipse', x: W - M - s, y: M, width: s, height: s, fill: '#00000000', stroke: iconInk(45), strokeWidth: Math.max(2, Math.round(s * .05)) })
    glyphIcon(g.icons.header, W - M - s, M, s, iconInk(90), 'header-icon')
    topRightInset = s + Math.round(gap * .5)
  }
  if (g.icons.scattered !== 'none') {
    const s = Math.round(W * .055), seed = hash(String(slide.headline || '') + index)
    const [lo, hi] = plan.anchor === 'top' ? [H * .58, H - M - bottomBand - s] : plan.anchor === 'bottom' ? [M + topBand, H * .38] : [M + topBand, H - M - bottomBand - s]
    for (let k = 0; k < 6; k++) {
      const x = M + ((seed >>> (k * 3)) + k * 389) % Math.max(1, W - 2 * M - s)
      const y = lo + ((seed >>> (k * 2 + 1)) + k * 241) % Math.max(1, hi - lo)
      // In a centred layout, keep marks out of the copy's middle band.
      if (plan.anchor === 'center' && y > H * .3 && y < H * .7) continue
      // Marks only go in empty space: never on text, cards, markers, images or the logo tile.
      const clear = s * .5
      if (nodes.some(n => (n.type === 'text' || n.type === 'image' || /card|marker|badge|pill|cta/.test(n.designRole || '')) && n.designRole !== 'backdrop-type'
        && x < n.x + n.width + clear && x + s > n.x - clear && y < n.y + n.height + clear && y + s > n.y - clear)) continue
      glyphIcon(g.icons.scattered, x, y, s, iconInk(g.icons.opacity), 'scattered-icon')
    }
  }

  // Branding: logo, slide number and handle in their studied corners.
  const half = Math.floor((W - 2 * M) / 2) - 8
  for (const b of branding) {
    const [v, h] = b.pos.split('-')
    // Every item in a branding row is centred on the row, which is as tall as its tallest item.
    const row = rowHeight(v), rowY = v === 'top' ? M : H - M - row
    const y = rowY + Math.round((row - band) / 2)
    const place = (width: number) => h === 'left' ? M : h === 'right' ? W - M - width - (v === 'top' ? topRightInset : 0) : Math.round(W / 2 - width / 2)
    if (b.kind === 'logo') {
      if (showLogo) {
        const src = textOnImage ? variants?.whiteTransparent || logoUrl : logoOn(p.surface)
        if (mark) {
          // The visible mark's edge lines up with the copy's edge; the node keeps the file's proportions around it.
          const markWidth = Math.round(logoHeight * markAspect)
          const fullHeight = logoHeight / mark.bounds.height, fullWidth = fullHeight * mark.imageAspect
          const markX = h === 'left' ? M : h === 'right' ? W - M - markWidth - (v === 'top' ? topRightInset : 0) : Math.round(W / 2 - markWidth / 2)
          const markY = rowY + Math.round((row - logoHeight) / 2)
          push('logo', { type: 'image', x: Math.round(markX - mark.bounds.x * fullWidth), y: Math.round(markY - mark.bounds.y * fullHeight), width: Math.round(fullWidth), height: Math.round(fullHeight), aspectRatio: mark.imageAspect, src, objectFit: 'contain' })
        } else {
          const width = Math.round(W * .2)
          push('logo', { type: 'image', x: place(width), y: rowY + Math.round((row - logoHeight) / 2), width, height: logoHeight, src, objectFit: 'contain' })
        }
      } else if (brand.name) {
        // Branding texts share a row with each other: each box keeps to its half so they never overlap.
        const width = Math.min(Math.round(W * .45), half)
        push('brand-name', { type: 'text', x: place(width), ...line(y, band, Math.round(W * .026), 1.1), width, text: clean(brand.name), fontFamily: heading, fontSize: Math.round(W * .026), fontWeight: 700, lineHeight: 1.1, color: fg, textAlign: h === 'center' ? 'center' : h })
      }
    } else if (b.kind === 'number') {
      const width = Math.round(W * .16)
      push('slide-number', { type: 'text', x: place(width), ...line(y, band, Math.round(W * .03), 1), width, text: `${String(index + 1).padStart(2, '0')}`, fontFamily: heading, fontSize: Math.round(W * .03), fontWeight: 700, lineHeight: 1, color: accent, textAlign: h === 'center' ? 'center' : h })
    } else if (brand.website) {
      let site = clean(brand.website)
      try { site = new URL(site).hostname.replace(/^www\./, '') } catch {}
      const size = Math.round(W * .022)
      if (cardsFor('handle')) {
        // The handle sits in a pill, as studied.
        const width = Math.min(Math.round(W * .5), Math.round(site.length * size * .6 + size * 2.2))
        const x = place(width)
        card({ x, y, width, height: band }, 'handle-pill')
        push('handle', { type: 'text', x, ...line(y, band, size, 1.1), width, text: site, fontFamily: bodyFont, fontSize: size, fontWeight: 600, lineHeight: 1.1, color: box.style === 'card' ? cardText : fg, textAlign: 'center' })
      } else {
        const width = Math.min(Math.round(W * .5), half)
        push('handle', { type: 'text', x: place(width), ...line(y, band, size, 1.1), width, text: site, fontFamily: bodyFont, fontSize: size, fontWeight: 400, lineHeight: 1.1, color: muted, textAlign: h === 'center' ? 'center' : h })
      }
    }
  }

  const classes = {
    'family-highlight': { background: accent, color: textOnImage ? on(accent) : p.onAccent, paddingX: 8, paddingY: 0 },
    'family-emphasis': { color: accent, fontWeight: 700 },
  }
  return { width: W, height: H, background: pageBackground, nodes, groups: [], classes, composition: plan.composition, free }
}

/** Sample copy for library previews: four beats so a family shows several compositions, not one layout. */
export const SAMPLE_DECK = [
  { headline: 'Make your next move matter', body: 'A clear idea, one practical step.', eyebrow: 'Start here' },
  { headline: 'Small steps compound', body: 'Consistent effort beats occasional intensity. Pick one habit and protect it every day.' },
  { headline: 'Three moves to begin', body: '1. Decide what matters\n2. Start small today\n3. Review every week' },
  { headline: 'Ready when you are', body: 'Turn the idea into your next action.', cta: 'Save this post' },
]

/**
 * Sample imagery for study previews, composed exactly like a real post's photo or cutout.
 * Photos from Pexels (free to use): landscape by Bob Krustev (#163915); potted plant by Gül Işık (#2266851),
 * background removed with the app's subject pipeline.
 */
export const SAMPLE_IMAGES = {
  photo: { url: '/samples/landscape.jpg', width: 1600, height: 1066 },
  cutout: { url: '/samples/cutout.png', width: 637, height: 543 },
}

/** Preview of one sample beat, with a sample photo or cutout wherever the study places imagery. */
export function previewSlide(family: GlobalDesignFamily, brand: any, sampleIndex = 0) {
  const deck = { format: 'carousel', slides: SAMPLE_DECK }
  const plans = planSlides(family, deck)
  const i = Math.max(0, Math.min(SAMPLE_DECK.length - 1, sampleIndex))
  const sample = plans[i].cutout ? SAMPLE_IMAGES.cutout : SAMPLE_IMAGES.photo
  try { return composeSlide(family, brand, SAMPLE_DECK[i], plans[i], i, SAMPLE_DECK.length, { preview: true, image: sample.url, imageSize: sample }) }
  catch { return composeSlide(family, brand, { headline: SAMPLE_DECK[i].headline }, { ...plans[i], composition: 'statement', withImage: false }, i, SAMPLE_DECK.length, { preview: true }) }
}
