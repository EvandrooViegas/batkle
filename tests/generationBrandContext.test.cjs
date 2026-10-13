const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const load = path => stripTypeScriptTypes(fs.readFileSync(path, 'utf8').replace(/^import .*$/gm, '').replace(/export /g, ''))
const { loadGenerationBrandContext, EXTRACTED_CONTEXT_RULES } = new Function(load('lib/services/generationBrandContext.ts') + ';return {loadGenerationBrandContext,EXTRACTED_CONTEXT_RULES}')()
const compactBrand = new Function('globalThis', load('lib/services/ai/requestBudget.ts') + ';return compactBrand')({})
const strategy = new Function(load('lib/services/contentLanguage.ts') + load('lib/services/contentAngles.ts') + load('lib/services/ideaRequest.ts') + load('lib/services/postImages.ts') + load('lib/services/copyFacts.ts') + ';return {postLanguage,readSlideCount,slideCountRule,fitOutline,readLanguageChoice,lengthOf,contentLanguage,languageIssues,copyTexts,chooseAngle,ideaHistory,topicSimilarity,readIdeaRequest,ideaRequestBlock,formatRule,finalFormat,IDEA_REQUEST_RULE,postImageIds,prepareIdeaImages,postImagesBlock,inventedFigures,ideaOutline,outlineIssue,recurringSubjects,mentionsSubject,chooseCarouselLength,CAROUSEL_LENGTHS}')()
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
