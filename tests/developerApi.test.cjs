const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createHash } = require('node:crypto')
const { stripTypeScriptTypes } = require('node:module')

/** Loads a module with its types stripped: node: and npm imports are required, the rest come from `deps`. */
function load(file, names, deps = {}, env = {}) {
  let source = fs.readFileSync(file, 'utf8')
  if (file.endsWith('.ts')) source = stripTypeScriptTypes(source)
  source = source
    .replace(/^import \{([^}]*)\} from '([^']+)'$/gm, (_, list, from) => {
      const names = list.split(',').map(s => s.trim()).filter(Boolean).join(', ')
      return from in deps ? `const { ${names} } = __deps['${from}']` : `const { ${names} } = require('${from}')`
    })
    .replace(/^import (\w+) from '([^']+)'$/gm, (_, name, from) => (from in deps ? `const ${name} = __deps['${from}']` : `const ${name} = require('${from}')`))
    .replace(/^export /gm, '')
  return new Function('require', '__deps', 'process', source + `;return {${names.join(',')}}`)(require, deps, { env })
}

const keys = load('lib/developer/keys.ts', ['KEY_PREFIX', 'newApiKey', 'hashApiKey', 'readApiKey', 'maskedKey', 'newId'])
const pricing = load('lib/developer/pricing.ts', ['CREDIT_COSTS', 'starterCredits', 'imageCost'], {}, { DEVELOPER_FREE_CREDITS: '10' })
const validate = load('lib/developer/validate.ts', ['apiError', 'errorType', 'parseBody', 'publicHttpUrl', 'readTimeZone', 'MAX_BODY_BYTES'])
const styleParser = load('lib/styleParser.js', ['parseStyledText', 'resolveCanvasClass', 'parseImageTags'])
const documents = load('lib/developer/document.ts', ['readPostDocument', 'toApiDocument', 'LIMITS', 'IMAGE_LIMITS'], { '../styleParser': styleParser, './validate': validate })
const store = load('lib/developer/store.ts', ['creditCharge', 'developerAccount', 'takeCreditsUpTo', 'lastDays', 'createApiKey', 'authenticateKey', 'revokeApiKey'], { './keys': keys, './pricing': pricing, './validate': validate })

const rendered = []
const render = load('lib/developer/render.ts', ['privateAddress', 'loadDocumentImages', 'renderDocument'], {
  '@/lib/renderCanvas': { renderCanvasToPng: async canvas => { rendered.push(canvas); return Buffer.from(`png:${canvas.nodes.length}`) } },
  '@/lib/services/uploadCache': { loadUpload: async (db, id) => (id === 'logo-1.png' ? { bytes: Buffer.from('logo'), contentType: 'image/png' } : null) },
  './document': documents,
  './validate': validate,
})

const bad = (body, pattern) => assert.throws(() => documents.readPostDocument(body), e => e.status === 400 && e.type === 'invalid_request' && pattern.test(e.message), String(pattern))

test('API keys are random, 32 characters after the prefix, and only their hash identifies them', () => {
  const a = keys.newApiKey(), b = keys.newApiKey()
  assert.match(a.key, /^bk_live_[0-9A-Za-z]{32}$/)
  assert.notEqual(a.key, b.key)
  assert.equal(a.hash, createHash('sha256').update(a.key).digest('hex'))
  assert.equal(keys.maskedKey(a), `${a.start}…${a.last4}`)
  assert.match(keys.newId('req'), /^req_[0-9a-f]{24}$/)
})

test('only a well-formed Bearer key is read from the Authorization header', () => {
  const { key } = keys.newApiKey()
  assert.equal(keys.readApiKey(`Bearer ${key}`), key)
  assert.equal(keys.readApiKey(`bearer   ${key} `), key)
  for (const header of [null, '', key, `Basic ${key}`, `Bearer ${key}x`, `Bearer ${key.slice(0, -1)}`, 'Bearer sk_live_' + 'a'.repeat(32)]) assert.equal(keys.readApiKey(header), null, String(header))
})

test('one credit per image; starter credits from DEVELOPER_FREE_CREDITS, 100 by default', () => {
  assert.equal(pricing.imageCost(1), 1)
  assert.equal(pricing.imageCost(7), 7)
  assert.equal(pricing.starterCredits({}), 100)
  assert.equal(pricing.starterCredits({ DEVELOPER_FREE_CREDITS: 'lots' }), 100)
  assert.equal(pricing.starterCredits({ DEVELOPER_FREE_CREDITS: '0' }), 0)
  assert.equal(pricing.starterCredits({ DEVELOPER_FREE_CREDITS: '250' }), 250)
})

test('bodies must be JSON objects under the size limit', () => {
  assert.deepEqual(validate.parseBody('{"a":1}'), { a: 1 })
  assert.throws(() => validate.parseBody(''), e => e.status === 400 && /empty/.test(e.message))
  assert.throws(() => validate.parseBody('{nope'), e => e.status === 400 && /JSON/.test(e.message))
  assert.throws(() => validate.parseBody('[1]'), e => e.status === 400)
  assert.throws(() => validate.parseBody('"' + 'x'.repeat(validate.MAX_BODY_BYTES) + '"'), e => e.status === 413)
  assert.equal(validate.errorType(402), 'insufficient_credits')
  assert.equal(validate.errorType(422), 'invalid_request')
  assert.equal(validate.readTimeZone('Europe/Lisbon'), 'Europe/Lisbon')
  assert.equal(validate.readTimeZone('../../etc'), 'UTC')
})

test('a single post gets its defaults: size, white background and text that fills the width between margins', () => {
  const doc = documents.readPostDocument({ nodes: [{ type: 'text', x: 90, y: 100, text: 'Hello' }] })
  assert.equal(doc.carousel, false)
  assert.deepEqual([doc.width, doc.height], [1080, 1350])
  assert.equal(doc.slides.length, 1)
  const { canvas } = doc.slides[0]
  assert.equal(canvas.background, '#FFFFFF')
  assert.deepEqual(canvas.groups, [])
  const [text] = canvas.nodes
  assert.equal(text.id, 'n0')
  assert.deepEqual([text.width, text.height], [900, 1250])
  assert.deepEqual([text.fontFamily, text.fontSize, text.fontWeight, text.color, text.textAlign, text.verticalAlign, text.lineHeight], ['Inter', 48, 400, '#000000', 'left', 'top', 1.2])
  assert.equal(text.opacity, undefined)
  assert.equal(documents.readPostDocument({ width: 1080, height: 1080, nodes: [{ type: 'text', text: 'x', opacity: 0.5, rotation: 15 }] }).slides[0].canvas.nodes[0].opacity, 50)
})

test('spans become the renderer’s inline tags, and stray tag markers in text are made harmless', () => {
  const [node] = documents.readPostDocument({ nodes: [{ type: 'text', text: ['Open house ', { text: 'this Saturday', color: '#FFD84D', fontWeight: 800, background: '#14131A', padding: 8 }, '!'] }] }).slides[0].canvas.nodes
  assert.equal(node.text, 'Open house <%inline:color=#FFD84D|fontWeight=800|backgroundColor=#14131A|paddingLeft=8px|paddingRight=8px:this Saturday%>!')
  const parsed = styleParser.parseStyledText(node.text)
  assert.equal(parsed.length, 3)
  assert.deepEqual(parsed[1].style, { color: '#FFD84D', fontWeight: '800', backgroundColor: '#14131A', paddingLeft: '8px', paddingRight: '8px' })
  const [plain] = documents.readPostDocument({ nodes: [{ type: 'text', text: 'a <%inline:color=red:b%> c' }] }).slides[0].canvas.nodes
  assert.equal(styleParser.parseStyledText(plain.text).every(t => typeof t === 'string'), true)
  bad({ nodes: [{ type: 'text', text: [{ color: 'red' }] }] }, /"nodes\[0\]\.text\[0\]\.text" is required/)
  bad({ nodes: [{ type: 'text', text: [{ text: 'x', fontFamily: 'Comic|Sans' }] }] }, /fontFamily/)
})

test('every mistake names the property, and near-miss spellings are suggested', () => {
  bad({ nodes: [{ type: 'text', text: 'x', fontsize: 40 }] }, /"nodes\[0\]\.fontsize" is not a property here\. Did you mean "fontSize"\?/)
  bad({ nodes: [{ type: 'text', text: 'x', fontSize: 2 }] }, /"nodes\[0\]\.fontSize" must be from 6 to 600/)
  bad({ nodes: [{ type: 'text', text: 'x', color: 'url(javascript:1)' }] }, /"nodes\[0\]\.color" must be a colour/)
  bad({ nodes: [{ type: 'circle' }] }, /"nodes\[0\]\.type" must be one of: text, image, shape, gradient/)
  bad({ nodes: [{ type: 'image', src: 'https://example.com/a.png' }] }, /"nodes\[0\]\.width" is required/)
  bad({ nodes: [{ type: 'image', src: 'https://example.com/a.png', width: 10, height: 10, mask: 'blob' }] }, /mask/)
  bad({ nodes: [{ type: 'gradient', width: 10, height: 10 }] }, /"nodes\[0\]\.gradient" is required/)
  bad({ nodes: [{ type: 'gradient', width: 10, height: 10, gradient: { stops: [{ color: '#fff' }] } }] }, /2 to 10 colour stops/)
  bad({ nodes: [{ type: 'gradient', width: 10, height: 10, gradient: { stops: [{ color: 'red' }, { color: '#000' }] } }] }, /stops\[0\]\.color" must be a hex colour/)
  bad({ nodes: [], slides: [] }, /both "nodes" and "slides"/)
  bad({}, /needs "nodes"/)
  bad({ width: 100, nodes: [] }, /"width" must be from 320/)
  bad({ nodes: [], bacground: '#000' }, /"body\.bacground" is not a property here/)
  bad({ nodes: Array(101).fill({ type: 'shape', width: 1, height: 1 }) }, /at most 100 nodes/)
})

test('images, shapes and gradients map to the renderer’s nodes', () => {
  const nodes = documents.readPostDocument({
    background: { angle: 180, stops: [{ color: '#000' }, { color: '#3B5BFF', opacity: 0.5 }] },
    nodes: [
      { type: 'image', src: 'https://example.com/a.jpg', x: 10, y: 20, width: 300, height: 200, fit: 'contain', mask: 'circle', crop: { left: 10, top: 5 }, flipX: true, filters: { grayscale: 100 } },
      { type: 'shape', shape: 'ellipse', width: 100, height: 100, fill: '#FFD84D', stroke: { color: '#14131A', width: 4 } },
      { type: 'gradient', width: 100, height: 100, gradient: { type: 'radial', center: { x: 30, y: 70 }, stops: [{ color: '#fff' }, { color: '#000', position: 80 }, { color: '#f00' }] } },
    ],
  }).slides[0].canvas.nodes
  // A gradient background is a full-size gradient node under the others.
  assert.equal(nodes.length, 4)
  assert.deepEqual([nodes[0].id, nodes[0].type, nodes[0].width, nodes[0].height, nodes[0].angle], ['background', 'gradient', 1080, 1350, 180])
  assert.deepEqual(nodes[0].stops, [{ color: '#000000', position: 0, alpha: 100 }, { color: '#3B5BFF', position: 100, alpha: 50 }])
  const [, image, shape, gradient] = nodes
  assert.deepEqual([image.objectFit, image.mask, image.cropLeft, image.cropTop, image.cropRight, image.flipX, image.filters.grayscale], ['contain', 'circle', 10, 5, undefined, true, 100])
  assert.deepEqual([shape.shape, shape.fill, shape.stroke, shape.strokeWidth], ['ellipse', '#FFD84D', '#14131A', 4])
  assert.deepEqual([gradient.gradientType, gradient.focalX, gradient.focalY, gradient.stops.map(s => s.position)], ['radial', 30, 70, [0, 80, 100]])
  bad({ nodes: [{ type: 'image', src: 'x', width: 1, height: 1, crop: { left: 60, right: 50 } }] }, /opposite sides/)
})

test('a carousel renders every slide, or the one asked for; slides inherit the post background', () => {
  const body = { width: 1080, height: 1080, background: '#14131A', slides: [{ nodes: [{ type: 'text', text: 'Cover' }] }, { background: '#FFD84D', nodes: [{ type: 'image', src: 'https://example.com/a.png', width: 10, height: 10 }] }, { nodes: [{ type: 'image', src: 'https://example.com/a.png', width: 20, height: 20 }] }] }
  const all = documents.readPostDocument(body)
  assert.equal(all.carousel, true)
  assert.deepEqual(all.slides.map(s => [s.index, s.canvas.background]), [[1, '#14131A'], [2, '#FFD84D'], [3, '#14131A']])
  assert.deepEqual(all.images, ['https://example.com/a.png'])
  assert.equal(all.slides[1].canvas.nodes[0].id, 's1n0')
  const one = documents.readPostDocument({ ...body, slide: 2 })
  assert.deepEqual(one.slides.map(s => s.index), [2])
  bad({ ...body, slide: 4 }, /"slide" must be from 1 to 3/)
  bad({ slides: [{ nodes: [] }] }, /2 to 10 slides/)
  bad({ nodes: [], slide: 1 }, /only applies to a carousel/)
})

test('a saved editor design becomes a request that renders the same nodes', () => {
  const saved = {
    id: 'post-1', type: 'carousel', width: 1080, height: 1350, background: '#FFFFFF',
    classes: { '.hl': { color: '#F2A900', background: '#14131A', paddingX: 6 } },
    pages: [
      { order: 1, background: '#F6F3EA', nodes: [{ id: 'b', type: 'shape', x: 0, y: 0, width: 100, height: 4, fill: '#000000', shape: 'rect' }] },
      { order: 0, nodes: [
        { id: 't', type: 'text', x: 80, y: 900, width: 920, height: 300, text: 'Hello <%kind:.hl:world%>\nagain', fontFamily: 'Poppins', fontSize: 80, fontWeight: 700, color: '#FFFFFF', textAlign: 'center', lineHeight: 1.1, dynamic_key: 'headline', designRole: 'headline' },
        { id: 'i', type: 'image', x: 0, y: 0, width: 1080, height: 800, src: '/api/uploads/logo-1.png', opacity: 80, borderRadius: 24 },
        { id: 'h', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'hidden', hidden: true },
        { id: 'g', type: 'gradient', x: 0, y: 400, width: 1080, height: 400, gradientType: 'linear', angle: 180, stops: [{ color: '#000000', position: 0, alpha: 0 }, { color: '#000000', position: 100, alpha: 100 }] },
      ] },
    ],
  }
  const api = documents.toApiDocument(saved, 'https://batkle.example')
  assert.equal(api.slides.length, 2)
  assert.equal(api.slides[0].background, '#FFFFFF')
  assert.equal(api.slides[1].background, '#F6F3EA')
  const [text, image, gradient] = api.slides[0].nodes
  assert.equal(api.slides[0].nodes.length, 3, 'hidden nodes are left out')
  assert.deepEqual(text.text, ['Hello ', { text: 'world', color: '#F2A900', background: '#14131A', padding: 6 }, '\nagain'])
  assert.equal(text.verticalAlign, 'middle', 'saved centred text sits in the middle of its box')
  assert.equal(text.dynamic_key, undefined)
  assert.deepEqual([image.src, image.opacity, image.borderRadius], ['https://batkle.example/api/uploads/logo-1.png', 0.8, 24])
  assert.deepEqual(gradient.gradient, { type: 'linear', angle: 180, stops: [{ color: '#000000', position: 0, opacity: 0 }, { color: '#000000', position: 100 }] })
  // The exported request is a valid body.
  const back = documents.readPostDocument(JSON.parse(JSON.stringify(api)))
  assert.equal(back.slides.length, 2)
  const node = back.slides[0].canvas.nodes[0]
  assert.deepEqual([node.x, node.y, node.width, node.height, node.fontFamily, node.fontSize, node.textAlign, node.verticalAlign], [80, 900, 920, 300, 'Poppins', 80, 'center', 'middle'])
  assert.match(node.text, /^Hello <%inline:color=#F2A900\|backgroundColor=#14131A\|paddingLeft=6px\|paddingRight=6px:world%>\nagain$/)
  const single = documents.toApiDocument({ width: 1080, height: 1080, background: '#000000', nodes: [{ type: 'shape', x: 0, y: 0, width: 5, height: 5, fill: '#fff' }] })
  assert.deepEqual(Object.keys(single), ['width', 'height', 'background', 'nodes'])
})

test('images load only from data URLs, Batkle uploads and public addresses', async () => {
  for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.5', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) assert.equal(render.privateAddress(ip), true, ip)
  for (const ip of ['8.8.8.8', '151.101.1.69', '2606:4700::1111']) assert.equal(render.privateAddress(ip), false, ip)
  const doc = images => ({ images })
  const loaded = await render.loadDocumentImages({}, doc(['data:image/png;base64,iVBO Rw0K', '/api/uploads/logo-1.png', 'https://batkle.example/api/uploads/logo-1.png']), 'https://batkle.example')
  assert.equal(loaded.get('data:image/png;base64,iVBO Rw0K'), 'data:image/png;base64,iVBORw0K')
  assert.equal(loaded.get('/api/uploads/logo-1.png'), `data:image/png;base64,${Buffer.from('logo').toString('base64')}`)
  assert.equal(loaded.get('https://batkle.example/api/uploads/logo-1.png'), loaded.get('/api/uploads/logo-1.png'))
  for (const [src, reason] of [
    ['http://169.254.169.254/latest/meta-data', /not a public/],
    ['http://localhost:3000/api/flows', /not a public/],
    ['http://[::1]/x.png', /not a public/],
    ['file:///etc/passwd', /not a public/],
    ['data:text/html;base64,PHNjcmlwdD4=', /data URL must be/],
    ['/api/uploads/missing.png', /no Batkle upload/],
  ]) await assert.rejects(render.loadDocumentImages({}, doc([src]), 'https://batkle.example'), e => e.status === 422 && e.type === 'image_unavailable' && reason.test(e.message), src)
  await assert.rejects(render.loadDocumentImages({}, doc(Array.from({ length: 41 }, (_, i) => `data:image/png;base64,${i}`)), ''), e => e.status === 400)
})

test('a post renders to one PNG and a carousel to a ZIP of numbered slides', async () => {
  rendered.length = 0
  const single = await render.renderDocument({}, documents.readPostDocument({ nodes: [{ type: 'image', src: '/api/uploads/logo-1.png', width: 10, height: 10 }] }), '')
  assert.deepEqual([single.contentType, single.filename, single.images], ['image/png', 'post.png', 1])
  assert.match(rendered[0].nodes[0].src, /^data:image\/png;base64,/)
  const carousel = documents.readPostDocument({ slides: [{ nodes: [] }, { nodes: [{ type: 'text', text: 'b' }] }] })
  const zip = await render.renderDocument({}, carousel, '')
  assert.deepEqual([zip.contentType, zip.filename, zip.images], ['application/zip', 'carousel.zip', 2])
  const files = Object.keys((await require('jszip').loadAsync(zip.bytes)).files)
  assert.deepEqual(files, ['slide-01.png', 'slide-02.png'])
  const one = await render.renderDocument({}, documents.readPostDocument({ slides: [{ nodes: [] }, { nodes: [] }], slide: 2 }), '')
  assert.deepEqual([one.contentType, one.filename], ['image/png', 'slide-02.png'])
})

test('usage days are calendar dates in the viewer’s time zone', () => {
  assert.deepEqual(store.lastDays(3, 'UTC', new Date('2026-03-01T10:00:00Z')), ['2026-02-27', '2026-02-28', '2026-03-01'])
  assert.equal(store.lastDays(1, 'Pacific/Auckland', new Date('2026-10-14T20:00:00Z'))[0], '2026-10-15')
})

/** Enough of MongoDB for the credit and key functions: equality and $gte filters, $inc/$set and the floor pipeline. */
function fakeDb() {
  const data = {}
  const matches = (doc, filter) => Object.entries(filter).every(([k, v]) => v && typeof v === 'object' && '$gte' in v ? doc[k] >= v.$gte : v === null ? doc[k] == null : doc[k] === v)
  const apply = (doc, update) => {
    if (Array.isArray(update)) { doc.balance = Math.max(0, doc.balance - update[0].$set.balance.$max[1].$subtract[1]); return }
    for (const [k, v] of Object.entries(update.$inc || {})) doc[k] = (doc[k] || 0) + v
    Object.assign(doc, update.$set || {})
  }
  const collection = name => {
    const docs = (data[name] ||= [])
    return {
      createIndex: async () => {},
      countDocuments: async filter => docs.filter(d => matches(d, filter)).length,
      findOne: async filter => { const d = docs.find(x => matches(x, filter)); return d ? { ...d } : null },
      insertOne: async doc => {
        if (name === 'developerAccounts' && docs.some(d => d.id === doc.id)) throw Object.assign(new Error('duplicate'), { code: 11000 })
        docs.push({ ...doc })
      },
      updateOne: async (filter, update) => { const d = docs.find(x => matches(x, filter)); if (d) apply(d, update); return { matchedCount: d ? 1 : 0 } },
      findOneAndUpdate: async (filter, update, options = {}) => {
        const d = docs.find(x => matches(x, filter))
        if (!d) return null
        const before = { ...d }
        apply(d, update)
        return options.returnDocument === 'before' ? before : { ...d }
      },
    }
  }
  return { data, collection }
}

test('a new account opens once with the starter credits, and charges never overdraw it', async () => {
  const db = fakeDb()
  assert.equal((await store.developerAccount(db, 'user_1')).balance, 10)
  assert.equal((await store.developerAccount(db, 'user_1')).balance, 10)
  assert.equal(db.data.creditLedger.length, 1)
  const charge = store.creditCharge(db, 'user_1')
  await charge.take(4)
  await assert.rejects(charge.take(7), e => e.status === 402 && e.type === 'insufficient_credits' && e.needed === 7 && e.balance === 6)
  await charge.settle(2)
  assert.equal((await store.developerAccount(db, 'user_1')).balance, 8)
  await charge.settle(20)
  assert.equal((await store.developerAccount(db, 'user_1')).balance, 0)
  await charge.refundAll()
  assert.equal((await store.developerAccount(db, 'user_1')).balance, 10)
})

test('keys are stored as a hash, authenticate until revoked, and are capped per account', async () => {
  const db = fakeDb()
  const { key, record } = await store.createApiKey(db, 'user_1', '  Production   server ')
  assert.equal(record.name, 'Production server')
  assert.equal(db.data.apiKeys[0].hash, keys.hashApiKey(key))
  assert.ok(!JSON.stringify(db.data.apiKeys).includes(key))
  assert.equal((await store.authenticateKey(db, key)).ownerId, 'user_1')
  await store.revokeApiKey(db, 'user_1', record.id)
  assert.equal(await store.authenticateKey(db, key), null)
  await assert.rejects(store.revokeApiKey(db, 'user_2', record.id), e => e.status === 404)
  for (let i = 0; i < 10; i++) await store.createApiKey(db, 'user_1', `Key ${i}`)
  await assert.rejects(store.createApiKey(db, 'user_1', 'One too many'), e => e.status === 400)
})
