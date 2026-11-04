const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const sharp = require('sharp')
const { stripTypeScriptTypes } = require('node:module')
const source = stripTypeScriptTypes(fs.readFileSync('lib/designs/global/referenceMetrics.ts', 'utf8').replace(/^import .*$/gm, '').replace(/export /g, ''))
const { measureReference, applyReferenceMetrics } = new Function('sharp', source + ';return { measureReference, applyReferenceMetrics }')(sharp)
const { types, study, generation } = require('./globalDesigns.test.cjs')

// A line of "words": white (or coloured) bars with word gaps, like set type seen at low resolution.
const words = (x, y, widths, fill = '#ffffff', h = 50) => { let cx = x; return widths.map(w => { const r = `<rect x="${cx}" y="${y}" width="${w}" height="${h}" fill="${fill}"/><rect x="${cx + 14}" y="${y + 14}" width="${Math.max(4, w - 28)}" height="${h - 28}" fill="#111111"/>`; cx += w + 22; return r }).join('') }
const centred = (y, widths, fill) => { const total = widths.reduce((a, b) => a + b, 0) + 22 * (widths.length - 1); return words(Math.round(540 - total / 2), y, widths, fill) }
const image = async body => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#151515"/>${body}</svg>`)).png().toBuffer()

test('measures centred copy, an outlined accent box around the headline, and no coloured copy', async () => {
  const m = await measureReference(await image(`${centred(860, [140, 90, 210, 120, 80])}<rect x="110" y="940" width="860" height="160" fill="none" stroke="#d4a72c" stroke-width="7"/>${centred(990, [260, 300])}${centred(1150, [120, 160, 90])}`))
  assert.equal(m.align, 'center')
  assert.ok(m.box && Math.abs(m.box.x - .1) < .02 && Math.abs(m.box.width - .8) < .03, JSON.stringify(m.box))
  assert.equal(m.coloredText, false)
  assert.equal(m.rules, 0, 'the box edges are not separate rules')
})

test('measures left-aligned copy, a separate accent rule, coloured words, and ignores a saturated sky', async () => {
  const left = await measureReference(await image(`<rect x="0" y="0" width="1080" height="300" fill="#2f6fd6"/>${words(110, 700, [200, 120, 160])}${words(110, 780, [90, 260])}${words(110, 860, [150, 110, 70, 130])}<rect x="110" y="960" width="420" height="6" fill="#d4a72c"/>`))
  assert.equal(left.align, 'left')
  assert.equal(left.box, null, 'the sky is not a box')
  assert.ok(left.rules >= 1, 'the thin rule is found')
  const coloured = await measureReference(await image(`${centred(700, [200, 160], '#2ecc71')}${centred(780, [180, 220], '#2ecc71')}`))
  assert.equal(coloured.coloredText, true)
})

// Dark "letters" set straight on a colour: bars with word gaps, like the words above without their own fill.
const ink = (x, y, widths, h = 56) => { let cx = x; return widths.map(w => { const r = `<rect x="${cx}" y="${y}" width="${w}" height="${h}" fill="#141414"/>`; cx += w + 24; return r }).join('') }
// Like the PRUMO reference: a grey "photo", a yellow block holding a two-line headline, a second block with the body.
const panelled = `<rect width="1080" height="700" fill="#7a7a7a"/><rect y="700" width="1080" height="650" fill="#4a4a4a"/>
  <rect x="0" y="700" width="760" height="330" fill="#e8b830"/>${ink(90, 760, [180, 60, 150, 90, 110])}${ink(90, 880, [70, 230, 120, 60])}
  <rect x="40" y="1020" width="935" height="300" fill="#e8b830"/>${ink(100, 1080, [210, 260], 34)}${ink(100, 1160, [90, 140, 70, 190, 60], 24)}${ink(100, 1210, [120, 80, 160], 24)}`

test('a headline on a solid colour panel is measured as a panel, and its dark copy is not coloured copy', async () => {
  const m = await measureReference(await image(panelled))
  assert.ok(m.panel, 'the yellow blocks are a panel')
  // The two blocks touch, so they read as one panel from the left edge (x 0) to the body block's right edge (975 px).
  assert.ok(m.panel.x < .02 && m.panel.y > .5 && m.panel.y < .54 && Math.abs(m.panel.width - .9) < .02, JSON.stringify(m.panel))
  assert.equal(m.box, null, 'a filled panel is not an outlined box')
  assert.equal(m.coloredText, false, 'the yellow around the letters is the panel, not coloured words')
})

test('a word highlight hugging one line is not a panel', async () => {
  // One line of dark letters with a tight yellow highlight behind its last words, like a "background" emphasis.
  const m = await measureReference(await image(`<rect width="1080" height="1350" fill="#ffffff"/>${ink(110, 500, [200, 160, 140], 110)}<rect x="100" y="700" width="700" height="140" fill="#ffdd55"/>${ink(110, 712, [230, 120, 260], 116)}`))
  assert.equal(m.panel, null, JSON.stringify(m.panel))
})

test('a measured panel gives the study a solid headline panel and puts callout copy in cards', () => {
  const study = { familyRules: [], variantRules: [], avoid: [], grammar: { emphasis: 'background', headline: { frame: 'none' }, containers: { style: 'none', radius: 'small', fill: 'accent', use: ['callout', 'label'] }, decorations: [], references: [{ composition: 'split', align: 'left', imagePos: 'full', image: true }] } }
  const fixed = applyReferenceMetrics(study, [{ align: 'left', box: null, panel: { x: 0, y: .52, width: 1, height: .46 }, rules: 0, coloredText: false, lines: [] }])
  assert.equal(fixed.grammar.headline.frame, 'solid')
  assert.equal(fixed.grammar.references[0].frame, true)
  assert.equal(fixed.grammar.containers.style, 'card')
  assert.equal(fixed.grammar.emphasis, 'none', 'no words are set in colour')
  assert.ok(fixed.familyRules.some(r => /solid panel/.test(r)))
})

test('measurements correct the study: alignment, a headline box on the boxed reference only, no invented emphasis or rules', () => {
  const study = {
    composition: 'The text is always left-aligned and anchored to the bottom edge.', typography: 'Heavy condensed headline.', hierarchy: 'Headline, subtitle.', decorative: 'A thin accent rule.',
    familyRules: ['Text must be left-aligned and anchored to the bottom.', 'Headlines are heavy and condensed.'], variantRules: [], avoid: ['Centering the text block.', 'Serif fonts.'],
    grammar: { alignment: ['left'], emphasis: 'color', headline: { frame: 'none' }, decorations: [{ kind: 'line' }, { kind: 'glow' }],
      references: [{ composition: 'image-led', align: 'left' }, { composition: 'image-led', align: 'left' }, { composition: 'image-led', align: 'left' }] },
  }
  const metrics = [{ align: 'center', box: { x: .1, y: .8, width: .8, height: .1 }, rules: 0, coloredText: false, lines: [] }, { align: 'center', box: null, rules: 0, coloredText: false, lines: [] }, { align: null, box: null, rules: 0, coloredText: false, lines: [] }]
  const fixed = applyReferenceMetrics(study, metrics)
  assert.deepEqual(fixed.grammar.alignment, ['center'])
  assert.deepEqual(fixed.grammar.references.map(r => [r.align, r.frame]), [['center', true], ['center', false], ['center', false]], 'the unmeasured reference follows the others')
  assert.equal(fixed.grammar.headline.frame, 'outline')
  assert.equal(fixed.grammar.emphasis, 'none')
  assert.deepEqual(fixed.grammar.decorations.map(d => d.kind), ['glow'], 'the "rule" was the box edges')
  assert.match(fixed.composition, /centred/)
  assert.ok(!fixed.familyRules.some(r => /left-aligned/.test(r)) && fixed.familyRules.includes('Copy is centred on the canvas.'))
  assert.deepEqual(fixed.avoid, ['Serif fonts.'])
  // Disagreeing references leave the model's alignment alone.
  assert.deepEqual(applyReferenceMetrics(study, [{ ...metrics[0], align: 'left' }, metrics[1]]).grammar.alignment, ['left'])
})

test('only slides that follow a boxed reference get the headline box', () => {
  const family = study.reconcileStudy(types.familySchema.parse({
    id: 'industrial', schemaVersion: 1, version: 1, name: 'Industrial', description: 'd', tags: [], width: 1080, height: 1350,
    typography: { headingFallback: 'Inter', bodyFallback: 'Inter' }, referenceStyle: { primary: '#d4a72c', secondary: '#111111', accent: '#d4a72c', background: '#111111', textPrimary: '#ffffff' },
    referenceImages: [1, 2].map(i => ({ id: `r${i}`, url: `/api/uploads/ref-${i}`, name: `r${i}.png`, width: 1080, height: 1350 })), analysis: '', variants: [],
    study: { personality: 'p', composition: 'c', spaceDensity: 's', typography: 't', colorContrast: 'cc', colorRoles: {}, imagery: { mode: 'none' }, decorative: 'd', hierarchy: 'h', logoPlacement: 'l', distinctive: [], familyRules: [], variantRules: [], avoid: [],
      grammar: { compositions: ['statement'], headline: { scale: 'large', weight: 'black', frame: 'outline' }, alignment: ['center'], anchors: ['bottom'], surfaces: ['dark'],
        references: [{ composition: 'statement', align: 'center', anchor: 'bottom', frame: true }, { composition: 'statement', align: 'center', anchor: 'bottom', frame: false }] } },
  }))
  const post = generation.renderGlobalPost(family, { name: 'PRUMO' }, { format: 'carousel', slides: [{ headline: 'Sumol+Compal' }, { headline: 'Montagem de andaimes' }, { headline: 'Fachada' }] }, { slots: [] }, { id: 'global-x' }, crypto.randomUUID)
  assert.deepEqual(post.pages.map(p => p.nodes.some(n => n.designRole === 'headline-frame')), [true, false, false])
})

// A stand-in photo: blotches of warm tones, softened like a photo out of focus.
const photo = async () => {
  let seed = 7
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const cells = []
  for (let y = 0; y < 1350; y += 45) for (let x = 0; x < 1080; x += 45) { const v = Math.round(30 + rand() * 70); cells.push(`<rect x="${x}" y="${y}" width="45" height="45" fill="rgb(${v},${Math.round(v * .8)},${Math.round(v * .65)})"/>`) }
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">${cells.join('')}</svg>`)).blur(6).png().toBuffer()
}
const over = async (base, body) => sharp(base).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">${body}</svg>`) }]).png().toBuffer()
// Bands 15px high every 30px down the top of the slide, like the blinds over the IKACHICA photo.
const bands = (fill, opacity) => Array.from({ length: 26 }, (_, i) => `<rect y="${i * 30}" width="1080" height="15" fill="${fill}" fill-opacity="${opacity}"/>`).join('')
const copy = `${words(80, 960, [260, 200, 240])}${words(80, 1040, [300, 220])}`

test('bands over a photo are stripes: coloured bands are measured as coloured, with their strength and thickness', async () => {
  const base = await photo()
  const orange = await measureReference(await over(base, bands('#e8541e', .45) + copy))
  assert.ok(orange.stripes, 'the bands are found')
  assert.equal(orange.stripes.colored, true)
  assert.equal(orange.stripes.scale, 'medium')
  assert.ok(orange.stripes.opacity >= 35 && orange.stripes.opacity <= 85, JSON.stringify(orange.stripes))
  const white = await measureReference(await over(base, bands('#ffffff', .3) + copy))
  assert.ok(white.stripes, 'white bands are found too')
  assert.equal(white.stripes.colored, false, 'white bands over a warm photo are not coloured')
  assert.equal((await measureReference(await over(base, copy))).stripes, null, 'the photo alone has no stripes')
})

test('lines of copy and a dot grid are not stripes', async () => {
  const list = Array.from({ length: 9 }, (_, i) => words(110, 300 + i * 90, [180, 120, 220, 90])).join('')
  assert.equal((await measureReference(await image(list))).stripes, null)
  const dots = Array.from({ length: 37 }, (_, r) => Array.from({ length: 30 }, (_, c) => `<circle cx="${18 + c * 36}" cy="${18 + r * 36}" r="8" fill="#e8541e"/>`).join('')).join('')
  assert.equal((await measureReference(await image(dots))).stripes, null)
})

test('measured stripes correct the study: coloured bands are accent at their strength, and are added when missed', () => {
  const base = { familyRules: [], variantRules: [], avoid: [], grammar: { emphasis: 'none', headline: { frame: 'none' }, references: [{ composition: 'image-led', align: 'left' }] } }
  const metric = stripes => ({ align: null, box: null, panel: null, rules: 0, coloredText: false, lines: [], stripes })
  const coloured = metric({ scale: 'medium', colored: true, opacity: 54 })
  // The model saw a faint white "scanline" texture.
  const read = applyReferenceMetrics({ ...base, grammar: { ...base.grammar, decorations: [{ kind: 'stripes', placement: 'background', scale: 'oversized', opacity: 20, color: 'foreground', frequency: 'every' }] } }, [coloured])
  assert.deepEqual(read.grammar.decorations, [{ kind: 'stripes', placement: 'background', scale: 'medium', opacity: 54, color: 'accent', frequency: 'every' }])
  assert.ok(read.familyRules.some(r => /accent colour/.test(r)))
  // The model missed them.
  const missed = applyReferenceMetrics({ ...base, grammar: { ...base.grammar, decorations: [{ kind: 'glow' }] } }, [coloured])
  assert.deepEqual(missed.grammar.decorations.map(d => [d.kind, d.color, d.opacity]), [['glow', undefined, undefined], ['stripes', 'accent', 54]])
  // Neutral bands keep the model's colour and strength, take the measured thickness, and are not invented.
  const neutral = metric({ scale: 'small', colored: false, opacity: 15 })
  const kept = applyReferenceMetrics({ ...base, grammar: { ...base.grammar, decorations: [{ kind: 'stripes', placement: 'background', scale: 'large', opacity: 25, color: 'foreground', frequency: 'every' }] } }, [neutral])
  assert.deepEqual(kept.grammar.decorations.map(d => [d.scale, d.color, d.opacity]), [['small', 'foreground', 25]])
  assert.deepEqual(applyReferenceMetrics({ ...base, grammar: { ...base.grammar, decorations: [] } }, [neutral]).grammar.decorations, [])
  // Stripes on one of three references show on some slides.
  assert.equal(applyReferenceMetrics({ ...base, grammar: { ...base.grammar, decorations: [] } }, [coloured, metric(null), metric(null)]).grammar.decorations[0].frequency, 'some')
})
