const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{stripTypeScriptTypes}=require('node:module')
const source=stripTypeScriptTypes(fs.readFileSync('lib/services/brandLogoVariants.ts','utf8').replace(/^import .*$/gm,'').replace(/export /g,''))
test('missing variants are generated from uploaded logo and saved once on the brand',async()=>{
 let calls=0,saved
 const ensure=new Function('loadUpload','generateLogoVariants','persistInlineImages',source+';return ensureBrandLogoVariants').bind(null,require('./uploadTestHelpers.cjs').loadUpload)(async input=>{calls++;assert.match(input,/^data:image\/png;base64,/);return {source:input,inkLightness:.9,bounds:{x:0,y:0,width:1,height:1},blackTransparent:'black',whiteTransparent:'white'}},async(db,v)=>v)
 const brand={id:'brand-flow',logo:'/api/uploads/logo'}
 const db={collection:name=>name==='uploads'?{findOne:async()=>({contentType:'image/png',bytes:Buffer.from('image')})}:{updateOne:async(query,update)=>{assert.equal(query['brandContext.logo'],brand.logo);saved=update.$set['brandContext.logoVariants']}}}
 const result=await ensure(db,brand)
 assert.equal(result.source,brand.logo);assert.equal(saved,result);assert.equal(await ensure(db,brand),result);assert.equal(calls,1)
})
test('valid saved upload URLs are reused without generation',async()=>{
 const ensure=new Function('generateLogoVariants','persistInlineImages',source+';return ensureBrandLogoVariants')(()=>{throw Error('must not generate')},()=>{throw Error('must not persist')})
 const brand={logo:'logo',logoVariants:{source:'logo',inkLightness:.9,bounds:{x:0,y:0,width:1,height:1},blackTransparent:'/api/uploads/black',whiteTransparent:'/api/uploads/white'}}
 assert.equal(await ensure({},brand),brand.logoVariants)
})
test('variants saved before the ink and bounds measurements are regenerated once',async()=>{
 let calls=0
 const ensure=new Function('generateLogoVariants','persistInlineImages',source+';return ensureBrandLogoVariants')(async input=>{calls++;return {source:input,inkLightness:.95,bounds:{x:0,y:0,width:1,height:1},blackTransparent:'b',whiteTransparent:'w'}},async(db,v)=>v)
 const brand={id:'f',logo:'https://x/logo.png',logoVariants:{source:'https://x/logo.png',blackTransparent:'old-b',whiteTransparent:'old-w'}}
 const db={collection:()=>({updateOne:async()=>{}})}
 assert.equal((await ensure(db,brand)).inkLightness,.95)
 await ensure(db,brand);assert.equal(calls,1)
})
