const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const sharp = require('sharp')

const source = stripTypeScriptTypes(fs.readFileSync('lib/services/imageStorage.ts', 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))
const { compactImage, sameVisiblePixels } = new Function('sharp', source + ';return {compactImage,sameVisiblePixels}')(sharp)

// A real 1080x1350 design from the repo, optionally cut out with a soft-edged alpha like the AI cutouts.
const REFERENCE = fs.readFileSync('public/design-references/5.png')
async function photo(width, height, alphaAt) {
  let image = sharp(await sharp(REFERENCE).resize(width, height).removeAlpha().png().toBuffer())
  if (alphaAt) {
    const alpha = Buffer.alloc(width * height)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) alpha[y * width + x] = alphaAt(x, y)
    image = image.joinChannel(alpha, { raw: { width, height, channels: 1 } })
  }
  return image.png().toBuffer()
}
const pixels = bytes => sharp(bytes).ensureAlpha().raw().toBuffer()

test('an opaque PNG becomes a smaller lossless WebP with every pixel identical', async () => {
  const png = await photo(700, 700)
  const stored = await compactImage(png, 'image/png')
  assert.equal(stored.contentType, 'image/webp')
  assert.ok(stored.bytes.length < png.length * 0.95, `${stored.bytes.length} vs ${png.length}`)
  assert.ok((await pixels(png)).equals(await pixels(stored.bytes)), 'no pixel may change')
})

test('a transparent cutout keeps every alpha value and every visible colour', async () => {
  // A soft-edged disc: fully clear corners, a feathered rim and a solid centre.
  const png = await photo(700, 700, (x, y) => Math.max(0, Math.min(255, Math.round((300 - Math.hypot(x - 350, y - 350)) * 4))))
  const stored = await compactImage(png, 'image/png')
  assert.equal(stored.contentType, 'image/webp')
  const [before, after] = [await pixels(png), await pixels(stored.bytes)]
  assert.ok(sameVisiblePixels(before, after), 'what can be seen must be identical')
  for (let i = 3; i < before.length; i += 4) if (before[i] !== after[i]) assert.fail(`alpha changed at pixel ${(i - 3) / 4}`)
})

test('JPEG and WebP are never re-encoded, so they cannot lose quality', async () => {
  const jpeg = await sharp(await photo(700, 700)).jpeg({ quality: 100 }).toBuffer()
  assert.equal((await compactImage(jpeg, 'image/jpeg')).bytes, jpeg)
  const webp = await sharp(await photo(700, 700)).webp({ quality: 90 }).toBuffer()
  assert.equal((await compactImage(webp, 'image/webp')).bytes, webp)
})

test('small images, 16-bit images and unreadable bytes are kept as they are', async () => {
  const small = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ff000080' } }).png().toBuffer()
  assert.equal((await compactImage(small, 'image/png')).bytes, small)
  // WebP is 8-bit, so a 16-bit PNG would lose precision: it must stay a PNG.
  const deep = await sharp(await photo(500, 500)).toColourspace('rgb16').png().toBuffer()
  assert.equal((await compactImage(deep, 'image/png')).contentType, 'image/png')
  const junk = Buffer.alloc(300 * 1024, 1)
  assert.deepEqual(await compactImage(junk, 'image/png'), { bytes: junk, contentType: 'image/png' })
})

test('the visible-pixel check ignores only the hidden colour of fully transparent pixels', () => {
  const a = Buffer.from([10, 20, 30, 255, 1, 2, 3, 0, 9, 9, 9, 128])
  assert.equal(sameVisiblePixels(a, Buffer.from([10, 20, 30, 255, 7, 7, 7, 0, 9, 9, 9, 128])), true)
  assert.equal(sameVisiblePixels(a, Buffer.from([10, 20, 31, 255, 1, 2, 3, 0, 9, 9, 9, 128])), false, 'visible colour')
  assert.equal(sameVisiblePixels(a, Buffer.from([10, 20, 30, 255, 1, 2, 3, 0, 9, 9, 9, 127])), false, 'alpha')
  assert.equal(sameVisiblePixels(a, Buffer.from([10, 20, 30, 255, 1, 2, 3, 1, 9, 9, 9, 128])), false, 'transparent pixel became visible')
})
