/**
 * Chooses what the next idea is about, in code, so a brand's ideas explore its whole profile instead of
 * circling one subject. Each idea pairs the least-used content pillar with the least-covered part of the
 * brand (a service, project, differentiator, researched topic or the company itself). No model call.
 */
export const PILLARS = ['Educational', 'Expertise', 'Services', 'Projects / Cases', 'Company', 'Behind the scenes', 'Industry insights', 'Problems and solutions', 'Trust / Credibility', 'Brand positioning'] as const
type FacetKind = 'service' | 'project' | 'differentiator' | 'topic' | 'company'
export interface Facet { kind: FacetKind; label: string; detail: string }
/** `text` is everything the idea talks about (topic, hook, core message, outline), used to spot recurring subjects. */
export interface PastIdea { topic?: string; text?: string; pillar?: string; format?: string; slides?: number; angle?: { pillar?: string; facet?: string }; hookShape?: string; hook?: string }
export interface CarouselLength { label: 'short' | 'medium' | 'long'; min: number; max: number; use: string }
/**
 * `avoid`: subjects the recent ideas already lean on, which this idea must not bring up again.
 * `aside`: cross-cutting terms (a technology or method such as BIM) the facet is not about: the idea may mention them
 * as a detail, never in its topic or hook.
 */
export interface Angle { pillar: string; facet: Facet; format: 'single' | 'carousel'; length?: CarouselLength; avoid?: string[]; aside?: string[] }

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

const ACRONYM = /^[A-Z][A-Z0-9]{1,5}$/
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
  if (ACRONYM.test(subject)) return new RegExp(`(?<![A-Z0-9])${subject}(?![A-Z0-9])`).test(String(value || ''))
  return fold(String(value || '')).includes(fold(subject))
}

/**
 * Subjects the brand's recent ideas keep returning to (a third of the last few, and at least two), so the next idea
 * and post can be steered to other parts of the brand. Half was too late: a profile that names one technology in
 * most of its services kept it in two ideas out of three without ever reaching it.
 */
export function recurringSubjects(brand: any, history: PastIdea[], window = 6): string[] {
  const recent = history.slice(0, window).map(i => i.text || i.topic || '').filter(Boolean)
  if (recent.length < 2) return []
  const needed = Math.max(2, Math.ceil(recent.length / 3))
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
  // A term the profile repeats across many parts (BIM) belongs to the parts about it. Elsewhere it may come up as a
  // detail, never as what the idea is about, or ideas on construction, research or a project all become BIM ideas.
  const aside = brandSubjects(brand).filter(subject => ACRONYM.test(subject) && !avoid.includes(subject) && !mentionsSubject(about(facet), subject))
  const formats = recent.slice(0, 6).map(i => i.format)
  const format = formats.filter(f => f === 'carousel').length > formats.filter(f => f === 'single').length + 1 ? 'single' : 'carousel'
  return { pillar, facet, format, length: chooseCarouselLength(pillar, history), ...(avoid.length ? { avoid } : {}), ...(aside.length ? { aside } : {}) }
}

/** Merges idea history from the client and the saved flow, newest first, one entry per topic. */
export function ideaHistory(...sources: any[][]): PastIdea[] {
  const byKey = new Map<string, PastIdea>(), out: PastIdea[] = []
  for (const source of sources) for (const item of list(source)) {
    const slides = Array.isArray(item?.outline) ? item.outline.length : Number(item?.slides) || undefined
    const said = item && typeof item === 'object' ? [item.topic, item.hook, item.coreMessage, ...list(item.outline)].map(text).filter(Boolean).join(' \n ') : text(item)
    // Ideas from before hook shapes were chosen count as a call-out when their hook opens by addressing the reader.
    const shape = item && typeof item === 'object' ? text(item.hookShape) || (callsOutReader(text(item.hook), text(item.targetAudience)) ? 'callout' : '') : ''
    const idea: PastIdea = typeof item === 'string' ? { topic: item, text: item } : item && typeof item === 'object' ? { topic: text(item.topic), text: said, pillar: text(item.pillar), format: text(item.format), ...(slides ? { slides } : {}), angle: item.angle && typeof item.angle === 'object' ? { pillar: text(item.angle.pillar), facet: text(item.angle.facet) } : undefined, ...(shape ? { hookShape: shape } : {}), ...(text(item.hook) ? { hook: text(item.hook) } : {}) } : {}
    const key = fold(idea.topic || '')
    if (!key) continue
    const known = byKey.get(key)
    // The same idea from a fuller source (the saved flow, after the client's topic list) adds what it says.
    if (known) { if ((idea.text || '').length > (known.text || '').length) known.text = idea.text; continue }
    byKey.set(key, idea); out.push(idea)
  }
  return out.slice(0, 40)
}

// ---- Hooks: how a post (or story) opens ----

/**
 * The ways a hook can open. The model chooses the one that fits each topic (no fixed rotation); it sees how the
 * brand's recent posts opened, so a brand's posts do not all open the same way (an audience call-out on every cover
 * reads like a template). The examples come from other businesses and only show the shape.
 */
export const HOOK_SHAPES = [
  { id: 'scene', label: 'A scene they know', use: 'a short moment from the reader’s day, in the present tense: what they see, hear or do, not who they are', example: 'POV: the kitchen renovation was meant to take three weeks. It’s month four.' },
  { id: 'belief', label: 'A belief to correct', use: 'one plain statement that corrects something people believe about the subject', example: 'A bigger website is not a better website.' },
  { id: 'mistake', label: 'The costly mistake', use: 'the mistake, named plainly, and what it costs', example: 'The most expensive renovation mistake: choosing the tiles before the plan.' },
  { id: 'question', label: 'The question in their head', use: 'the exact question the reader asks themselves, in their own words, not a question that sets up a pitch', example: 'Why does the damp come back every winter?' },
  { id: 'result', label: 'A specific result or count', use: 'what the post delivers, made specific: a count of signs, steps or mistakes, or a concrete outcome, with numbers only from the profile or the slides themselves', example: '4 signs a roof needs work before winter' },
  { id: 'story', label: 'A story that starts mid-way', use: 'the first line of a real situation from the brand’s work (a project, a request, a site), told plainly', example: 'The call came on a Friday: half the ceiling was on the floor.' },
  { id: 'contrast', label: 'Two ways side by side', use: 'two things set against each other in few words: before and after, or the usual way and the better one', example: 'Tiles first, plan later. Or plan first and pay once.' },
  { id: 'callout', label: 'Call out the reader', use: 'name who the post is for and their situation; the only way that opens by addressing the reader', example: 'Landlords who heard about the leak from the tenant downstairs' },
] as const
export type HookShape = typeof HOOK_SHAPES[number]

const openingOf = (hook: string) => (fold(String(hook || '')).match(/[a-z0-9]+/g) || []).slice(0, 3).join(' ')

/**
 * How to open, for the idea prompt: the ways a hook can open (the model picks the one that fits the topic and says
 * which in "hookShape"), and how the brand's recent posts opened, so this one opens differently.
 */
export function hookChoiceBlock(history: PastIdea[]) {
  const recent = history.map(i => i.hook).filter(Boolean).slice(0, 6) as string[]
  const addressed = recent.slice(0, 3).some(h => callsOutReader(h))
  return `HOW TO OPEN (your choice): pick the way in that best fits this topic, and give its id as "hookShape". The examples come from other businesses and only show the shape; never reuse their words.
${HOOK_SHAPES.map(s => `- ${s.id}: ${s.label}: ${s.use}. "${s.example}"`).join('\n')}${recent.length ? `\nThe brand's recent posts opened like this. Open this one differently, in other words and preferably another way in:\n${recent.map(h => `- "${h}"`).join('\n')}` : ''}${addressed ? '\nA recent post already opened by addressing the reader: do not open this one that way.' : ''}`
}

// Short words that never say what a post is about.
const FILLER_WORDS = new Set(['your', 'their', 'with', 'from', 'that', 'this', 'what', 'about', 'para', 'como', 'with', 'sobre', 'mais', 'muito', 'have', 'they', 'sua', 'seu', 'suas', 'seus', 'uma', 'umas', 'pelo', 'pela', 'post', 'posts', 'reader', 'leitor'])

/**
 * Whether the hook says what the model itself says a reader understands from it alone ("hookSubject"): at least one
 * of the subject's words must be in the hook. "Your feed repeats the same post style three days straight." does not
 * contain "content ideas", so it goes back.
 */
export function hookSubjectIssue(hook: string, subject: string): string[] {
  const words = (value: string) => (fold(String(value || '')).match(/[a-z0-9]{4,}/g) || []).filter(w => !FILLER_WORDS.has(w))
  const wanted = words(subject), said = words(hook)
  if (!wanted.length) return []
  return wanted.some(w => said.some(h => h.slice(0, 5) === w.slice(0, 5))) ? [] : [`the hook does not say what the post is about: you said a reader understands "${String(subject).slice(0, 80)}", but none of that is in "${String(hook).slice(0, 80)}"; put the subject in the hook`]
}

/** A hook that repeats how a recent post opened: its first words, or addressing the reader right after one that did. */
export function hookRepeats(hook: string, history: PastIdea[]): string[] {
  const recent = history.map(i => i.hook).filter(Boolean).slice(0, 6) as string[]
  const opening = openingOf(hook)
  const same = opening.split(' ').length >= 2 ? recent.find(h => openingOf(h) === opening) : undefined
  if (same) return [`the hook opens like a recent post ("${String(same).slice(0, 60)}"); open it another way`]
  if (callsOutReader(hook) && recent.slice(0, 3).some(h => callsOutReader(h))) return ['the hook opens by addressing the reader, like a recent post did; open it another way (a moment, a mistake, a belief, a question, a result)']
  return []
}

// Openings that address the reader ("Para donos de restaurantes: …", "If you run a shop, …"), accents folded.
const ADDRESS = /^(para|for|attention|atencao|hey|ola|ei|caro|cara|caros|dear|calling all|se (es|e|tens|tem|esta|estas|trabalha|trabalhas|gere|geres)|if you( are|'re| run| own| have| work| manage)|you( are|'re) (a|an))\b/
// An opening phrase that is a group of people ("Empresas de construção, …", "Construction marketers: …").
const GROUP = /^(\w+ )?(empresas|empresarios|empreendedores|donos|proprietarios|gestores|marketeers?|marketers?|owners|business owners|founders|landlords|senhorios|clientes|lojistas|profissionais|equipas|teams|managers|agencias|agencies|negocios|marcas|brands|criadores|creators|freelancers|startups)\b/

/** Whether a hook opens by naming or addressing its audience ("Construction marketers, …", "Empresas de x, …"). */
export function callsOutReader(hook: string, audience = ''): boolean {
  const opening = fold(String(hook || '').trim())
  if (!opening) return false
  if (ADDRESS.test(opening)) return true
  const lead = opening.match(/^([^,:;.!?—–]{3,60})[,:;—–]\s/)
  if (!lead) return false
  if (GROUP.test(lead[1])) return true
  // The opening phrase repeats the audience's own words.
  const words = lead[1].match(/[a-z]{4,}/g) || []
  const audienceWords = fold(audience).match(/[a-z]{5,}/g) || []
  return audienceWords.some(a => words.some(w => w.slice(0, 5) === a.slice(0, 5)))
}

/** The hook problem the idea and copy checks send back: an audience call-out when the chosen shape is another. */
export function hookIssues(hook: string, shape: string | undefined, audience = ''): string[] {
  if (!shape || shape === 'callout' || !callsOutReader(hook, audience)) return []
  const wanted = HOOK_SHAPES.find(s => s.id === shape)
  return [`the hook opens by naming or addressing who the post is for ("${String(hook).slice(0, 60)}"); open with ${wanted ? wanted.label.toLowerCase() : 'the moment, the problem or the belief'} instead`]
}

// Phrases that make copy read as machine-written, in English and Portuguese.
const AI_TELLS = [
  /\bturns? (?:that|this|your|the|a|an) [^.,;:!?]{2,40} into\b/i, /\btransforma(?:m|r)? (?:o|a|os|as|esse|essa|isso|o seu|a sua|a tua|o teu)\b[^.,;:!?]{0,40}\b(?:em|num|numa|nuns|numas)\b/i,
  /\bthe result(?:\s*[?:]|\s+(?:is|was|are)\b)/i, /(?:^|[.\n]\s*|\bo )resultado(?:\s*[?:]|\s+(?:é|foi|são|foram)(?![\p{L}]))/iu, /\bwant to see (?:it|how)\b/i, /\bquer(?:es)? (?:ver|saber) como\b/i,
  // A question to the reader that only sets up the pitch ("Want to grow your bookings?", "Quer evitar esse erro?").
  /\bwant to [^?.\n]{3,60}\?/i, /\bquer(?:es)? (?!saber como|ver como)[^?.\n]{3,60}\?/i,
  /\bgoes beyond\b/i, /\bvai (?:muito )?além d[eoa]s?\b/i,
  /\bin (?:just )?minutes\b/i, /\bem (?:poucos |apenas )?minutos\b/i, /\bsay goodbye to\b/i, /\bdiga adeus\b/i,
  /\b(?:it'?s|is) not just\b/i, /\bisn'?t just\b/i, /\bnão é (?:apenas|só)\b/i,
  /\bimagine\b/i, /\bgame[- ]?changer\b/i, /\bseamless(?:ly)?\b/i, /\beffortless(?:ly)?\b/i, /\bsem esforço\b/i,
  /\b(?:the )?next level\b/i, /\bpróximo nível\b/i, /\bunlock\b/i, /\bdesbloque\w*/i, /\belevate\b/i, /\bempower\w*/i,
  /\bsupercharge\w*/i, /\bstreamline\w*/i, /\brevolutioni[sz]e\w*/i, /\bin today'?s\b/i, /\bnos dias de hoje\b/i, /\bno mundo (?:atual|digital)\b/i,
  /\blook no further\b/i, /\bwhether you'?re\b/i, /\b(?:instagram|content) gold\b/i,
  // A next step that names nothing: say what to try or ask for, and from whom.
  /\b(?:try|watch|see) (?:the|a|our) demo\b/i, /\bsee how it works\b/i, /\b(?:experimente|veja|conheça) (?:a|o nosso|a nossa) demo\b/i, /\bveja como funciona\b/i,
]

// Machine phrases that come out of a sentence without changing what it says, so they are cut in code instead of
// costing a retry. A sentence opening on "The result is" / "O resultado é" keeps the rest ("The result is clunky
// wording." → "Clunky wording."), and a "want to see it…?" question that only sets up the next line is dropped.
const RESULT_LEAD = /(^|[.!?]["”']?[ \t]+|\n[ \t]*)(?:the result(?:\s+(?:is|was|are|were)(?:\s+that)?|\s*[:?])|o resultado(?:\s+(?:é|foi|são|foram)(?:\s+que)?|\s*[:?]))\s+(\p{L})/giu
const SEE_IT = /(^|[.!?]["”']?[ \t]+|\n[ \t]*)(?:want to see (?:it|how)\b|quer(?:es)? (?:ver|saber) como\b)[^?.!\n]{0,80}\?[ \t]*(\n?)/giu

/** Some copy without the machine phrases that can be cut cleanly; text that would be left empty stays as it is. */
export function cutMachinePhrases(text: string): string {
  const said = String(text ?? '')
  const cut = said
    .replace(RESULT_LEAD, (_whole, before, first) => before + first.toLocaleUpperCase())
    // A question on its own line takes its line break with it.
    .replace(SEE_IT, (_whole, before, after) => (before.includes('\n') || !before ? before : before + after))
    .replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return cut ? cut : said
}

// Claims that something grew or improved, with no figure (so the figure check misses them): "cresceram
// significativamente", "a significant increase in bookings".
const RESULT_CLAIMS = [
  /\b(?:aument(?:o|ou|aram|ar)|cresc(?:eu|eram|imento)|subi(?:u|ram)|duplic(?:ou|aram)|multiplic(?:ou|aram))\b[^.\n]{0,50}\b(?:significativ\w*|consideravelmente|exponencial\w*|muito|imenso)\b/iu,
  /\b(?:significativ\w*|consideráve\w*|grande) (?:aumento|crescimento|subida)\b/iu,
  /\b(?:significant(?:ly)?|dramatic(?:ally)?|massive(?:ly)?) (?:increase[sd]?|grow(?:th|n)?|boost(?:ed)?|rise|more)\b/i, /\b(?:grew|increased|doubled|tripled|skyrocketed|soared)\b[^.\n]{0,40}\b(?:significantly|dramatically|considerably)\b/i,
]

/** Result claims without figures in some copy (at most four), unless the brand's own facts make the same claim. */
export function resultClaims(texts: unknown[], facts = ''): string[] {
  const found = new Set<string>()
  for (const value of texts) {
    const said = String(value || '')
    for (const claim of RESULT_CLAIMS) { const match = said.match(claim); if (match && !fold(facts).includes(fold(match[0]))) found.add(match[0].trim().toLowerCase()) }
  }
  return [...found].slice(0, 4)
}

// Offers a business has to honour: something free, or a guarantee ("crescimento garantido"). "Garantimos que" (we
// make sure that) is everyday Portuguese, not a guarantee, so only the explicit forms count.
const PROMISES = [
  { kind: 'free', claim: /(?<!\p{L})(?:grátis|gratuit[oa]s?|free of charge|for free|free)(?!\p{L})/iu },
  { kind: 'guarantee', claim: /(?<!\p{L})(?:garantid[oa]s?|garantia de|guaranteed|money[- ]back)(?!\p{L})/iu },
]

/** Free offers and guarantees in some copy that the brand's own facts never make. */
export function unbackedPromises(texts: unknown[], facts = ''): string[] {
  const found = new Set<string>()
  for (const { claim } of PROMISES) {
    if (claim.test(facts)) continue
    for (const value of texts) { const match = String(value || '').match(claim); if (match) found.add(match[0].toLowerCase()) }
  }
  return [...found]
}

/** The machine-sounding phrases in some copy, as found (at most six), for the copy checks to send back. */
export function aiTells(texts: unknown[]): string[] {
  const found = new Set<string>()
  for (const value of texts) {
    const said = String(value || '')
    for (const tell of AI_TELLS) { const match = said.match(tell); if (match) found.add(match[0].trim().toLowerCase()) }
  }
  return [...found].slice(0, 6)
}
