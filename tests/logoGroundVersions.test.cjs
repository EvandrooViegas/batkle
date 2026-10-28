const { test } = require('node:test')
const assert = require('node:assert/strict')
const sharp = require('sharp')
const { stripTypeScriptTypes } = require('node:module')

// Versions for dark and light grounds: an outer shape that fades swaps colours with its main detail when that detail
// reads on the ground (as a designer's reversed logo does), else it turns white or black and its colourless details flip.
const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../lib/services/logoVariants.ts'), 'utf8').replace(/^import .*$/gm, '').replace(/export /g, '')
const { createLogoVariants } = require('node:vm').runInNewContext(stripTypeScriptTypes(source) + '\n({createLogoVariants})', { sharp, Buffer, Uint8Array, Int32Array })
const pixels = async src => {
  const { data, info } = await sharp(Buffer.from(src.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { at: (x, y) => [...data.subarray((Math.round(y) * info.width + Math.round(x)) * 4, (Math.round(y) * info.width + Math.round(x)) * 4 + 4)], width: info.width, height: info.height }
}

// Like an app-icon logo: a dark rounded plate with a yellow circle and a dark eye inside it, beside a dark wordmark
// (a bar standing in for the letters), on a transparent background.
const iconLogo = () => sharp(Buffer.from(`<svg width="400" height="120" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="120" height="120" rx="24" fill="#18171C"/>
  <circle cx="60" cy="60" r="36" fill="#FFD84D"/>
  <circle cx="60" cy="60" r="8" fill="#18171C"/>
  <rect x="150" y="30" width="250" height="60" fill="#18171C"/>
</svg>`)).png().toBuffer()

test('a dark plate holding a yellow symbol swaps colours with it on dark grounds; the plain wordmark turns white', async () => {
  const v = await createLogoVariants(await iconLogo())
  assert.ok(v.lostOnDark > 0.5, `most of the mark vanishes on dark (${v.lostOnDark})`)
  assert.ok(v.lostOnLight < 0.01, `nothing vanishes on white (${v.lostOnLight})`)
  assert.ok(v.reversedTransparent, 'a reversed version is made')
  assert.equal(v.darkenedTransparent, undefined, 'nothing light to darken')
  const reversed = await pixels(v.reversedTransparent)
  const scale = reversed.width / 400
  const [r1, g1, b1, a1] = reversed.at(300 * scale, 60 * scale)
  assert.ok(r1 > 240 && g1 > 240 && b1 > 240 && a1 > 240, `the wordmark turns white: ${[r1, g1, b1, a1]}`)
  const [r2, g2, b2] = reversed.at(10 * scale, 60 * scale)
  assert.ok(r2 > 240 && g2 > 200 && b2 < 120, `the dark plate takes the symbol's yellow: ${[r2, g2, b2]}`)
  const [r3, g3, b3] = reversed.at(60 * scale, 35 * scale)
  assert.ok(r3 < 60 && g3 < 60 && b3 < 60, `the yellow symbol takes the plate's dark: ${[r3, g3, b3]}`)
  const [r4, g4, b4] = reversed.at(60 * scale, 60 * scale)
  assert.ok(r4 > 240 && g4 > 200 && b4 < 120, `the dark eye inside it turns yellow: ${[r4, g4, b4]}`)
  const [, , , a5] = reversed.at(135 * scale, 10 * scale)
  assert.ok(a5 < 20, 'the background stays transparent')
})

test('a white logo gets a darkened version for light grounds', async () => {
  const white = await sharp(Buffer.from('<svg width="300" height="100" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="20" width="200" height="60" fill="#FFFFFF"/><circle cx="260" cy="50" r="30" fill="#E4572E"/></svg>')).png().toBuffer()
  const v = await createLogoVariants(white)
  assert.ok(v.lostOnLight > 0.5, `the white shape vanishes on white (${v.lostOnLight})`)
  assert.ok(v.lostOnDark < 0.01)
  assert.ok(v.darkenedTransparent)
  const darkened = await pixels(v.darkenedTransparent)
  const [r, g, b] = darkened.at(40 * darkened.width / 280, 30 * darkened.height / 60)
  assert.ok(r < 20 && g < 20 && b < 20, `the white shape turns black: ${[r, g, b]}`)
})

// Like Batkle's logo: a yellow tile with a white glyph whose stem reaches the tile's top edge, beside a yellow
// wordmark (a bar), on a transparent background.
const tileLogo = glyph => sharp(Buffer.from(`<svg width="400" height="120" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="120" height="120" rx="24" fill="#FFD84D"/>
  <rect x="55" y="0" width="10" height="40" fill="${glyph}"/>
  <circle cx="60" cy="68" r="28" fill="${glyph}"/>
  <rect x="150" y="30" width="250" height="60" fill="#FFD84D"/>
</svg>`)).png().toBuffer()

test('one-colour versions cut the details out of each shape instead of filling them, a stem reaching the edge too', async () => {
  const v = await createLogoVariants(await tileLogo('#FFFFFF'))
  const black = await pixels(v.blackTransparent), white = await pixels(v.whiteTransparent)
  const scale = black.width / 400
  for (const [x, y, what] of [[12, 100, 'the tile'], [300, 60, 'the wordmark']]) {
    const [r, g, b, a] = black.at(x * scale, y * scale)
    assert.ok(a > 240 && r < 20 && g < 20 && b < 20, `${what} is filled black: ${[r, g, b, a]}`)
    assert.ok(white.at(x * scale, y * scale)[3] > 240, `${what} is filled white`)
  }
  assert.ok(black.at(60 * scale, 68 * scale)[3] < 30, 'the glyph is cut out of the black tile')
  assert.ok(black.at(60 * scale, 20 * scale)[3] < 30, 'the stem that reaches the edge is cut out too')
  assert.ok(white.at(60 * scale, 68 * scale)[3] < 30, 'and of the white one')
})

test('on light grounds a yellow tile turns black and its white glyph stays white; a dark glyph makes them swap', async () => {
  const v = await createLogoVariants(await tileLogo('#FFFFFF'))
  assert.ok(v.lostOnLight > 0.5, `yellow and white fade on white (${v.lostOnLight})`)
  assert.equal(v.reversedTransparent, undefined, 'yellow reads on dark: nothing to change there')
  const light = await pixels(v.darkenedTransparent), scale = light.width / 400
  const [r1, g1, b1] = light.at(12 * scale, 100 * scale)
  assert.ok(r1 < 20 && g1 < 20 && b1 < 20, `the tile turns black: ${[r1, g1, b1]}`)
  const [r2, g2, b2, a2] = light.at(60 * scale, 68 * scale)
  assert.ok(r2 > 240 && g2 > 240 && b2 > 240 && a2 > 240, `the white glyph stays white on it: ${[r2, g2, b2, a2]}`)
  const [r3, g3, b3] = light.at(300 * scale, 60 * scale)
  assert.ok(r3 < 20 && g3 < 20 && b3 < 20, `the wordmark turns black: ${[r3, g3, b3]}`)

  const swapped = await pixels((await createLogoVariants(await tileLogo('#18171C'))).darkenedTransparent)
  const [r4, g4, b4] = swapped.at(12 * scale, 100 * scale)
  assert.ok(r4 < 60 && g4 < 60 && b4 < 60, `with a dark glyph, the tile takes its dark: ${[r4, g4, b4]}`)
  const [r5, g5, b5] = swapped.at(60 * scale, 68 * scale)
  assert.ok(r5 > 240 && g5 > 200 && b5 < 120, `…and the glyph the tile's yellow: ${[r5, g5, b5]}`)
})
