const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { stripTypeScriptTypes } = require('node:module')
const { seeds, generation, study } = require('./globalDesigns.test.cjs')

const load = file => stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))
const meta = new Function(load('lib/ads/meta.ts') + ';return { AD_PLACEMENTS, DEFAULT_PLACEMENTS, AD_TEXT_LIMITS, AD_ANGLES, CREATIVE_LIMITS, STORY_SAFE, META_CTAS, AD_OBJECTIVES, AD_VARIANTS, AD_FORMATS, CAROUSEL_CARDS, CAROUSEL_PLACEMENTS, CAROUSEL_DEFAULT_PLACEMENTS, placementById, objectiveById, isMetaCta, readFormat, readCards, placementsFor, defaultPlacements, readPlacements, adCredits }')()
const story = new Function(load('lib/designs/global/story.ts') + ';return { toStoryCanvas, storyArea, STORY_FRAME }')()
const language = new Function(load('lib/services/contentLanguage.ts') + load('lib/services/copyFacts.ts') + load('lib/services/contentAngles.ts') + ';return { postLanguage, languageIssues, modernPortuguese, inventedFigures, brandSubjects, mentionsSubject, aiTells, resultClaims }')()

function adHandlers(overrides = {}) {
  const deps = {
    NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) }, randomUUID: crypto.randomUUID, Groq: class {},
    availableGroqCompletion: async () => { throw Error('no model in tests') }, compactBrand: brand => brand,
    loadGenerationBrandContext: async () => null, EXTRACTED_CONTEXT_RULES: '', persistInlineImages: async (_db, c) => c, ensureBrandLogoVariants: async () => null,
    chooseBrandFamily: async () => null, renderGlobalPost: generation.renderGlobalPost, hydrateBrandFamilies: async () => [],
    familyGrammar: study.familyGrammar, familyImagery: study.familyImagery,
    chargeCredits: async () => ({}), findCharge: async () => null, grantExtraCredits: async () => true, refundCharge: async () => true, requireFeature: async () => {}, settleCharge: async () => true,
    requireOwnBrands: async () => {}, sanitizeDesignPlan: (_f, copy) => copy, planAssets: async () => ({ slots: [] }),
    ...language, ...meta, toStoryCanvas: story.toStoryCanvas, ...overrides,
  }
  return new Function(...Object.keys(deps), load('lib/handlers/adHandlers.ts') + ';return { readAdBrief, fitChars, dropPointers, pickHeadlines, adCopyIssues, closingNote, asideTerms, proofPoints, normalizeAdCopy, writeAdCopy, creativeCopy, adFamily, composeAtSize, handlePlanAd, handleBuildAd, handleUpdateAdCopy }')(...Object.values(deps))
}
const ads = adHandlers()
const portuguese = language.postLanguage({ language: 'Portuguese', languageVariant: 'pt-PT' })

// A draft that follows every rule: three angles, Meta's limits, one language, facts from the profile.
const goodCopy = () => ({
  primaryText: [
    'Senhorios em Lisboa: a fachada precisa de obras? Avaliamos no local e explicamos o que fazer.',
    'A fachada tem fissuras e a humidade já entrou em casa.\nVamos ao local, vemos a causa e dizemos o que fazer.\nTrabalhámos na fachada do Ministério da Justiça.\nPeça a avaliação sem compromisso.',
    'Reabilitámos a fachada e a cobertura do Ministério da Justiça.\nAgora avaliamos a sua, com o mesmo cuidado.\nPeça orçamento: vamos ao local e explicamos cada passo.',
  ],
  headlines: ['Avaliação de fachadas em Lisboa', 'Orçamento sem compromisso', 'Fachadas sem fissuras'],
  description: 'Alvará de Obra Pública', cta: 'Get Quote',
  creative: { headline: 'A sua fachada precisa de obras?', supportingText: 'Avaliamos no local', label: 'Avaliação no local', cta: 'Diga-nos o que a fachada precisa' },
  image: { subject: 'historic building facade with scaffolding', queries: ['facade scaffolding'] },
})

// A four-card carousel that follows every rule: a hook, two reasons, the offer with the action on the last image.
const goodCarousel = () => ({
  primaryText: goodCopy().primaryText, cta: 'Get Quote',
  cards: [
    { headline: 'Fissuras na fachada?', description: 'Avaliação no local', creative: { headline: 'A sua fachada tem fissuras?', supportingText: '', cta: '' }, image: { subject: 'cracked old facade', queries: ['cracked facade'] } },
    { headline: 'Vemos a causa no local', description: '', creative: { headline: 'Vamos ao local ver a causa', supportingText: 'E explicamos o que fazer' }, image: { subject: 'engineer inspecting a wall', queries: ['wall inspection'] } },
    { headline: 'Obra no Ministério da Justiça', description: 'Com alvará', creative: { headline: 'A fachada do Ministério da Justiça', supportingText: 'Reabilitada pela nossa equipa' }, image: { subject: 'restored government building facade', queries: ['restored facade'] } },
    { headline: 'Orçamento sem compromisso', description: '', creative: { headline: 'Orçamento sem compromisso', supportingText: '', cta: 'Diga-nos o que a fachada precisa' }, image: { subject: 'facade with scaffolding', queries: ['facade scaffolding'] } },
  ],
})

test('Meta’s sizes, limits, angles and buttons', () => {
  assert.deepEqual(meta.AD_PLACEMENTS.map(p => [p.ratio, p.width, p.height]), [['4:5', 1080, 1350], ['1:1', 1080, 1080], ['9:16', 1080, 1920], ['1.91:1', 1200, 628]])
  assert.deepEqual(meta.readPlacements(['landscape', 'story', 'nope']), ['story', 'landscape'])
  assert.deepEqual(meta.readPlacements([]), meta.DEFAULT_PLACEMENTS)
  assert.deepEqual(meta.AD_TEXT_LIMITS, { primaryText: 125, primaryTextMax: 500, headline: 40, headlineVisible: 27, description: 30, cardDescription: 20 })
  assert.deepEqual(meta.AD_ANGLES.map(a => a.id), ['short', 'problem', 'proof'])
  assert.equal(meta.AD_ANGLES.length, meta.AD_VARIANTS)
  assert.ok(meta.AD_ANGLES.every(a => /call to action/.test(a.use)), 'every version ends by telling the reader what to do')
  assert.ok(meta.isMetaCta('Learn More') && !meta.isMetaCta('Click here'))
  assert.equal(meta.objectiveById('nope').id, 'traffic')
})

test('carousels: 2 to 10 cards, never landscape, square by default, one credit per card at each size', () => {
  assert.deepEqual(meta.AD_FORMATS.map(f => f.id), ['single', 'carousel'])
  assert.equal(meta.readFormat('carousel'), 'carousel'); assert.equal(meta.readFormat('reel'), 'single')
  assert.deepEqual([meta.readCards(1), meta.readCards('6'), meta.readCards(40), meta.readCards('x')], [2, 6, 10, meta.CAROUSEL_CARDS.default])
  assert.deepEqual(meta.readPlacements(['landscape', 'story'], 'carousel'), ['story'])
  assert.deepEqual(meta.readPlacements(['landscape'], 'carousel'), ['feed-square'], 'only landscape asked: the carousel default')
  assert.deepEqual(meta.placementsFor('carousel'), ['feed-portrait', 'feed-square', 'story'])
  assert.equal(meta.adCredits({ format: 'single', cards: 1, placements: ['feed-square', 'story'] }), 2)
  assert.equal(meta.adCredits({ format: 'carousel', cards: 5, placements: ['feed-square', 'story'] }), 10)
})

test('a brief needs what the ad promotes; the button follows the goal unless one is picked', () => {
  assert.throws(() => ads.readAdBrief({ brief: { offer: ' ' } }), /promotes/)
  assert.throws(() => ads.readAdBrief({ brief: { offer: 'Facade repairs', url: 'ftp://x' } }), /http/)
  const brief = ads.readAdBrief({ brief: { offer: '  Free on-site assessment  ', objective: 'leads', placements: ['story'], designId: 'starter-x' } })
  assert.deepEqual(brief, { offer: 'Free on-site assessment', objective: 'leads', audience: '', incentive: '', url: '', cta: 'Get Quote', format: 'single', cards: 1, placements: ['story'], designId: undefined })
  assert.equal(ads.readAdBrief({ brief: { offer: 'Course', incentive: '  First class free  ' } }).incentive, 'First class free')
  assert.equal(ads.readAdBrief({ brief: { offer: 'Course', objective: 'sales', cta: 'Sign Up' } }).cta, 'Sign Up')
  const carousel = ads.readAdBrief({ brief: { offer: 'Course', format: 'carousel', cards: 12, placements: ['landscape', 'feed-portrait'] } })
  assert.deepEqual([carousel.format, carousel.cards, carousel.placements], ['carousel', 10, ['feed-portrait']])
})

test('ad copy is checked: three angles, Meta’s limits, a first line that stops the reader, no filler, no invented figures', () => {
  const facts = 'Ministério da Justiça Alvará de Obra Pública'
  assert.deepEqual(ads.adCopyIssues(goodCopy(), portuguese, facts), [])
  const issues = (patch, source = facts) => ads.adCopyIssues({ ...goodCopy(), ...patch }, portuguese, source).join(' | ')
  assert.match(issues({ primaryText: goodCopy().primaryText.slice(0, 1) }), /must have 3 versions/)
  assert.match(issues({ primaryText: ['x'.repeat(130), ...goodCopy().primaryText.slice(1)] }), /primary text 1 has 130 characters; the limit is 125/)
  assert.match(issues({ primaryText: [goodCopy().primaryText[0], `${'Uma primeira linha que nunca mais acaba e que o Meta corta muito antes de a pessoa perceber do que trata este anúncio de obras'}\nDepois.`, goodCopy().primaryText[2]] }), /first line of primary text 2/)
  assert.match(issues({ headlines: ['Avaliação gratuita de fachadas históricas em Lisboa'] }), /headline has \d+ characters; the limit is 40/)
  assert.match(issues({ cta: 'Click here' }), /cta must be one of/)
  assert.match(issues({ creative: { ...goodCopy().creative, headline: 'Uma frase longa demais para a imagem do anúncio' } }), /creative.headline has more than 7 words/)
  assert.match(issues({ creative: { ...goodCopy().creative, cta: 'Diga-nos já o que a sua fachada precisa hoje' } }), /creative.cta has more than 6 words/)
  assert.match(issues({ headlines: ['Descubra a nossa avaliação'] }), /marketing filler \(Descubra\)/)
  assert.match(issues({ primaryText: ['Poupe 40% este mês na reabilitação de fachadas.', ...goodCopy().primaryText.slice(1)] }), /figures/)
  // Five headline candidates: the ones over the limit or with filler are left out, so they spoil nothing.
  assert.deepEqual(ads.adCopyIssues({ ...goodCopy(), headlines: ['Descubra a nossa avaliação', ...goodCopy().headlines, 'Avaliação gratuita de fachadas históricas em Lisboa'] }, portuguese, facts), [])
  // A closing "Saiba mais" is taken off, not asked again for.
  assert.deepEqual(issues({ primaryText: [goodCopy().primaryText[0] + ' Saiba mais', ...goodCopy().primaryText.slice(1)] }), '')
})

test('“free” only when the profile says so, three different endings, and a client’s name is never an off-topic acronym', () => {
  const facts = 'Ministério da Justiça Alvará de Obra Pública'
  const issues = (patch, source = facts) => ads.adCopyIssues({ ...goodCopy(), ...patch }, portuguese, source).join(' | ')
  assert.match(issues({ description: 'Orçamento gratuito' }), /calls something free/)
  assert.equal(issues({ description: 'Orçamento gratuito' }, `${facts} free quote`), '')
  const same = goodCopy().primaryText.map((t, i) => (i ? `${t.split('\n').slice(0, -1).join('\n')}\nPeça já o seu orçamento.` : `${t} Peça já o seu orçamento.`))
  assert.match(issues({ primaryText: same }), /end with the same line/)
  const agency = { name: 'KACHICA', about: 'For Barber PH, a barbershop, KACHICA built a booking site. Barber PH now takes bookings online.', services: ['Website Creation'] }
  assert.deepEqual(ads.asideTerms(agency, { offer: 'Website Creation', audience: '' }), [], 'PH is part of “Barber PH”')
  assert.deepEqual(ads.asideTerms({ name: 'PRUMO', about: 'Engineering with BIM. BIM coordination across projects.' }, { offer: 'Fachadas', audience: '' }), ['BIM'])
})

test('Meta’s three headlines come from the candidates that fit, never cut short; a closing “learn more” goes', () => {
  assert.deepEqual(ads.pickHeadlines(['Descubra a nossa avaliação', 'Avaliação gratuita de fachadas históricas em Lisboa', 'Fachadas sem fissuras', 'Orçamento após uma visita', 'Fachadas sem fissuras', 'Obra do Ministério da Justiça']),
    ['Fachadas sem fissuras', 'Orçamento após uma visita', 'Obra do Ministério da Justiça'])
  assert.deepEqual(ads.pickHeadlines(['Avaliação gratuita de fachadas históricas em Lisboa']), ['Avaliação gratuita de fachadas históricas em Lisboa'], 'when nothing fits, the one there is (cut later)')
  assert.equal(ads.dropPointers('Mais marcações, menos telefonemas. Saiba mais'), 'Mais marcações, menos telefonemas.')
  assert.equal(ads.dropPointers('Primeira linha.\nPeça orçamento.\nSaiba mais.'), 'Primeira linha.\nPeça orçamento.')
  assert.equal(ads.dropPointers('Learn more'), 'Learn more', 'a text that is only a closer stays, to be rejected')
  assert.equal(ads.dropPointers('Mais clientes na sua barbearia. Descubra como.\nSaiba mais e comece a receber reservas.\nClique para saber como.'), 'Mais clientes na sua barbearia.')
  // Meta draws its button under the image: a closing line that points at it, or is the button in other words or
  // another language, is left off the image.
  const repeats = ['Saiba Mais', 'Get Quote', 'Get Quote Now', 'Send us a message', 'Peça orçamento', 'Peça já o seu orçamento', 'Envie-nos uma mensagem', 'Contact us to learn more']
  for (const cta of repeats)
    assert.equal(ads.normalizeAdCopy({ ...goodCopy(), creative: { ...goodCopy().creative, cta } }, ads.readAdBrief({ brief: { offer: 'Fachadas' } }), 'pt-PT').creative.cta, '', `“${cta}” only repeats the button`)
  for (const cta of ['Tell us what your site needs', 'Tell us about the job'])
    assert.equal(ads.normalizeAdCopy({ ...goodCopy(), creative: { ...goodCopy().creative, cta } }, ads.readAdBrief({ brief: { offer: 'Fachadas' } }), 'en').creative.cta, cta, `“${cta}” says something the button does not`)
  // A repeated button (or no closing line) is no reason to rewrite the ad: the review is asked for other words.
  for (const cta of ['Saiba mais', 'Peça orçamento', ''])
    assert.deepEqual(ads.adCopyIssues({ ...goodCopy(), creative: { ...goodCopy().creative, cta } }, portuguese, 'Ministério da Justiça Alvará de Obra Pública'), [])
  assert.equal(ads.closingNote({ ...goodCopy(), creative: { ...goodCopy().creative, cta: 'Peça orçamento' } }), 'creative.cta (“Peça orçamento”) repeats Meta’s “Get Quote” button under the image; say what the reader gets by acting in 3 to 6 other words (such as “Ask us about your damp wall”), or leave it empty')
  assert.equal(ads.closingNote(goodCopy()), '')
  assert.equal(ads.closingNote({ ...goodCopy(), creative: { ...goodCopy().creative, cta: '' } }), '')
  const brief = ads.readAdBrief({ brief: { offer: 'Fachadas', objective: 'leads' } })
  const ad = ads.normalizeAdCopy({ ...goodCopy(), primaryText: ['Fachadas avaliadas no local. Saiba mais', ...goodCopy().primaryText.slice(1)], headlines: ['Seguidores que viram clientes fiéis e pagantes todos os meses', 'Fachadas sem fissuras', 'Orçamento após uma visita', 'Obra do Ministério da Justiça'] }, brief, 'pt-PT')
  assert.equal(ad.primaryText[0], 'Fachadas avaliadas no local.')
  assert.deepEqual(ad.headlines, ['Fachadas sem fissuras', 'Orçamento após uma visita', 'Obra do Ministério da Justiça'], 'a headline too long is left out, not cut to “Seguidores que viram”')
})

test('the profile’s proof points go to the copywriter by name: projects, facts in the description, differentiators', () => {
  const proof = ads.proofPoints({
    about: 'PRUMO is an engineering firm. It holds a public works licence (Alvará 120909). With over five years of experience and more than ten projects, it works in Lisbon.',
    projects: [{ name: 'Ministério da Justiça', description: 'Façade and roof rehabilitation' }, 'Sumol + Compal — Façades'],
    differentiators: ['BIM across the project lifecycle'],
  })
  assert.equal(proof[0], 'Ministério da Justiça: Façade and roof rehabilitation')
  assert.ok(proof.includes('Sumol + Compal — Façades'))
  assert.ok(proof.some(p => p.includes('Alvará 120909')))
  assert.ok(proof.some(p => p.includes('more than ten projects')))
  assert.ok(!proof.includes('PRUMO is an engineering firm.'), 'a sentence without a fact is not proof')
  assert.ok(proof.includes('BIM across the project lifecycle'))
})

test('copy is fitted at whole words, keeps its line breaks and is spelled in current Portuguese', () => {
  assert.equal(ads.fitChars('Reabilitação de fachadas históricas', 27), 'Reabilitação de fachadas')
  const brief = ads.readAdBrief({ brief: { offer: 'Fachadas', objective: 'leads' } })
  const ad = ads.normalizeAdCopy({
    primaryText: ['Um texto', 'Primeira linha\n\n  Segunda   linha ', 'Um texto'],
    headlines: ['Avaliação de fachadas históricas em Lisboa e arredores'], cta: 'nope',
    creative: { headline: 'Um dois três quatro cinco seis sete oito', label: 'Fachadas de Lisboa hoje', cta: 'Diga-nos o que precisa para a fachada' },
  }, brief, 'pt-PT')
  assert.deepEqual(ad.primaryText, ['Um texto', 'Primeira linha\nSegunda linha'], 'line breaks stay; repeated versions go')
  assert.ok(ad.headlines[0].length <= 40)
  assert.equal(ad.cta, 'Get Quote', 'an unknown button falls back to the goal’s')
  assert.equal(ad.creative.headline.split(' ').length, 7)
  assert.equal(ad.creative.label, 'Fachadas de Lisboa')
  assert.equal(ad.creative.cta, 'Diga-nos o que precisa', 'cut at six words, never on a dangling “para a”')
  assert.equal(ad.image, null)
})

test('the copywriter gets the proof points; the review fixes what the checks found; invented figures are never kept', async () => {
  const brand = { name: 'PRUMO', language: 'Portuguese', languageVariant: 'pt-PT', about: 'Engenharia e construção. Alvará de Obra Pública 120909.', projects: [{ name: 'Ministério da Justiça', description: 'Fachadas' }], services: ['Facade assessment — on-site inspection'] }
  const brief = ads.readAdBrief({ brief: { offer: 'Avaliação de fachadas', objective: 'leads' } })
  const reviewed = { ...goodCopy(), headlines: ['Fachadas avaliadas no local', ...goodCopy().headlines] }
  const answers = [{ ...goodCopy(), cta: 'Click here' }, reviewed]
  const asked = []
  const completion = async (_g, request) => { asked.push(request); return { choices: [{ message: { content: JSON.stringify(answers.shift()) } }] } }
  process.env.GROQ_API_KEY ||= 'test'
  const { copy } = await ads.writeAdCopy(brand, brief, completion)
  assert.match(asked[0].messages[1].content, /PROOF YOU MAY USE[\s\S]*Ministério da Justiça[\s\S]*Alvará de Obra Pública 120909/)
  assert.match(asked[0].messages[0].content, /Problem → answer[\s\S]*Proof first/)
  assert.match(asked[0].messages[0].content, /"plan"[\s\S]*the ONE service/)
  assert.equal(asked.length, 2, 'a usable draft goes straight to the review')
  assert.match(asked[1].messages[0].content, /creative director/)
  assert.match(asked[1].messages[1].content, /SERVICES[\s\S]*Facade assessment[\s\S]*DRAFT:[\s\S]*Avaliação de fachadas em Lisboa[\s\S]*THE CHECKS FOUND[\s\S]*cta must be one of/)
  assert.doesNotMatch(asked[1].messages[1].content, /BRAND PROFILE/, 'the review reads the services and the proof, not the whole profile')
  assert.equal(copy.headlines[0], 'Fachadas avaliadas no local', 'the review’s version is kept')
  assert.equal(copy.cta, 'Get Quote')
  assert.equal(copy.primaryText.length, 3)
  const invented = { ...goodCopy(), primaryText: ['Poupe 40% na reabilitação.', ...goodCopy().primaryText.slice(1)] }
  await assert.rejects(ads.writeAdCopy(brand, brief, async () => ({ choices: [{ message: { content: JSON.stringify(invented) } }] })), /could not be written/)
})

test('a draft with nothing usable is asked again first; when the review cannot fix a draft, the copywriter rewrites it', async () => {
  const brand = { name: 'PRUMO', language: 'Portuguese', languageVariant: 'pt-PT', about: 'Engenharia. Alvará de Obra Pública 120909.', projects: [{ name: 'Ministério da Justiça' }] }
  const brief = ads.readAdBrief({ brief: { offer: 'Avaliação de fachadas', objective: 'leads' } })
  const asked = []
  const reply = answers => async (_g, request) => { asked.push(request.messages[0].content.includes('creative director') ? 'review' : 'write'); const next = answers.shift(); return { choices: [{ message: { content: typeof next === 'string' ? next : JSON.stringify(next) } }] } }
  await ads.writeAdCopy(brand, brief, reply([{ ...goodCopy(), primaryText: ['Só uma'] }, goodCopy(), goodCopy()]))
  assert.deepEqual(asked, ['write', 'write', 'review'])
  asked.length = 0
  const { copy } = await ads.writeAdCopy(brand, brief, reply([{ ...goodCopy(), description: 'Orçamento gratuito' }, 'not json', goodCopy()]))
  assert.deepEqual(asked, ['write', 'review', 'write'])
  assert.equal(copy.description, 'Alvará de Obra Pública', 'the rewrite without the free claim is kept')
})

test('a closing line that repeats the button costs no rewrite: the review is asked for other words, else it is left off', async () => {
  const brand = { name: 'PRUMO', language: 'Portuguese', languageVariant: 'pt-PT', about: 'Engenharia. Alvará de Obra Pública 120909.', projects: [{ name: 'Ministério da Justiça' }] }
  const brief = ads.readAdBrief({ brief: { offer: 'Avaliação de fachadas', objective: 'leads' } })
  const echo = { ...goodCopy(), creative: { ...goodCopy().creative, cta: 'Peça já o seu orçamento' } }
  const run = async review => {
    const asked = [], answers = [echo, review]
    const { copy } = await ads.writeAdCopy(brand, brief, async (_g, request) => { asked.push(request); return { choices: [{ message: { content: JSON.stringify(answers.shift()) } }] } })
    return { asked, copy }
  }
  const fixed = await run(goodCopy())
  assert.equal(fixed.asked.length, 2, 'the draft, then the review')
  assert.match(fixed.asked[1].messages[1].content, /THE CHECKS FOUND[\s\S]*“Peça já o seu orçamento”\) repeats Meta’s “Get Quote” button/)
  assert.equal(fixed.copy.creative.cta, 'Diga-nos o que a fachada precisa')
  const kept = await run(echo)
  assert.equal(kept.asked.length, 2)
  assert.equal(kept.copy.creative.cta, '', 'the image has no closing line rather than the button twice')
})

test('a carousel is checked card by card: the number asked for, a headline under each, words on each image, the action on the last', () => {
  const facts = 'Ministério da Justiça Alvará de Obra Pública'
  assert.deepEqual(ads.adCopyIssues(goodCarousel(), portuguese, facts, [], 4), [])
  const issues = (cards, count = 4) => ads.adCopyIssues({ ...goodCarousel(), cards }, portuguese, facts, [], count).join(' | ')
  const good = goodCarousel().cards
  assert.match(issues(good.slice(0, 3)), /must have exactly 4 cards; it has 3/)
  const pointing = [...good.slice(0, 3), { ...good[3], creative: { ...good[3].creative, cta: 'Saiba mais' } }]
  assert.equal(issues(pointing), '')
  assert.match(ads.closingNote({ ...goodCarousel(), cards: pointing }, 4), /closing line on the last card’s image \(“Saiba mais”\) repeats Meta’s “Get Quote” button/)
  assert.match(issues([{ ...good[0], description: 'Avaliação técnica no local' }, ...good.slice(1)]), /description of card 1 is over 20/)
  assert.match(issues([{ ...good[0], headline: '' }, ...good.slice(1)]), /card 1 has no headline/)
  assert.match(issues([good[0], { ...good[1], creative: { headline: 'Vamos ao local ver a causa da humidade toda' } }, ...good.slice(2)]), /image words of card 2 have more than 7/)
  assert.match(issues([{ ...good[0], headline: 'Poupe 40% na fachada' }, ...good.slice(1)]), /figures/, 'the same fact checks as a single image')
  // The single image's headlines and badge play no part in a carousel.
  assert.deepEqual(ads.adCopyIssues({ ...goodCarousel(), headlines: [], creative: null }, portuguese, facts, [], 4), [])
})

test('a carousel is fitted per card, keeps the action on the last card only, and is no longer than asked', () => {
  const brief = ads.readAdBrief({ brief: { offer: 'Fachadas', objective: 'leads', format: 'carousel', cards: 3 } })
  const cards = [{ ...goodCarousel().cards[0], creative: { headline: 'Hook', cta: 'Peça já' } }, ...goodCarousel().cards.slice(1)]
  const ad = ads.normalizeAdCopy({ ...goodCarousel(), cards: [...cards.slice(0, 1), { ...cards[1], description: 'Uma descrição longa demais para o cartão' }, ...cards.slice(2)] }, brief, 'pt-PT')
  assert.equal(ad.cards.length, 3, 'a fourth card is left out')
  assert.ok(ad.cards[1].description.length <= 20)
  assert.deepEqual(ad.cards.map(c => c.creative.cta), ['', '', ''], 'the third card is now the last, and it had no action')
  assert.equal(ad.creative.headline, 'Hook', 'the ad’s creative is its first card’s')
  assert.deepEqual(ad.image, goodCarousel().cards[0].image)
  assert.equal(ad.headlines, undefined)
  const full = ads.normalizeAdCopy(goodCarousel(), { ...brief, cards: 4 }, 'pt-PT')
  assert.deepEqual(full.cards.map(c => c.creative.cta), ['', '', '', 'Diga-nos o que a fachada precisa'])
})

test('ads are written to sell to the ideal customer, harder than posts; a carousel is written and reviewed card by card', async () => {
  const brand = { name: 'PRUMO', language: 'Portuguese', languageVariant: 'pt-PT', about: 'Engenharia. Alvará de Obra Pública 120909.', projects: [{ name: 'Ministério da Justiça' }], targetAudience: 'Condomínios de prédios antigos em Lisboa' }
  const asked = []
  const answer = async (_g, request) => { asked.push(request); return { choices: [{ message: { content: JSON.stringify(goodCarousel()) } }] } }
  const brief = ads.readAdBrief({ brief: { offer: 'Avaliação de fachadas', objective: 'leads', format: 'carousel', cards: 4 } })
  const { copy } = await ads.writeAdCopy(brand, brief, answer)
  const [writer, review] = asked.map(r => r.messages[0].content)
  assert.match(writer, /An ad is not a post[\s\S]*SELL one service or product to the brand's ideal customer/)
  assert.match(writer, /"objection"/)
  assert.match(writer, /Every primary text ends by telling the reader what to do/)
  assert.match(writer, /exactly 4 cards[\s\S]*card 1: the hook[\s\S]*cards 2 to 3: one reason to buy each[\s\S]*card 4: the offer and the action/)
  assert.doesNotMatch(writer, /"headlines": \[/, 'a carousel has a headline per card, not three to test')
  assert.match(asked[0].messages[1].content, /"format":"carousel of 4 cards"[\s\S]*"idealCustomer":"Condomínios de prédios antigos em Lisboa"/, 'without an audience in the brief, the profile’s ideal customer')
  assert.match(review, /It sells[\s\S]*THIS AD IS A CAROUSEL: keep exactly the draft's number of cards/)
  assert.ok(asked[0].max_tokens > 4500, 'room for every card')
  assert.equal(copy.cards.length, 4)
  assert.equal(copy.cards[3].creative.cta, 'Diga-nos o que a fachada precisa')
  // A single image keeps its headlines to test and its one creative.
  asked.length = 0
  await ads.writeAdCopy(brand, ads.readAdBrief({ brief: { offer: 'Avaliação de fachadas', objective: 'leads' } }), async (_g, request) => { asked.push(request); return { choices: [{ message: { content: JSON.stringify(goodCopy()) } }] } })
  assert.match(asked[0].messages[0].content, /"headlines": \[5 versions/)
  assert.doesNotMatch(asked[0].messages[0].content, /exactly \d+ cards|CAROUSEL/)
  // A carousel that comes back with a single card cannot be made.
  const lonely = { ...goodCarousel(), cards: goodCarousel().cards.slice(0, 1) }
  await assert.rejects(ads.writeAdCopy(brand, brief, async () => ({ choices: [{ message: { content: JSON.stringify(lonely) } }] })), /carousel could not be written/)
})

test('a review that invents a figure or breaks more rules is dropped, and the draft is kept', async () => {
  const brand = { name: 'PRUMO', language: 'Portuguese', languageVariant: 'pt-PT', about: 'Engenharia. Alvará de Obra Pública 120909.', projects: [{ name: 'Ministério da Justiça' }] }
  const brief = ads.readAdBrief({ brief: { offer: 'Avaliação de fachadas', objective: 'leads' } })
  const run = async review => {
    const answers = [goodCopy(), review]
    return (await ads.writeAdCopy(brand, brief, async () => ({ choices: [{ message: { content: typeof answers[0] === 'string' ? answers.shift() : JSON.stringify(answers.shift()) } }] }))).copy
  }
  assert.equal((await run({ ...goodCopy(), headlines: ['Poupe 40% na sua fachada', ...goodCopy().headlines] })).headlines[0], 'Avaliação de fachadas em Lisboa')
  assert.equal((await run({ ...goodCopy(), headlines: ['Fachadas novas'], cta: 'Click here' })).headlines[0], 'Avaliação de fachadas em Lisboa')
  assert.equal((await run('not json')).headlines[0], 'Avaliação de fachadas em Lisboa', 'a review that fails to answer is skipped')
  const rejected = await ads.writeAdCopy(brand, brief, async (_g, request) => { if (/creative director/.test(request.messages[0].content)) throw new Error('rate limited'); return { choices: [{ message: { content: JSON.stringify(goodCopy()) } }] } })
  assert.equal(rejected.copy.headlines.length, 3)
})

test('Groq’s json_validate_failed (a reasoning model out of room) is retried without JSON mode, with more room', async () => {
  const brand = { name: 'PRUMO', language: 'Portuguese', languageVariant: 'pt-PT', about: 'Engenharia. Alvará de Obra Pública 120909.', projects: [{ name: 'Ministério da Justiça' }] }
  const brief = ads.readAdBrief({ brief: { offer: 'Avaliação de fachadas', objective: 'leads' } })
  const asked = []
  const completion = async (_g, request) => {
    asked.push(request)
    if (asked.length === 1) throw Object.assign(new Error('400 Failed to validate JSON'), { status: 400, error: { error: { code: 'json_validate_failed' } } })
    return { choices: [{ message: { content: `Here it is:\n${JSON.stringify(goodCopy())}\n` } }] }
  }
  const { copy } = await ads.writeAdCopy(brand, brief, completion)
  assert.equal(copy.headlines[0], 'Avaliação de fachadas em Lisboa')
  assert.ok(asked[0].response_format && !asked[1].response_format, 'the retry reads the object out of plain text')
  assert.ok(asked[1].max_tokens > asked[0].max_tokens)
})

test('a term the profile repeats but the brief does not mention stays out of the ad’s headlines and image words', () => {
  const profile = { name: 'PRUMO SOALHEIRO', about: 'Engineering with BIM. BIM coordination across projects.', services: ['BIM Services — modelling'] }
  assert.deepEqual(ads.asideTerms(profile, { offer: 'Avaliação de fachadas', audience: '' }), ['BIM'])
  assert.deepEqual(ads.asideTerms(profile, { offer: 'Coordenação BIM para obras', audience: '' }), [], 'an ad about BIM may name it')
  const withBim = { ...goodCopy(), headlines: ['BIM para coberturas'], creative: { ...goodCopy().creative, label: 'Serviço BIM' } }
  assert.match(ads.adCopyIssues(withBim, portuguese, 'BIM Ministério da Justiça Alvará de Obra Pública', ['BIM']).join(' '), /headline or the image words name BIM/)
  const inText = { ...goodCopy(), primaryText: [goodCopy().primaryText[0], `${goodCopy().primaryText[1]}\nModelação BIM incluída.`, goodCopy().primaryText[2]] }
  assert.deepEqual(ads.adCopyIssues(inText, portuguese, 'BIM Ministério da Justiça Alvará de Obra Pública', ['BIM']), [], 'the primary text may still mention it')
})

const brand = { id: 'brand', name: 'PRUMO SOALHEIRO', colors: ['#e3ad3b', '#393836'], fonts: ['Anton', 'Roboto'], website: 'https://prumo.pt' }
const adCopy = { primaryText: ['x'], headlines: ['x'], description: '', cta: 'Get Quote', creative: { headline: 'A sua fachada precisa de obras?', supportingText: 'Avaliamos no local', label: 'Fachadas', cta: 'Diga-nos o que a fachada precisa' }, image: { subject: 'historic facade', queries: ['facade'] } }
const plain = { slots: [{ slot_id: 'single_main', resolvedAsset: null }] }

test('the creative always looks for a picture, and carries the hook, the badge and a short call to action', () => {
  for (const family of seeds) {
    const copy = ads.creativeCopy(adCopy, family)
    assert.equal(copy.format, 'single')
    assert.equal(copy.imageChoice, 'on', '“With images”, whatever the design’s own habit')
    assert.deepEqual(copy.design.image, adCopy.image)
    assert.equal(copy.cta, 'Diga-nos o que a fachada precisa')
    assert.equal(copy.subheadline, 'Fachadas')
    assert.ok(study.familyGrammar(family).compositions.includes(copy.design.composition))
  }
})

test('ads read at a glance: the line under the hook one size up and the call to action a button; the rest is the design’s', () => {
  for (const family of seeds) {
    const own = study.familyGrammar(family), ad = study.familyGrammar(ads.adFamily(family))
    assert.equal(ad.body.scale, 'large')
    assert.equal(ad.cta, own.cta === 'text' ? 'pill' : own.cta)
    assert.deepEqual(ad.compositions, own.compositions)
    assert.deepEqual(ad.headline, own.headline)
  }
  assert.equal(ads.adFamily({ id: 'no-study' }).id, 'no-study')
})

test('a size too small for every word drops the badge, then the supporting line, then the call to action, never the hook', () => {
  const family = seeds[1]
  const copy = ads.creativeCopy(adCopy, family)
  const canvas = ads.composeAtSize(family, meta.placementById('landscape'), brand, copy, plain, { id: `global-${family.id}` }, crypto.randomUUID)
  // Words the design emphasises are wrapped in <%kind:…:word%>.
  const texts = canvas.nodes.filter(n => n.type === 'text').map(n => n.text.replace(/<%[^:%]*:[^:%]*:([^%]*)%>/g, '$1'))
  assert.ok(texts.some(t => /fachada precisa/i.test(t)), 'the hook stays')
  assert.ok(!texts.includes('Fachadas'), 'the badge gave way')
  const square = ads.composeAtSize(family, meta.placementById('feed-square'), brand, copy, plain, { id: `global-${family.id}` }, crypto.randomUUID)
  assert.ok(square.nodes.some(n => n.type === 'text' && /^Fachadas$/i.test(n.text)), 'where it fits, the badge stays')
})

test('every design composes the creative at every Meta size; Stories keep words and logo out of Meta’s bars', () => {
  const asset = { url: '/api/uploads/photo', width: 1600, height: 1067, source: 'unsplash' }
  for (const family of seeds) {
    const copy = ads.creativeCopy(adCopy, family)
    for (const placement of meta.AD_PLACEMENTS) {
      const canvas = ads.composeAtSize(family, placement, brand, copy, { slots: [{ slot_id: 'single_main', resolvedAsset: asset }] }, { id: `global-${family.id}` }, crypto.randomUUID)
      const label = `${family.name} ${placement.ratio}`
      assert.equal(canvas.width, placement.width, label); assert.equal(canvas.height, placement.height, label)
      const texts = canvas.nodes.filter(n => n.type === 'text')
      assert.ok(texts.some(n => /fachada/i.test(n.text)), `${label}: the hook is there`)
      for (const n of texts) assert.ok(n.x >= -1 && n.y >= -1 && n.x + n.width <= placement.width + 1 && n.y + n.height <= placement.height + 1, `${label}: "${n.text}" stays inside`)
      if (placement.id === 'story') {
        const marks = canvas.nodes.filter(n => n.type === 'text' || n.designRole === 'logo')
        for (const n of marks) assert.ok(n.y >= meta.STORY_SAFE.top - 1 && n.y + n.height <= placement.height - meta.STORY_SAFE.bottom + 1, `${label}: "${n.text || n.designRole}" is clear of Meta’s bars`)
        // A design's background is the canvas colour, or nodes covering it: those now cover the whole story.
        assert.ok(canvas.background, label)
        for (const n of canvas.nodes.filter(n => n.x <= 1 && n.y <= 1 && n.width >= placement.width - 1 && n.height >= 1300)) assert.ok(n.height >= placement.height, `${label}: the background fills the whole story`)
      }
    }
  }
})

test('building keeps the credits for the sizes made and gives one back for each size whose words do not fit', async () => {
  const family = seeds[0]
  const calls = { settle: 0, refund: 0, grants: [] }, inserted = []
  let attempt = 0
  const handlers = adHandlers({
    loadGenerationBrandContext: async () => ({ ...brand }),
    findCharge: async () => ({ id: 'charge', status: 'held', credits: 3 }),
    hydrateBrandFamilies: async () => [{ design: { id: `global-${family.id}` }, family }],
    // The landscape size cannot fit the words, even with the badge, the line and the call to action left out.
    renderGlobalPost: (sized, ...rest) => { attempt++; if (sized.height === 628) throw Object.assign(Error('overflow'), { status: 422 }); return generation.renderGlobalPost(sized, ...rest) },
    settleCharge: async () => { calls.settle++ }, refundCharge: async () => { calls.refund++ },
    grantExtraCredits: async (_db, _user, credits, { ref }) => { calls.grants.push([credits, ref]) },
  })
  const db = { collection: () => ({ insertOne: async doc => { inserted.push(doc) } }) }
  const copy = ads.creativeCopy(adCopy, family)
  const result = await handlers.handleBuildAd(db, 'user', { flowId: 'brand', brief: { offer: 'Fachadas', objective: 'leads', placements: ['feed-square', 'story', 'landscape'] }, ad: adCopy, copy, resolvedPlan: { designId: `global-${family.id}`, slots: plain.slots }, chargeRef: 'ref' })
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.ad.canvases.map(c => c.placement), ['feed-square', 'story'])
  assert.deepEqual(result.body.ad.failed.map(f => f.placement), ['landscape'])
  assert.equal(attempt, 2 + 4, 'two sizes at once, the landscape one four times')
  assert.equal(calls.settle, 1); assert.equal(calls.refund, 0)
  assert.equal(calls.grants.length, 1); assert.equal(calls.grants[0][0], 1)
  assert.ok(inserted.filter(d => d.ad).every(d => d.ownerId === 'user' && d.ad.id === result.body.ad.id), 'every size is a post owned by the account, tagged with its ad')
  assert.equal(result.body.ad.creative.cta, 'Diga-nos o que a fachada precisa')
  const short = adHandlers({ loadGenerationBrandContext: async () => ({ ...brand }), findCharge: async () => ({ id: 'c', status: 'held', credits: 1 }) })
  await assert.rejects(short.handleBuildAd(db, 'user', { flowId: 'brand', brief: { offer: 'Fachadas', placements: ['feed-square', 'story'] }, chargeRef: 'ref' }), /start again/)
})

const carouselAd = () => ads.normalizeAdCopy(goodCarousel(), ads.readAdBrief({ brief: { offer: 'Fachadas', objective: 'leads', format: 'carousel', cards: 4 } }), 'pt-PT')

test('a carousel is one post per size with a page per card: its own image and words on each, the action on the last', () => {
  const asset = { url: '/api/uploads/photo', width: 1600, height: 1067, source: 'unsplash' }
  const resolved = { slots: [1, 2, 3, 4].map(n => ({ slot_id: `slide_${n}`, resolvedAsset: asset })) }
  for (const family of seeds) {
    const copy = ads.creativeCopy(carouselAd(), family)
    assert.equal(copy.format, 'carousel')
    assert.equal(copy.imageChoice, 'on')
    assert.deepEqual(copy.slides.map(s => s.design.image.subject), goodCarousel().cards.map(c => c.image.subject))
    assert.deepEqual(copy.slides.map(s => s.cta), ['', '', '', 'Diga-nos o que a fachada precisa'])
    assert.ok(study.familyGrammar(family).compositions.includes(copy.slides[0].design.composition), 'the cover opens like a single image')
    for (const id of meta.CAROUSEL_PLACEMENTS) {
      const placement = meta.placementById(id), label = `${family.name} ${placement.ratio}`
      const canvas = ads.composeAtSize(family, placement, brand, copy, resolved, { id: `global-${family.id}` }, crypto.randomUUID)
      assert.equal(canvas.type, 'carousel', label)
      assert.equal(canvas.pages.length, 4, label)
      assert.equal(canvas.height, placement.height, label)
      const first = canvas.pages[0].nodes.filter(n => n.type === 'text').map(n => n.text.replace(/<%[^:%]*:[^:%]*:([^%]*)%>/g, '$1')).join(' ')
      assert.match(first, /fissuras/i, `${label}: the hook is on the first card`)
      if (id === 'story') for (const page of canvas.pages) for (const n of page.nodes.filter(n => n.type === 'text')) assert.ok(n.y >= meta.STORY_SAFE.top - 1 && n.y + n.height <= placement.height - meta.STORY_SAFE.bottom + 1, `${label}: "${n.text}" is clear of Meta’s bars`)
    }
  }
})

test('planning a carousel charges one credit per card at each size, for the cards actually written', async () => {
  const family = seeds[0]
  const charged = []
  const threeCards = { ...goodCarousel(), cards: goodCarousel().cards.filter((_, i) => i !== 2) }
  const handlers = adHandlers({
    loadGenerationBrandContext: async () => ({ ...brand, language: 'Portuguese', languageVariant: 'pt-PT', about: 'Alvará de Obra Pública. Ministério da Justiça.' }),
    chooseBrandFamily: async () => ({ family, design: { id: `global-${family.id}` } }),
    availableGroqCompletion: async () => ({ choices: [{ message: { content: JSON.stringify(threeCards) } }] }),
    planAssets: async (_db, { copy }) => ({ slots: copy.slides.map((_, i) => ({ slot_id: `slide_${i + 1}`, needs_visual: true })) }),
    chargeCredits: async (_db, _user, credits) => { charged.push(credits); return { credits } },
  })
  process.env.GROQ_API_KEY ||= 'test'
  const result = await handlers.handlePlanAd({}, 'user', { flowId: 'brand', brief: { offer: 'Fachadas', objective: 'leads', format: 'carousel', cards: 4, placements: ['feed-square', 'story'] } })
  assert.deepEqual(charged, [6], 'asked for 4 cards, 3 came back: 3 cards × 2 sizes')
  assert.equal(result.body.brief.cards, 3, 'the build is told how many cards there are')
  assert.equal(result.body.plan.slots.length, 3)
  assert.equal(result.body.credits.charged, 6)
})

test('building a carousel needs its cards’ credits, and a size that cannot be made gives back one per card', async () => {
  const family = seeds[0]
  const grants = [], inserted = []
  const handlers = adHandlers({
    loadGenerationBrandContext: async () => ({ ...brand }),
    findCharge: async () => ({ id: 'charge', status: 'held', credits: 8 }),
    hydrateBrandFamilies: async () => [{ design: { id: `global-${family.id}` }, family }],
    renderGlobalPost: (sized, ...rest) => { if (sized.height === 1350) throw Object.assign(Error('overflow'), { status: 422 }); return generation.renderGlobalPost(sized, ...rest) },
    grantExtraCredits: async (_db, _user, credits) => { grants.push(credits) },
  })
  const db = { collection: () => ({ insertOne: async doc => { inserted.push(doc) } }) }
  const ad = carouselAd(), copy = ads.creativeCopy(ad, family)
  const body = { flowId: 'brand', brief: { offer: 'Fachadas', objective: 'leads', format: 'carousel', cards: 4, placements: ['feed-portrait', 'feed-square'] }, ad, copy, resolvedPlan: { designId: `global-${family.id}`, slots: [] }, chargeRef: 'ref' }
  const result = await handlers.handleBuildAd(db, 'user', body)
  assert.deepEqual(result.body.ad.canvases.map(c => [c.placement, c.canvas.pages.length]), [['feed-square', 4]])
  assert.deepEqual(grants, [4], 'the portrait size’s four cards come back')
  assert.deepEqual(result.body.ad.copy.cards.map(c => c.headline), goodCarousel().cards.map(c => c.headline))
  assert.equal(result.body.ad.copy.headlines, undefined, 'a carousel has no headlines of its own')
  const short = adHandlers({ loadGenerationBrandContext: async () => ({ ...brand }), findCharge: async () => ({ id: 'c', status: 'held', credits: 4 }) })
  await assert.rejects(short.handleBuildAd(db, 'user', body), /start again/, 'two sizes of four cards need 8 credits')
})

test('editing a carousel’s text changes its cards’ headlines and descriptions, never their number', async () => {
  const brief = ads.readAdBrief({ brief: { offer: 'Fachadas', objective: 'leads', format: 'carousel', cards: 2 } })
  const stored = { id: 'ad2', ownerId: 'user', flowId: 'brand', brief, copy: { primaryText: ['Antes'], cards: [{ headline: 'Um', description: '' }, { headline: 'Dois', description: 'd' }], cta: 'Get Quote' }, creative: { headline: 'Hook' } }
  let saved = null
  const db = { collection: () => ({ findOne: async q => (q.id === 'ad2' ? stored : null), updateOne: async (_q, update) => { saved = update.$set } }) }
  const handlers = adHandlers({ loadGenerationBrandContext: async () => ({ ...brand, language: 'Portuguese', languageVariant: 'pt-PT' }) })
  const result = await handlers.handleUpdateAdCopy(db, 'user', 'ad2', { copy: { primaryText: ['Depois'], cards: [{ headline: 'Primeiro cartão', description: 'Uma descrição bem mais longa do que vinte' }, null, { headline: 'Um terceiro' }] } })
  assert.deepEqual(result.body.copy.cards.map(c => c.headline), ['Primeiro cartão', 'Dois'])
  assert.ok(result.body.copy.cards[0].description.length <= 20)
  assert.equal(result.body.copy.cards[1].description, 'd')
  assert.deepEqual(result.body.copy.primaryText, ['Depois'])
  assert.deepEqual(saved.copy, result.body.copy)
})

test('the person edits the ad’s text within Meta’s limits; the image stays as built', async () => {
  const stored = { id: 'ad1', ownerId: 'user', flowId: 'brand', brief: ads.readAdBrief({ brief: { offer: 'Fachadas', objective: 'leads' } }), copy: { primaryText: ['Antes'], headlines: ['Antes'], description: '', cta: 'Get Quote' }, creative: { headline: 'Hook' } }
  let saved = null
  const db = { collection: () => ({ findOne: async q => (q.id === 'ad1' && q.ownerId === 'user' ? stored : null), updateOne: async (_q, update) => { saved = update.$set } }) }
  const handlers = adHandlers({ loadGenerationBrandContext: async () => ({ ...brand, language: 'Portuguese', languageVariant: 'pt-PT' }) })
  const result = await handlers.handleUpdateAdCopy(db, 'user', 'ad1', { copy: { primaryText: ['Depois\n\nem duas linhas', 'Outra'], headlines: ['Um título muito comprido que passa dos quarenta caracteres permitidos'], cta: 'Book Now' } })
  assert.deepEqual(result.body.copy.primaryText, ['Depois\nem duas linhas', 'Outra'])
  assert.ok(result.body.copy.headlines[0].length <= 40)
  assert.equal(result.body.copy.cta, 'Book Now')
  assert.deepEqual(saved.copy, result.body.copy)
  await assert.rejects(handlers.handleUpdateAdCopy(db, 'other', 'ad1', { copy: {} }), /not found/)
  await assert.rejects(handlers.handleUpdateAdCopy(db, 'user', 'ad1', { copy: { primaryText: [], headlines: [] } }), /at least one/)
})
