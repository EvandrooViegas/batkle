const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')

const source = stripTypeScriptTypes(fs.readFileSync('lib/billing/plans.ts', 'utf8').replace(/^export /gm, ''))
const { pricingRows, PLAN_IDS, COMING_SOON, MAX_PHOTOS_PER_POST, cheapestPlanForPhotos } = new Function(source + ';return { pricingRows, PLAN_IDS, COMING_SOON, MAX_PHOTOS_PER_POST, cheapestPlanForPhotos }')()

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
  assert.deepEqual(byPlan(rowNamed('Posts in the voice of your own posts')), { free: false, pro: true, business: true })
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

test('paid plans add more of your own photos to a post, up to one on every slide of the longest carousel', () => {
  assert.deepEqual(byPlan(rowNamed('Your own photos in each post')), { free: 'Up to 4', pro: 'Up to 8', business: 'Up to 10' })
  assert.equal(MAX_PHOTOS_PER_POST, 10)
  // lib/services/postImages.ts keeps its own copy, since it is loaded without plans.ts.
  assert.match(fs.readFileSync('lib/services/postImages.ts', 'utf8'), new RegExp(`^export const MAX_POST_IMAGES = ${MAX_PHOTOS_PER_POST}\\s*$`, 'm'))
  assert.deepEqual([4, 5, 8, 9, 10, 11].map(n => cheapestPlanForPhotos(n)?.id ?? null), ['free', 'pro', 'pro', 'business', 'business', null])
  assert.equal(rowNamed('Upload your own images'), undefined, 'no total limit on your own images')
})

test('every row has one value per plan', () => {
  for (const row of pricingRows()) assert.equal(row.values.length, PLAN_IDS.length, row.label)
})
