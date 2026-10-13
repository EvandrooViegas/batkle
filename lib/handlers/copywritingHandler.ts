import { budgetedModels, budgetedCompletion, compactBrand, retrySeconds } from '@/lib/services/ai/requestBudget'
import { cleanCopy } from '@/lib/services/copyText'
import { NextResponse } from 'next/server'
import { corsify } from '@/lib/services/middleware'
import Groq from 'groq-sdk'
import { loadGenerationBrandContext, EXTRACTED_CONTEXT_RULES } from '@/lib/services/generationBrandContext'
import { postLanguage, languageIssues, copyTexts, type ContentLanguage } from '@/lib/services/contentLanguage'
import { inventedFigures } from '@/lib/services/copyFacts'
import { mentionsSubject } from '@/lib/services/contentAngles'

const SYSTEM_PROMPT = `You are an expert Instagram copywriter specialized in creating high-quality social media content for businesses.

Your job is to transform a structured Instagram Content Brief into the complete written content for an Instagram post.

You will receive:

1. The company's Brand Profile
2. A Content Brief created by a content strategist

Your output will later be given to a separate AI graphic designer that will transform the written content into a KAND Canvas design.

Therefore, your job is ONLY to write the content.

Do NOT design the post.
Do NOT describe the visual layout.
Do NOT create Canvas JSON.
Do NOT invent images.
Do NOT include design instructions inside the copy.

IMPORTANT RULES:

* Use ONLY information provided in the Brand Profile and Content Brief.
* Never invent facts, statistics, clients, awards, certifications, results, services, products or company history.
* Never make claims that cannot be supported by the provided information.
* If the brief asks for results, figures, percentages, testimonials or a before/after that the Brand Profile does not contain, do not invent them: describe the real scope, approach and benefits without numbers. Present each project only as the kind of work the Brand Profile describes.
* Write in the OUTPUT LANGUAGE given at the end of these instructions, exactly. Never mix languages or regional variants.
* Ground the post in the brief: build it on the specific service, project, audience problem or differentiator the brief names, using concrete details from the Brand Profile (scope, process, who it serves, named projects when relevant). Avoid generic advice that could fit any company.
* Match the company's positioning and tone.
* Write naturally and humanly.
* Avoid generic AI-sounding phrases.
* Avoid exaggerated marketing language.
* Avoid clickbait.
* Never use emojis or emoji number/keycap symbols. Use ordinary numbers and punctuation.
* Avoid excessive use of exclamation marks.
* Avoid repetitive phrases.
* Avoid unnecessarily complicated language.
* Keep visual copy concise because it will be displayed on an Instagram graphic.
* The caption can contain more context than the visual.
* The visual and caption should communicate the same central idea without simply duplicating each other.

CONTENT STRUCTURE:

For a SINGLE post:
Create:
* headline
* subheadline
* supportingText
* cta

For a CAROUSEL:
SLIDE COUNT: when the brief has an "outline", write exactly one slide per outline entry, in the same order and about the same point. Without an outline, choose the count from the material (3–10 slides): 3–4 for one sharp insight, 5–6 for an explanation, 7–10 for a process, checklist or story. Never default to five and never pad.
Each slide should have:
* slideNumber
* purpose
* headline
* body
* cta

THE COVER (slide 1) has one job: make the viewer stop and swipe. Its headline is the hook, not a title.
* 3–8 words when possible, never more than 10. Instantly understandable and about this post's exact subject.
* Open a question in the reader's mind that the next slides answer. Strong patterns: a specific promise ("4 signs your website is losing clients"), a common mistake ("The mistake that delays most renovations"), a question the audience is already asking, a surprising truth stated in the brand information, or a tension between what people expect and what actually works.
* Never a label or topic name ("Our methodology", "Our values", "About us"), never the company name or slogan on its own, never a vague statement that could open any post.
* Start from the brief's "hook" and sharpen it; keep it honest: every promise on the cover is delivered by the slides that follow, with no invented numbers and no clickbait.
The cover body is a 2–14 word teaser that raises the stakes or hints at the payoff without giving it away; when it fits, end it with a natural nudge to keep reading (such as "Swipe to see all four", written in the output language). Set the cover cta to an empty string.

THE REST OF THE CAROUSEL pays off the cover. Every slide stays on the cover's exact subject and moves it one step forward: one point per slide, in an order where each slide builds on the previous one. Never switch to a different topic, service or audience midway, never repeat a point, and never add filler slides. If the cover promises a number of signs, steps or mistakes, deliver exactly that number.
When a slide names steps, phases, options, benefits or tips (3–6 of them), write them as separate lines in its body: an optional short intro line, then one line per item starting with "1." or "-", each item 1–6 words. Never pack them into one sentence; they are laid out as a designed list.
The final slide closes the loop the cover opened: the takeaway that answers the hook. Give it a cta only when the post's objective calls for an action; otherwise leave the cta empty and let the caption carry the next step.
Do not put too much text on a slide.

FIELD DEFINITIONS:

"format": The Instagram format. Allowed values: "single" or "carousel". Must match the Content Brief.

"headline": The main piece of text that should attract attention. Short, clear and easy to understand. For a single post, this is the primary headline on the graphic. For a carousel, the headline on slide 1 should act as the main hook. Avoid making headlines unnecessarily long.

"subheadline": A short sentence that provides context or expands on the headline. Optional when it does not add value. For carousels, leave this empty; the cover contains only its headline.

"supportingText": Short supporting copy that explains or reinforces the main message. Concise enough to appear on a graphic. Do not write a long paragraph.

"cta": Optional. A short call to action appropriate to the post, or an empty string when the slide does not need one. Do not force a sales CTA into educational content. The graphic is an image, not a web page: nothing on it can be clicked. Write an action the reader can take on Instagram (save the post, share it, comment a word, send a message, follow the account, use the link in the bio), never button wording such as "Click here", "Learn more", "Explore more", "Saiba mais" or "Clique aqui".

"slides": An array containing the content of every carousel slide: one per outline entry when the brief has an outline, otherwise as many as the content requires (usually 3–10), without padding or a fixed default.

"slideNumber": The numerical order of the slide. Start at 1.

"purpose": The communication role of the slide. Examples: "hook", "context", "problem", "explanation", "example", "solution", "summary", "cta". Keep it short.

"body": The main explanatory text for the slide. Enough to communicate the idea but concise enough for an Instagram graphic. Avoid large paragraphs. Use short sentences or compact structures.

"caption": The Instagram caption that accompanies the visual. Should expand on the topic, add context not obvious from the graphic, be useful to the audience, match the company's tone, encourage interaction when appropriate, and end with a natural CTA when appropriate. Do not simply copy the slide text. Normally 2–5 short paragraphs.

"hashtags": A small list of relevant hashtags. Approximately 3–8 hashtags. Must be relevant to the company's industry, the topic, and the target audience. Do not use irrelevant trending hashtags.

"visualNotes": Brief notes for the graphic designer explaining important content considerations. NOT a design specification. For explanation-heavy slides (about 55 words or more), recommend a text-led slide without imagery: prioritize compact, clearly separated reading blocks. Images are optional and should add information rather than compete with detailed explanations. Examples: "The statistic should be visually prominent." / "The three steps should be clearly separated." Do not specify coordinates, colors, fonts or node structures.

QUALITY CONTROL — before returning verify:
1. Is the content directly related to the Content Brief?
2. Does it match the brand?
3. Is every factual claim supported?
4. Would the cover make someone stop scrolling and swipe, without being clickbait? Is it a hook rather than a title?
5. Is the visual copy concise?
6. Does every carousel slide have a clear purpose, and does it follow the outline when there is one?
7. Does the whole carousel stay on the cover's subject, tell a logical story and deliver what the cover promised?
8. Does the caption add value instead of repeating the graphic?
9. Is the CTA appropriate?
10. Is the language correct for the brand's language variant?

Return ONLY valid JSON. Do not return Markdown. Do not return explanations. Do not return text outside the JSON.`

function buildUserPrompt(brandJson: string, briefJson: string): string {
  return `Create the complete written content for the Instagram post using the following information.

BRAND PROFILE (English research notes: use them for facts only and translate every idea into the output language):

${brandJson}

CONTENT BRIEF:

${briefJson}

Follow all rules from the system instructions.

Return exactly this structure:

{
  "format": "single",
  "headline": "",
  "subheadline": "",
  "supportingText": "",
  "cta": "",
  "slides": [],
  "caption": "",
  "hashtags": [],
  "visualNotes": []
}

If the format is "single", populate:
* headline
* subheadline
* supportingText
* cta
* caption
* hashtags
* visualNotes
and return an empty "slides" array.

If the format is "carousel", populate:
* slides (one per outline entry when the brief has an outline; the first is the hook, the last closes the loop it opened)
* caption
* hashtags
* visualNotes
and return empty strings for headline, subheadline, supportingText and cta.

Return ONLY valid JSON.`
}

// Web-button wording promises a click that an Instagram image cannot give. A link-in-bio instruction is fine.
const BUTTON_CTA = /\b(click|tap here|learn more|read more|find out more|discover more|explore more|see more|shop now|buy now|order now|sign up|get started)\b|(?<!\p{L})(saiba mais|clique|carregue aqui|toque aqui|ver mais|veja mais|leia mais|descubra mais|explore mais|compre j[áa]|compre agora|inscreva-se|haz clic|más información|saber más|descubre más|compra ya|cliquez|en savoir plus)(?!\p{L})/iu
// "Visit the website" without an address asks for a click the image cannot give.
const SITE_CTA = /(?<!\p{L})(visite|visita|visit|acesse|aceda|acede|aceder|acessar|veja|explore|go to)\s+(?:(?:o|a|ao|à|our|the|nosso|nossa|el|nuestro)\s+)*(site|website|página|pagina|page|loja online|online store|web)(?!\p{L})/iu
export function isButtonCta(cta: any): boolean {
  if (typeof cta !== 'string' || /link (?:na|in|en la|dans la) bio/i.test(cta)) return false
  return BUTTON_CTA.test(cta) || (SITE_CTA.test(cta) && !/\w\.[a-z]{2,}\b/i.test(cta))
}

async function getGroqModel(groq: Groq): Promise<string> {
  const models = await budgetedModels(groq)
  const preferred = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant']
  const found = preferred.find(id => models.data.some((model: any) => model.id === id && model.active !== false))
  if (!found) throw new Error('No supported copywriting chat model is available in this Groq account. Check your project model permissions.')
  return found
}

/** Optional design context for the combined copy + composition plan call. */
export interface PlanningDesign { prompt: string; validate: (parsed: any) => void }

/** The slide-by-slide plan from the brief, when it has one: one carousel slide per entry. */
export function briefOutline(idea: any): string[] {
  return Array.isArray(idea?.outline) ? idea.outline.filter((s: any) => typeof s === 'string' && s.trim()).slice(0, 10) : []
}

/** Style problems are worth one corrective retry but never worth failing a post that is otherwise complete. */
function styleIssues(parsed: any, language: ContentLanguage, idea?: any): string[] {
  const issues: string[] = []
  if (parsed.format === 'carousel') {
    const cover = parsed.slides[0]
    const coverWords = cover.headline.trim().split(/\s+/u).filter(Boolean).length
    const teaserWords = String(cover.body || '').trim().split(/\s+/u).filter(Boolean).length
    if (coverWords > 10) issues.push(`Carousel cover has ${coverWords} words; maximum is 10`)
    if (teaserWords < 2 || teaserWords > 14) issues.push(`Carousel cover teaser must contain 2–14 words; received ${teaserWords}`)
    const outline = briefOutline(idea)
    if (outline.length >= 3 && parsed.slides.length !== outline.length) issues.push(`The carousel has ${parsed.slides.length} slides but the brief's outline has ${outline.length} entries; write exactly one slide per outline entry`)
  }
  const mixed = languageIssues(copyTexts(parsed), language)
  if (mixed.length) issues.push(`Language: the copy ${mixed.join('; ')}`)
  const written = [...copyTexts(parsed), ...(Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String) : [])]
  const repeated = avoidedSubjects(idea).filter(subject => written.some(t => mentionsSubject(t, subject)))
  if (repeated.length) issues.push(`Repetition: the copy mentions ${repeated.join(', ')}, which the brand's recent posts already centred on; remove it and use other details from the brand profile`)
  return issues
}

/** Subjects the brief says recent posts already covered, unless this post is itself about them. */
function avoidedSubjects(idea: any): string[] {
  const own = [idea?.topic, idea?.coreMessage, idea?.userRequest].filter(v => typeof v === 'string').join(' \n ')
  return (Array.isArray(idea?.avoid) ? idea.avoid : []).filter((s: any) => typeof s === 'string' && s.trim() && !mentionsSubject(own, s))
}

/**
 * The single text-model call for a post. With `design`, the same call also returns the composition plan,
 * so the copy context is sent once. A second attempt is made only when the output fails validation;
 * if that retry cannot run (per-minute quota) or comes back worse, a complete first draft is used instead.
 */
export async function writeCopy(brandContext: any, idea: any, design?: PlanningDesign) {
  const apiKey = (process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_2)
  if (!apiKey) throw Object.assign(new Error('GROQ_API_KEY is not configured'), { status: 500 })
  const groq = new Groq({ apiKey,maxRetries:0 })
  const model = await getGroqModel(groq)
  // A language chosen for this post in the composer wins over the brand's.
  const language = postLanguage(brandContext, idea?.languageChoice)
  // What figures may be stated: the profile the copywriter sees and anything the person typed themselves,
  // never the AI-written brief.
  const factSource = JSON.stringify(compactBrand(brandContext)) + ' ' + (typeof idea?.userRequest === 'string' ? idea.userRequest : '')
  const avoid = avoidedSubjects(idea)
  const userPrompt = buildUserPrompt(JSON.stringify(compactBrand(brandContext)), JSON.stringify(idea, null, 2)) + (design ? '\n\n' + design.prompt : '')
    + (avoid.length ? `\n\nAVOID REPEATING: the brand's recent posts already centred on ${avoid.map(s => `"${s}"`).join(', ')}. Do not mention ${avoid.length > 1 ? 'them' : 'it'} anywhere in this post (slides, caption or hashtags); use other concrete details from the brand profile.` : '')
    + `\n\nOUTPUT LANGUAGE: ${language.label}. Every reader-facing field (headline, body, cta, caption, hashtags) in it; the design study above is internal and in English, never copy its words.`
  let parsed: any
  let draft: any
  let validationFeedback = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: any
    try {
      console.info(`[ai-call] service=groq model=${model} purpose=${design ? 'post-copy-and-composition-plan' : 'post-copy'} attempt=${attempt + 1} referenceImages=false`)
      response = await budgetedCompletion(groq, {
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT + '\n\n' + EXTRACTED_CONTEXT_RULES + '\n\n' + language.rules },
          { role: 'user', content: userPrompt + (attempt ? `\nThe previous attempt failed output validation: ${validationFeedback}. Correct that issue and generate a complete JSON object with the requested fields and no commentary.` : '') },
        ],
        response_format: { type: 'json_object' },
        max_tokens: (attempt ? 4800 : 2400) + (design ? 1600 : 0),
        temperature: attempt ? 0.2 : 0.7,
      })
    } catch (error: any) {
      const code = error?.error?.error?.code || error?.error?.code || error?.code
      if (attempt === 0 && code === 'json_validate_failed') { validationFeedback = 'the response was not valid JSON'; continue }
      if (draft) { console.warn(`[copywriting] retry unavailable (${error?.status || code || error?.message}); using the first draft`); parsed = draft; break }
      throw error
    }
    const choice = response.choices?.[0]
    const raw = choice?.message?.content?.trim() || ''
    try {
      if (choice?.finish_reason === 'length') throw new Error('Truncated copywriting response')
      parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim())
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a copywriting object')
      if (!['single', 'carousel'].includes(parsed.format) || (idea.format && parsed.format !== idea.format)) throw new Error('Incorrect post format')
      if (typeof parsed.caption !== 'string') throw new Error('Missing caption')
      if (parsed.format === 'single' && (typeof parsed.headline !== 'string' || !parsed.headline.trim())) throw new Error('Missing headline')
      if (parsed.format === 'carousel') {
        if (!Array.isArray(parsed.slides) || parsed.slides.length < 2 || parsed.slides.some((slide: any) => !slide || typeof slide.headline !== 'string' || !slide.headline.trim())) throw new Error('Missing carousel slides')
        // The cover carries no CTA; clearing it is exact, so it never costs a retry.
        parsed.slides[0].cta = ''
      }
      // Nothing on an Instagram graphic is clickable: web-button wording is removed, never retried.
      for (const item of parsed.format === 'carousel' ? parsed.slides : [parsed]) if (item && isButtonCta(item.cta)) item.cta = ''
      design?.validate(parsed)
      // Result figures must come from the profile or the person's own request. A draft that invents them
      // is never kept as a fallback: a failed post is better than a published false claim.
      const invented = inventedFigures(copyTexts(parsed), factSource)
      if (invented.length) throw new Error(`Facts: the copy states figures that are not in the brand profile (${invented.slice(0, 6).join(', ')}). Remove them and describe results without numbers`)
      // Cover length and one language per post are checked in code. The first complete draft is kept,
      // so a retry that cannot run or does no better never turns a usable post into a failure.
      const issues = styleIssues(parsed, language, idea)
      if (issues.length && attempt === 0) { draft = parsed; throw new Error(issues.join('; ')) }
      if (issues.length) console.warn('[copywriting] style issues after retry:', issues.join('; '))
      break
    } catch (error: any) {
      validationFeedback = error?.message || 'invalid output'
      console.warn(`[copywriting] attempt ${attempt + 1} rejected: ${validationFeedback}`)
      if (attempt === 0) continue
      if (draft) { console.warn('[copywriting] using the first draft'); parsed = draft; break }
      throw Object.assign(new Error(`AI could not generate complete, valid copywriting (${validationFeedback}). Please retry; your saved content is unchanged.`), { status: 502 })
    }
  }
  return { copy: cleanCopy(parsed), raw: parsed }
}

export function copyErrorResponse(error: any, fallback: string) {
  console.error('Copywriting generation error:', error)
  return corsify(NextResponse.json({ error: error.status===429?'AI quota reached. Retry in '+retrySeconds(error)+' seconds. Completed steps are saved.':error.message || fallback }, { status: error.status===429?429:error.status||500,headers:error.status===429?{'Retry-After':String(retrySeconds(error))}:{} }))
}

export async function handleGenerateCopywriting(body: any, db: any) {
  try {
    const { idea } = body
    const brandContext = await loadGenerationBrandContext(db, body)
    if (!brandContext) return corsify(NextResponse.json({ error: 'brandContext is required' }, { status: 400 }))
    if (!idea) return corsify(NextResponse.json({ error: 'idea (content brief) is required' }, { status: 400 }))
    return corsify(NextResponse.json((await writeCopy(brandContext, idea)).copy))
  } catch (error: any) {
    return copyErrorResponse(error, 'Failed to generate copywriting')
  }
}
