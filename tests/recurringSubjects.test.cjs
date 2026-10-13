const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')

const load = file => stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))
const strategy = new Function(load('lib/services/contentLanguage.ts') + load('lib/services/contentAngles.ts') + load('lib/services/ideaRequest.ts') + load('lib/services/postImages.ts') + load('lib/services/copyFacts.ts')
  + ';return {postLanguage,readSlideCount,slideCountRule,fitOutline,readLanguageChoice,lengthOf,contentLanguage,languageIssues,copyTexts,chooseAngle,ideaHistory,topicSimilarity,readIdeaRequest,ideaRequestBlock,formatRule,finalFormat,IDEA_REQUEST_RULE,postImageIds,prepareIdeaImages,postImagesBlock,inventedFigures,ideaOutline,outlineIssue,chooseCarouselLength,CAROUSEL_LENGTHS,recurringSubjects,mentionsSubject,brandSubjects}')()
const { EXTRACTED_CONTEXT_RULES } = new Function(load('lib/services/generationBrandContext.ts') + ';return {EXTRACTED_CONTEXT_RULES}')()

// A construction company whose profile leans on one technology (BIM), like PRUMO SOALHEIRO.
const brand = {
  id: 'prumo', name: 'PRUMO SOALHEIRO', language: 'Portuguese', website: 'https://www.prumosoalheiro.pt',
  about: 'PRUMO SOALHEIRO is an engineering and construction company. It uses BIM across design and site work, and rehabilitates heritage buildings.',
  services: ['BIM Services — 3D modelling, coordination and clash detection', 'Construção (Construction) — New works and building rehabilitation', 'Formação (Training) — Courses for professionals'],
  differentiators: ['Specialised BIM expertise including Clash Detection', 'Holds a Public Works License', 'Transparent management with periodic reporting'],
  contentTopics: ['The role of BIM in reducing errors', 'How structural reinforcement improves seismic safety'],
  projects: [{ name: 'Ministério da Justiça', description: 'Façade and roof rehabilitation' }],
}
const bimIdeas = [
  { topic: 'Como o BIM coordena a obra', hook: 'Menos erros', coreMessage: 'O BIM reduz conflitos.' },
  { topic: 'Reabilitação de fachadas no Ministério da Justiça', hook: 'Património protegido', coreMessage: 'Com modelação BIM, a intervenção foi planeada ao detalhe.' },
  { topic: 'A equipa multidisciplinar da PRUMO', hook: 'Engenheiros e técnicos', coreMessage: 'Especialistas OpenBIM trabalham lado a lado.' },
]

test('a brand\'s subjects are its repeated acronyms and project names, never its own name or everyday acronyms', () => {
  const subjects = strategy.brandSubjects({ ...brand, about: brand.about + ' Contact our CEO for a VAT quote.' })
  assert.ok(subjects.includes('BIM'))
  assert.ok(subjects.includes('Ministério da Justiça'))
  for (const not of ['PRUMO', 'SOALHEIRO', 'CEO', 'VAT']) assert.ok(!subjects.includes(not), not)
  assert.ok(strategy.mentionsSubject('modelação OpenBIM 4D', 'BIM'))
  assert.ok(!strategy.mentionsSubject('relatório bimestral', 'BIM'), 'a word that merely contains the letters is not a mention')
  assert.ok(strategy.mentionsSubject('obra no ministerio da justica', 'Ministério da Justiça'))
})

test('a subject most recent ideas mention becomes recurring; the next angle steers away and says what to avoid', () => {
  const history = strategy.ideaHistory(bimIdeas)
  assert.deepEqual(strategy.recurringSubjects(brand, history), ['BIM'])
  assert.deepEqual(strategy.recurringSubjects(brand, strategy.ideaHistory(bimIdeas.slice(0, 1))), [], 'one idea is not a pattern')
  for (let i = 0; i < 20; i++) {
    const angle = strategy.chooseAngle(brand, history)
    const about = `${angle.facet.label} ${angle.facet.detail}`
    if (strategy.mentionsSubject(about, 'BIM')) assert.ok(!angle.avoid?.includes('BIM'), 'a BIM part of the brand may still be named when chosen')
    else assert.deepEqual(angle.avoid, ['BIM'])
  }
  const picks = Array.from({ length: 40 }, () => strategy.chooseAngle(brand, history)).filter(a => strategy.mentionsSubject(`${a.facet.label} ${a.facet.detail}`, 'BIM'))
  assert.ok(picks.length < 8, `BIM-based angles should wait their turn (${picks.length} of 40)`)
})

test('idea history keeps what each idea said, even when the client only sends its topic', () => {
  const merged = strategy.ideaHistory([{ topic: bimIdeas[1].topic, pillar: 'Projects / Cases' }], bimIdeas)
  assert.match(merged.find(i => i.topic === bimIdeas[1].topic).text, /modelação BIM/)
})

function ideasHandler(outputs, saved) {
  const requests = []
  const completion = async (_client, request) => { requests.push(request); return { choices: [{ message: { content: JSON.stringify(outputs.shift()) }, finish_reason: 'stop' }] } }
  const db = { collection: () => ({ findOne: async () => ({ brandContext: brand, creationState: { ideas: saved } }) }) }
  const run = new Function('Groq', 'process', 'loadGenerationBrandContext', 'EXTRACTED_CONTEXT_RULES', 'compactBrand', 'budgetedModels', 'budgetedCompletion', 'NextResponse', 'corsify', 'randomUUID', 'cleanCopy', 'retrySeconds', 'availableGroqCompletion', ...Object.keys(strategy), load('lib/handlers/contentIdeasHandler.ts') + ';return handleGenerateContentIdeas')(
    class {}, { env: { GROQ_API_KEY: 'test' } }, async () => ({ ...brand }), EXTRACTED_CONTEXT_RULES, x => x,
    async () => ({ data: [{ id: 'llama-3.3-70b-versatile' }] }), completion, { json: (body, options) => ({ body, status: options?.status || 200 }) }, r => r, () => 'unique', r => r, () => 60, completion, ...Object.values(strategy))
  return { requests, run: body => run(body, db) }
}

test('a suggested idea is told to leave the recurring subject out, is retried when it brings it up, and carries it to the copywriter', async () => {
  const withBim = { ideas: [{ topic: 'O BIM na reabilitação sísmica', hook: 'Mais segurança', coreMessage: 'O BIM ajuda a reforçar estruturas.', format: 'single' }] }
  const without = { ideas: [{ topic: 'Reforço estrutural de moradias antigas', hook: 'Mais segurança', coreMessage: 'Reforçar a estrutura protege quem lá vive.', format: 'single' }] }
  const { run, requests } = ideasHandler([withBim, without], bimIdeas)
  const result = await run({ brandContext: { id: 'prumo' }, format: 'single' })
  assert.equal(result.status, 200)
  assert.match(requests[0].messages[1].content, /AVOID REPEATING[\s\S]*"BIM"/)
  assert.equal(requests.length, 2)
  assert.match(requests[1].messages[1].content, /mentions BIM/)
  assert.deepEqual(result.body.ideas[0].avoid, ['BIM'])
})

test('a typed idea about the recurring subject is allowed', async () => {
  const brief = { ideas: [{ topic: 'Como o BIM evita conflitos em obra', hook: 'Menos surpresas', coreMessage: 'O BIM deteta conflitos antes da obra.', format: 'single' }] }
  const { run, requests } = ideasHandler([brief], bimIdeas)
  const result = await run({ brandContext: { id: 'prumo' }, userIdea: 'A post about how BIM avoids clashes on site', format: 'single' })
  assert.equal(requests.length, 1)
  assert.doesNotMatch(requests[0].messages[1].content, /AVOID REPEATING/)
  assert.equal(result.body.ideas[0].avoid, undefined)
})

function copywriter(outputs) {
  const requests = []
  const source = load('lib/handlers/copywritingHandler.ts')
  const run = new Function('Groq', 'process', 'loadGenerationBrandContext', 'EXTRACTED_CONTEXT_RULES', 'compactBrand', 'budgetedModels', 'budgetedCompletion', 'NextResponse', 'corsify', 'cleanCopy', 'retrySeconds', ...Object.keys(strategy), source + ';return handleGenerateCopywriting')(
    class {}, { env: { GROQ_API_KEY: 'test' } }, async () => ({ ...brand }), '', x => x, async () => ({ data: [{ id: 'llama-3.3-70b-versatile' }] }),
    async (_c, request) => { requests.push(request); return { choices: [{ message: { content: JSON.stringify(outputs.shift()) }, finish_reason: 'stop' }] } },
    { json: (body, options) => ({ body, status: options?.status || 200 }) }, x => x, x => x, () => 60, ...Object.values(strategy))
  return { requests, run: idea => run({ idea }, {}) }
}

test('the copywriter leaves out a subject recent posts already covered, unless the post is about it', async () => {
  const repeated = { format: 'single', headline: 'Fachadas com história', supportingText: 'Planeamos cada intervenção em BIM.', caption: 'Reabilitação cuidada.', hashtags: ['#reabilitacao'] }
  const clean = { format: 'single', headline: 'Fachadas com história', supportingText: 'Cada intervenção respeita o original.', caption: 'Reabilitação cuidada.', hashtags: ['#reabilitacao'] }
  const facades = { format: 'single', topic: 'Reabilitação de fachadas históricas', coreMessage: 'Respeitar o original.', avoid: ['BIM'] }
  const first = copywriter([repeated, clean])
  const result = await first.run(facades)
  assert.equal(result.status, 200)
  assert.match(first.requests[0].messages[1].content, /AVOID REPEATING[\s\S]*"BIM"/)
  assert.match(first.requests[1].messages[1].content, /Repetition: the copy mentions BIM/)
  assert.equal(result.body.supportingText, clean.supportingText)
  // A hashtag counts too.
  const tagged = copywriter([{ ...clean, hashtags: ['#BIM'] }, clean])
  await tagged.run(facades)
  assert.equal(tagged.requests.length, 2)
  // A post whose brief is about BIM may name it.
  const about = copywriter([repeated])
  await about.run({ ...facades, topic: 'Como o BIM planeia a reabilitação de fachadas' })
  assert.equal(about.requests.length, 1)
  assert.doesNotMatch(about.requests[0].messages[1].content, /AVOID REPEATING/)
})
