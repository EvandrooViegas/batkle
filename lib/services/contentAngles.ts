/**
 * Chooses what the next idea is about, in code, so a brand's ideas explore its whole profile instead of
 * circling one subject. Each idea pairs the least-used content pillar with the least-covered part of the
 * brand (a service, project, differentiator, researched topic or the company itself). No model call.
 */
export const PILLARS = ['Educational', 'Expertise', 'Services', 'Projects / Cases', 'Company', 'Behind the scenes', 'Industry insights', 'Problems and solutions', 'Trust / Credibility', 'Brand positioning'] as const
type FacetKind = 'service' | 'project' | 'differentiator' | 'topic' | 'company'
export interface Facet { kind: FacetKind; label: string; detail: string }
/** `text` is everything the idea talks about (topic, hook, core message, outline), used to spot recurring subjects. */
export interface PastIdea { topic?: string; text?: string; pillar?: string; format?: string; slides?: number; angle?: { pillar?: string; facet?: string } }
export interface CarouselLength { label: 'short' | 'medium' | 'long'; min: number; max: number; use: string }
/** `avoid`: subjects the recent ideas already lean on, which this idea must not bring up again. */
export interface Angle { pillar: string; facet: Facet; format: 'single' | 'carousel'; length?: CarouselLength; avoid?: string[] }

/** Carousel lengths, by slide count including the cover and the closing slide. */
export const CAROUSEL_LENGTHS: Record<CarouselLength['label'], CarouselLength> = {
  short: { label: 'short', min: 3, max: 4, use: 'one sharp insight: the cover, one or two points, then the takeaway' },
  medium: { label: 'medium', min: 5, max: 6, use: 'an explanation, or a problem and its solution, one point per slide' },
  long: { label: 'long', min: 7, max: 9, use: 'a step-by-step process, a checklist or a story told slide by slide' },
}
// Lengths that suit each pillar: a value or a company story is short, a method or a case can run long.
const PILLAR_LENGTHS: Record<string, CarouselLength['label'][]> = {
  Educational: ['medium', 'long'], Expertise: ['medium', 'long'], Services: ['short', 'medium'], 'Projects / Cases': ['medium', 'long'],
  Company: ['short', 'medium'], 'Behind the scenes': ['short', 'medium', 'long'], 'Industry insights': ['short', 'medium'],
  'Problems and solutions': ['short', 'medium', 'long'], 'Trust / Credibility': ['short', 'medium'], 'Brand positioning': ['short', 'medium'],
}

/** A carousel brief's slide plan, one short line per slide (at most 10); a single post has none. */
export function ideaOutline(outline: any, format: string): string[] {
  if (format !== 'carousel' || !Array.isArray(outline)) return []
  return outline.map(s => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 240) : '')).filter(Boolean).slice(0, 10)
}

/** Why a carousel outline needs another try, or null: too short to tell a story, or outside the chosen length. */
export function outlineIssue(outline: string[], length?: CarouselLength): string | null {
  if (outline.length < 3) return 'the carousel needs an outline of 3-10 lines, one per slide, from the hook to the takeaway'
  if (length && (outline.length < length.min || outline.length > length.max)) return `the outline plans ${outline.length} slides; this carousel should have ${length.min}-${length.max} (${length.use})`
  return null
}

export function lengthOf(slides?: number): CarouselLength['label'] | null {
  if (!slides) return null
  return slides <= CAROUSEL_LENGTHS.short.max ? 'short' : slides <= CAROUSEL_LENGTHS.medium.max ? 'medium' : 'long'
}

/**
 * How long the next carousel should be, so a brand's carousels vary instead of always running five slides:
 * a length that suits the pillar, preferring the one its recent carousels used least, then least recently.
 * Deterministic, so it never shifts the random pillar and subject choices.
 */
export function chooseCarouselLength(pillar: string, history: PastIdea[]): CarouselLength {
  const allowed = PILLAR_LENGTHS[pillar] || ['short', 'medium', 'long']
  const recent = history.filter(i => i.slides).slice(0, 6).map(i => lengthOf(i.slides))
  const uses = (label: string) => recent.filter(l => l === label).length
  // Position in the recent list: 0 is the latest carousel; never used counts as longest ago.
  const ago = (label: string) => { const i = recent.indexOf(label as any); return i === -1 ? Infinity : i }
  const fewest = Math.min(...allowed.map(uses))
  const leastUsed = allowed.filter(l => uses(l) === fewest)
  const oldest = Math.max(...leastUsed.map(ago))
  const best = leastUsed.filter(l => ago(l) === oldest)
  return CAROUSEL_LENGTHS[best[history.length % best.length]]
}

// Which parts of the brand each pillar can be built on.
const PILLAR_FACETS: Record<string, FacetKind[]> = {
  Educational: ['topic', 'service'], Expertise: ['service', 'differentiator'], Services: ['service'], 'Projects / Cases': ['project'],
  Company: ['company', 'differentiator'], 'Behind the scenes': ['service', 'project'], 'Industry insights': ['topic', 'service'],
  'Problems and solutions': ['service', 'topic'], 'Trust / Credibility': ['differentiator', 'project'], 'Brand positioning': ['differentiator', 'company'],
}

const text = (value: any) => typeof value === 'string' ? value.trim() : ''
const list = (value: any): any[] => Array.isArray(value) ? value : []

/** The distinct things this brand can talk about, from its saved profile. */
export function brandFacets(brand: any = {}): Facet[] {
  const named = (value: string) => { const [label, ...rest] = value.split(/\s+[—–-]\s+/); return { label: label.slice(0, 90), detail: (rest.join(' — ') || value).slice(0, 300) } }
  const facets: Facet[] = [
    ...list(brand.services).map(text).filter(Boolean).map(s => ({ kind: 'service' as const, ...named(s) })),
    ...list(brand.projects).map((p: any) => typeof p === 'string' ? named(p) : { label: text(p?.name).slice(0, 90), detail: text(p?.description).slice(0, 300) }).filter(p => p.label).map(p => ({ kind: 'project' as const, ...p })),
    ...list(brand.differentiators).map(text).filter(Boolean).map(d => ({ kind: 'differentiator' as const, label: d.slice(0, 90), detail: d.slice(0, 300) })),
    ...list(brand.contentTopics).map(text).filter(Boolean).map(t => ({ kind: 'topic' as const, label: t.slice(0, 90), detail: t.slice(0, 300) })),
  ]
  if (text(brand.about)) facets.push({ kind: 'company', label: 'The company itself: story, values and way of working', detail: text(brand.about).slice(0, 400) })
  return facets
}

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const significant = (value: string) => new Set((fold(value).match(/[a-z0-9]{4,}/g) || []))
/** Shared distinctive words; proper nouns (Facebook, TikTok, project names) survive translation. */
function mentions(topic: string, facet: Facet) {
  const words = significant(topic)
  const names = (facet.label.match(/\b[A-Z][\w-]*[A-Z]?[\w-]*/g) || []).map(fold).filter(n => n.length >= 3 && !['the', 'and', 'how', 'why', 'what'].includes(n))
  if (names.some(n => words.has(n) || fold(topic).includes(n))) return true
  return [...significant(facet.label)].filter(w => words.has(w)).length >= 2
}

// Everyday business acronyms that are not a brand's subject.
const COMMON_ACRONYMS = new Set(['CEO', 'CTA', 'PME', 'SME', 'LDA', 'SA', 'NIF', 'IVA', 'VAT', 'EU', 'UE', 'USA', 'UK', 'FAQ', 'OK'])

/**
 * Named subjects a brand's posts can lean on: acronyms its profile uses more than once (BIM, SEO) and its project
 * names. The brand's own name is never one.
 */
export function brandSubjects(brand: any = {}): string[] {
  const projects = list(brand.projects).map((p: any) => text(typeof p === 'string' ? p.split(/\s+[—–-]\s+/)[0] : p?.name)).filter((n: string) => n.length >= 3)
  const profile = [brand.about, ...list(brand.services), ...list(brand.differentiators), ...list(brand.contentTopics), ...list(brand.projects).map((p: any) => typeof p === 'string' ? p : `${p?.name || ''} ${p?.description || ''}`)].map(v => String(v || '')).join('\n')
  const own = new Set(fold(String(brand.name || '')).match(/[a-z0-9]+/g) || [])
  const counts = new Map<string, number>()
  for (const m of profile.matchAll(/(?<![A-Za-z0-9])[A-Z][A-Z0-9]{1,5}(?![A-Za-z0-9])/g)) counts.set(m[0], (counts.get(m[0]) || 0) + 1)
  const acronyms = [...counts].filter(([term, n]) => n >= 2 && !COMMON_ACRONYMS.has(term) && !own.has(term.toLowerCase())).map(([term]) => term)
  return [...new Set([...acronyms, ...projects.filter(name => fold(name) !== fold(String(brand.name || '')))])]
}

/** Whether text brings up a subject. Acronyms match as written (BIM, OpenBIM), names regardless of case and accents. */
export function mentionsSubject(value: string, subject: string): boolean {
  if (/^[A-Z][A-Z0-9]{1,5}$/.test(subject)) return new RegExp(`(?<![A-Z0-9])${subject}(?![A-Z0-9])`).test(String(value || ''))
  return fold(String(value || '')).includes(fold(subject))
}

/**
 * Subjects most of the brand's recent ideas already mention (at least half of the last few, and at least two),
 * so the next idea and post can be steered to other parts of the brand.
 */
export function recurringSubjects(brand: any, history: PastIdea[], window = 6): string[] {
  const recent = history.slice(0, window).map(i => i.text || i.topic || '').filter(Boolean)
  if (recent.length < 2) return []
  const needed = Math.max(2, Math.ceil(recent.length / 2))
  return brandSubjects(brand).filter(subject => recent.filter(t => mentionsSubject(t, subject)).length >= needed)
}

/** Topic overlap between two ideas written in the same language (0..1). */
export function topicSimilarity(a: string, b: string) {
  const x = significant(a), y = significant(b)
  if (!x.size || !y.size) return 0
  const shared = [...x].filter(w => y.has(w)).length
  return shared / (x.size + y.size - shared)
}

export function chooseAngle(brand: any, history: PastIdea[], random = Math.random): Angle | null {
  const facets = brandFacets(brand)
  if (!facets.length) return null
  const recent = history.slice(0, 12)
  const pick = <T,>(items: T[], score: (item: T) => number) => {
    const best = Math.min(...items.map(score))
    const ties = items.filter(item => score(item) === best)
    return ties[Math.floor(random() * ties.length) % ties.length]
  }
  const pillars = PILLARS.filter(p => facets.some(f => PILLAR_FACETS[p].includes(f.kind)))
  const pillarOf = (idea: PastIdea) => idea.angle?.pillar || idea.pillar || ''
  // The least-used pillar recently; never the same pillar twice in a row when another is available.
  const pillar = pick(pillars.filter(p => pillars.length < 2 || p !== pillarOf(history[0] || {})), p => recent.filter(i => pillarOf(i) === p).length)
  // Parts of the brand built on a subject the recent ideas keep returning to wait their turn.
  const recurring = recurringSubjects(brand, history)
  const about = (facet: Facet) => `${facet.label} ${facet.detail}`
  const leansOn = (facet: Facet) => recurring.some(subject => mentionsSubject(about(facet), subject))
  const usage = (facet: Facet) => history.filter(i => i.angle?.facet ? i.angle.facet === facet.label : mentions(String(i.topic || ''), facet)).length + (leansOn(facet) ? 3 : 0)
  const facet = pick(facets.filter(f => PILLAR_FACETS[pillar].includes(f.kind)), usage)
  // When every option leans on it, the chosen part of the brand may still name its own subject.
  const avoid = recurring.filter(subject => !mentionsSubject(about(facet), subject))
  const formats = recent.slice(0, 6).map(i => i.format)
  const format = formats.filter(f => f === 'carousel').length > formats.filter(f => f === 'single').length + 1 ? 'single' : 'carousel'
  return { pillar, facet, format, length: chooseCarouselLength(pillar, history), ...(avoid.length ? { avoid } : {}) }
}

/** Merges idea history from the client and the saved flow, newest first, one entry per topic. */
export function ideaHistory(...sources: any[][]): PastIdea[] {
  const byKey = new Map<string, PastIdea>(), out: PastIdea[] = []
  for (const source of sources) for (const item of list(source)) {
    const slides = Array.isArray(item?.outline) ? item.outline.length : Number(item?.slides) || undefined
    const said = item && typeof item === 'object' ? [item.topic, item.hook, item.coreMessage, ...list(item.outline)].map(text).filter(Boolean).join(' \n ') : text(item)
    const idea: PastIdea = typeof item === 'string' ? { topic: item, text: item } : item && typeof item === 'object' ? { topic: text(item.topic), text: said, pillar: text(item.pillar), format: text(item.format), ...(slides ? { slides } : {}), angle: item.angle && typeof item.angle === 'object' ? { pillar: text(item.angle.pillar), facet: text(item.angle.facet) } : undefined } : {}
    const key = fold(idea.topic || '')
    if (!key) continue
    const known = byKey.get(key)
    // The same idea from a fuller source (the saved flow, after the client's topic list) adds what it says.
    if (known) { if ((idea.text || '').length > (known.text || '').length) known.text = idea.text; continue }
    byKey.set(key, idea); out.push(idea)
  }
  return out.slice(0, 40)
}
