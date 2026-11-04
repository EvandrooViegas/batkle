import { z } from 'zod'

export const COLOR_TOKENS = ['brand.primary', 'brand.secondary', 'brand.accent', 'brand.background', 'brand.textPrimary', 'brand.textSecondary', 'brand.onPrimary', 'brand.onAccent', 'brand.onImage', 'brand.overlay', 'transparent'] as const
export const FONT_TOKENS = ['brand.headingFont', 'brand.bodyFont'] as const
export const SLOT_NAMES = ['headline', 'body', 'cta', 'eyebrow', 'number', 'author', 'brand.name', 'brand.website', 'brand.logo', 'image.primary', 'step.1', 'step.2', 'step.3', 'step.4'] as const
export const VARIANT_ROLES = ['cover', 'content', 'image-content', 'list', 'quote', 'cta'] as const
const color = z.enum(COLOR_TOKENS)
const coord = z.number().finite().min(-4096).max(8192)
const size = z.number().finite().positive().max(8192)
const slotString = z.string().max(4000).refine(s => [...s.matchAll(/\{\{([^}]+)\}\}/g)].every(m => (SLOT_NAMES as readonly string[]).includes(m[1])), 'Unknown content slot')

// These are the existing Canvas node properties, with semantic values before resolution.
export const templateNodeSchema = z.object({
  id: z.string().min(1).max(100), type: z.enum(['text', 'shape', 'image', 'gradient']),
  x: coord, y: coord, width: size, height: size, rotation: z.number().min(-360).max(360).optional(),
  text: slotString.optional(), fontFamily: z.enum(FONT_TOKENS).optional(), fontSize: z.number().min(12).max(400).optional(),
  minFontSize: z.number().min(12).max(200).optional(), fontWeight: z.number().min(100).max(900).optional(),
  fontStyle: z.enum(['normal', 'italic']).optional(), textAlign: z.enum(['left', 'center', 'right']).optional(),
  lineHeight: z.number().min(.85).max(2).optional(), letterSpacing: z.number().min(-15).max(30).optional(),
  textTransform: z.enum(['none', 'uppercase', 'lowercase']).optional(), color: color.optional(),
  fill: color.optional(), stroke: color.optional(), strokeWidth: z.number().min(0).max(40).optional(),
  fillAlpha: z.number().min(0).max(100).optional(),
  shape: z.enum(['rect', 'ellipse']).optional(), borderRadius: z.number().min(0).max(4096).optional(),
  src: z.enum(['{{image.primary}}', '{{brand.logo}}']).optional(), objectFit: z.enum(['cover', 'contain']).optional(),
  cropLeft: z.number().min(0).max(90).optional(), cropRight: z.number().min(0).max(90).optional(),
  cropTop: z.number().min(0).max(90).optional(), cropBottom: z.number().min(0).max(90).optional(),
  filters: z.object({ brightness: z.number().min(0).max(200).optional(), contrast: z.number().min(0).max(200).optional(), saturate: z.number().min(0).max(200).optional(), opacity: z.number().min(0).max(100).optional() }).optional(),
  gradientType: z.enum(['linear', 'radial']).optional(), angle: z.number().min(0).max(360).optional(),
  stops: z.array(z.object({ color, position: z.number().min(0).max(100), alpha: z.number().min(0).max(100) })).min(2).max(8).optional(),
  highlight: z.enum(['none', 'color', 'background']).optional(),
  highlightCount: z.number().int().min(1).max(2).optional(),
  optional: z.boolean().optional(),
}).superRefine((node, ctx) => {
  if (node.type === 'text' && (!node.text || !node.fontFamily || !node.color || !node.fontSize)) ctx.addIssue({ code: 'custom', message: 'Text requires text, fontFamily, color and fontSize' })
  if (node.type === 'image' && !node.src) ctx.addIssue({ code: 'custom', message: 'Images must use image.primary or brand.logo slots' })
  if (node.type === 'gradient' && !node.stops) ctx.addIssue({ code: 'custom', message: 'Gradient requires stops' })
})
export const IMAGERY_MODES = ['none', 'background', 'fullBleed', 'cutout', 'contained', 'collage', 'mixed', 'other'] as const
export const VARIANT_IMAGE_MODES = ['none', 'background', 'cutout', 'contained'] as const
const prose = (max = 1200) => z.string().trim().max(max).default('')
const rules = z.array(z.string().trim().min(1).max(400)).max(16).default([])
// Imagery is a property of the design, never of the brand. Generation follows it.
export const imageryStrategySchema = z.object({
  mode: z.enum(IMAGERY_MODES), usage: prose(), placement: prose(), cropBehavior: prose(), subjectPlacement: prose(),
  textRelationship: prose(), overlayTreatment: prose(), frequency: prose(), notes: prose(),
})

// The grammar is the machine-readable half of a study: relationships and constraints, never coordinates.
// Every field tolerates partial model output so one odd value never discards a whole study.
const oneOf = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) => z.enum(values).catch(fallback)
const someOf = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number][]) => z.preprocess(
  v => Array.isArray(v) ? [...new Set(v.filter(x => (values as readonly unknown[]).includes(x)))] : v,
  z.array(z.enum(values)).min(1)).catch(fallback)
/** Composition moves a study allows. The planner combines them with the grammar; they are not templates. */
export const COMPOSITIONS = ['statement', 'stacked', 'split', 'image-led', 'backdrop-type', 'list', 'closing'] as const
export const DECORATION_KINDS = ['oversizedType', 'ring', 'circle', 'arc', 'line', 'dotGrid', 'pill', 'cornerBlock', 'frame', 'glow', 'stripes'] as const
const POSITIONS = ['top-left', 'top-right', 'top-center', 'bottom-left', 'bottom-right', 'bottom-center', 'none'] as const
/** Color roles a study may use; each resolves to the current brand at generation time. */
export const COLOR_ROLES = ['surface', 'tint', 'light', 'dark', 'primary', 'accent', 'foreground', 'white'] as const
const flag = z.preprocess(v => v === true || v === 'true', z.boolean()).catch(false)
const FLAT_BACKGROUND = { type: 'flat' as const, angle: 180, from: 'surface' as const, to: 'light' as const, intensity: 'subtle' as const }
const HEADLINE_GRADIENT = { from: 'foreground' as const, to: 'primary' as const, angle: 90 }
const decorationSchema = z.object({
  kind: z.enum(DECORATION_KINDS),
  placement: oneOf(['behind', 'edge', 'corner', 'around-text', 'background'] as const, 'edge'),
  scale: oneOf(['small', 'medium', 'large', 'oversized'] as const, 'large'),
  opacity: z.coerce.number().min(0).max(100).catch(20),
  color: oneOf(['accent', 'foreground', 'surfaceTone'] as const, 'surfaceTone'),
  frequency: oneOf(['every', 'some'] as const, 'every'),
})
export const grammarSchema = z.object({
  compositions: someOf(COMPOSITIONS, ['statement', 'stacked', 'closing']),
  headline: z.object({
    scale: oneOf(['medium', 'large', 'veryLarge', 'oversized'] as const, 'large'),
    weight: oneOf(['regular', 'bold', 'black'] as const, 'bold'),
    case: oneOf(['none', 'uppercase'] as const, 'none'),
    tracking: oneOf(['tight', 'normal', 'wide'] as const, 'normal'),
    leading: oneOf(['tight', 'normal', 'loose'] as const, 'tight'),
    fill: oneOf(['solid', 'gradient'] as const, 'solid'),
    gradient: z.object({ from: oneOf(COLOR_ROLES, 'foreground'), to: oneOf(COLOR_ROLES, 'primary'), angle: z.coerce.number().min(0).max(360).catch(90) }).catch(HEADLINE_GRADIENT),
    // A rectangle drawn around the whole headline: a border only, or a filled panel the headline sits on.
    frame: oneOf(['none', 'outline', 'solid'] as const, 'none'),
  }).catch({ scale: 'large', weight: 'bold', case: 'none', tracking: 'normal', leading: 'tight', fill: 'solid', gradient: HEADLINE_GRADIENT, frame: 'none' }),
  // How a filled headline panel is drawn: a thin dark outline around it (and around cards), and a second block offset
  // behind it, solid or outline only. Absent on older studies: it is then read from the study's prose (see familyGrammar).
  panel: z.object({ outline: flag, offset: oneOf(['none', 'block', 'outline'] as const, 'none') }).optional().catch(undefined),
  body: z.object({ scale: oneOf(['small', 'medium', 'large'] as const, 'medium') }).catch({ scale: 'medium' }),
  emphasis: oneOf(['none', 'color', 'background', 'underline'] as const, 'color'),
  alignment: someOf(['left', 'center', 'right'] as const, ['left']),
  anchors: someOf(['top', 'center', 'bottom'] as const, ['center']),
  margin: oneOf(['tight', 'standard', 'generous'] as const, 'standard'),
  density: oneOf(['airy', 'balanced', 'dense'] as const, 'balanced'),
  surfaces: someOf(['dark', 'light', 'brand'] as const, ['light']),
  decorations: z.preprocess(v => Array.isArray(v) ? v.filter(d => d && (DECORATION_KINDS as readonly unknown[]).includes(d.kind)) : [], z.array(decorationSchema).max(6)).catch([]),
  imagery: z.object({
    scale: oneOf(['none', 'small', 'medium', 'large', 'dominant'] as const, 'none'),
    positions: someOf(['full', 'top', 'bottom', 'left', 'right', 'center'] as const, ['full']),
    shape: oneOf(['rect', 'rounded', 'circle', 'pill', 'arch'] as const, 'rect'),
    overlap: oneOf(['none', 'text', 'edge'] as const, 'none'),
    dominance: oneOf(['supports', 'balanced', 'dominates'] as const, 'balanced'),
    overlay: oneOf(['none', 'gradient', 'solid'] as const, 'none'),
    frequency: oneOf(['every', 'most', 'some', 'rare', 'never'] as const, 'never'),
    tone: oneOf(['color', 'monochrome'] as const, 'color'),
    // How often subjects are cut out with no background (transparent PNGs on the design surface).
    // Absent on older studies: it is then read from the imagery prose (see familyCutouts).
    cutout: z.enum(['never', 'some', 'always']).optional().catch(undefined),
  }).catch({ scale: 'none', positions: ['full'], shape: 'rect', overlap: 'none', dominance: 'balanced', overlay: 'none', frequency: 'never', tone: 'color' }),
  branding: z.object({ logo: oneOf(POSITIONS, 'top-left'), slideNumber: oneOf(POSITIONS, 'none'), handle: oneOf(POSITIONS, 'none') })
    .catch({ logo: 'top-left', slideNumber: 'none', handle: 'none' }),
  cta: oneOf(['text', 'pill', 'underline', 'arrow'] as const, 'text'),
  // Surface treatment: flat, or a gradient between two color roles.
  background: z.object({
    type: oneOf(['flat', 'linear', 'radial'] as const, 'flat'), angle: z.coerce.number().min(0).max(360).catch(180),
    from: oneOf(COLOR_ROLES, 'surface'), to: oneOf(COLOR_ROLES, 'light'), intensity: oneOf(['subtle', 'medium', 'strong'] as const, 'subtle'),
  }).catch(FLAT_BACKGROUND),
  // Cards and panels: how the language groups content (list rows, a callout, labels, the website handle).
  containers: z.object({
    style: oneOf(['none', 'card', 'outline', 'glass'] as const, 'none'), radius: oneOf(['small', 'medium', 'large', 'pill'] as const, 'medium'),
    fill: oneOf(COLOR_ROLES, 'tint'),
    use: z.preprocess(v => Array.isArray(v) ? [...new Set(v.filter(x => ['list', 'callout', 'label', 'handle'].includes(x)))] : [], z.array(z.enum(['list', 'callout', 'label', 'handle']))).catch([]),
  }).catch({ style: 'none', radius: 'medium', fill: 'tint', use: [] }),
  list: z.object({
    marker: oneOf(['number', 'check', 'arrow', 'dot'] as const, 'number'), shape: oneOf(['circle', 'square', 'none'] as const, 'circle'),
    fill: oneOf(['solid', 'outline'] as const, 'solid'), color: oneOf(COLOR_ROLES, 'accent'),
  }).catch({ marker: 'number', shape: 'circle', fill: 'solid', color: 'accent' }),
  icons: z.object({
    header: oneOf(['none', 'arrow', 'plus', 'check'] as const, 'none'), scattered: oneOf(['none', 'link', 'plus', 'spark', 'arrow'] as const, 'none'),
    opacity: z.coerce.number().min(0).max(100).catch(18),
  }).catch({ header: 'none', scattered: 'none', opacity: 18 }),
  // A brand mark inside a solid shape, used as a hero element (e.g. an app-icon style logo tile).
  badge: oneOf(['none', 'logo'] as const, 'none'),
  // How each reference is arranged, in order. Generation follows these arrangements first, sized to the real copy.
  references: z.preprocess(v => Array.isArray(v) ? v.filter(r => r && typeof r === 'object') : [], z.array(z.object({
    composition: z.enum(COMPOSITIONS).catch('statement'), align: oneOf(['left', 'center', 'right'] as const, 'left'),
    anchor: oneOf(['top', 'center', 'bottom'] as const, 'center'), image: flag,
    imagePos: oneOf(['full', 'top', 'bottom', 'left', 'right', 'center'] as const, 'bottom'), callout: flag, badge: flag,
    // Measured from the reference's pixels: its headline sits in a box. Absent on older studies.
    frame: z.boolean().optional().catch(undefined),
  })).max(30)).catch([]),
})
/**
 * Brand-agnostic design DNA: relationships, roles and behaviour. No hex colors, font names, logos or reference copy.
 * familyRules are the recurring rules, variantRules the flexible rules, avoid the anti-patterns.
 */
export const studySchema = z.object({
  personality: prose(), composition: prose(), spaceDensity: prose(), typography: prose(), colorContrast: prose(),
  colorRoles: z.object({ background: prose(200), foreground: prose(200), accent: prose(200), decoration: prose(200) }).default({}),
  imagery: imageryStrategySchema, decorative: prose(), hierarchy: prose(), logoPlacement: prose(400),
  distinctive: rules, familyRules: rules, variantRules: rules, avoid: rules,
  grammar: grammarSchema.optional(),
})
export const variantSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).max(80), name: z.string().min(1).max(80), role: z.enum(VARIANT_ROLES),
  imageMode: z.enum(VARIANT_IMAGE_MODES).optional(), applicability: z.string().max(600).optional(),
  background: color, nodes: z.array(templateNodeSchema).min(1).max(1600),
}).superRefine((v, ctx) => {
  if (new Set(v.nodes.map(n => n.id)).size !== v.nodes.length) ctx.addIssue({ code: 'custom', message: 'Node IDs must be unique within each variant' })
})
export const referenceSchema = z.object({ id: z.string().min(1).max(100), url: z.string().regex(/^\/(?:api\/uploads\/[a-zA-Z0-9-]+|design-references\/[a-zA-Z0-9_.-]+)$/), name: z.string().max(200), width: z.number().positive(), height: z.number().positive() })
export const familySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).max(100), schemaVersion: z.literal(1), version: z.number().int().positive(),
  name: z.string().trim().min(1).max(100), description: z.string().max(3000), tags: z.array(z.string().max(40)).max(12),
  width: z.number().int().min(320).max(4096), height: z.number().int().min(320).max(4096),
  typography: z.object({ headingFallback: z.string().max(80), bodyFallback: z.string().max(80) }),
  referenceStyle: z.object({
    primary: z.string().regex(/^#[a-fA-F0-9]{6}$/), secondary: z.string().regex(/^#[a-fA-F0-9]{6}$/),
    accent: z.string().regex(/^#[a-fA-F0-9]{6}$/), background: z.string().regex(/^#[a-fA-F0-9]{6}$/),
    textPrimary: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  }).optional(),
  referenceImages: z.array(referenceSchema).min(1).max(30),
  // Variants are reference reconstructions: evidence for review, never the routes generation follows.
  analysis: z.string().max(12000), study: studySchema.optional(), variants: z.array(variantSchema).max(30).default([]),
}).superRefine((family, ctx) => {
  if (new Set(family.variants.map(v => v.id)).size !== family.variants.length) ctx.addIssue({ code: 'custom', message: 'Variant IDs must be unique' })
  for (const variant of family.variants) for (const node of variant.nodes) {
    if (node.type === 'text' && (node.x < 0 || node.y < 0 || node.x + node.width > family.width || node.y + node.height > family.height)) ctx.addIssue({ code: 'custom', message: `${variant.id}/${node.id}: text must stay inside the canvas` })
  }
})
export type TemplateNode = z.infer<typeof templateNodeSchema>
export type DesignVariant = z.infer<typeof variantSchema>
export type GlobalDesignFamily = z.infer<typeof familySchema>
export type ReferenceImage = z.infer<typeof referenceSchema>
export type DesignStudy = z.infer<typeof studySchema>
export type DesignGrammar = z.infer<typeof grammarSchema>
export type Composition = typeof COMPOSITIONS[number]
export type VariantImageMode = typeof VARIANT_IMAGE_MODES[number]
export interface BrandGlobalDesign { id: string; source: 'global'; globalFamilyId: string; globalVersion: number; name: string; tags: string[]; createdAt: string }
export interface GlobalDesignRecord { id: string; status: 'draft' | 'published'; revision: number; draft: GlobalDesignFamily; publishedVersion?: number; deletedAt?: Date; updatedAt: Date }
