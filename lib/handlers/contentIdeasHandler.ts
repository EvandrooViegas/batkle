import { compactBrand, retrySeconds } from '@/lib/services/ai/requestBudget'
import { availableGroqCompletion } from '@/lib/services/ai/availableGroqCompletion'
import { NextResponse } from 'next/server'
import { corsify } from '@/lib/services/middleware'
import Groq from 'groq-sdk'
import { randomUUID } from 'node:crypto'
import { loadGenerationBrandContext, EXTRACTED_CONTEXT_RULES } from '@/lib/services/generationBrandContext'
import { postLanguage, languageIssues } from '@/lib/services/contentLanguage'
import { inventedFigures } from '@/lib/services/copyFacts'
import { chooseAngle, ideaHistory, topicSimilarity, ideaOutline, outlineIssue, recurringSubjects, mentionsSubject, lengthOf, type CarouselLength } from '@/lib/services/contentAngles'
import { readIdeaRequest, ideaRequestBlock, formatRule, finalFormat, readSlideCount, slideCountRule, fitOutline, readLanguageChoice, IDEA_REQUEST_RULE, type FormatChoice } from '@/lib/services/ideaRequest'
import { postImageIds, prepareIdeaImages, postImagesBlock } from '@/lib/services/postImages'

const SYSTEM_PROMPT = `You are an expert Instagram content strategist.

Your job is to analyze a company's brand information and create relevant Instagram post ideas that are aligned with the company's positioning, audience, services, expertise, and visual identity.

You are NOT creating the final Instagram post yet.

You are creating structured CONTENT BRIEFS that will later be given to another AI responsible for writing the post and another AI responsible for designing the visual.

IMPORTANT RULES:

* Use ONLY information available in the provided brand information.
* Never invent services, clients, statistics, awards, certifications, results, locations, products, or company facts.
* Never ask for figures, percentages, before/after results, testimonials or case-study outcomes unless the brand information states them. Present a project only as the work the profile describes (for example "a website with a booking platform"), never as a different kind of work or with metrics.
* Do not make unsupported claims.
* Do not create ideas that have no connection to the company.
* Avoid generic content that could apply to any business.
* Ideas should provide value to the company's target audience.
* Ideas should help the company build authority, trust, awareness, engagement, or generate interest in its services.
* Use the company's actual positioning and differentiators whenever possible.
* Write every field in the OUTPUT LANGUAGE given below, never in the language of the research notes.
* The brand's contentTopics are research suggestions, not a queue to work through. Build each idea on the ANGLE you are given.
* Avoid excessive promotional content.
* Create a balanced content strategy rather than making every post an advertisement.

CONTENT PILLARS:

Use one of the following pillars whenever possible:

* Educational: Teach the audience something relevant to the company's industry.
* Expertise: Demonstrate the company's knowledge, experience, methodology, or way of working.
* Services: Explain a service, what problem it solves, or when someone might need it.
* Projects / Cases: Showcase real projects, work, processes, or results when information about them is available.
* Company: Communicate the company's identity, values, mission, team, culture, or story.
* Behind the scenes: Show how the company works, its processes, people, equipment, or day-to-day operations when information is available.
* Industry insights: Discuss relevant trends, changes, challenges, or opportunities in the company's industry.
* Problems and solutions: Identify a problem faced by the target audience and explain how it can be approached or solved.
* Trust / Credibility: Communicate information that helps the audience understand why the company is trustworthy.
* Brand positioning: Communicate what makes the company different and how it approaches its work.

FIELD DEFINITIONS:

For every idea, return the following fields:

"id": A unique identifier. Use format "idea-001", "idea-002", etc.

"pillar": The main content category. Choose from the pillars listed above.

"objective": WHY the company should publish this post. Describe the desired communication or marketing objective.

"format": "single" for one visual, "carousel" for multiple slides. Use "carousel" when the topic requires explanation, steps, lists, comparisons, storytelling, or multiple pieces of information. Use "single" when one strong message suffices.

"topic": The specific subject of the post. Must be specific enough that another AI can write the complete post without guessing.

"hook": The cover line that makes the viewer stop scrolling and keep reading. 3-10 words. It opens a question the post answers: a specific promise, a common mistake, a question the audience already has, or a surprising truth from the brand information. It is never a title or label ("Our methodology", "About us") and never clickbait: the post must deliver what it promises.

"coreMessage": The ONE main idea the audience should understand after seeing the post. 1-3 sentences. Do not write the full post here.

"outline": For a carousel, the plan of every slide in order: one short line per slide saying what that slide covers (not its final wording). The first line is the cover hook, the last is the takeaway that answers it, and every line in between is ONE point on the same topic that moves the story forward, so the whole carousel stays on one subject. The number of lines comes from the material: 3-4 for one sharp insight, 5-6 for an explanation, 7-10 for a process, checklist or story. Never pad to a fixed count. For a single post, return an empty array.

"targetAudience": Who this specific post is for. Be specific.

"visualDirection": How the content could be visually communicated. Describe the visual approach type, not exact positions or dimensions.

CONTENT QUALITY — before returning each idea verify:
1. Is this relevant to the company's business?
2. Is this relevant to its target audience?
3. Does it provide value?
4. Does it reinforce the company's positioning?
5. Could another AI create a complete post from this brief without guessing?
6. Is the idea sufficiently specific?
7. Is it based on information actually available about the company?

Return ONLY valid JSON. Do not return Markdown. Do not return explanations. Do not return text outside the JSON object.`

function buildUserPrompt(brandJson: string): string {
  return `Analyze the following extracted brand information and generate exactly ONE Instagram content idea.

BRAND INFORMATION (English research notes; facts only):

${brandJson}

For every idea, follow the exact structure defined in the system instructions.

Create a balanced mix of content pillars and formats.

Prioritize ideas that:

* Demonstrate the company's expertise
* Educate its target audience
* Explain problems the company can solve
* Communicate its differentiators
* Create trust
* Naturally connect with the company's services

Do not make every idea directly promotional.

${IDEA_JSON_SHAPE}`
}

/** Prompt for an idea the user typed: their subject, grounded in the brand profile. */
function buildRequestPrompt(brandJson: string, request: string, format: FormatChoice, formatReason?: string): string {
  return `Turn the user's own post idea into exactly ONE Instagram content brief for this brand.

BRAND INFORMATION (English research notes; facts only):

${brandJson}

${ideaRequestBlock(request, format, formatReason)}

For the idea, follow the exact structure defined in the system instructions.

${IDEA_JSON_SHAPE}`
}

const IDEA_JSON_SHAPE = `Return exactly this JSON structure:

{
  "ideas": [
    {
      "id": "idea-001",
      "pillar": "Educational",
      "objective": "Educate potential clients about an important problem",
      "format": "carousel",
      "topic": "Specific topic of the post",
      "hook": "Cover line that makes the viewer keep reading",
      "coreMessage": "The main idea the audience should understand",
      "outline": ["Cover: the hook", "One point on the same topic", "The next point", "Takeaway that answers the hook"],
      "targetAudience": "Specific audience for this post",
      "visualDirection": "Suggested visual approach"
    }
  ]
}`

export async function handleGenerateContentIdeas(body: any, db: any) {
  try {
    const brandContext = await loadGenerationBrandContext(db, body)

    if (!brandContext) {
      return corsify(
        NextResponse.json({ error: 'brandContext is required' }, { status: 400 })
      )
    }

    const apiKey = (process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_2)
    if (!apiKey) {
      return corsify(
        NextResponse.json({ error: 'GROQ_API_KEY is not configured' }, { status: 500 })
      )
    }

    const groq = new Groq({ apiKey,maxRetries:0 })

    const brandJson = JSON.stringify(compactBrand(brandContext))
    // History is the saved flow's ideas plus whatever the open page sends, so repetition is judged on everything.
    let saved: any[] = []
    if (brandContext.id && db) {
      try { saved = (await db.collection('flows').findOne({ id: brandContext.id }, { projection: { 'creationState.ideas': 1 } }))?.creationState?.ideas || [] } catch {}
    }
    const history = ideaHistory(body.existingIdeas, saved, body.existingTopics)
    // Settings chosen in the composer for this post; each falls back to Auto (the brand's language, the content's length).
    const languageChoice = readLanguageChoice(body.language)
    const language = postLanguage(brandContext, languageChoice)
    // A typed idea sets the subject. Without one, the angle is chosen in code:
    // least-used pillar on the least-covered service, project, differentiator or topic.
    const { request, format } = readIdeaRequest(body)
    // A slide count only applies to carousels; with Single post it is ignored.
    const slideCount = format === 'single' ? null : readSlideCount(body.slides)
    // Attached photos (at most four) shape the idea like a typed idea does; several photos need a carousel.
    const imageIds = postImageIds(body.images)
    if (imageIds.length > 1 && format === 'single') throw Object.assign(new Error('A single post shows one photo. Choose Carousel or Auto to use all your photos.'), { status: 400 })
    const images = imageIds.length ? await prepareIdeaImages(db, brandContext, imageIds) : []
    const formatChoice: FormatChoice = images.length > 1 || slideCount ? 'carousel' : format
    const formatReason = format === 'carousel' ? undefined : images.length > 1 ? 'the user attached several photos' : slideCount ? `the user chose ${slideCount} slides` : undefined
    const angle = request || images.length ? null : chooseAngle(brandContext, history)
    // The person's slide count replaces the length the angle would choose.
    const length: CarouselLength | undefined = slideCount ? { label: lengthOf(slideCount)!, min: slideCount, max: slideCount, use: 'the number of slides the user chose' } : angle?.length
    const lengthLine = slideCount ? `${slideCountRule(slideCount)}\n` : ''
    // Subjects the recent ideas keep returning to (e.g. one technology): this idea leaves them out, unless the
    // person's own words ask for them.
    const avoid = angle ? angle.avoid || [] : recurringSubjects(brandContext, history).filter(subject => !mentionsSubject(request, subject))
    const avoidBlock = avoid.length ? `\nAVOID REPEATING (required): the brand's recent ideas already centred on ${avoid.map(s => `"${s}"`).join(', ')}. Do not mention or build this idea on ${avoid.length > 1 ? 'them' : 'it'}; use other details from the brand information.\n` : ''
    const angleBlock = angle ? `\nANGLE FOR THIS IDEA (required):
- Pillar: ${angle.pillar}
- Build it on this ${angle.facet.kind === 'company' ? 'part of the company' : angle.facet.kind}: "${angle.facet.label}"${angle.facet.detail && angle.facet.detail !== angle.facet.label ? ` (${angle.facet.detail})` : ''}
${formatRule(formatChoice, angle.format, formatReason)}
${slideCount ? lengthLine : length && formatChoice !== 'single' ? `- Length if it is a carousel: ${length.min}-${length.max} slides, so the outline has ${length.min}-${length.max} lines (${length.use})\n` : ''}Use concrete details from the brand information about this ${angle.facet.kind}; do not drift to another service or topic.\n` : !request && formatChoice !== 'auto' ? `\n${formatRule(formatChoice, undefined, formatReason)}\n${lengthLine}` : ''
    const previous = history.slice(0, 30).map(i => `- [${i.angle?.pillar || i.pillar || '?'}] ${String(i.topic).slice(0, 160)}`).join('\n')
    const userPrompt = (request
      ? buildRequestPrompt(brandJson, request, formatChoice, formatReason) + (lengthLine ? `\n${lengthLine}` : '')
      : buildUserPrompt(brandJson) + angleBlock
        + (previous ? `\nPREVIOUS IDEAS (the new idea must cover a clearly different subject and angle, not a rewording):\n${previous}\n` : ''))
      + avoidBlock
      + (images.length ? `\n${postImagesBlock(images)}\n` : '')
      + `\n${language.rules}`
    const systemPrompt = SYSTEM_PROMPT + '\n\n' + EXTRACTED_CONTEXT_RULES + (request ? '\n\n' + IDEA_REQUEST_RULE : '') + '\n\n' + language.rules

    let raw = ''
    let feedback = ''
    let parsed: any
    let idea: any
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await availableGroqCompletion(groq,{
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt + (feedback ? `\nThe previous attempt was rejected: ${feedback}. Return a corrected idea.` : '') },
        ],
        max_tokens: 1800,
        temperature: attempt ? 0.5 : 0.8,
      }, 'GROQ_CONTENT_IDEAS_MODEL')

      raw = response.choices[0]?.message?.content?.trim() || ''
      if (!raw) {
        if (attempt === 0) { feedback = 'the response was empty'; continue }
        return corsify(
          NextResponse.json({ error: 'Empty response from AI' }, { status: 500 })
        )
      }

      // Strip markdown code fences if the model wrapped the JSON
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

      parsed = undefined
      try {
        parsed = JSON.parse(cleaned)
      } catch {
        // Response was truncated — try to salvage complete ideas from the partial JSON.
        // Find the last complete idea object (ends with "}" before the truncation point).
        try {
          const ideasStart = cleaned.indexOf('"ideas"')
          const arrayStart = cleaned.indexOf('[', ideasStart)
          if (arrayStart !== -1) {
            // Walk backwards from the end to find the last complete "}" at depth 1
            let depth = 0
            let lastCompleteEnd = -1
            for (let i = arrayStart; i < cleaned.length; i++) {
              if (cleaned[i] === '{') depth++
              if (cleaned[i] === '}') {
                depth--
                if (depth === 0) lastCompleteEnd = i
              }
            }
            if (lastCompleteEnd !== -1) {
              const repairedStr = `{"ideas": ${cleaned.slice(arrayStart, lastCompleteEnd + 1)}]}`
              parsed = JSON.parse(repairedStr)
              console.warn(`Truncated response repaired — recovered ${parsed.ideas?.length ?? 0} ideas`)
            }
          }
        } catch {
          // repair also failed
        }

        if (!parsed && attempt === 0) { feedback = 'the response was not valid JSON'; continue }
        if (!parsed) {
          console.error('Failed to parse AI response:', cleaned.slice(0, 500))
          return corsify(
            NextResponse.json({ error: 'AI returned invalid JSON', raw: cleaned }, { status: 500 })
          )
        }
      }

      idea=Array.isArray(parsed.ideas)?parsed.ideas.find((i:any)=>i&&typeof i.topic==='string'&&i.topic.trim()):null
      if(!idea){ if(attempt===0){feedback='no idea with a topic was returned';continue} return corsify(NextResponse.json({error:'No usable idea returned'},{status:502})) }
      // Code-level checks: one language, and (for suggestions) a subject that is not a rewording of an existing idea.
      // A typed idea may revisit a subject on purpose, so it is never rejected as a repeat.
      // A carousel brief plans every slide, so the copy stays on one subject and its length fits the material.
      const outline=ideaOutline(idea.outline,finalFormat(idea.format,formatChoice,angle?.format))
      const problems=[...languageIssues([idea.topic,idea.hook,idea.coreMessage,...outline],language)]
      const outlineProblem=finalFormat(idea.format,formatChoice,angle?.format)==='carousel'?outlineIssue(outline,length):null
      if(outlineProblem)problems.push(outlineProblem)
      // A brief that promises figures pushes the copywriter to invent them; only the profile or the person's own words may supply them.
      const invented=inventedFigures([idea.topic,idea.hook,idea.coreMessage,idea.visualDirection,...outline],brandJson+' '+(request||''))
      if(invented.length)problems.push(`it states figures that are not in the brand information (${invented.slice(0,5).join(', ')}); remove them and never ask for metrics or before/after results the profile does not contain`)
      const duplicate=request||images.length?null:history.find(i=>topicSimilarity(String(i.topic),idea.topic)>=.5)
      if(duplicate)problems.push(`the topic repeats an existing idea ("${String(duplicate.topic).slice(0,120)}"); choose a different subject within the angle`)
      const repeated=avoid.filter(subject=>mentionsSubject([idea.topic,idea.hook,idea.coreMessage,...outline].join(' \n '),subject))
      if(repeated.length)problems.push(`it mentions ${repeated.join(', ')}, which the brand's recent ideas already centred on; build it on other details from the brand information`)
      if(!problems.length||attempt===1){ if(problems.length)console.warn('[content-ideas] accepted after retry with:',problems.join('; ')); break }
      feedback=problems.join('; ')
    }
    const ideaId='idea-'+randomUUID()
    // Each photo belongs to one post: reserve it for this idea, refusing a photo another idea took meanwhile.
    if(images.length){
      const reserved=await db.collection('assets').updateMany({id:{$in:imageIds},brand_id:`brand_${brandContext.id}`,reserved_for:{$exists:false}},{$set:{reserved_for:ideaId,updated_at:new Date()}})
      if(reserved.modifiedCount!==imageIds.length)throw Object.assign(new Error('A photo is already used in another post. Each photo can be used once.'),{status:409})
    }
    // The user's own words and photos travel with the brief, so the copywriter and planner see them too.
    const {outline:rawOutline,...brief}=idea
    const ideaFormat=finalFormat(idea.format,formatChoice,angle?.format)
    // A chosen length holds even when the model overshot it twice: the cover, the first points, then the takeaway.
    const outline=fitOutline(ideaOutline(rawOutline,ideaFormat),slideCount)
    // `avoid` travels with the brief, so the copywriter leaves the same subjects out of the post. The composer's
    // slide count and language travel with it too, so rebuilds keep them.
    return corsify(NextResponse.json({ideas:[{...brief,id:ideaId,format:ideaFormat,...(outline.length?{outline}:{}),...(slideCount&&ideaFormat==='carousel'?{slideCount}:{}),...(languageChoice?{languageChoice}:{}),...(angle?{angle:{pillar:angle.pillar,facet:angle.facet.label,kind:angle.facet.kind}}:{}),...(avoid.length?{avoid}:{}),...(request?{userRequest:request}:{}),...(images.length?{images:images.map(({ref,...image})=>image)}:{})}]}))
  } catch (error: any) {
    console.error('Content ideas generation error:', error)
    return corsify(
      NextResponse.json(
        { error: error.status===429?'AI quota reached. Retry in '+retrySeconds(error)+' seconds.':error.message || 'Failed to generate content ideas' },
        { status: error.status===429?429:error.status>=400&&error.status<500?error.status:500,headers:error.status===429?{'Retry-After':String(retrySeconds(error))}:{} }
      )
    )
  }
}
