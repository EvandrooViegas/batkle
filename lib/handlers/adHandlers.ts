import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import Groq from 'groq-sdk'
import { availableGroqCompletion } from '@/lib/services/ai/availableGroqCompletion'
import { compactBrand } from '@/lib/services/ai/requestBudget'
import { loadGenerationBrandContext, EXTRACTED_CONTEXT_RULES } from '@/lib/services/generationBrandContext'
import { postLanguage, languageIssues, modernPortuguese } from '@/lib/services/contentLanguage'
import { inventedFigures } from '@/lib/services/copyFacts'
import { brandSubjects, mentionsSubject } from '@/lib/services/contentAngles'
import { persistInlineImages } from '@/lib/services/persistInlineImages'
import { ensureBrandLogoVariants } from '@/lib/services/brandLogoVariants'
import { chooseBrandFamily, renderGlobalPost } from '@/lib/designs/global/generation'
import { hydrateBrandFamilies } from '@/lib/designs/global/store'
import { familyGrammar, familyImagery } from '@/lib/designs/global/study'
import { toStoryCanvas } from '@/lib/designs/global/story'
import { chargeCredits, findCharge, grantExtraCredits, refundCharge, requireFeature, settleCharge } from '@/lib/billing/account'
import { requireOwnBrands } from '@/lib/auth'
import { sanitizeDesignPlan } from './postPlanHandler'
import { planAssets } from './assetPlannerHandler'
import { AD_ANGLES, AD_PLACEMENTS, AD_TEXT_LIMITS, AD_VARIANTS, CREATIVE_LIMITS, META_CTAS, STORY_SAFE, isMetaCta, objectiveById, placementById, readPlacements } from '@/lib/ads/meta'

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })
const text = (value: unknown, max = 600) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')
/** Text that keeps its line breaks (a primary text written in short lines). */
const lines = (value: unknown, max = 2000) => (typeof value === 'string' ? value.split(/\n+/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, max) : '')
const words = (value: string) => value.split(/\s+/).filter(Boolean).length
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * A model call that waits out a rate-limit cooldown once (up to `maxWait` seconds) instead of failing the ad. Groq's
 * free tier allows 8,000 tokens a minute, about one ad call, so the second and third calls often wait.
 */
async function patiently<T>(call: () => Promise<T>, maxWait = 30): Promise<T> {
  try { return await call() }
  catch (error: any) {
    const wait = Number(error?.headers?.['retry-after'])
    if (error?.status !== 429 || !(wait > 0 && wait <= maxWait)) throw error
    await pause(wait * 1000 + 250)
    return call()
  }
}

/** What the person asked for, cleaned: the offer is required, everything else falls back to sensible defaults. */
export function readAdBrief(body: any) {
  const brief = body?.brief && typeof body.brief === 'object' ? body.brief : {}
  const offer = text(brief.offer, 600)
  if (offer.length < 3) throw httpError(400, 'Say what the ad promotes: a service, a product or an offer.')
  const objective = objectiveById(brief.objective)
  const url = text(brief.url, 300)
  if (url && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(url)) throw httpError(400, 'The link must start with http:// or https://.')
  return {
    offer, objective: objective.id, audience: text(brief.audience, 300),
    // A reason to act now that the business really offers (a free first visit, a launch price): never made up.
    incentive: text(brief.incentive, 200), url,
    cta: isMetaCta(brief.cta) ? brief.cta : objective.cta,
    placements: readPlacements(brief.placements),
    designId: typeof brief.designId === 'string' && brief.designId.startsWith('global-') ? brief.designId : undefined,
  }
}
export type AdBrief = ReturnType<typeof readAdBrief>

// Marketing filler that makes an ad read like every other ad; one of them is already a weaker ad.
const FILLER = /(?<!\p{L})(discover|unlock|elevate|transform\w*|revolutioni[sz]e|game[- ]changer|don'?t miss|next level|click( here)?|learn more|find out more|descubra|saiba mais|transforme|eleve|potencie|impulsione|alavanque|garanta já|não perca|soluções inovadoras|solicite já|clique( aqui| para)?|descubre|no te pierdas|haz clic)(?!\p{L})/giu

// Headlines asked for: more than Meta's three, so the ones over the limit or with filler can be left out, never cut.
const HEADLINE_CANDIDATES = 5

// Limits every draft keeps, for the copywriter and for the review.
const LIMITS = `Primary text 1 at most ${AD_TEXT_LIMITS.primaryText} characters; 2 and 3 at most ${AD_TEXT_LIMITS.primaryTextMax}, their first line within ${AD_TEXT_LIMITS.primaryText}. Headlines at most ${AD_TEXT_LIMITS.headline} characters. Description at most ${AD_TEXT_LIMITS.description}. On the image: hook at most ${CREATIVE_LIMITS.headline} words, badge ${CREATIVE_LIMITS.label}, supporting line ${CREATIVE_LIMITS.supportingText}, call to action ${CREATIVE_LIMITS.cta}. The button is exactly one of: ${META_CTAS.join(', ')}.`

const SYSTEM_PROMPT = `You are a direct-response copywriter writing Meta ads (Facebook and Instagram) for a business: the text around the ad and the few words on its image.
People see the ad between their friends' posts, not looking for this business. The first words decide whether the right person stops.

PLAN THE AD FIRST (the "plan" in the JSON), then write every line from it:
* reader: one kind of person, as specific as the brief and the profile allow (a barbershop owner, a landlord of an older building), never "businesses" or "people who want to grow".
* moment: the situation in which they need this (the phone ringing during a haircut, damp coming back every winter).
* service: the ONE service or product the ad sells. When the brief is broad ("our services", "my marketing"), pick the single service from the profile that best fits the goal and build the whole ad on it; never list everything the business does.
* proof: one real proof point from PROOF YOU MAY USE that backs that service (a named client or project, a credential, years of work), or none.
* action: what the reader does next, matching the button. When the brief gives a reason to act now, use it as given; never invent one.

WHAT MAKES THE AD WORK
* Specific beats clever: if a competitor could run a line unchanged, rewrite it with what only this business can say (the service, the kind of client, the place, the named project).
* The reader's gain before the company: what changes for them (bookings while they work, calls from the right clients), never how the company describes itself (data-driven, tailored, innovative, quality, solutions, strategies, growth, visibility, excellence, commitment).
* Concrete words: places, objects, moments and facts from the profile.
* Plain spoken sentences and short words, the way the business would say it to a customer face to face, written by a native speaker of the output language: correct agreement, one form of address all through, no literal translation.
* Never marketing filler, in any language: discover, unlock, elevate, transform, revolutionise, game-changer, don't miss, next level, learn more; in Portuguese never descubra, saiba mais, transforme, eleve, potencie, impulsione, alavanque, garanta já, não perca, soluções inovadoras, solicite já. No line ends with an invitation to "learn more": the button does that.

Return ONLY this JSON object:
{
  "plan": { "reader": "...", "moment": "...", "service": "...", "proof": "... or none", "action": "..." },
  "primaryText": [${AD_VARIANTS} versions, in this order:
    1. ${AD_ANGLES[0].label}: at most ${AD_TEXT_LIMITS.primaryText} characters; ${AD_ANGLES[0].use}.
    2. ${AD_ANGLES[1].label}: ${AD_ANGLES[1].use}, separated by \\n. Its first line alone, within ${AD_TEXT_LIMITS.primaryText} characters, makes the right reader stop (Meta cuts the rest behind "See more"). At most ${AD_TEXT_LIMITS.primaryTextMax} characters.
    3. ${AD_ANGLES[2].label}: ${AD_ANGLES[2].use}, separated by \\n. First line within ${AD_TEXT_LIMITS.primaryText} characters. At most ${AD_TEXT_LIMITS.primaryTextMax} characters.],
  "headlines": [${HEADLINE_CANDIDATES} versions, best first, each a complete phrase of at most ${AD_TEXT_LIMITS.headline} characters with its point in the first ${AD_TEXT_LIMITS.headlineVisible}; each from a different angle (the outcome, the offer, the proof, the reader or place, the objection answered), never the company name alone],
  "description": "at most ${AD_TEXT_LIMITS.description} characters: a proof point, or what makes acting easy (such as no obligation), or empty",
  "cta": "the button under the image, exactly one of: ${META_CTAS.join(', ')}",
  "creative": {
    "headline": "the hook on the image, at most ${CREATIVE_LIMITS.headline} words: the reader's outcome, their problem as a question, or the offer. The right reader knows in one second it is for them",
    "label": "a badge of at most ${CREATIVE_LIMITS.label} words: the offer or the service",
    "supportingText": "at most ${CREATIVE_LIMITS.supportingText} words: the proof or the turn; empty when the hook says it all",
    "cta": "at most ${CREATIVE_LIMITS.cta} words on the image: the same action as the button, in the output language"
  },
  "image": { "subject": "one concrete, realistic photo subject in English that shows the offer or its result: no text, logos or brand marks", "queries": ["2-4 word English stock search", "alternative wording"] }
}

SHAPES THAT WORK (other businesses, in English, to show the shape only; never reuse their words; write about this brand in the output language):
* Short primary text: "Landlords in Porto: a leaking roof costs more every week it waits. Free inspection, no obligation."
* Problem → answer: "The tenant called about the damp again.\\nWe find where the water comes in and fix it at the source.\\n200 roofs repaired across Porto since 2015.\\nBook a free inspection this week."
* Proof first: "We restored the façade of the Porto city library.\\nNow we take on homes and small buildings too.\\nAsk for a quote: we visit, measure and explain every step."
* Image hooks: "Is your roof ready for winter?", "Your kitchen, finished in 3 weeks", "A free plan for your garden"
* Headlines: "Free roof inspection in Porto", "Quote after one visit"
* Weak, because any business could say it → stronger, because only one could: "Boost your online visibility" → "Bookings while you cut hair"; "Data-driven decisions" → "The booking site behind Studio Lume"; "Tailored digital marketing" → "Facebook ads for local salons"; "Quality solutions for your home" → "Damp walls fixed at the source"

RULES
* Facts only from the brand profile and the brief. Never invent prices, discounts, deadlines, figures, results, guarantees, awards, durations or client names; the examples' numbers are not facts about this brand.
* A named client or project proves only what the profile says was done for it ("we built Studio Lume's booking site"); never claim a result for it (more bookings, more sales) that the profile does not state.
* Call something free only when the brief or the profile says that exact thing is free: a free quote is not a free assessment or a free visit.
* A reason to act now (a price, a date, a free first visit) only when the brief's "reasonToActNow" gives it; without one, the next step itself is the offer (ask for a quote, book a call).
* Never "click" or "clique": Meta's button under the image is the next step.
* Meta's ad policies: never assert or imply the reader's personal attributes (health, finances, age, religion, identity: not "Are you struggling with debt?"), no before-and-after or exaggerated claims, no ALL CAPS words, no clickbait.
* At most one emoji in a primary text version, none in headlines, the description or the image words. No hashtags. At most one exclamation mark in the whole ad.
* The image words never repeat the primary text word for word.`

const REVIEW_PROMPT = `You are the creative director who approves Meta ads (Facebook and Instagram) before they run. A copywriter drafted the ad below. Make it as strong as the facts allow, then return it.

Read every line and rewrite each one that fails a check:
1. Specific: if a competitor could run the line unchanged, it fails. Use what only this business can say: the one service the ad is about, the kind of client, the place, a named project, a fact from the profile.
2. One reader, one moment: it speaks to one kind of person in a situation they recognise, not to "businesses" or "everyone who wants to grow".
3. The reader's gain: what changes for them, in their words; never what the company calls itself (data-driven, tailored, innovative, quality, solutions, strategies, growth, visibility).
4. Native: it reads as if a native speaker of the output language wrote it to a customer. Correct agreement (a plural subject with a plural verb), one form of address all through, natural word order, no literal translation, no English a local would not use.
5. Headlines: each a complete phrase that makes sense alone under the image, its point in the first ${AD_TEXT_LIMITS.headlineVisible} characters; together they differ in angle (outcome, offer, proof, reader or place, objection), not just in words. Best first.
6. Primary texts: the first line makes the right reader stop; no line ends with an invitation to "learn more" or "find out" (the button does that); the three open differently.
7. The image hook is readable in one second and works without the text around the ad; every line on the image is a complete phrase on its own ("Studio Lume já tem" is not: say what it has).
8. Never marketing filler: discover, unlock, elevate, transform, boost, don't miss, learn more; descubra, saiba mais, transforme, eleve, potencie, impulsione, alavanque, não perca, solicite já.
9. Claims: a named client or project proves only what the profile says was done for it; remove any result claimed for it (more bookings, more sales, more traffic) that the profile does not state, and say what was done instead.
Keep what already passes. Never add facts, figures, prices, discounts, deadlines, guarantees or "free" offers that the profile or the brief do not state.

Limits: ${LIMITS}

Return ONLY the full JSON object, in the draft's shape, with every field.`

// Sentences that only point at the button ("Saiba mais.", "Descubra como.", "Clique para saber mais."): Meta's button
// under the image already does that, so they go, and a draft is never asked again for one.
const POINTER = /(?<!\p{L})(saiba mais|saber mais|descubra (como|mais)|cliqu?e|clica|learn more|find out (how|more)|click|discover how|haz clic|descubre (cómo|más)|más información)(?!\p{L})/iu
export function dropPointers(value: string) {
  const kept = value.split('\n').map(line => line.split(/(?<=[.!?…])\s+/).filter(sentence => !POINTER.test(sentence)).join(' ').trim()).filter(Boolean).join('\n')
  return kept || value
}

const fitsHeadline = (h: string) => h.length <= AD_TEXT_LIMITS.headline && !new RegExp(FILLER.source, 'iu').test(h)

/**
 * Meta's headlines from the candidates: the ones within the limit and free of filler (Meta takes fewer than three), never
 * cut short. Only when fewer than two fit do the others come along, for the checks to send back.
 */
export function pickHeadlines(values: unknown): string[] {
  const all = [...new Set((Array.isArray(values) ? values : []).map((v: any) => text(v, 400)).filter(Boolean))]
  const fitting = all.filter(fitsHeadline)
  return (fitting.length >= 2 ? fitting : [...fitting, ...all.filter(h => !fitsHeadline(h))]).slice(0, AD_VARIANTS)
}

// Short words a cut line must not end on ("Orçamento sem compromisso para").
const DANGLING = new Set(['a', 'o', 'as', 'os', 'ao', 'à', 'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'no', 'na', 'nos', 'nas', 'para', 'por', 'com', 'sem', 'um', 'uma', 'que', 'sua', 'seu', 'suas', 'seus', 'nossa', 'nosso', 'mais', 'the', 'an', 'of', 'for', 'to', 'and', 'with', 'in', 'on', 'at', 'your', 'our', 'more', 'el', 'la', 'los', 'las', 'del', 'y', 'con', 'un', 'su', 'tu'])

/** Characters past a limit are cut at the last whole word, never mid-word, and never on a dangling short word. */
export function fitChars(value: string, max: number) {
  if (value.length <= max) return value
  let cut = value.slice(0, max + 1).replace(/\s+\S*$/, '')
  for (let words = cut.split(/\s+/); words.length > 1 && (DANGLING.has(words[words.length - 1].toLowerCase()) || /^[–—-]$/.test(words[words.length - 1])); words.pop()) cut = words.slice(0, -1).join(' ')
  cut = cut.replace(/[\s,;:–—-]+$/, '').trim()
  return cut || value.slice(0, max)
}

/**
 * Terms the brand's profile repeats everywhere (an acronym such as BIM) that the brief does not mention: the ad is about
 * its offer, so they stay out of its headlines and the words on the image, as posts keep them out of theirs.
 */
export function asideTerms(brand: any, brief: { offer: string; audience: string }) {
  const profile = JSON.stringify(brand || {})
  // An acronym written mostly after a capitalised word ("Barber PH") is part of a client's name: proof, not a subject.
  const inName = (term: string) => {
    const all = profile.match(new RegExp(`(?<![\\p{L}\\d])${term}(?![\\p{L}\\d])`, 'gu'))?.length || 0
    const named = profile.match(new RegExp(`\\p{Lu}\\p{Ll}+ ${term}(?![\\p{L}\\d])`, 'gu'))?.length || 0
    return all > 0 && named * 2 >= all
  }
  return brandSubjects(brand).filter(subject => /^[A-Z][A-Z0-9]{1,5}$/.test(subject) && !inName(subject) && !mentionsSubject(`${brief.offer} ${brief.audience}`, subject))
}

/**
 * The profile's proof points, handed to the copywriter by name: its projects, its differentiators and the sentences of
 * its description that carry a fact (a licence, years, work done). Only these may back a claim.
 */
export function proofPoints(brand: any): string[] {
  const projects = (Array.isArray(brand?.projects) ? brand.projects : []).map((p: any) => (typeof p === 'string' ? p : [p?.name, p?.description].filter(Boolean).join(': '))).filter(Boolean)
  const differentiators = (Array.isArray(brand?.differentiators) ? brand.differentiators : []).filter((d: any) => typeof d === 'string')
  const facts = String(brand?.about || '').split(/(?<=[.!?])\s+/).filter(s => /\d|licen|alvar|certif|award|prémio|since|desde|years|anos|projects|projetos|clients|clientes/i.test(s))
  return [...projects.slice(0, 4), ...facts.slice(0, 3), ...differentiators.slice(0, 3)].map(s => text(s, 220)).filter(Boolean)
}

/** Problems a draft has, for one retry; the second answer is fitted to the limits instead of failing. */
export function adCopyIssues(ad: any, languageRules: any, factSource: string, aside: string[] = []): string[] {
  const issues: string[] = []
  const versions = (Array.isArray(ad?.primaryText) ? ad.primaryText : []).map((t: any) => dropPointers(lines(t))).filter(Boolean)
  // Only the headlines that would be kept are checked: a candidate left out cannot spoil the ad.
  const headlines = pickHeadlines(ad?.headlines)
  if (versions.length < AD_VARIANTS) issues.push(`primaryText must have ${AD_VARIANTS} versions (${AD_ANGLES.map(a => a.label).join(', ')})`)
  if (!headlines.length) issues.push('headlines must list the versions')
  if (!text(ad?.creative?.headline)) issues.push('creative.headline is missing')
  versions.forEach((t: string, i: number) => {
    const max = i === 0 ? AD_TEXT_LIMITS.primaryText : AD_TEXT_LIMITS.primaryTextMax
    if (t.length > max) issues.push(`primary text ${i + 1} has ${t.length} characters; the limit is ${max}`)
    const first = t.split('\n')[0]
    if (i > 0 && first.length > AD_TEXT_LIMITS.primaryText) issues.push(`the first line of primary text ${i + 1} has ${first.length} characters; it must stop the reader within ${AD_TEXT_LIMITS.primaryText}`)
  })
  for (const t of headlines) if (t.length > AD_TEXT_LIMITS.headline) issues.push(`a headline has ${t.length} characters; the limit is ${AD_TEXT_LIMITS.headline}`)
  if (text(ad?.description, 400).length > AD_TEXT_LIMITS.description) issues.push(`the description is over ${AD_TEXT_LIMITS.description} characters`)
  if (words(text(ad?.creative?.headline)) > CREATIVE_LIMITS.headline) issues.push(`creative.headline has more than ${CREATIVE_LIMITS.headline} words`)
  if (words(text(ad?.creative?.cta)) > CREATIVE_LIMITS.cta) issues.push(`creative.cta has more than ${CREATIVE_LIMITS.cta} words`)
  if (!isMetaCta(ad?.cta)) issues.push(`cta must be one of ${META_CTAS.join(', ')}`)
  // An on-image call to action that only points at the button is left out (normalizeAdCopy), so it is not checked.
  const imageCta = POINTER.test(text(ad?.creative?.cta)) ? '' : ad?.creative?.cta
  const readerText = [...versions, ...headlines, ad?.description, ad?.creative?.headline, ad?.creative?.supportingText, ad?.creative?.label, imageCta].map(t => lines(t)).filter(Boolean)
  const filler = [...new Set(readerText.join('\n').match(FILLER) || [])]
  if (filler.length) issues.push(`it uses marketing filler (${filler.slice(0, 4).join(', ')}); say the concrete thing instead`)
  const mixed = languageIssues(readerText, languageRules)
  if (mixed.length) issues.push(`language: ${mixed.join('; ')}`)
  const invented = inventedFigures(readerText, factSource)
  if (invented.length) issues.push(`it states figures that are not in the brand profile or brief (${invented.slice(0, 5).join(', ')}); remove them`)
  // A guarantee is a promise the business must keep: only one the profile or brief makes.
  const GUARANTEE = /(?<!\p{L})(garant(ia|ido|ida|idos|idas|imos|e|em)|guarantee[ds]?|guaranteed|garantizad[oa]s?)(?!\p{L})/iu
  if (readerText.some(t => GUARANTEE.test(t)) && !GUARANTEE.test(factSource)) issues.push('it promises a guarantee the brand profile does not give; say what the business does instead')
  // "Free" is an offer too: only one the profile or the brief makes.
  const FREE = /(?<!\p{L})(grátis|gratuit[oa]s?|free|gratis|gratuit[ao]s?)(?!\p{L})/iu
  if (readerText.some(t => FREE.test(t)) && !FREE.test(factSource)) issues.push('it calls something free that the brand profile and the brief never say is free; offer the next step without calling it free')
  // Three versions that all end on the same line read as one ad three times.
  const endings = versions.map((t: string) => t.split(/\n|(?<=[.!?])\s+/).filter(Boolean).at(-1)?.toLowerCase().replace(/[^\p{L}\d ]/gu, '').trim()).filter(Boolean)
  if (endings.length > 1 && new Set(endings).size < endings.length) issues.push('two or more primary texts end with the same line; end each one differently')
  const headings = [...headlines, ad?.creative?.headline, ad?.creative?.label].map(t => text(t, 400)).filter(Boolean)
  const offTopic = aside.filter(term => headings.some(h => mentionsSubject(h, term)))
  if (offTopic.length) issues.push(`a headline or the image words name ${offTopic.join(', ')}, which the brief is not about; keep ${offTopic.join(', ')} out of them (the primary text may mention it)`)
  return issues
}

/**
 * The ad's copy, fitted to Meta's limits, in the post's language. Written copy also loses its lines that only point at
 * the button and the headlines that do not fit; the person's own edits (`edited`) are only fitted.
 */
export function normalizeAdCopy(ad: any, brief: AdBrief, languageCode: string, edited = false) {
  // Portuguese in its current spelling (AO90), as posts are.
  const spell = (value: string) => (/^pt/i.test(languageCode || '') ? modernPortuguese(value) : value)
  const uniq = (values: string[]) => [...new Set(values.filter(Boolean))].slice(0, AD_VARIANTS)
  const firstWords = (value: unknown, count: number, max = 400) => spell(text(value, max).split(/\s+/).slice(0, count).join(' '))
  const primary = (Array.isArray(ad?.primaryText) ? ad.primaryText : []).map((v: any, i: number) => spell(fitChars(edited ? lines(v) : dropPointers(lines(v)), i === 0 ? AD_TEXT_LIMITS.primaryText : AD_TEXT_LIMITS.primaryTextMax)))
  const picked = edited ? [...new Set((Array.isArray(ad?.headlines) ? ad.headlines : []).map((v: any) => text(v, 400)).filter(Boolean))] as string[] : pickHeadlines(ad?.headlines)
  const fitting = edited ? [] : picked.filter(fitsHeadline)
  return {
    primaryText: uniq(primary),
    headlines: uniq((fitting.length ? fitting : edited ? picked : picked.slice(0, 1)).map(v => spell(fitChars(v, AD_TEXT_LIMITS.headline)))),
    description: spell(fitChars(text(ad?.description, 400), AD_TEXT_LIMITS.description)),
    cta: isMetaCta(ad?.cta) ? ad.cta : brief.cta,
    creative: {
      headline: firstWords(ad?.creative?.headline, CREATIVE_LIMITS.headline),
      supportingText: firstWords(ad?.creative?.supportingText, CREATIVE_LIMITS.supportingText),
      label: firstWords(ad?.creative?.label, CREATIVE_LIMITS.label, 80),
      // "Saiba mais" on the image only repeats Meta's button under it.
      cta: POINTER.test(text(ad?.creative?.cta)) ? '' : firstWords(ad?.creative?.cta, CREATIVE_LIMITS.cta, 60),
    },
    image: text(ad?.image?.subject) ? { subject: text(ad.image.subject, 300), queries: (Array.isArray(ad.image.queries) ? ad.image.queries : []).map((q: any) => text(q, 80)).filter(Boolean).slice(0, 3) } : null,
  }
}
export type AdCopy = ReturnType<typeof normalizeAdCopy>

/**
 * The creative director's pass over the draft: what the checks found is fixed first, then generic, foreign-sounding or
 * repeated lines are rewritten. The review is kept only when it breaks no more rules than the draft did, and never with
 * an invented figure; otherwise the draft is.
 */
async function reviewAdCopy(groq: any, completion: typeof availableGroqCompletion, draft: any, problems: string[], context: { prompt: string; language: any; factSource: string; aside: string[]; maxWait: number }) {
  console.info('[ai-call] service=groq purpose=meta-ad-review')
  try {
    const response = await patiently(() => completion(groq, {
      messages: [
        { role: 'system', content: REVIEW_PROMPT + '\n\n' + EXTRACTED_CONTEXT_RULES + '\n\n' + context.language.rules },
        { role: 'user', content: `${context.prompt}\n\nDRAFT:\n${JSON.stringify(draft)}${problems.length ? `\n\nTHE CHECKS FOUND (fix these first):\n${problems.map(p => `- ${p}`).join('\n')}` : ''}` },
      ],
      max_tokens: 5000, temperature: 0.4,
    }, 'GROQ_AD_COPY_MODEL'), context.maxWait)
    const raw = String(response.choices?.[0]?.message?.content || '')
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    const reviewed = { ...draft, ...parsed, creative: { ...draft.creative, ...parsed?.creative }, image: parsed?.image?.subject ? parsed.image : draft.image }
    const issues = adCopyIssues(reviewed, context.language, context.factSource, context.aside)
    if (issues.length) console.info(`[ads] the review missed: ${issues.join('; ').slice(0, 600)}`)
    return issues.some(i => i.startsWith('it states figures')) || issues.length > problems.length ? null : reviewed
  } catch (error: any) {
    console.warn('[ads] the review was skipped:', error?.message)
    return null
  }
}

// Problems that leave no usable draft, so the copywriter is asked again before any review.
const STRUCTURAL = /^(primaryText must have|headlines must list|creative\.headline is missing|it states figures)/

/**
 * The ad's copy: a draft, then the creative director's review, which also fixes what the checks found. The copywriter
 * is asked again only for a draft with nothing usable, or when the review cannot fix it; within about 70 seconds, so
 * the plan answers within the route's 120 (Groq's free tier makes the second and third calls wait).
 */
export async function writeAdCopy(brandContext: any, brief: AdBrief, completion = availableGroqCompletion) {
  const started = Date.now()
  const elapsed = () => (Date.now() - started) / 1000
  const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_2
  if (!apiKey) throw httpError(500, 'GROQ_API_KEY is not configured')
  const groq = new Groq({ apiKey, maxRetries: 0 })
  const language = postLanguage(brandContext)
  const brandJson = JSON.stringify(compactBrand(brandContext))
  const objective = objectiveById(brief.objective)
  const factSource = `${brandJson} ${brief.offer} ${brief.audience} ${brief.incentive}`
  const aside = asideTerms(brandContext, brief)
  const asideRule = aside.length ? ` This ad is about what the brief promotes, not about ${aside.join(', ')}: keep ${aside.length > 1 ? 'them' : 'it'} out of the headlines and the image words.` : ''
  const proof = proofPoints(brandContext)
  const proofList = proof.length ? proof.map(p => `- ${p}`).join('\n') : '- none: rely on the service itself, never invent proof'
  const briefJson = JSON.stringify({ promote: brief.offer, objective: `${objective.label}: ${objective.goal}`, audience: brief.audience || 'the brand’s ideal customers (see the profile)', reasonToActNow: brief.incentive || null, button: brief.cta, link: brief.url || null })
  const rules = `The brief's words are the person's own: facts they state about their business may be used. Use the button "${brief.cta}" unless another one in the list clearly fits better.${asideRule}\n\n${language.rules}`
  const userPrompt = `BRAND PROFILE (English research notes; facts only):\n${brandJson}\n\nPROOF YOU MAY USE (from the profile; pick the one that best backs this offer):\n${proofList}\n\nAD BRIEF:\n${briefJson}\n\n${rules}`
  // The review reads less than the copywriter: the services, the proof and the brief, so its call fits the token budget.
  const services = (Array.isArray(brandContext?.services) ? brandContext.services : []).map((s: any) => text(typeof s === 'string' ? s : [s?.name, s?.description].filter(Boolean).join(': '), 240)).filter(Boolean).slice(0, 6)
  const reviewPrompt = `BRAND: ${brandContext?.name || 'the business'}\nSERVICES (English research notes):\n${services.map((s: string) => `- ${s}`).join('\n') || '- see the draft'}\n\nPROOF YOU MAY USE:\n${proofList}\n\nAD BRIEF:\n${briefJson}\n\n${rules}`
  const review = (candidate: any, found: string[]) => reviewAdCopy(groq, completion, candidate, found, { prompt: reviewPrompt, language, factSource, aside, maxWait: Math.max(0, Math.min(45, 75 - elapsed())) })
  let feedback = '', draft: any = null, problems: string[] = [], reviewed: any = null, reviewTried = false
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt && draft && elapsed() > 70) break
    console.info(`[ai-call] service=groq purpose=meta-ad-copy attempt=${attempt + 1}`)
    let response: any
    try {
      response = await patiently(() => completion(groq, {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT + '\n\n' + EXTRACTED_CONTEXT_RULES + '\n\n' + language.rules },
          { role: 'user', content: userPrompt + (feedback ? `\n\nThe previous attempt was rejected: ${feedback}. Return a corrected JSON object.` : '') },
        ],
        // Reasoning models spend part of the budget thinking; a short one ends before the JSON does. The retry drops
        // JSON mode, which Groq answers with json_validate_failed when that happens, and reads the object from the text.
        ...(attempt ? {} : { response_format: { type: 'json_object' } }), max_tokens: attempt ? 6000 : 4500, temperature: attempt ? 0.5 : 0.8,
      }, 'GROQ_AD_COPY_MODEL'))
    } catch (error: any) {
      const code = error?.error?.error?.code || error?.error?.code || error?.code
      if (attempt === 0 && code === 'json_validate_failed') { feedback = 'the response was not valid JSON'; continue }
      if (draft) break
      throw error
    }
    let parsed: any
    const raw = String(response.choices?.[0]?.message?.content || '')
    try { parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) }
    catch { feedback = 'the response was not valid JSON'; continue }
    const issues = adCopyIssues(parsed, language, factSource, aside)
    if (issues.length) console.info(`[ads] draft ${attempt + 1} missed: ${issues.join('; ').slice(0, 600)}`)
    // Invented figures are never kept: a missing ad is better than a false claim in one.
    const invented = issues.some(i => i.startsWith('it states figures'))
    if (!invented && (!draft || issues.length < problems.length)) { draft = parsed; problems = issues }
    if (!issues.length) break
    feedback = issues.join('; ')
    // A usable draft goes to the review, which fixes the rest in one call; only when it cannot is the copywriter asked again.
    if (draft && !reviewTried && !issues.some(i => STRUCTURAL.test(i))) {
      reviewTried = true
      reviewed = await review(draft, problems)
      if (reviewed) break
    }
  }
  if (!draft) throw httpError(502, 'The ad could not be written. Please try again.')
  if (!reviewTried) reviewed = await review(draft, problems)
  return { copy: normalizeAdCopy(reviewed || draft, brief, language.code), language }
}

/**
 * The ad's one creative as a single-slide post for the design pipeline. Ads always look for a picture of the offer
 * ("With images"): photo-led when the design is, else a cutout in the space the words leave. The image carries the hook,
 * the offer badge, an optional line and a short call to action that matches Meta's button under it.
 */
export function creativeCopy(ad: AdCopy, family: any) {
  const compositions = familyGrammar(family).compositions as string[]
  const pictured = familyImagery(family).mode !== 'none'
  const composition = pictured && compositions.includes('image-led') ? 'image-led' : pictured && compositions.includes('split') ? 'split' : compositions.includes('statement') ? 'statement' : compositions[0]
  return {
    format: 'single', headline: ad.creative.headline, subheadline: ad.creative.label, supportingText: ad.creative.supportingText, body: ad.creative.supportingText,
    cta: ad.creative.cta || '', caption: ad.primaryText[0] || '', hashtags: [], imageChoice: 'on',
    design: { composition, image: ad.image },
  }
}

/**
 * A design as ads use it: the line under the hook one size up, so it reads at a glance on a phone, and the call to
 * action drawn as a button where the design writes it as plain text. Everything else is the design's own.
 */
export function adFamily(family: any) {
  if (!family?.study) return family
  const grammar = familyGrammar(family)
  return { ...family, study: { ...family.study, grammar: { ...grammar, body: { scale: 'large' }, cta: grammar.cta === 'text' ? 'pill' : grammar.cta } } }
}

/**
 * The creative composed at one size. Stories keep every word and the logo out of the bars Meta draws over the top and
 * bottom. A size too small for every word (a landscape ad) is tried without the badge, then without the supporting line
 * and then without the on-image call to action, before giving up: the hook itself is never cut.
 */
export function composeAtSize(family: any, placement: { id?: string; width: number; height: number; label: string }, brand: any, copy: any, resolvedPlan: any, design: any, id: () => string) {
  const story = placement.id === 'story'
  const height = story ? placement.height - STORY_SAFE.top - STORY_SAFE.bottom : placement.height
  const attempts = [copy, { ...copy, subheadline: '' }, { ...copy, subheadline: '', supportingText: '', body: '' }, { ...copy, subheadline: '', supportingText: '', body: '', cta: '' }]
  const forAds = adFamily(family)
  let lastError: any
  for (const attempt of attempts) {
    try {
      const canvas = renderGlobalPost({ ...forAds, width: placement.width, height }, brand, attempt, resolvedPlan, design, id, `${brand.name || 'Ad'} — Ad · ${placement.label}`)
      return story ? toStoryCanvas(canvas, STORY_SAFE) : canvas
    } catch (error: any) { if (error?.status !== 422) throw error; lastError = error }
  }
  throw lastError
}

async function loadBrand(db: any, userId: string, flowId: unknown) {
  if (typeof flowId !== 'string' || !flowId) throw httpError(400, 'Choose a brand.')
  await requireOwnBrands(db, userId, [flowId])
  const brand = await loadGenerationBrandContext(db, { flowId })
  if (!brand) throw httpError(404, 'Brand not found')
  return brand
}

/**
 * PLAN: the ad's copy, its design and its image plan, and the credits for it (one per size, held until the sizes are
 * built). Answers like /api/plan-post, so VISUALS runs through /api/resolve-assets with the same chargeRef.
 */
export async function handlePlanAd(db: any, userId: string, body: any) {
  await requireFeature(db, userId, 'adDesigns')
  const brief = readAdBrief(body)
  const brand = await loadBrand(db, userId, body.flowId)
  const selection = await chooseBrandFamily(db, brand, { headline: brief.offer }, brief.designId, { userId, imagery: true })
  if (!selection) throw httpError(409, 'Ads use the Design Library. Switch on at least one design for this brand first.')
  const { copy: ad } = await writeAdCopy(brand, brief)
  const copy = sanitizeDesignPlan(selection.family, creativeCopy(ad, selection.family), [], [], 'on')
  const plan = await planAssets(db, { brandContext: brand, copy, idea: { topic: brief.offer, format: 'single' }, uploads: [], brand_id: `brand_${brand.id}`, designId: selection.design.id })
  const chargeRef = `ad_${randomUUID()}`
  const charge = await chargeCredits(db, userId, brief.placements.length, { reason: 'ad', ref: chargeRef })
  return NextResponse.json({ brief, ad, copy, plan, needsVisuals: plan.slots.some((s: any) => s.needs_visual), chargeRef, credits: { charged: charge.credits } })
}

/**
 * BUILD: the one creative composed at every size asked for, each an editable post. The credits are kept for the sizes
 * that were made; a size whose words cannot fit gives its credit back.
 */
export async function handleBuildAd(db: any, userId: string, body: any) {
  const brief = readAdBrief(body)
  const brand = await loadBrand(db, userId, body.flowId)
  const charge = typeof body.chargeRef === 'string' ? await findCharge(db, userId, body.chargeRef) : null
  if (!charge || charge.status !== 'held' || charge.credits < brief.placements.length) throw httpError(409, 'This ad has to start again from the beginning. Please try again.')
  try {
    const resolvedPlan = body.resolvedPlan
    const designId = resolvedPlan?.designId || resolvedPlan?.layoutPlan?.designId
    const selected = (await hydrateBrandFamilies(db, brand)).find(f => f.design.id === designId)
    if (!selected || !Array.isArray(resolvedPlan?.slots)) throw httpError(409, 'This ad has to start again from the beginning. Please try again.')
    if (brand.logo) await ensureBrandLogoVariants(db, brand).catch(error => console.warn('[ads] logo variants unavailable:', error?.message))
    const adId = `ad_${randomUUID()}`, now = new Date()
    const made: any[] = [], failed: any[] = []
    for (const placementId of brief.placements) {
      const placement = placementById(placementId)!
      try {
        const canvas = composeAtSize(selected.family, placement, brand, body.copy, resolvedPlan, selected.design, randomUUID)
        const saved = await persistInlineImages(db, { ...canvas, ownerId: userId, ad: { id: adId, placement: placement.id } })
        await db.collection('canvases').insertOne(saved)
        const { _id, ...stored } = saved as any
        made.push({ placement: placement.id, canvasId: stored.id, width: placement.width, height: placement.height, canvas: stored })
      } catch (error: any) {
        if (error?.status !== 422) throw error
        failed.push({ placement: placement.id, reason: 'The words did not fit this size.' })
      }
    }
    if (!made.length) throw httpError(422, 'The ad’s words did not fit any of the sizes. Try a shorter offer.')
    const ad = normalizeAdCopy(body.ad, brief, postLanguage(brand).code)
    const record = {
      id: adId, ownerId: userId, flowId: brand.id, brief, designId,
      copy: { primaryText: ad.primaryText, headlines: ad.headlines, description: ad.description, cta: ad.cta },
      creative: ad.creative, canvases: made.map(({ canvas, ...rest }) => rest), failed, createdAt: now, updatedAt: now,
    }
    await db.collection('ads').insertOne({ ...record })
    await settleCharge(db, userId, charge.id)
    if (failed.length) await grantExtraCredits(db, userId, failed.length, { ref: `ad-sizes-${adId}`, note: 'Ad sizes that could not be made' })
    return NextResponse.json({ ad: { ...record, canvases: made } })
  } catch (error) {
    await refundCharge(db, userId, charge.id).catch(() => {})
    throw error
  }
}

/**
 * The person's own edits to an ad's text (the copy that goes into Ads Manager), kept within Meta's limits. The image
 * is edited in the editor, like any post.
 */
export async function handleUpdateAdCopy(db: any, userId: string, adId: string, body: any) {
  const ad = await db.collection('ads').findOne({ id: adId, ownerId: userId }, { projection: { _id: 0 } })
  if (!ad) throw httpError(404, 'Ad not found')
  const brand = await loadBrand(db, userId, ad.flowId)
  const edited = normalizeAdCopy({ ...ad.copy, ...body?.copy, creative: ad.creative }, ad.brief, postLanguage(brand).code, true)
  const copy = { primaryText: edited.primaryText, headlines: edited.headlines, description: edited.description, cta: edited.cta }
  if (!copy.primaryText.length || !copy.headlines.length) throw httpError(400, 'Keep at least one primary text and one headline.')
  await db.collection('ads').updateOne({ id: adId, ownerId: userId }, { $set: { copy, updatedAt: new Date() } })
  return NextResponse.json({ copy })
}

/** A brand's ads, newest first, each with its sized posts for the previews. */
export async function handleListAds(db: any, userId: string, flowId: unknown) {
  await loadBrand(db, userId, flowId)
  const ads = await db.collection('ads').find({ ownerId: userId, flowId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(40).toArray()
  const ids = ads.flatMap((ad: any) => ad.canvases.map((c: any) => c.canvasId))
  const canvases = ids.length ? await db.collection('canvases').find({ id: { $in: ids }, ownerId: userId }, { projection: { _id: 0 } }).toArray() : []
  const byId = new Map(canvases.map((c: any) => [c.id, c]))
  return NextResponse.json({ ads: ads.map((ad: any) => ({ ...ad, canvases: ad.canvases.filter((c: any) => byId.has(c.canvasId)).map((c: any) => ({ ...c, canvas: byId.get(c.canvasId) })) })) })
}

/** Deletes an ad and the posts it made. */
export async function handleDeleteAd(db: any, userId: string, adId: string) {
  const ad = await db.collection('ads').findOne({ id: adId, ownerId: userId }, { projection: { _id: 0 } })
  if (!ad) throw httpError(404, 'Ad not found')
  await db.collection('canvases').deleteMany({ id: { $in: ad.canvases.map((c: any) => c.canvasId) }, ownerId: userId })
  await db.collection('ads').deleteOne({ id: adId, ownerId: userId })
  return NextResponse.json({ success: true })
}

export { AD_PLACEMENTS }
