const { test } = require('node:test')
const assert = require('node:assert/strict')
const { registerHooks } = require('node:module')
const sharp = require('sharp')

// lib/ uses extensionless imports, as Next resolves them.
registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context) } catch (error) {
      if (specifier.startsWith('.') && !/\.[cm]?js$/.test(specifier)) return next(`${specifier}.js`, context)
      throw error
    }
  },
})
const { renderCanvasToPng } = require('../lib/renderCanvas.js')

const pixel = async (png, x, y) => {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * info.channels
  return [data[i], data[i + 1], data[i + 2]]
}
const square = extra => ({ id: 's', type: 'shape', shape: 'rect', x: 0, y: 0, width: 100, height: 100, fill: '#000000', ...extra })
const canvas = nodes => ({ width: 100, height: 100, background: '#ffffff', nodes })

test('hidden layers are left out of the download', async () => {
  assert.deepEqual(await pixel(await renderCanvasToPng(canvas([square({ hidden: true })])), 50, 50), [255, 255, 255])
  assert.deepEqual(await pixel(await renderCanvasToPng(canvas([square()])), 50, 50), [0, 0, 0])
})

test('layer opacity lets the background through', async () => {
  const [r] = await pixel(await renderCanvasToPng(canvas([square({ opacity: 50 })])), 50, 50)
  assert.ok(Math.abs(r - 128) <= 2, `expected mid grey, got ${r}`)
})

test('flipped images are mirrored before they are cropped', async () => {
  // Red on the left, blue on the right.
  const raw = Buffer.alloc(2 * 1 * 3)
  raw.set([255, 0, 0, 0, 0, 255])
  const png = await sharp(raw, { raw: { width: 2, height: 1, channels: 3 } }).resize(100, 50, { kernel: 'nearest' }).png().toBuffer()
  const image = extra => ({ id: 'i', type: 'image', x: 0, y: 0, width: 100, height: 50, src: `data:image/png;base64,${png.toString('base64')}`, ...extra })
  const plain = await renderCanvasToPng(canvas([image()]))
  assert.deepEqual(await pixel(plain, 10, 25), [255, 0, 0])
  const flipped = await renderCanvasToPng(canvas([image({ flipX: true })]))
  assert.deepEqual(await pixel(flipped, 10, 25), [0, 0, 255])
  // Cropping the left half of the flipped picture leaves its red (right-hand) half.
  const cropped = await renderCanvasToPng(canvas([image({ flipX: true, cropLeft: 50 })]))
  assert.deepEqual(await pixel(cropped, 75, 25), [255, 0, 0])
})
