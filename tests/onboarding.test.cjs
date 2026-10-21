const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')

const source = fs.readFileSync('lib/client/onboarding.js', 'utf8').replace(/^export /gm, '')
const { normalizeWebsite, researchStepAt, RESEARCH_STEPS, POST_LANGUAGES, languageChoices, researchSummary } =
  new Function(source + ';return {normalizeWebsite,researchStepAt,RESEARCH_STEPS,POST_LANGUAGES,languageChoices,researchSummary}')()
const languageSource = stripTypeScriptTypes(fs.readFileSync('lib/services/contentLanguage.ts', 'utf8').replace(/^export /gm, ''))
const { contentLanguage } = new Function(languageSource + ';return {contentLanguage}')()

test('a typed website becomes a researchable URL and a short domain', () => {
  assert.deepEqual(normalizeWebsite('  kachica.pt '), { url: 'https://kachica.pt/', domain: 'kachica.pt' })
  assert.deepEqual(normalizeWebsite('https://www.Acme.co.uk/about'), { url: 'https://www.acme.co.uk/about', domain: 'acme.co.uk' })
  assert.equal(normalizeWebsite('http://acme.com').url, 'http://acme.com/')
})

test('addresses that cannot be researched are explained, not sent', () => {
  for (const input of ['', '   ', 'acme', 'localhost:3000', 'my site.com', 'ftp://acme.com', 'https://']) {
    assert.ok(normalizeWebsite(input).error, `expected an error for ${JSON.stringify(input)}`)
    assert.equal(normalizeWebsite(input).url, undefined)
  }
})

test('research progress advances with time and waits on the last step until the result arrives', () => {
  assert.equal(researchStepAt(0), 0)
  assert.equal(researchStepAt(RESEARCH_STEPS[0].ms), 1)
  assert.equal(researchStepAt(10 * 60 * 1000), RESEARCH_STEPS.length - 1)
  assert.equal(RESEARCH_STEPS[0].label('acme.pt'), 'Opening acme.pt')
})

test('the review selects the language posts are actually written in', () => {
  assert.equal(languageChoices({ language: 'Portuguese', website: 'https://www.kachica.pt/' }, contentLanguage).selected, 'pt-PT')
  assert.equal(languageChoices({ language: 'Portuguese', website: 'https://loja.com.br/' }, contentLanguage).selected, 'pt-BR')
  assert.equal(languageChoices({ language: 'English', website: 'https://acme.co.uk' }, contentLanguage).selected, 'en-GB')
  assert.equal(languageChoices({ language: 'Spanish' }, contentLanguage).selected, 'es')
})

test('every offered language round-trips: choosing it makes posts use exactly that variant', () => {
  // Hosts that would otherwise suggest a different variant must not override an explicit choice.
  const hosts = ['https://acme.com', 'https://acme.com.br', 'https://acme.co.uk', 'https://acme.es']
  for (const option of POST_LANGUAGES) {
    for (const website of hosts) {
      const brand = { language: option.language, languageVariant: option.languageVariant, website }
      assert.equal(languageChoices(brand, contentLanguage).selected, option.code, `${option.label} on ${website}`)
    }
  }
})

test('a detected language outside the list is kept as its own option instead of becoming English', () => {
  const choices = languageChoices({ language: 'Dutch' }, contentLanguage)
  assert.equal(choices.selected, 'other:Dutch')
  assert.equal(choices.options[0].label, 'Dutch')
  assert.equal(choices.options[0].language, 'Dutch')
})

test('the research summary only mentions what happened', () => {
  assert.equal(researchSummary({ pages: 5 }), '5 pages read')
  assert.equal(researchSummary({ pages: 1 }), '1 page read')
  assert.equal(researchSummary({}), '')
})

test('a language without its own rules keeps its name and code instead of becoming English', () => {
  for (const language of ['Dutch', 'nl', 'nl-BE']) {
    const result = contentLanguage({ language })
    assert.equal(result.code.split('-')[0], 'nl', language)
    assert.match(result.label, /^(Dutch|Flemish)/)
    assert.doesNotMatch(result.rules, /OUTPUT LANGUAGE: English/)
  }
  assert.equal(contentLanguage({ language: 'Polish' }).code, 'pl')
  // Names that merely start like a code are not mistaken for it.
  assert.equal(contentLanguage({ language: 'Estonian' }).code, 'et')
  assert.equal(contentLanguage({ language: 'Frisian' }).name, 'Frisian')
  assert.equal(contentLanguage({}).code, 'en-US')
  assert.equal(contentLanguage({ language: 'unknown' }).code, 'en-US')
})

test('Dutch copy is not flagged as English for sharing words like "is", "we" and "tips"', () => {
  const nl = contentLanguage({ language: 'Dutch' })
  const languageIssues = new Function(languageSource + ';return languageIssues')()
  assert.deepEqual(languageIssues(['Dit is waarom we elke week nieuwe tips delen voor ondernemers die meer klanten willen bereiken.'], nl), [])
  assert.equal(languageIssues(['Discover how we help your business grow with the right tools for your team and your customers today.'], nl).length, 1)
})
