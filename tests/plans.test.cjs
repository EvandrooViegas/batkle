const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')

const source = stripTypeScriptTypes(fs.readFileSync('lib/billing/plans.ts', 'utf8').replace(/^export /gm, ''))
const { pricingRows, PLAN_IDS, COMING_SOON } = new Function(source + ';return { pricingRows, PLAN_IDS, COMING_SOON }')()

const byPlan = row => Object.fromEntries(PLAN_IDS.map((id, i) => [id, row.values[i]]))
const rowNamed = label => pricingRows().find(row => row.label === label)

test('a feature that is not built yet never shows a tick: its plans say "Coming soon"', () => {
  const soon = pricingRows().filter(row => row.comingSoon)
  assert.deepEqual(soon.map(row => row.label), ['Text reminders'])
  for (const row of soon) {
    assert.ok(!row.values.includes(true), row.label)
    assert.ok(row.values.every(value => value === false || value === 'Coming soon'), row.label)
  }
  assert.deepEqual(byPlan(rowNamed('Text reminders')), { free: false, pro: 'Coming soon', business: 'Coming soon' })
})

test('designs are made on Pro and Business; Free browses the ones members publish', () => {
  assert.deepEqual(byPlan(rowNamed('Create and share your own designs')), { free: false, pro: true, business: true })
  assert.deepEqual(byPlan(rowNamed('Designs published by other members')), { free: 'Browse only', pro: true, business: true })
  assert.deepEqual(byPlan(rowNamed('Facebook and Instagram ads')), { free: false, pro: false, business: true })
})

test('taking text reminders out of COMING_SOON shows each plan’s texts a month again', () => {
  const at = COMING_SOON.indexOf('textReminders')
  COMING_SOON.splice(at, 1)
  try {
    const texts = rowNamed('Text reminders')
    assert.equal(texts.comingSoon, undefined)
    assert.deepEqual(byPlan(texts), { free: false, pro: '30 a month', business: '100 a month' })
  } finally {
    COMING_SOON.splice(at, 0, 'textReminders')
  }
})

test('every row has one value per plan', () => {
  for (const row of pricingRows()) assert.equal(row.values.length, PLAN_IDS.length, row.label)
})
