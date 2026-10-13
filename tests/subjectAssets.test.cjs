const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const sharp = require('sharp')
const { stripTypeScriptTypes } = require('node:module')
const source = fs.readFileSync(require('node:path').join(__dirname, '../lib/services/subjectAssets.ts'), 'utf8').replace(/^import .*$/gm, '').replace(/export /g, '')
const service = vm.runInNewContext(stripTypeScriptTypes(source) + '\n({hydrateSubjectCrops,validateSubject,createSubject,prepareSubjectAssets,cleanSubjectMask,restoreSubjectSurfaces,removeStudioBackground})', {
  require, sharp, Buffer, Blob, Uint8Array, URL, console,
  createHash: require('node:crypto').createHash, Binary: require('mongodb').Binary,
  downloadLogo: async () => { throw new Error('offline fixture') },
  loadUpload: require('./uploadTestHelpers.cjs').loadUpload, compactImage: require('./uploadTestHelpers.cjs').keepImage,
})
async function fixture(background = 'transparent') {
  return sharp(Buffer.from(`<svg width="100" height="120"><rect width="100" height="120" fill="${background}"/><rect x="30" y="20" width="40" height="80" fill="red"/></svg>`)).png().toBuffer()
}
test('valid alpha is retained and transparent margins trimmed', async () => {
  const result = await service.createSubject(await fixture())
  assert.equal(result.width, 48); assert.equal(result.height, 88)
  assert.equal((await sharp(result.png).metadata()).hasAlpha, true)
})
test('empty and opaque masks are rejected', async () => {
  assert.equal(await service.validateSubject(await fixture('white')), null)
  const empty = await sharp({ create: { width: 100, height: 100, channels: 4, background: '#00000000' } }).png().toBuffer()
  assert.equal(await service.validateSubject(empty), null)
})
test('source crop edges are recorded before transparent padding is trimmed',async()=>{
 const image=await sharp(Buffer.from('<svg width="100" height="120"><rect x="0" y="20" width="60" height="100" fill="red"/></svg>')).png().toBuffer()
 const result=await service.validateSubject(image)
 assert.equal(result.cropEdges.left,true);assert.equal(result.cropEdges.bottom,true)
 assert.equal(result.cropEdges.top,false);assert.equal(result.cropEdges.right,false)
})
test('derivative persists once and subsequent requests reuse it', async () => {
  const uploads = new Map(); let writes = 0
  const db = { collection: () => ({ findOne: async ({ id }) => uploads.get(id), updateOne: async ({ id }, update) => { writes++; uploads.set(id, update.$setOnInsert) } }) }
  const url = 'data:image/png;base64,' + (await fixture()).toString('base64')
  const plan = { slots: [{ slot_id: 'a', resolvedAsset: { url } }, { slot_id: 'b', resolvedAsset: { url } }] }
  const first = await service.prepareSubjectAssets(db, plan)
  const second = await service.prepareSubjectAssets(db, plan)
  assert.equal(writes, 1)
  assert.equal(first.slots[0].resolvedAsset.url, url)
  assert.equal(first.slots[0].resolvedAsset.subject.url, second.slots[0].resolvedAsset.subject.url)
  assert.equal(plan.slots[0].resolvedAsset.subject, undefined)
})
test('failed remote image leaves original usable', async () => {
  const plan = { slots: [{ slot_id: 'a', resolvedAsset: { url: 'https://example.com/photo.jpg' } }] }
  const result = await service.prepareSubjectAssets({}, plan)
  assert.equal(result.slots[0].resolvedAsset.url, plan.slots[0].resolvedAsset.url)
  assert.equal(result.slots[0].resolvedAsset.subject, undefined)
})

test('mask cleanup removes detached debris but preserves substantial props and soft edges', async () => {
  const input = await sharp(Buffer.from('<svg width="200" height="200"><rect x="40" y="30" width="80" height="140" fill="red"/><rect x="120" y="30" width="2" height="140" fill="red" opacity="0.3"/><rect x="150" y="70" width="25" height="60" fill="blue"/><rect x="180" y="10" width="5" height="5" fill="white" opacity="0.4"/></svg>')).png().toBuffer()
  const output = await service.cleanSubjectMask(input)
  const {data,info} = await sharp(output).raw().toBuffer({resolveWithObject:true})
  const alpha = (x,y) => data[(y*info.width+x)*4+3]
  assert.equal(alpha(182,12),0)
  assert.equal(alpha(160,80),255)
  assert.equal(alpha(80,80),255)
  assert.ok(alpha(120,80)>0 && alpha(120,80)<255)
})

test('restores a missing dark screen from original RGB but leaves background gaps clear', async () => {
  const source = await sharp(Buffer.from('<svg width="200" height="160"><rect width="200" height="160" fill="white"/><rect x="20" y="20" width="160" height="120" fill="#333"/><rect x="110" y="40" width="40" height="70" fill="white"/></svg>')).png().toBuffer()
  const mask = await sharp(Buffer.from('<svg width="200" height="160"><path fill="#333" fill-rule="evenodd" d="M20 20H180V140H20Z M30 40H90V110H30Z M110 40H150V110H110Z"/></svg>')).png().toBuffer()
  const output = await service.restoreSubjectSurfaces(mask,source)
  const {data,info} = await sharp(output).raw().toBuffer({resolveWithObject:true})
  const at=(x,y,c)=>data[(y*info.width+x)*4+c]
  assert.equal(at(50,60,3),255)
  assert.equal(at(50,60,0),51)
  assert.equal(at(120,60,3),0)
  assert.equal(at(0,0,3),0)
})

test('plain code removes studio backdrop while preserving enclosed screen of same colour', async () => {
  const input = await sharp(Buffer.from('<svg width="200" height="160"><rect width="200" height="160" fill="white"/><rect x="30" y="20" width="140" height="120" fill="#222"/><rect x="40" y="30" width="120" height="90" fill="white"/></svg>')).png().toBuffer()
  const output = await service.removeStudioBackground(input)
  assert.ok(output)
  const {data,info} = await sharp(output).raw().toBuffer({resolveWithObject:true})
  const alpha=(x,y)=>data[(y*info.width+x)*4+3]
  assert.equal(alpha(0,0),0)
  assert.equal(alpha(80,60),255)
  assert.equal(alpha(32,40),255)
})
test('plain code declines complex borders and empty scenes', async () => {
  const complex = await sharp(Buffer.from('<svg width="100" height="120"><rect width="50" height="120" fill="red"/><rect x="50" width="50" height="120" fill="blue"/></svg>')).png().toBuffer()
  assert.equal(await service.removeStudioBackground(complex),null)
  const empty=await sharp({create:{width:100,height:100,channels:4,background:'white'}}).png().toBuffer()
  assert.equal(await service.removeStudioBackground(empty),null)
})

test('saved transparent cutouts gain crop metadata without generating a new asset',async()=>{
 const png=await sharp(Buffer.from('<svg width="100" height="120"><rect x="40" y="20" width="60" height="100" fill="red"/></svg>')).png().toBuffer()
 const subject={url:'data:image/png;base64,'+png.toString('base64'),width:100,height:120}
 const plan={slots:[{slot_id:'existing',treatment:'isolated_subject',resolvedAsset:{url:'original',subject}}]}
 const result=await service.hydrateSubjectCrops({},plan)
 assert.equal(result.slots[0].resolvedAsset.subject.url,subject.url)
 assert.equal(result.slots[0].resolvedAsset.subject.cropEdges.right,true)
 assert.equal(result.slots[0].resolvedAsset.subject.cropEdges.left,false)
 assert.equal(plan.slots[0].resolvedAsset.subject.cropEdges,undefined)
})

test('older padded cutouts with false crop flags are reinspected',async()=>{
 const png=await sharp(Buffer.from('<svg width="100" height="120"><rect x="4" y="20" width="50" height="96" fill="red"/></svg>')).png().toBuffer()
 const subject={url:'data:image/png;base64,'+png.toString('base64'),width:100,height:120,cropEdges:{left:false,right:false,top:false,bottom:false}}
 const plan={slots:[{slot_id:'old',treatment:'environmental',resolvedAsset:{url:'original',subject}}]}
 const result=await service.hydrateSubjectCrops({},plan)
 assert.equal(result.slots[0].resolvedAsset.subject.cropEdges.left,true)
 assert.equal(result.slots[0].resolvedAsset.subject.cropEdges.right,false)
 assert.equal(result.slots[0].resolvedAsset.subject.cropVersion,3)
})

test('a complete parcel edge does not compete with the long cropped van edge',async()=>{
 const png=await sharp(Buffer.from('<svg width="100" height="120"><rect x="40" y="20" width="56" height="90" fill="white"/><rect x="4" y="70" width="60" height="40" fill="brown"/></svg>')).png().toBuffer()
 const result=await service.validateSubject(png)
 assert.equal(result.cropEdges.right,true)
 assert.equal(result.cropEdges.left,false)
})
