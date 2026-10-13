const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')

const source = stripTypeScriptTypes(fs.readFileSync('lib/services/copyFacts.ts', 'utf8').replace(/^export /gm, ''))
const { inventedFigures } = new Function(source + ';return {inventedFigures}')()

const profile = JSON.stringify({
  about: 'KACHICA is a digital marketing agency with over three years of experience.',
  projects: [{ name: 'Barber PH', description: 'Modern website for a barbershop with a booking platform.' }],
  differentiators: ['Clients saw 40% more enquiries after the 2024 redesign', 'Serving 120 clients across Portugal'],
})

test('made-up results in a case study are caught (the Barber PH copy that shipped)', () => {
  const copy = ['Antes: 2 leads/mês, ROI 0,8×. Depois da segmentação avançada: 15 leads/mês, ROI 3,5×.', 'Antes: 15 % de taxa de conversão. Depois: 45 % com segmentação.']
  assert.deepEqual(inventedFigures(copy, profile), ['2 leads', 'ROI 0,8', '15 leads', 'ROI 3,5', '15 %', '45 %'])
})

test('figures that the brand profile states are allowed, in any notation', () => {
  assert.deepEqual(inventedFigures(['Os nossos clientes tiveram 40 % mais pedidos.', 'Já servimos 120 clientes.'], profile), [])
  assert.deepEqual(inventedFigures(['ROI of 2.5'], JSON.stringify({ about: 'A campaign returned an ROI of 2,5 in 2025.' })), [])
})

test('money, multipliers and ROI not in the profile are caught across languages', () => {
  assert.deepEqual(inventedFigures(['Poupe 500 € por mês', 'Triplique as vendas: 3x mais rápido', 'ROI de 4', 'Gana $1.000 en ventas'], profile), ['500 €', '3x', 'ROI de 4', '$1.000'])
})

test('ordinary numbers are not mistaken for results', () => {
  const copy = ['4 etapas para crescer', '5 dicas para o seu negócio', 'Desde 2021', 'Atendimento 24/7', '100% personalizado', 'Ligue 912 345 678', 'Slide 3 de 7']
  assert.deepEqual(inventedFigures(copy, profile), [])
})
