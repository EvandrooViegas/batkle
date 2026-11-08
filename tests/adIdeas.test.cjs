const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')

const load = file => stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))
const meta = new Function(load('lib/ads/meta.ts') + ';return { AD_PLACEMENTS, DEFAULT_PLACEMENTS, AD_TEXT_LIMITS, AD_ANGLES, CREATIVE_LIMITS, STORY_SAFE, META_CTAS, AD_OBJECTIVES, AD_VARIANTS, AD_FORMATS, CAROUSEL_CARDS, CAROUSEL_PLACEMENTS, CAROUSEL_DEFAULT_PLACEMENTS, placementById, objectiveById, isMetaCta, readFormat, readCards, placementsFor, defaultPlacements, readPlacements, adCredits }')()
const language = new Function(load('lib/services/contentLanguage.ts') + load('lib/services/copyFacts.ts') + load('lib/services/contentAngles.ts') + ';return { postLanguage, languageIssues, modernPortuguese, inventedFigures, brandSubjects, mentionsSubject, aiTells, resultClaims }')()
const deps = {
  NextResponse: { json: body => ({ body }) }, randomUUID: () => 'id', Groq: class {}, availableGroqCompletion: async () => { throw Error('no model in tests') }, compactBrand: b => b,
  loadGenerationBrandContext: async () => null, EXTRACTED_CONTEXT_RULES: '', persistInlineImages: async (_db, c) => c, ensureBrandLogoVariants: async () => null,
  chooseBrandFamily: async () => null, renderGlobalPost: () => null, hydrateBrandFamilies: async () => [], familyGrammar: () => ({}), familyImagery: () => ({}), toStoryCanvas: c => c,
  chargeCredits: async () => ({}), findCharge: async () => null, grantExtraCredits: async () => true, refundCharge: async () => true, giveBackCharge: async () => 'refunded', requireFeature: async () => {}, settleCharge: async () => true,
  requireOwnBrands: async () => {}, sanitizeDesignPlan: (_f, c) => c, planAssets: async () => ({ slots: [] }), ...language, ...meta,
}
const { writeAdIdea, ideaContext } = new Function(...Object.keys(deps), load('lib/handlers/adHandlers.ts') + ';return { writeAdIdea, ideaContext }')(...Object.values(deps))
process.env.GROQ_API_KEY ||= 'test-only'

const brand = {
  name: 'PRUMO Soalheiro', language: 'Portuguese', languageVariant: 'pt-PT', about: 'Construção civil e remodelações em Lisboa.',
  services: [{ name: 'Remodelação de casas de banho', description: 'Da demolição aos acabamentos.' }, 'Pintura de fachadas'],
  projects: [{ name: 'Moradia em Alfama' }], targetAudience: 'Proprietários de casas antigas em Lisboa.', differentiators: ['Equipa própria, sem subempreiteiros'],
}
const answer = value => ({ choices: [{ message: { content: JSON.stringify(value) } }] })

test('an ad idea starts from the chosen item, in the brand language, and never repeats the ones already given', async () => {
  const requests = []
  const idea = await writeAdIdea(brand, 'Remodelação de casas de banho', ['Remodele a sua casa de banho antiga sem obras longas.'], async (_g, request) => {
    requests.push(request)
    return answer({ offer: 'Casa de banho nova para quem vive num prédio antigo: tratamos da canalização e dos azulejos.', audience: 'Proprietários de apartamentos antigos' })
  })
  assert.equal(idea.offer.startsWith('Casa de banho nova'), true)
  assert.equal(idea.audience, 'Proprietários de apartamentos antigos')
  const [system, user] = requests[0].messages.map(m => m.content)
  assert.match(system, /Portuguese/)
  assert.match(user, /START FROM: Remodelação de casas de banho/)
  assert.match(user, /ALREADY SUGGESTED[\s\S]*sem obras longas/, 'earlier ideas are passed back, so the next one differs')
  assert.equal(requests[0].temperature, 1)
})

test('an idea with a price or offer the profile does not state is asked again, and fails rather than inventing one', async () => {
  let calls = 0
  const idea = await writeAdIdea(brand, 'Pintura de fachadas', [], async () => {
    calls++
    return answer(calls === 1 ? { offer: 'Pintura de fachadas com 20% de desconto até sexta.', audience: 'Condomínios' } : { offer: 'Pintura de fachadas de prédios antigos, com equipa própria.', audience: 'Condomínios em Lisboa' })
  })
  assert.equal(calls, 2)
  assert.doesNotMatch(idea.offer, /20%/)
  await assert.rejects(writeAdIdea(brand, 'Pintura de fachadas', [], async () => answer({ offer: 'Desconto de 30% este mês.', audience: '' })), /No idea could be written/)
})

test('the profile sent for an idea is short: name, about, services, projects, customers and what sets the brand apart', () => {
  const context = ideaContext({ ...brand, services: Array.from({ length: 20 }, (_, i) => `Serviço ${i}`), logo: 'data:image/png;base64,AAAA', logoVariants: { big: 'x'.repeat(10000) } })
  assert.deepEqual(Object.keys(context), ['name', 'about', 'services', 'projects', 'customers', 'apart'])
  assert.equal(context.services.length, 8)
  assert.ok(JSON.stringify(context).length < 2000)
})
