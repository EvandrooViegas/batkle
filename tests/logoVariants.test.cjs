const { test } = require('node:test')
const assert = require('node:assert/strict')
const sharp = require('sharp')
const { stripTypeScriptTypes } = require('node:module')
const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../lib/services/logoVariants.ts'), 'utf8').replace(/^import .*$/gm, '').replace(/export /g, '')
const { createLogoVariants, generateLogoVariants } = require('node:vm').runInNewContext(stripTypeScriptTypes(source) + '\n({createLogoVariants,generateLogoVariants})', { sharp, Buffer, Uint8Array, Int32Array })
const decode = src => sharp(Buffer.from(src.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer()
const size = async src => { const { width, height } = await sharp(Buffer.from(src.split(',')[1], 'base64')).metadata(); return { width, height } }

test('removes colored flat backgrounds and generates contrasting opaque and transparent variants', async () => {
  const input = await sharp(Buffer.from('<svg width="80" height="40"><rect width="80" height="40" fill="red"/><rect x="20" y="10" width="40" height="20" fill="blue"/></svg>')).png().toBuffer()
  const variants = await createLogoVariants(input)
  assert.equal(Object.keys(variants).length, 10)
  // The red background is removed and every variant is cropped to the 40×20 blue mark.
  assert.deepEqual({ ...variants.bounds }, { x: 0, y: 0, width: 1, height: 1 })
  assert.equal(variants.imageAspect, 2)
  assert.ok(Math.abs(variants.inkLightness - .0722) < .005, 'ink lightness is the relative luminance of the remaining blue artwork')
  for (const key of ['originalTransparent', 'blackTransparent', 'whiteTransparent', 'whiteOnBlack', 'blackOnWhite']) {
    assert.deepEqual(await size(variants[key]), { width: 40, height: 20 }, key)
    assert.equal((await decode(variants[key]))[(5 * 40 + 5) * 4 + 3], 255)
  }
  assert.deepEqual([...((await decode(variants.blackTransparent)).subarray((5 * 40 + 5) * 4, (5 * 40 + 5) * 4 + 4))], [0, 0, 0, 255])
  assert.deepEqual([...(await decode(variants.whiteOnBlack)).subarray(0, 4)], [255, 255, 255, 255])
  assert.deepEqual([...(await decode(variants.blackOnWhite)).subarray(0, 4)], [0, 0, 0, 255])
})

test('preserves partial alpha and aspect ratio of transparent artwork', async () => {
  const input = await sharp({ create: { width: 20, height: 10, channels: 4, background: { r: 30, g: 50, b: 200, alpha: .5 } } }).png().toBuffer()
  const variants = await createLogoVariants(input)
  const raw = await decode(variants.whiteTransparent)
  assert.equal(raw.length, 20 * 10 * 4)
  assert.ok(raw[3] >= 127 && raw[3] <= 128)
  assert.equal(raw[0], 255)
})

test('rejects empty artwork and invalid images', async () => {
  await assert.rejects(createLogoVariants(Buffer.from('invalid')))
  const blank = await sharp({ create: { width: 20, height: 20, channels: 4, background: 'white' } }).png().toBuffer()
  await assert.rejects(createLogoVariants(blank), /No visible logo/)
})

test('designer selects contrasting saved variants without downloading the original', async () => {
  const code = require('node:fs').readFileSync(require('node:path').join(__dirname, '../lib/handlers/canvasDesignerHandler.ts'), 'utf8').replace(/^import .*$/gm, '').replace(/export /g, '')
  const { softenCanvasLogos } = require('node:vm').runInNewContext(stripTypeScriptTypes(code) + '\n({softenCanvasLogos})', {
    containPreparedLogo: async () => { throw Error('Saved URL must not be decoded as inline data') },
    prepareLogo: async () => { throw new Error('Unexpected download') },
  })
  for (const [background, expected] of [['#ffffff', '/api/uploads/black'], ['#000000', '/api/uploads/white']]) {
    const canvas = { background, nodes: [{ type: 'image', src: 'https://example.com/logo.png', x: 0, y: 0, width: 100, height: 40 }] }
    await softenCanvasLogos(canvas, 'https://example.com/logo.png', { source: 'https://example.com/logo.png', blackTransparent: '/api/uploads/black', whiteTransparent: '/api/uploads/white' })
    assert.equal(canvas.nodes.length, 1)
    assert.equal(canvas.nodes[0].src, expected)
    assert.equal(canvas.nodes[0].width, 100)
  }
})

test('URL-encoded SVG data logos produce variants',async()=>{
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect x="20" y="20" width="40" height="40" fill="red"/></svg>'
 const result=await generateLogoVariants('data:image/svg+xml,'+encodeURIComponent(svg))
 assert.ok(result.whiteTransparent.startsWith('data:image/png;base64,'))
})
test('PNG inside ICO is decoded automatically',async()=>{
 const png=await sharp(Buffer.from('<svg width="32" height="32"><rect x="8" y="8" width="16" height="16" fill="red"/></svg>')).png().toBuffer()
 const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=32;header[7]=32;header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18)
 const result=await createLogoVariants(Buffer.concat([header,png]))
 assert.ok(result.blackTransparent)
})

test('badge variants retain the lettering instead of a solid circle',async()=>{
 const input=await sharp(Buffer.from('<svg width="100" height="100"><circle cx="50" cy="50" r="48" fill="black"/><path d="M35 70 V30 L65 70 V30" fill="none" stroke="white" stroke-width="7"/></svg>')).png().toBuffer()
 const result=await createLogoVariants(input)
 const black=await decode(result.blackTransparent),white=await decode(result.whiteTransparent),original=await decode(result.originalTransparent)
 // Variants are cropped to the circle; points are taken relative to its centre.
 const {width:w,height:h}=await size(result.originalTransparent),dx=50-Math.round(w/2),dy=50-Math.round(h/2)
 const at=(x,y)=>((y-dy)*w+(x-dx))*4,badge=at(15,50),ink=at(35,40)
 assert.equal(original[badge+3],255)
 assert.equal(black[badge+3],0)
 assert.equal(white[badge+3],0)
 assert.ok(black[ink+3]>220)
 assert.equal(black[ink],0)
 assert.equal(white[ink],255)
})

test('edge-touching black logo loses its white background',async()=>{
 const input=await sharp(Buffer.from('<svg width="100" height="50"><rect width="100" height="50" fill="white"/><rect x="30" width="35" height="50" fill="black"/></svg>')).png().toBuffer()
 const result=await createLogoVariants(input),white=await decode(result.whiteTransparent)
 // Only the 35px black bar remains: the white background was removed and cropped away.
 assert.deepEqual(await size(result.whiteTransparent),{width:35,height:50})
 assert.equal(white[(25*35+15)*4],255);assert.equal(white[(25*35+15)*4+3],255)
})

test('almost opaque logo with transparent corners still has its background removed',async()=>{
 const width=100,height=50,pixels=Buffer.alloc(width*height*4,255)
 for(const i of [0,width-1,(height-1)*width,width*height-1])pixels[i*4+3]=0
 for(let y=0;y<height;y++)for(let x=35;x<65;x++){const i=(y*width+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=0}
 const png=await sharp(pixels,{raw:{width,height,channels:4}}).png().toBuffer()
 const variants=await createLogoVariants(png),white=await decode(variants.whiteTransparent)
 // The white field is removed, leaving only the 30px black bar.
 assert.deepEqual(await size(variants.whiteTransparent),{width:30,height})
 assert.equal(white[(25*30+15)*4+3],255)
 assert.equal(white[(25*30+15)*4],255)
})

test('uploaded photo pixels determine black or white logo independently of page color',async()=>{
 const vm=require('node:vm'),fs=require('node:fs')
 const load=path=>stripTypeScriptTypes(fs.readFileSync(path,'utf8').replace(/^import .*$/gm,'').replace(/export /g,''))
 const {sampleLogoBackdrop}=vm.runInNewContext(load('lib/services/logoBackground.ts')+';({sampleLogoBackdrop})',{sharp,Buffer,loadUpload:require('./uploadTestHelpers.cjs').loadUpload})
 const {softenCanvasLogos}=vm.runInNewContext(load('lib/handlers/canvasDesignerHandler.ts')+';({softenCanvasLogos})',{sampleLogoBackdrop})
 // One image with a bright upper half and dark lower half. Only local logo area matters.
 const bytes=await sharp(Buffer.from('<svg width="100" height="100"><rect width="100" height="100" fill="white"/><rect y="50" width="100" height="50" fill="black"/></svg>')).png().toBuffer()
 let reads=0
 const db={collection:name=>{assert.equal(name,'uploads');return {findOne:async query=>{assert.equal(query.id,'photo');reads++;return {bytes:{buffer:bytes}}}}}}
 const variants={source:'brand-logo',blackTransparent:'/api/uploads/black',whiteTransparent:'/api/uploads/white'}
 for(const [y,expected] of [[5,variants.blackTransparent],[75,variants.whiteTransparent]]){
  const canvas={background:y===5?'#000000':'#ffffff',nodes:[{type:'image',src:'/api/uploads/photo',x:0,y:0,width:100,height:100},{type:'image',src:'brand-logo',x:70,y,width:20,height:15}]}
  await softenCanvasLogos(canvas,'brand-logo',variants,db)
  assert.equal(canvas.nodes[1].src,expected)
 }
 assert.equal(reads,2)
})
