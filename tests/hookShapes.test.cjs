const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')

const load = file => stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))
const strategy = new Function(load('lib/services/contentLanguage.ts') + load('lib/services/contentAngles.ts') + load('lib/services/ideaRequest.ts') + load('lib/services/postImages.ts') + load('lib/services/copyFacts.ts') + load('lib/services/postFeedback.ts')
  + ';return {postLanguage,HOOK_SHAPES,hookChoiceBlock,hookRepeats,hookSubjectIssue,cutMachinePhrases,feedbackBlock,loadPostFeedback,withoutDislikedDesigns,hookIssues,callsOutReader,aiTells,resultClaims,unbackedPromises,readSlideCount,slideCountRule,fitOutline,readLanguageChoice,lengthOf,contentLanguage,languageIssues,copyTexts,withModernSpelling,chooseAngle,ideaHistory,topicSimilarity,readIdeaRequest,ideaRequestBlock,formatRule,finalFormat,IDEA_REQUEST_RULE,postImageIds,prepareIdeaImages,postImagesBlock,inventedFigures,ideaOutline,outlineIssue,recurringSubjects,mentionsSubject,chooseCarouselLength,CAROUSEL_LENGTHS}')()
const { EXTRACTED_CONTEXT_RULES } = new Function(load('lib/services/generationBrandContext.ts') + ';return {EXTRACTED_CONTEXT_RULES}')()

test('how a hook opens is the model’s choice; only an opening that repeats a recent post is sent back', () => {
  const history = strategy.ideaHistory([
    { topic: 'A', hook: 'Construction marketers, turn your website into posts', targetAudience: 'construction marketers' },
    { topic: 'B', hook: 'POV: the client books a haircut without calling' },
  ])
  // Ideas from before the model chose: a hook that addressed the reader counts as a call-out.
  assert.equal(history[0].hookShape, 'callout')
  const block = strategy.hookChoiceBlock(history)
  assert.match(block, /HOW TO OPEN \(your choice\)[\s\S]*"hookShape"/)
  for (const shape of strategy.HOOK_SHAPES) assert.ok(block.includes(`- ${shape.id}:`), shape.id)
  assert.match(block, /recent posts opened like this[\s\S]*Construction marketers, turn your website[\s\S]*POV: the client books/)
  assert.match(block, /already opened by addressing the reader: do not open this one that way/)
  assert.doesNotMatch(block, /\(required\)/, 'no shape is imposed')
  assert.match(strategy.hookRepeats('POV: the client books a table online', history)[0], /opens like a recent post/)
  assert.match(strategy.hookRepeats('Shop owners, your posts can write themselves', history)[0], /addressing the reader, like a recent post did/)
  assert.deepEqual(strategy.hookRepeats('Batkle turns your website into a month of Instagram posts', history), [])
  assert.deepEqual(strategy.hookRepeats('Anything at all', []), [])
})

test('a hook must contain what the model says a reader understands from it alone', () => {
  assert.match(strategy.hookSubjectIssue('Your feed repeats the same post style three days straight.', 'Batkle’s rotating content ideas')[0], /does not say what the post is about/)
  assert.deepEqual(strategy.hookSubjectIssue('Batkle writes a month of Instagram posts from your website', 'Batkle writing posts from a website'), [])
  assert.deepEqual(strategy.hookSubjectIssue('Pintar a fachada sem tratar as fissuras sai caro', 'fissuras na fachada'), [], 'accents and word forms are matched')
  assert.deepEqual(strategy.hookSubjectIssue('Anything', ''), [], 'no stated subject: nothing to compare')
})

test('a hook that names or addresses its audience is caught; other openings are not', () => {
  const calls = [
    ['Construction marketers, turn your website into Instagram gold in 5 simple steps', 'construction marketers'],
    ['Empresas de construção, o vosso site pode trabalhar por vocês', 'empresas de construção em Lisboa'],
    ['Para donos de restaurantes: as reservas começam no Instagram', ''],
    ['Se és dono de uma barbearia, isto é para ti', ''],
    ['If you run a small shop, read this first', ''],
    ['Senhorios em Lisboa: a fachada precisa de obras?', 'senhorios de prédios antigos'],
  ]
  for (const [hook, audience] of calls) assert.ok(strategy.callsOutReader(hook, audience), hook)
  const fine = [
    ['A bigger website is not a better website.', 'shop owners'],
    ['POV: a obra devia demorar três semanas. Vai no quarto mês.', 'donos de moradias'],
    ['4 sinais de que o seu site está a perder clientes', 'empresas locais'],
    ['O telefone tocou numa sexta: metade do teto estava no chão.', 'proprietários'],
    ['Porque é que a humidade volta todos os invernos?', 'proprietários de casas antigas'],
  ]
  for (const [hook, audience] of fine) assert.ok(!strategy.callsOutReader(hook, audience), hook)
  assert.deepEqual(strategy.hookIssues('Construction marketers, turn your website…', 'callout', 'construction marketers'), [], 'fine when the shape is a call-out')
  assert.match(strategy.hookIssues('Construction marketers, turn your website…', 'scene', 'construction marketers')[0], /opens by naming or addressing who the post is for[\s\S]*a scene they know/)
})

test('machine-sounding phrases are found in English and Portuguese', () => {
  const caption = 'Batkle turns that juggling act into a five-step workflow. The result is on-brand content in minutes. Want to see it in action?'
  assert.deepEqual(strategy.aiTells([caption]).sort(), ['in minutes', 'the result is', 'turns that juggling act into', 'want to see it', 'want to see it in action?'])
  assert.deepEqual(strategy.aiTells(['O resultado? Conteúdo em minutos. Não é apenas um site.']).sort(), ['em minutos', 'não é apenas', 'o resultado?'])
  assert.deepEqual(strategy.aiTells(['Planeamos a obra contigo antes de partir uma parede.']), [])
  // From a real run: the turns the first version of these checks let through.
  const missed = 'Quer transformar o seu site num motor de novos clientes? O resultado são processos duplicados. O nosso modelo vai além de um fornecedor.'
  const found = strategy.aiTells([missed])
  for (const phrase of ['transformar o seu site num', 'o resultado são', 'vai além de']) assert.ok(found.some(f => f.includes(phrase)), `${phrase} in ${found}`)
  assert.ok(found.some(f => f.endsWith('?')), 'the pitch question')
  assert.deepEqual(strategy.aiTells(['Porque é que a humidade volta todos os invernos?']), [], 'a plain question is fine')
})

test('free offers and explicit guarantees need the profile to make them; "garantimos que" is not one', () => {
  assert.deepEqual(strategy.unbackedPromises(['Contacte-nos para uma auditoria gratuita.', 'Estratégia à medida, crescimento garantido.']).sort(), ['garantido', 'gratuita'])
  assert.deepEqual(strategy.unbackedPromises(['Garantimos que a frequência é a ideal.']), [])
  assert.deepEqual(strategy.unbackedPromises(['Orçamento gratuito.'], 'We offer a free quote'), [], 'the profile offers it')
})

test('result claims without figures are caught unless the profile makes them', () => {
  const copy = ['O site passou a aparecer primeiro e as chamadas de contacto cresceram significativamente.', 'Houve um aumento significativo nos pedidos de contacto.', 'Bookings increased significantly after launch.']
  assert.equal(strategy.resultClaims(copy).length, 3)
  assert.deepEqual(strategy.resultClaims(['Criámos um site com marcação online.']), [])
  assert.deepEqual(strategy.resultClaims(['Houve um aumento significativo nos pedidos.'], 'The client saw um aumento significativo in requests'), [], 'the profile’s own claim may be repeated')
})

test('the idea prompt asks for a hook that says what the post is about, in the model’s own choice of opening', async () => {
  const brand = { id: 'b', name: 'PRUMO', language: 'Portuguese', languageVariant: 'pt-PT', about: 'Reabilitação de fachadas em Lisboa.', services: ['Fachadas — reabilitação'], targetAudience: 'proprietários' }
  const saved = [{ topic: 'Coberturas antes do inverno', hook: 'Proprietários de Lisboa, a vossa cobertura aguenta o inverno?', targetAudience: 'proprietários' }]
  const callout = { ideas: [{ topic: 'Reabilitação de fachadas antigas em Lisboa', format: 'single', hookShape: 'callout', hook: 'Proprietários de Lisboa, a vossa fachada precisa de atenção', coreMessage: 'Avaliar antes de obrar.', targetAudience: 'proprietários de prédios antigos' }] }
  const mistake = { ideas: [{ topic: 'Reabilitação de fachadas antigas em Lisboa', format: 'single', hookShape: 'mistake', hookOptions: ['a', 'b', 'c'], hook: 'Pintar a fachada sem tratar as fissuras sai caro duas vezes', coreMessage: 'Avaliar antes de obrar.', targetAudience: 'proprietários de prédios antigos' }] }
  const outputs = [callout, mistake], requests = []
  const completion = async (_c, request) => { requests.push(request); return { choices: [{ message: { content: JSON.stringify(outputs.shift()) }, finish_reason: 'stop' }] } }
  const db = { collection: () => ({ findOne: async () => ({ brandContext: brand, creationState: { ideas: saved } }) }) }
  const run = new Function('Groq', 'process', 'loadGenerationBrandContext', 'EXTRACTED_CONTEXT_RULES', 'compactBrand', 'budgetedModels', 'budgetedCompletion', 'NextResponse', 'corsify', 'randomUUID', 'cleanCopy', 'retrySeconds', 'availableGroqCompletion', ...Object.keys(strategy), load('lib/handlers/contentIdeasHandler.ts') + ';return handleGenerateContentIdeas')(
    class {}, { env: { GROQ_API_KEY: 'test' } }, async () => ({ ...brand }), EXTRACTED_CONTEXT_RULES, x => x,
    async () => ({ data: [{ id: 'llama-3.3-70b-versatile' }] }), completion, { json: (body, options) => ({ body, status: options?.status || 200 }) }, r => r, () => 'unique', r => r, () => 60, completion, ...Object.values(strategy))
  const result = await run({ brandContext: { id: 'b' } }, db)
  assert.equal(result.status, 200)
  const system = requests[0].messages[0].content, prompt = requests[0].messages[1].content
  assert.match(system, /Clear on its own[\s\S]*knows what the post is about[\s\S]*Your feed repeats the same post style three days straight\.[\s\S]*fails/)
  assert.match(system, /A reason to read on/)
  assert.match(system, /"hookOptions": Three different candidate hooks/)
  assert.match(system, /ONE kind of reader/)
  assert.match(prompt, /HOW TO OPEN \(your choice\)[\s\S]*Proprietários de Lisboa, a vossa cobertura/)
  assert.equal(requests.length, 2, 'a second call-out in a row is sent back once')
  assert.match(requests[1].messages[1].content, /opens like a recent post|addressing the reader, like a recent post did/)
  assert.equal(result.body.ideas[0].hookShape, 'mistake', 'the model’s choice travels with the brief to the copywriter')
  assert.equal(result.body.ideas[0].hook, 'Pintar a fachada sem tratar as fissuras sai caro duas vezes')
})

test('machine phrases that come out cleanly are cut; a field they would empty is left alone', () => {
  assert.equal(strategy.cutMachinePhrases('The result is on-brand content, every week.'), 'On-brand content, every week.')
  assert.equal(strategy.cutMachinePhrases('Most brands translate. The result? Clunky wording.'), 'Most brands translate. Clunky wording.')
  assert.equal(strategy.cutMachinePhrases('The result: a feed that looks like you.'), 'A feed that looks like you.')
  assert.equal(strategy.cutMachinePhrases('Traduzir sai caro. O resultado é que o texto perde o tom.'), 'Traduzir sai caro. O texto perde o tom.')
  assert.equal(strategy.cutMachinePhrases('O resultado? Mais pedidos de orçamento.'), 'Mais pedidos de orçamento.')
  assert.equal(strategy.cutMachinePhrases('Batkle reads your site. Want to see it in action? Paste your link.'), 'Batkle reads your site. Paste your link.')
  assert.equal(strategy.cutMachinePhrases('Lê o seu site.\nQuer ver como funciona?\nCole o link.'), 'Lê o seu site.\nCole o link.')
  assert.equal(strategy.cutMachinePhrases('Want to see how it works?'), 'Want to see how it works?', 'a field it would empty stays')
  assert.equal(strategy.cutMachinePhrases('and the result is great'), 'and the result is great', 'only where a sentence opens with it')
  assert.deepEqual(strategy.aiTells([strategy.cutMachinePhrases('The result is clunky wording. Want to see it in action?')]), [])
})
