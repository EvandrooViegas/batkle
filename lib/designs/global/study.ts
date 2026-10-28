import { grammarSchema, COMPOSITIONS } from './types'
import type { GlobalDesignFamily, DesignVariant, DesignStudy, DesignGrammar, VariantImageMode, Composition } from './types'

const photoNode = (v: DesignVariant) => v.nodes.find(n => n.type === 'image' && n.src === '{{image.primary}}')

/** Geometry is authoritative for whether a reconstruction has a photo; the study labels how it behaves. */
export function variantImageMode(family: Pick<GlobalDesignFamily, 'width' | 'height'>, variant: DesignVariant): VariantImageMode {
  const photo = photoNode(variant)
  if (!photo) return 'none'
  if (variant.imageMode && variant.imageMode !== 'none') return variant.imageMode
  return photo.width * photo.height >= family.width * family.height * .8 ? 'background' : 'contained'
}

const IMAGERY_DEFAULTS: Record<string, string> = {
  none: 'This design family relies entirely on typography, shapes and decorative graphics. Do not introduce photography.',
  background: 'Photography fills the canvas edge to edge. Text is layered over quieter or overlaid areas with high-contrast typography.',
  fullBleed: 'Large photography runs off the canvas edges and shares the composition with typography.',
  cutout: 'Isolated subjects with transparent backgrounds act as major compositional elements and interact with typography.',
  contained: 'Photography appears inside defined frames or containers that are part of the layout grid.',
  collage: 'Several photographs are arranged together as one composition.',
}
const BLANK_IMAGERY = { usage: '', placement: '', cropBehavior: '', subjectPlacement: '', textRelationship: '', overlayTreatment: '', frequency: '', notes: '' }

/** Imagery comes from the study. Families saved without a study derive it from their reference reconstructions. */
export function familyImagery(family: GlobalDesignFamily): DesignStudy['imagery'] {
  const studied = family.study?.imagery
  const pictured = ((family.study as any)?.grammar?.references || []).some((r: any) => r?.image === true || r?.image === 'true')
  if (studied?.mode === 'none' && pictured) {
    const prose = Object.values(studied).join(' ')
    const mode = /cut-?out|isolated|transparent/i.test(prose) ? 'cutout' : /fills? the (?:whole )?canvas|full.?bleed background|behind (?:the )?text/i.test(prose) ? 'background' : 'contained'
    return { ...BLANK_IMAGERY, ...studied, mode, usage: studied.usage || IMAGERY_DEFAULTS[mode] }
  }
  if (studied?.mode) return { ...BLANK_IMAGERY, ...studied, usage: studied.usage || IMAGERY_DEFAULTS[studied.mode] || '' }
  const modes = [...new Set((family.variants || []).map(v => variantImageMode(family, v)))]
  const mode = !modes.length ? 'none' : modes.length === 1 ? modes[0] : 'mixed'
  return { ...BLANK_IMAGERY, mode, usage: mode === 'mixed' ? `References use different treatments (${modes.join(', ')}).` : IMAGERY_DEFAULTS[mode] || '' }
}

const CUTOUT_PROSE = /cut-?outs?\b|isolated (?:subject|person|people|object|product|hand)|silhouett|transparent background|(?:without|no) background|background(?:s)? removed/i
const NO_CUTOUTS = /(?:no|never|avoid|without)\s+(?:\w+\s+){0,2}cut-?outs?/i
const PHOTO_PROSE = /full.?bleed photo|photo(?:graph)?s? (?:fill|cover)|background photo|framed photo|photos? inside|inside (?:a |the )?frames?/i

/**
 * How often the study's subjects are transparent cutouts rather than photographs. A stated grammar value wins;
 * older studies are read from their imagery prose, because the mode label alone often says "fullBleed" or "mixed"
 * for what the prose describes as a cutout.
 */
export function familyCutouts(family: GlobalDesignFamily): 'never' | 'some' | 'always' {
  const imagery = familyImagery(family)
  if (imagery.mode === 'none') return 'never'
  const stated = (family.study as any)?.grammar?.imagery?.cutout
  if (stated === 'never' || stated === 'some' || stated === 'always') return stated
  if (imagery.mode === 'cutout') return 'always'
  const prose = [imagery.usage, imagery.placement, imagery.cropBehavior, imagery.subjectPlacement, imagery.textRelationship, imagery.overlayTreatment, imagery.notes].join(' ')
  if (!CUTOUT_PROSE.test(prose) || NO_CUTOUTS.test(prose)) return 'never'
  return imagery.mode === 'mixed' && PHOTO_PROSE.test(prose) ? 'some' : 'always'
}

/**
 * A study built on a full-canvas photograph behind the copy (background imagery, or full-bleed photos that fill the
 * frame). Its look is the photograph, so its images stay photographs instead of becoming AI cutouts.
 */
export function familyPhotoLed(family: GlobalDesignFamily): boolean {
  const imagery = familyImagery(family)
  if (imagery.mode === 'background') return true
  const positions = (family.study as any)?.grammar?.imagery?.positions
  return imagery.mode === 'fullBleed' && familyCutouts(family) === 'never' && Array.isArray(positions) && positions.length === 1 && positions[0] === 'full'
}

const IMAGE_COMPOSITIONS: Composition[] = ['image-led', 'split', 'stacked']
const textCompositions = (list: Composition[]) => list.filter(c => c !== 'image-led' && c !== 'split')

/**
 * Grammar for families saved before structured grammars: read from reconstruction geometry in code, no model call.
 * Relationships only (scale ratios, sides, roles); coordinates never leave this function.
 */
export function deriveGrammar(family: GlobalDesignFamily): DesignGrammar {
  const W = family.width, H = family.height, variants = family.variants || []
  const texts = variants.flatMap(v => v.nodes.filter(n => n.type === 'text'))
  const headlines = texts.filter(n => n.text?.includes('{{headline}}'))
  const avg = (values: number[], fallback: number) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : fallback
  const ratio = avg(headlines.map(n => (n.fontSize || 80) / W), .09)
  const weight = avg(headlines.map(n => n.fontWeight || 700), 700)
  const centers = headlines.map(n => (n.y + n.height / 2) / H)
  const align = (n: any) => n.textAlign === 'center' || n.textAlign === 'right' ? n.textAlign : Math.abs(n.x + n.width / 2 - W / 2) < W * .04 && n.width < W * .7 ? 'center' : 'left'
  const margin = avg(headlines.map(n => n.x / W), .09)
  const corner = (n: any) => !n ? 'none' : `${n.y < H / 2 ? 'top' : 'bottom'}-${n.x + n.width / 2 < W * .4 ? 'left' : n.x + n.width / 2 > W * .6 ? 'right' : 'center'}`
  const find = (pred: (n: any) => boolean) => variants.flatMap(v => v.nodes).find(pred)
  const shapes = variants.flatMap(v => v.nodes.filter(n => n.type === 'shape'))
  const imagery = familyImagery(family)
  const photos = variants.map(v => photoNode(v)).filter(Boolean) as any[]
  const coverage = avg(photos.map(p => (p.width * p.height) / (W * H)), 0)
  const decorations: any[] = []
  if (shapes.filter(s => s.width < W * .03).length > 40) decorations.push({ kind: 'dotGrid', placement: 'background', scale: 'oversized', opacity: Math.round(avg(shapes.map(s => s.fillAlpha ?? 100), 20)), color: 'surfaceTone' })
  if (shapes.some(s => s.shape === 'ellipse' && s.strokeWidth)) decorations.push({ kind: 'ring', placement: 'edge', scale: 'small', opacity: 100, color: 'foreground', frequency: 'some' })
  if (shapes.some(s => s.shape !== 'ellipse' && s.height <= 12 && s.width > W * .08)) decorations.push({ kind: 'line', placement: 'around-text', scale: 'medium', opacity: 100, color: 'foreground' })
  if (shapes.some(s => s.stroke && (s.borderRadius || 0) >= s.height / 3)) decorations.push({ kind: 'pill', placement: 'corner', scale: 'small', opacity: 100, color: 'foreground' })
  if (variants.some(v => v.nodes.some(n => n.type === 'gradient')) && imagery.mode === 'none') decorations.push({ kind: 'glow', placement: 'behind', scale: 'large', opacity: 30, color: 'accent' })
  const surfaces = [...new Set(variants.map(v => v.background === 'brand.primary' ? 'brand' : v.background === 'brand.background' ? 'light' : 'dark'))]
  const highlight = headlines.find(n => n.highlight && n.highlight !== 'none')?.highlight
  const hasImages = imagery.mode !== 'none'
  const positions = coverage >= .8 ? ['full'] : [...new Set(photos.map(p => p.y + p.height / 2 > H * .6 ? 'bottom' : p.y + p.height / 2 < H * .4 ? 'top' : p.x + p.width / 2 < W / 2 ? 'left' : 'right'))]
  const base: Composition[] = ['statement', 'stacked', 'list', 'closing']
  return grammarSchema.parse({
    compositions: hasImages ? [...base, coverage >= .8 ? 'image-led' : 'split'] : base,
    headline: {
      scale: ratio >= .13 ? 'oversized' : ratio >= .1 ? 'veryLarge' : ratio >= .075 ? 'large' : 'medium',
      weight: weight >= 800 ? 'black' : weight >= 600 ? 'bold' : 'regular',
      case: headlines.some(n => n.textTransform === 'uppercase') ? 'uppercase' : 'none',
      tracking: avg(headlines.map(n => n.letterSpacing || 0), 0) < -1 ? 'tight' : 'normal',
      leading: avg(headlines.map(n => n.lineHeight || 1.1), 1.1) < 1.08 ? 'tight' : 'normal',
    },
    body: { scale: 'medium' },
    emphasis: highlight === 'background' ? 'background' : 'color',
    alignment: [...new Set(headlines.map(align))],
    anchors: [...new Set(centers.map(c => c < .4 ? 'top' : c > .62 ? 'bottom' : 'center'))],
    margin: margin < .06 ? 'tight' : margin > .095 ? 'generous' : 'standard',
    density: 'balanced',
    surfaces: surfaces.length ? surfaces : ['light'],
    decorations,
    imagery: hasImages
      ? { scale: coverage >= .8 ? 'dominant' : coverage > .35 ? 'large' : 'medium', positions, shape: 'rect', overlap: coverage >= .8 ? 'text' : 'edge', dominance: coverage >= .8 ? 'dominates' : 'balanced', overlay: variants.some(v => v.nodes.some(n => n.type === 'gradient')) ? 'gradient' : 'none', frequency: photos.length >= variants.length ? 'every' : 'most' }
      : { scale: 'none', positions: ['full'], frequency: 'never' },
    branding: {
      logo: corner(find(n => n.src === '{{brand.logo}}' || n.text?.includes('{{brand.name}}'))),
      slideNumber: corner(find(n => n.text?.includes('{{number}}'))),
      handle: corner(find(n => n.text?.includes('{{brand.website}}'))),
    },
    cta: 'text',
  })
}

const PANEL_SHAPE = '(?:block|panel|box|rectangle|card)s?'
const PANEL_OUTLINE = new RegExp(`\\b(?:outlined|outlines?|bordered|borders?|keylines?)\\b[^.]{0,60}\\b${PANEL_SHAPE}\\b|\\b${PANEL_SHAPE}\\b[^.]{0,60}\\b(?:outlined|outlines?|bordered|borders?)\\b`, 'i')
const PANEL_OFFSET = new RegExp(`\\b(?:ghost|offset|layered|layering|overlapping)\\b[^.]{0,60}\\b${PANEL_SHAPE}\\b`, 'i')
const GHOST_ONLY = /\bghost\b|outline only|outlined only/i
const SOLID_SECOND = /secondary (?:accent |solid |colou?r(?:ed)? )?blocks?|solid (?:and outlined )?(?:blocks|rectangles)/i

/**
 * A filled headline panel's outline and offset block, read from the study's own words when the grammar doesn't say
 * (studies made before the grammar had them). "Ghost" or "outline only" alone makes the second block an outline.
 */
function studiedPanel(study: any): NonNullable<DesignGrammar['panel']> {
  const prose = [study?.decorative, study?.composition, study?.colorRoles?.decoration, ...(study?.distinctive || []), ...(study?.familyRules || [])].filter(Boolean).join('. ')
  const offset = !PANEL_OFFSET.test(prose) ? 'none' : SOLID_SECOND.test(prose) || !GHOST_ONLY.test(prose) ? 'block' : 'outline'
  // "Outline only" describes the second block, not a line around the panel.
  return { outline: PANEL_OUTLINE.test(prose.replace(/\b(?:outline|outlined) only\b/gi, '')), offset }
}

/** The grammar generation follows, made consistent with the study's imagery strategy. */
export function familyGrammar(family: GlobalDesignFamily): DesignGrammar {
  const parsed = family.study?.grammar ? grammarSchema.parse(family.study.grammar) : deriveGrammar(family)
  // A reference whose photo fills the canvas is image-led, whatever the model called it: a split gives the photo one
  // side. Every arrangement the references show is one the language allows.
  const references = parsed.references.map(r => r.image && r.imagePos === 'full' && r.composition === 'split' ? { ...r, composition: 'image-led' as const } : r)
  const shown = [...new Set(references.map(r => r.composition))].filter(c => !parsed.compositions.includes(c))
  const panel = parsed.panel ?? (parsed.headline.frame === 'solid' ? studiedPanel(family.study) : undefined)
  const grammar = { ...parsed, references, compositions: [...parsed.compositions, ...shown], ...(panel ? { panel } : {}) }
  const imagery = familyImagery(family)
  if (imagery.mode === 'none') {
    const compositions = textCompositions(grammar.compositions)
    return { ...grammar, compositions: compositions.length ? compositions : ['statement', 'stacked', 'closing'], imagery: { ...grammar.imagery, scale: 'none', frequency: 'never' } }
  }
  const fullFrame = imagery.mode === 'background'
  const image = {
    ...grammar.imagery,
    frequency: grammar.imagery.frequency === 'never' ? 'most' as const : grammar.imagery.frequency,
    scale: grammar.imagery.scale === 'none' ? (fullFrame ? 'dominant' as const : 'large' as const) : grammar.imagery.scale,
    positions: fullFrame && !grammar.imagery.positions.includes('full') ? ['full' as const, ...grammar.imagery.positions] : grammar.imagery.positions,
  }
  // An image family needs at least one composition that can hold its imagery.
  const compositions = grammar.compositions.some(c => IMAGE_COMPOSITIONS.includes(c)) ? grammar.compositions : [...grammar.compositions, fullFrame ? 'image-led' as const : 'stacked' as const]
  return { ...grammar, compositions, imagery: { ...image, cutout: familyCutouts(family) } }
}

const HEX = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi
const scrub = (value: any): any => typeof value === 'string' ? value.replace(HEX, 'a brand color role')
  : Array.isArray(value) ? value.map(scrub) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)])) : value

/**
 * Makes a model-produced family consistent before it is saved: reconstruction image modes agree with geometry,
 * the study carries a complete grammar, and literal reference colors are removed from the study.
 */
export function reconcileStudy<T extends GlobalDesignFamily>(family: T): T {
  const variants = (family.variants || []).map(v => ({ ...v, imageMode: variantImageMode(family, v) }))
  const next = { ...family, variants } as T
  if (!family.study) return next
  const imagery = familyImagery(next)
  next.study = scrub({ ...family.study, imagery, grammar: familyGrammar({ ...next, study: { ...family.study, imagery } }) })
  return next
}

/** Compact, coordinate-free view of the saved study used by the planning call. Reference images are never sent. */
export function studyForPlanning(family: GlobalDesignFamily) {
  const s = family.study, grammar = familyGrammar(family)
  return {
    name: family.name,
    study: s ? { personality: s.personality, composition: s.composition, hierarchy: s.hierarchy, typography: s.typography, spaceDensity: s.spaceDensity, recurringRules: s.familyRules, flexibleRules: s.variantRules, antiPatterns: s.avoid } : { description: family.description },
    imagery: { ...familyImagery(family), scale: grammar.imagery.scale, frequency: grammar.imagery.frequency, dominance: grammar.imagery.dominance, cutouts: familyCutouts(family) },
    compositions: grammar.compositions.filter(c => (COMPOSITIONS as readonly string[]).includes(c)),
    referenceArrangements: grammar.references.map(r => r.composition),
    headlineScale: grammar.headline.scale, density: grammar.density, emphasis: grammar.emphasis,
  }
}
