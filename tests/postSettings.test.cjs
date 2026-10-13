const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const load = path => stripTypeScriptTypes(fs.readFileSync(path, 'utf8').replace(/^import .*$/gm, '').replace(/export /g, ''))
const { readSlideCount, slideCountRule, fitOutline, readLanguageChoice, postLanguage, contentLanguage, outlineIssue, lengthOf } = new Function(
  load('lib/services/contentLanguage.ts') + load('lib/services/contentAngles.ts') + load('lib/services/ideaRequest.ts')
  + ';return {readSlideCount,slideCountRule,fitOutline,readLanguageChoice,postLanguage,contentLanguage,outlineIssue,lengthOf}',
)()

test('a slide count is 3 to 10 whole slides, anything else is Auto', () => {
  assert.equal(readSlideCount(6), 6)
  assert.equal(readSlideCount('8'), 8)
  for (const value of ['auto', 2, 11, 4.5, null, undefined, '', 'six']) assert.equal(readSlideCount(value), null, String(value))
})

test('the slide count rule asks for exactly that many outline lines', () => {
  assert.match(slideCountRule(6), /exactly 6 slides/)
  assert.match(slideCountRule(6), /4 points/)
  assert.match(slideCountRule(3), /1 point,/)
})

test('a chosen length is validated exactly and an outline that overshoots keeps its cover and takeaway', () => {
  const length = { label: lengthOf(5), min: 5, max: 5, use: 'the number of slides the user chose' }
  assert.match(outlineIssue(['a', 'b', 'c', 'd', 'e', 'f'], length), /plans 6 slides; this carousel should have 5-5/)
  assert.equal(outlineIssue(['a', 'b', 'c', 'd', 'e'], length), null)
  assert.deepEqual(fitOutline(['cover', 'p1', 'p2', 'p3', 'p4', 'takeaway'], 4), ['cover', 'p1', 'p2', 'takeaway'])
  assert.deepEqual(fitOutline(['cover', 'p1', 'takeaway'], 5), ['cover', 'p1', 'takeaway'], 'a shorter outline is left alone')
  assert.deepEqual(fitOutline(['a', 'b', 'c', 'd'], null), ['a', 'b', 'c', 'd'], 'Auto keeps the outline')
})

test('a language chosen for one post is read safely', () => {
  assert.deepEqual(readLanguageChoice({ language: 'Spanish', languageVariant: 'es-ES' }), { language: 'Spanish', languageVariant: 'es-ES' })
  assert.deepEqual(readLanguageChoice({ languageVariant: 'fr' }), { language: 'fr', languageVariant: 'fr' })
  assert.equal(readLanguageChoice(null), null)
  assert.equal(readLanguageChoice('Spanish'), null, 'only the composer\'s object shape counts')
  assert.equal(readLanguageChoice({ language: '"};{' }), null, 'punctuation is stripped, leaving nothing')
})

test('a post language overrides the brand language, including its regional variant', () => {
  const brand = { language: 'Portuguese', languageVariant: 'pt-PT', website: 'https://atelier.pt' }
  assert.equal(postLanguage(brand).code, 'pt-PT', 'no choice keeps the brand language')
  assert.equal(postLanguage(brand, null).code, contentLanguage(brand).code)
  assert.equal(postLanguage(brand, { language: 'Spanish', languageVariant: 'es-ES' }).code, 'es-ES')
  assert.equal(postLanguage(brand, { language: 'Portuguese', languageVariant: 'pt-BR' }).code, 'pt-BR', 'the chosen variant wins over the .pt site')
  assert.equal(postLanguage(brand, { language: 'English', languageVariant: 'en-GB' }).code, 'en-GB')
  assert.match(postLanguage(brand, { language: 'French', languageVariant: 'fr' }).rules, /OUTPUT LANGUAGE: French \(fr\)/)
  assert.equal(postLanguage(brand, 'Spanish').code, 'pt-PT', 'a stray string from the model is ignored')
})
