// Exported text wraps like the editor (a browser): a wrapped line never starts with a space, and the space after a
// line's last word hangs past the box instead of pushing that word to the next line.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { registerHooks } = require('node:module')
const sharp = require('sharp')

registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context) } catch (error) {
      if (specifier.startsWith('.') && !/\.[cm]?js$/.test(specifier)) return next(`${specifier}.js`, context)
      throw error
    }
  },
})
const { renderCanvasToPng } = require('../lib/renderCanvas.js')
const { wordGroups, buildSatoriTextLines, parseStyledText } = require('../lib/styleParser.js')

/** The left-most and right-most dark columns in each band of rows. */
async function inkEdges(png, bands) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  return bands.map(([top, bottom]) => {
    let left = Infinity, right = -1
    for (let y = top; y < bottom; y++) for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels] < 100) { left = Math.min(left, x); right = Math.max(right, x) }
    }
    return { left, right }
  })
}

const box = (text, width, align = 'left') => ({
  width: 600, height: 300, background: '#ffffff',
  nodes: [{ id: 't', type: 'text', text, x: 20, y: 20, width, height: 260, fontSize: 60, fontWeight: 700, fontFamily: 'Inter', color: '#000000', lineHeight: 1.2, textAlign: align, verticalAlign: 'top' }],
})

test('words keep the spaces after them, so no line starts with one', () => {
  assert.deepEqual(wordGroups(['Make', ' ', 'your', '  ', 'next']).map(g => [...g]), [['Make', ' '], ['your', '  '], ['next']])
  assert.deepEqual(wordGroups([' ', 'lead']).map(g => [...g]), [[' '], ['lead']], 'spaces before the first word stay their own')
  const [row] = buildSatoriTextLines(parseStyledText('Make your <%kind:x:next%>'), { x: { style: { color: '#f00' } } }, { align: 'center', hang: 14 })
  assert.equal(row.props.style.marginRight, -14)
  assert.equal(row.props.style.width, undefined)
  const [plain] = buildSatoriTextLines(parseStyledText('Make your next'), {})
  assert.equal(plain.props.style.width, '100%', 'callers without a hang keep the full-width row')
})

test('a wrapped line starts at the box’s left edge, and a line that fits without its last space keeps its last word', async () => {
  // "WIDE WORDS" is too wide for one line; the second line must start where the first does.
  const wrapped = await renderCanvasToPng(box('WIDE WORDS', 260))
  const [first, second] = await inkEdges(wrapped, [[25, 90], [97, 162]])
  assert.ok(Number.isFinite(second.left), 'the second word went to a second line')
  assert.ok(Math.abs(second.left - first.left) <= 3, `second line starts at ${second.left}, first at ${first.left}`)

  // A box just wide enough for "WIDE" + "WORDS" without the space after "WORDS": both stay on the first line.
  const oneLine = await renderCanvasToPng(box('WIDE WORDS', 600))
  const [line] = await inkEdges(oneLine, [[25, 90]])
  const tight = await renderCanvasToPng(box('WIDE WORDS', line.right - 20 + 3))
  const [top, below] = await inkEdges(tight, [[25, 90], [97, 162]])
  assert.ok(top.right >= line.right - 3, 'both words on the first line')
  assert.equal(below.left, Infinity, 'nothing wrapped')
})

test('right-aligned lines end at the box edge, every line alike', async () => {
  const png = await renderCanvasToPng(box('WIDE WORDS', 260, 'right'))
  const [first, second] = await inkEdges(png, [[25, 90], [97, 162]])
  assert.ok(Math.abs(first.right - second.right) <= 4, `${first.right} vs ${second.right}`)
  assert.ok(first.right <= 20 + 260, 'inside the box')
})
