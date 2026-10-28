const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const load = path => stripTypeScriptTypes(fs.readFileSync(path, 'utf8').replace(/^import .*$/gm, '').replace(/export /g, ''))
// `hasFeature` stands in for the account's plan (lib/billing/account.ts).
const loader = hasFeature => new Function('hasFeature', load('lib/services/generationBrandContext.ts') + ';return {loadGenerationBrandContext,EXTRACTED_CONTEXT_RULES}')(hasFeature)
const { loadGenerationBrandContext, EXTRACTED_CONTEXT_RULES } = loader(async () => true)
const compactBrand = new Function('globalThis', load('lib/services/brandPosts.ts') + load('lib/services/ai/requestBudget.ts') + ';return compactBrand')({})
const strategy = new Function(load('lib/services/contentLanguage.ts') + load('lib/services/contentAngles.ts') + load('lib/services/ideaRequest.ts') + load('lib/services/postImages.ts') + load('lib/services/copyFacts.ts') + load('lib/services/postFeedback.ts') + ';return {postLanguage,HOOK_SHAPES,hookChoiceBlock,hookRepeats,hookSubjectIssue,cutMachinePhrases,feedbackBlock,loadPostFeedback,withoutDislikedDesigns,hookIssues,callsOutReader,aiTells,resultClaims,unbackedPromises,readSlideCount,slideCountRule,fitOutline,readLanguageChoice,lengthOf,contentLanguage,languageIssues,copyTexts,withModernSpelling,chooseAngle,ideaHistory,topicSimilarity,readIdeaRequest,ideaRequestBlock,formatRule,finalFormat,IDEA_REQUEST_RULE,postImageIds,prepareIdeaImages,postImagesBlock,inventedFigures,ideaOutline,outlineIssue,recurringSubjects,mentionsSubject,chooseCarouselLength,CAROUSEL_LENGTHS}')()
const saved = {
  name: 'Saved brand', about: 'Verified website overview', services: ['Facade restoration'],
  projects: [{ name: 'Ministry project', description: 'Participation in facade work', sourceUrl: 'https://example.com/projects' }],
  targetAudience: 'Property owners', tone: 'Technical and approachable', suggestedCtas: ['Request a site visit'],
  differentiators: ['Multidisciplinary team'], contentTopics: ['How facade restoration works'],
  language: 'Portuguese', languageVariant: 'pt-PT', profileLanguage: 'en',
  researchSources: [{ url: 'https://example.com/services', title: 'Services' }],
  logo: 'large-image-data', designs: [{ huge: 'not relevant to copywriting' }],
}

for (const [file, handler] of [['contentIdeasHandler', 'handleGenerateContentIdeas'], ['copywritingHandler', 'handleGenerateCopywriting']]) {
  test(`${handler} supplies current saved website research to the model, not stale browser data`, async () => {
    const requests = [], lookups = []
    class Groq { constructor(options) { assert.equal(options.maxRetries, 0) } }
    const db = { collection: name => { assert.equal(name, 'flows'); return { findOne: async query => { lookups.push(query); return { brandContext: saved } } } } }
    const budgetedCompletion = async (_client, request) => {
      requests.push(request)
      return { choices: [{ message: { content: JSON.stringify({ ideas: [{ topic: 'Facade restoration', format: 'single' }], format: 'single', headline: 'Restoration', caption: 'Project scope' }) } }] }
    }
    const run = new Function('Groq', 'process', 'loadGenerationBrandContext', 'EXTRACTED_CONTEXT_RULES', 'compactBrand', 'budgetedModels', 'budgetedCompletion', 'NextResponse', 'corsify', 'randomUUID', 'cleanCopy', 'retrySeconds', 'availableGroqCompletion', ...Object.keys(strategy), load(`lib/handlers/${file}.ts`) + `;return ${handler}`)(
      Groq, { env: { GROQ_API_KEY: 'test' } }, loadGenerationBrandContext, EXTRACTED_CONTEXT_RULES, compactBrand,
      async () => ({ data: [{ id: 'llama-3.3-70b-versatile' }] }), budgetedCompletion,
      { json: (body, options) => ({ body, status: options?.status || 200 }) }, result => result,
      () => 'unique', result => result, () => 60, budgetedCompletion, ...Object.values(strategy),
    )
    const result = await run({ brandContext: { id: 'flow-a', name: 'STALE', about: 'STALE' }, idea: { topic: 'Facade restoration', format: 'single' } }, db)
    assert.equal(result.status, 200)
    // The profile is read from the saved flow; the ideas step also reads the saved idea history from it.
    assert.deepEqual(lookups[0], { id: 'flow-a' })
    assert.ok(lookups.every(query => query.id === 'flow-a'))
    assert.equal(requests.length, 1)
    const prompt = requests[0].messages[1].content
    for (const value of ['Verified website overview', 'Facade restoration', 'Ministry project', 'Property owners', 'Technical and approachable', 'Request a site visit', 'Multidisciplinary team', 'How facade restoration works', 'https://example.com/services', 'pt-PT']) assert.ok(prompt.includes(value), value)
    assert.ok(!prompt.includes('STALE'))
    assert.ok(!prompt.includes('large-image-data'))
    assert.match(requests[0].messages[0].content, /even though the profile is English research/)
    assert.match(requests[0].messages[0].content, /OUTPUT LANGUAGE: Portuguese — European \(pt-PT\)/)
    assert.match(requests[0].messages[0].content, /participation is not ownership/)
  })
}

test('explicit flow IDs and brand IDs resolve the saved profile, and missing brands do not use stale data', async () => {
  const db = { collection: () => ({ findOne: async query => query.id === 'flow-a' ? { brandContext: saved } : null }) }
  assert.equal((await loadGenerationBrandContext(db, { flowId: 'flow-a' })).name, 'Saved brand')
  assert.equal((await loadGenerationBrandContext(db, { brand_id: 'brand_flow-a' })).name, 'Saved brand')
  await assert.rejects(loadGenerationBrandContext(db, { flowId: 'missing', brandContext: { name: 'Stale' } }), /not found/)
  const draft = { name: 'Unsaved draft' }
  assert.equal(await loadGenerationBrandContext(db, { brandContext: draft }), draft)
})

test('the voice learned from the brand’s own posts reaches ideas and copy while its switch is on and the plan has it, never the posts themselves', async () => {
  const voice = { summary: 'Plain and close, like a builder talking to a neighbour.', traits: ['Opens with the problem', 'Ends by asking for a site visit'], count: 2, basis: 'b', updatedAt: '2026-10-23T00:00:00.000Z' }
  for (const [enabled, plan, used] of [[true, 'pro', true], [false, 'pro', false], [true, 'free', false]]) {
    for (const [file, handler] of [['contentIdeasHandler', 'handleGenerateContentIdeas'], ['copywritingHandler', 'handleGenerateCopywriting']]) {
      const requests = []
      const brand = { ...saved, postExamples: { enabled, posts: [{ id: 'a', image: '', caption: 'A caption that is never sent' }], voice } }
      const db = { collection: () => ({ findOne: async () => ({ ownerId: 'owner-1', brandContext: brand }) }) }
      const { loadGenerationBrandContext } = loader(async (_db, userId, feature) => userId === 'owner-1' && feature === 'postVoice' && plan === 'pro')
      const budgetedCompletion = async (_client, request) => {
        requests.push(request)
        return { choices: [{ message: { content: JSON.stringify({ ideas: [{ topic: 'Facade restoration', format: 'single' }], format: 'single', headline: 'Restoration', caption: 'Project scope' }) } }] }
      }
      const run = new Function('Groq', 'process', 'loadGenerationBrandContext', 'EXTRACTED_CONTEXT_RULES', 'compactBrand', 'budgetedModels', 'budgetedCompletion', 'NextResponse', 'corsify', 'randomUUID', 'cleanCopy', 'retrySeconds', 'availableGroqCompletion', ...Object.keys(strategy), load(`lib/handlers/${file}.ts`) + `;return ${handler}`)(
        class {}, { env: { GROQ_API_KEY: 'test' } }, loadGenerationBrandContext, EXTRACTED_CONTEXT_RULES, compactBrand,
        async () => ({ data: [{ id: 'llama-3.3-70b-versatile' }] }), budgetedCompletion,
        { json: (body, options) => ({ body, status: options?.status || 200 }) }, result => result,
        () => 'unique', result => result, () => 60, budgetedCompletion, ...Object.values(strategy),
      )
      assert.equal((await run({ flowId: 'flow-a', idea: { topic: 'Facade restoration', format: 'single' } }, db)).status, 200)
      const prompt = requests[0].messages[1].content
      assert.equal(prompt.includes('Plain and close, like a builder'), used, `${handler} enabled=${enabled} plan=${plan}`)
      assert.ok(!prompt.includes('never sent'), 'the posts themselves never reach a prompt')
      assert.match(requests[0].messages[0].content, /voiceFromOwnPosts[\s\S]*never as a template/)
    }
  }
})

test('the owner’s likes and dislikes reach the idea writer and the copywriter', async () => {
  const postFeedback = [
    { key: 'c1', ideaId: 'i1', rating: 'like', reasons: [], note: '', at: '2026-10-24T00:00:00.000Z', surface: 'post', format: 'carousel', topic: 'Roof checks', hook: 'Moss is the first sign', headline: 'Moss is the first sign', caption: 'Check the north side first.' },
    { key: 'c2', ideaId: 'i2', rating: 'dislike', reasons: ['text'], note: 'too salesy', at: '2026-10-23T00:00:00.000Z', surface: 'post', format: 'single', topic: 'Roof deals', hook: 'Unlock your roof', headline: 'Unlock your roof potential', caption: 'Book now.' },
  ]
  for (const [file, handler, heading] of [['contentIdeasHandler', 'handleGenerateContentIdeas', /WHAT THE OWNER THOUGHT OF RECENT POSTS \(their own ratings\):\nLiked:\n- a carousel: "Moss is the first sign"[\s\S]*Disliked:[\s\S]*the owner said: "too salesy"/], ['copywritingHandler', 'handleGenerateCopywriting', /WHAT THE OWNER THOUGHT OF RECENT POSTS' WORDS[\s\S]*headline "Moss is the first sign"[\s\S]*headline "Unlock your roof potential"[\s\S]*too salesy/]]) {
    const requests = []
    const db = { collection: () => ({ findOne: async () => ({ ownerId: 'owner-1', brandContext: saved, postFeedback }) }) }
    const budgetedCompletion = async (_client, request) => {
      requests.push(request)
      return { choices: [{ message: { content: JSON.stringify({ ideas: [{ topic: 'Facade restoration', format: 'single' }], format: 'single', headline: 'Restoration', caption: 'Project scope' }) } }] }
    }
    const run = new Function('Groq', 'process', 'loadGenerationBrandContext', 'EXTRACTED_CONTEXT_RULES', 'compactBrand', 'budgetedModels', 'budgetedCompletion', 'NextResponse', 'corsify', 'randomUUID', 'cleanCopy', 'retrySeconds', 'availableGroqCompletion', ...Object.keys(strategy), load(`lib/handlers/${file}.ts`) + `;return ${handler}`)(
      class {}, { env: { GROQ_API_KEY: 'test' } }, loadGenerationBrandContext, EXTRACTED_CONTEXT_RULES, compactBrand,
      async () => ({ data: [{ id: 'llama-3.3-70b-versatile' }] }), budgetedCompletion,
      { json: (body, options) => ({ body, status: options?.status || 200 }) }, result => result,
      () => 'unique', result => result, () => 60, budgetedCompletion, ...Object.values(strategy),
    )
    assert.equal((await run({ flowId: 'flow-a', idea: { topic: 'Facade restoration', format: 'single' } }, db)).status, 200)
    assert.match(requests[0].messages[1].content, heading, handler)
  }
})
