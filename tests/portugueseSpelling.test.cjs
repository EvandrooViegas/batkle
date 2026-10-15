const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')

const source = stripTypeScriptTypes(fs.readFileSync('lib/services/contentLanguage.ts', 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))
const { modernPortuguese, withModernSpelling } = new Function(source + ';return { modernPortuguese, withModernSpelling }')()

test('pre-1990 Portuguese spellings become the current ones, keeping capitals', () => {
  assert.equal(modernPortuguese('Optimização: ajuste enquanto corre'), 'Otimização: ajuste enquanto corre')
  assert.equal(modernPortuguese('A OPTIMIZAÇÃO é óptima'), 'A OTIMIZAÇÃO é ótima')
  assert.equal(modernPortuguese('Uma acção, duas acções e reacções'), 'Uma ação, duas ações e reações')
  assert.equal(modernPortuguese('Direcção do projecto e arquitectos'), 'Direção do projeto e arquitetos')
  assert.equal(modernPortuguese('Actualmente actualizámos, exactamente'), 'Atualmente atualizámos, exatamente')
  assert.equal(modernPortuguese('O director fala directamente; o objectivo é efectivo'), 'O diretor fala diretamente; o objetivo é efetivo')
})

test('words Portugal kept, and other words that only look alike, are left alone', () => {
  for (const kept of ['De facto, o contacto é claro', 'Envie Direct no Instagram', 'O pacto e o impacto', 'Contacte-nos', 'A fração atual']) {
    assert.equal(modernPortuguese(kept), kept, kept)
  }
})

test('only a Portuguese post is corrected, and only the words people read', () => {
  const copy = {
    format: 'carousel', headline: '', caption: 'A optimização é contínua.', hashtags: ['#optimização'],
    slides: [{ headline: 'Optimização', body: 'Uma acção por semana.', cta: '', design: { image: { subject: 'optimization chart', queries: ['optimización'] } } }],
    visualNotes: ['optimização visual'],
  }
  const fixed = withModernSpelling(copy, 'pt-PT')
  assert.equal(fixed.slides[0].headline, 'Otimização')
  assert.equal(fixed.slides[0].body, 'Uma ação por semana.')
  assert.equal(fixed.caption, 'A otimização é contínua.')
  assert.deepEqual(fixed.hashtags, ['#otimização'])
  assert.deepEqual(fixed.slides[0].design, copy.slides[0].design, 'internal design notes are untouched')
  assert.deepEqual(fixed.visualNotes, copy.visualNotes)
  assert.equal(copy.slides[0].headline, 'Optimização', 'the original is not changed')
  assert.equal(withModernSpelling(copy, 'pt-BR').slides[0].headline, 'Otimização', 'Brazil follows the same spelling')
  assert.equal(withModernSpelling(copy, 'es'), copy, 'another language is left as written')
})
