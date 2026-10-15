const { test } = require('node:test')
const assert = require('node:assert/strict')
const { registerHooks } = require('node:module')
const sharp = require('sharp')
const { memoryDb, loadStorage, loadUploadHandlers } = require('./uploadTestHelpers.cjs')

// lib/ uses extensionless imports, as Next resolves them.
registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context) } catch (error) {
      if (specifier.startsWith('.') && !/\.[cm]?js$/.test(specifier)) return next(`${specifier}.js`, context)
      throw error
    }
  },
})
const { renderCanvasToPng, uprightImage } = require('../lib/renderCanvas.js')

/**
 * A phone photo as taken: stored 100 x 50, red top half and blue bottom half, with EXIF orientation 6 ("turn 90°
 * clockwise to view"). Seen upright, as the browser and the editor show it, it is 50 x 100: blue left, red right.
 */
async function phonePhoto(width = 100, height = 50) {
  const raw = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(y < height / 2 ? [255, 0, 0] : [0, 0, 255], (y * width + x) * 3)
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toBuffer()
}
const colour = async (png, x, y) => {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * info.channels
  return data[i] > 200 && data[i + 2] < 60 ? 'red' : data[i + 2] > 200 && data[i] < 60 ? 'blue' : `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`
}

test('a rotated phone photo renders upright, as the editor shows it', async () => {
  const jpeg = await phonePhoto()
  assert.equal((await sharp(jpeg).metadata()).orientation, 6)
  const png = await renderCanvasToPng({ width: 50, height: 100, background: '#ffffff', nodes: [
    { id: 'photo', type: 'image', x: 0, y: 0, width: 50, height: 100, objectFit: 'fill', src: `data:image/jpeg;base64,${jpeg.toString('base64')}` },
  ] })
  assert.equal(await colour(png, 10, 50), 'blue')
  assert.equal(await colour(png, 40, 50), 'red')
})

test('turning happens in memory only: an upright image is passed on untouched, a turned one becomes a lossless PNG', async () => {
  const plain = await sharp({ create: { width: 8, height: 4, channels: 3, background: '#123456' } }).jpeg().toBuffer()
  assert.equal(await uprightImage(plain), plain, 'no orientation: the same bytes, not a copy')
  const turned = await uprightImage(await phonePhoto())
  const meta = await sharp(turned).metadata()
  assert.deepEqual([meta.format, meta.width, meta.height, meta.orientation], ['png', 50, 100, undefined])
  const junk = Buffer.from('not an image')
  assert.equal(await uprightImage(junk), junk, 'unreadable bytes are left for the renderer to report')
})

test('gallery and post uploads keep the photo byte for byte, with upright sizes and an upright thumbnail', async () => {
  const storage = loadStorage({ r2: true })
  const h = loadUploadHandlers({ storage })
  const db = memoryDb({ flows: [{ id: 'k', ownerId: 'user_1' }] })
  const jpeg = await phonePhoto()
  const data = `data:image/jpeg;base64,${jpeg.toString('base64')}`
  const gallery = await h.handleUploadAsset(db, { data, filename: 'phone.jpg', brand_id: 'brand_k' }, { headers: { get: () => null } }, 'user_1')
  assert.deepEqual([gallery.body.width, gallery.body.height, gallery.body.orientation], [50, 100, 'portrait'])
  const record = id => db.rows('uploads').find(row => row.id === id.split('/').pop())
  assert.ok(storage.bucket.objects.get(record(gallery.body.url).key).bytes.equals(jpeg), 'the original keeps its bytes and its EXIF orientation')
  const thumbnail = storage.bucket.objects.get(record(gallery.body.thumbnail_url).key).bytes
  const thumbMeta = await sharp(thumbnail).metadata()
  assert.deepEqual([thumbMeta.width, thumbMeta.height], [50, 100])
  assert.equal(await colour(thumbnail, 10, 50), 'blue')

  // A post photo (at least 300 px a side) the same way.
  const big = await phonePhoto(480, 320)
  const post = await h.handleUploadPostImage(db, { data: `data:image/jpeg;base64,${big.toString('base64')}`, filename: 'phone.jpg', brand_id: 'brand_k' }, 'user_1')
  assert.deepEqual([post.body.width, post.body.height, post.body.orientation], [320, 480, 'portrait'])
  assert.ok(storage.bucket.objects.get(record(post.body.url).key).bytes.equals(big))
  const postThumb = await sharp(storage.bucket.objects.get(record(post.body.thumbnail_url).key).bytes).metadata()
  assert.ok(postThumb.height > postThumb.width, 'its thumbnail is upright too')
})
