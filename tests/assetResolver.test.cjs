const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')
const source = fs.readFileSync(require('node:path').join(__dirname, '../lib/handlers/assetResolverHandler.ts'), 'utf8')
  .replace(/^import .*$/gm, '').replace(/export /g, '')
function engine(fetch, generation, env = {}) {
  const library=new Function('createHash',stripTypeScriptTypes(fs.readFileSync('lib/services/generatedAssetLibrary.ts','utf8').replace(/^import .*$/gm,'').replace(/export /g,''))+';return {findGeneratedAsset,saveGeneratedAsset}')(require('node:crypto').createHash)
  return vm.runInNewContext(stripTypeScriptTypes(source) + (generation ? '\ngenerateImage = generation;\n' : '') + '\n({ searchUnsplash, searchStock, resolveSlot, buildGenerationBrief, generateImageOpenAI })', {
    hasWatermarkMetadata: new Function(stripTypeScriptTypes(fs.readFileSync('lib/handlers/assetPlannerHandler.ts','utf8').replace(/^import .*$/gm,'').replace(/export /g,''))+';return hasWatermarkMetadata')(),
    ...library,fetch, generation, console, URL, Buffer, Uint8Array, AbortSignal, sharp: require('sharp'), process: {env}, Math: Object.assign(Object.create(Math), { random: () => 0 }),
  })
}
const photo = id => ({ id, urls: { regular: `https://images.example/${id}` } })
const slot = { search_queries: ['hands testing soil', 'gardener holding soil'], search_keywords: ['garden'], visual_purpose: 'Check soil' }
test('described background upload resolves before automatic tagging without stock or generation calls', async () => {
 const e=engine(async()=>{throw Error('No network expected')},async()=>{throw Error('No generation expected')})
 const db={collection:()=>({findOne:async query=>{
  assert.equal(query.brand_id,'brand-a');assert.equal(query.id,'upload')
  return {id:'upload',status:'processing',description:'Campo de trigo',description_tags:['wheat','field'],url:'saved-photo',width:1200,height:800}
 }})}
 const result=await e.resolveSlot(db,{slot_id:'bg',needs_visual:true,preferred_source:'uploaded_asset',treatment:'environmental',selected:{asset_id:'upload'}},'brand-a',null,null,new Set())
 assert.equal(result.resolvedAsset.url,'saved-photo')
 assert.equal(result.resolvedAsset.alt,'Campo de trigo')
 assert.equal(result.warning,null)
})
test('background stock preference avoids AI and retains environmental treatment',async()=>{
 const e=engine(async()=>({ok:true,json:async()=>({results:[photo('background')]})}),async()=>{throw Error('AI should not run')})
 const result=await e.resolveSlot({}, {...slot,slot_id:'bg',needs_visual:true,preferred_source:'unsplash',treatment:'environmental'},null,'key',null,new Set())
 assert.equal(result.source,'unsplash');assert.equal(result.treatment,'environmental')
})

test('concurrent slots reserve distinct photos from overlapping results', async () => {
  const e = engine(async () => ({ ok: true, json: async () => ({ results: [photo('a'), photo('b')] }) }))
  const used = new Set()
  const results = await Promise.all([e.searchUnsplash(slot, 'key', used), e.searchUnsplash(slot, 'key', used)])
  assert.equal(new Set(results.map(r => r.unsplash_id)).size, 2)
})

test('exhausted results retry a standalone alternative query', async () => {
  const queries = []
  const e = engine(async url => {
    queries.push(new URL(url).searchParams.get('query'))
    return { ok: true, json: async () => ({ results: queries.length === 1 ? [photo('used')] : [photo('new')] }) }
  })
  assert.equal((await e.searchUnsplash(slot, 'key', new Set(['used']))).unsplash_id, 'new')
  assert.deepEqual(queries, slot.search_queries)
})

test('legacy tags work and empty searches do not request arbitrary photos', async () => {
  const queries = []
  const e = engine(async url => {
    queries.push(new URL(url).searchParams.get('query'))
    return { ok: true, json: async () => ({ results: [photo('legacy')] }) }
  })
  await e.searchUnsplash({ search_keywords: ['garden', 'soil'] }, 'key', new Set())
  assert.deepEqual(queries, ['garden soil'])
  assert.equal(await e.searchUnsplash({ search_keywords: [] }, 'key', new Set()), null)
  assert.equal(queries.length, 1)
})

test('text-only slides never fetch an image', async () => {
  const e = engine(async () => { throw new Error('Unexpected request') })
  const result = await e.resolveSlot(null, { ...slot, needs_visual: false, preferred_source: 'none' }, null, 'key', null, new Set())
  assert.equal(result.resolvedAsset, null)
})

test('isolated subject ranking prefers a relevant portrait over crowds', async () => {
  const e = engine(async () => ({ ok: true, json: async () => ({ results: [
    { ...photo('crowd'), alt_description: 'group of people in a crowd' },
    { ...photo('portrait'), alt_description: 'single person studio portrait' },
  ] }) }))
  const result = await e.searchUnsplash({ ...slot, treatment: 'isolated_subject', search_keywords: ['person'] }, 'key', new Set())
  assert.equal(result.unsplash_id, 'portrait')
})

test('generation brief includes exact slide context and explicit realism and cutout instructions',()=>{
 const brief=engine().buildGenerationBrief({...slot,treatment:'isolated_subject',slide_context:{headline:'Work efficiently',body:'Type and manage orders on your laptop'},subject_description:'Shop owner typing on a laptop',brand_context:{name:'Example'}})
 assert.ok(brief.includes('Type and manage orders on your laptop'))
 assert.ok(brief.includes('Shop owner typing on a laptop'))
 assert.ok(brief.includes('Photorealistic'))
 assert.ok(brief.includes('background-removal code'))
 const scene=engine().buildGenerationBrief({...slot,treatment:'environmental'})
 assert.ok(scene.includes('Preserve meaningful workspace'))
 assert.ok(!scene.includes('Plain contrasting studio backdrop'))
})

test('AI failure does not retry or switch to stock',async()=>{
 const order=[]
 const e=engine(async()=>{order.push('stock');return {ok:true,json:async()=>({results:[photo('fallback')]})}},async()=>{order.push('ai');throw Error('Provider unavailable')})
 const result=await e.resolveSlot(null,{...slot,needs_visual:true,preferred_source:'ai_generated'},null,'key',null,new Set())
 assert.deepEqual(order,['ai'])
 assert.equal(result.source,'ai_generated')
 assert.equal(result.resolvedAsset,null)
 assert.match(result.warning,/Provider unavailable/)
})
test('failed stock selection does not automatically generate an AI image',async()=>{
 const e=engine(async()=>{throw Error('Stock must not run')},async()=>({source:'ai_generated',url:'data:image/png;base64,fixture'}))
 const result=await e.resolveSlot(null,{...slot,needs_visual:true,preferred_source:'unsplash'},null,'key',null,new Set())
 assert.equal(result.source,'unsplash')
 assert.equal(result.resolvedAsset,null)
})

test('GPT Image 2.5 requests native transparent PNG and reads real dimensions', async () => {
  const png=await require('sharp')({create:{width:64,height:80,channels:4,background:'#00000000'}}).png().toBuffer()
  let request
  const e=engine(async (url,options)=>{request=JSON.parse(options.body);assert.equal(url,'https://api.openai.com/v1/images/generations');return new Response(JSON.stringify({data:[{b64_json:png.toString('base64')}]}))},null,{OPENAI_API_KEY:'test-only'})
  const image=await e.generateImageOpenAI('person holding complete laptop')
  assert.equal(request.model,'gpt-image-2.5-sunburst')
  assert.equal(request.background,'transparent')
  assert.equal(request.output_format,'png')
  assert.equal(image.width,64);assert.equal(image.height,80)
})
test('missing OpenAI key reports configuration error without fetching',async()=>{
 const e=engine(()=>{throw Error('must not fetch')})
 await assert.rejects(e.generateImageOpenAI('photo',false),/OPENAI_API_KEY/)
})

test('drawing design requests illustration instead of photorealistic output',()=>{
 const brief=engine(()=>{}).buildGenerationBrief({...slot,image_style:'drawing',treatment:'isolated_subject'},true)
 assert.ok(brief.includes('editorial illustration'))
 assert.ok(brief.includes('Intentional editorial drawing'))
 assert.equal(brief.includes('Photorealistic natural skin'),false)
})

async function alphaFramingFixture(twoSides){
 const sharp=require('sharp')
 const png=await sharp(Buffer.from(`<svg width="100" height="100"><rect x="0" y="10" width="${twoSides?100:60}" height="80" fill="red"/></svg>`)).png().toBuffer()
 return {url:'data:image/png;base64,'+png.toString('base64'),width:100,height:100}
}

test('single generation receives strict constraints without automatic crop retries',async()=>{
 const bad=await alphaFramingFixture(true),good=await alphaFramingFixture(false),prompts=[]
 const e=engine(async()=>{throw Error('Stock should not run')},async prompt=>{prompts.push(prompt);return prompts.length===1?bad:good})
 const result=await e.resolveSlot({}, {...slot,slot_id:'a',needs_visual:true,preferred_source:'ai_generated',treatment:'isolated_subject'},null,null,null,new Set())
 assert.equal(prompts.length,1);assert.match(prompts[0],/STRICT COMPOSITION CONSTRAINTS/)
 assert.match(prompts[0],/NO horizontal cropping/)
 assert.equal(result.resolvedAsset.url,bad.url);assert.equal(result.source,'ai_generated')
})

test('crop output never triggers a second generation or stock fallback',async()=>{
 const bad=await alphaFramingFixture(true);let generations=0
 const e=engine(async()=>({ok:true,json:async()=>({results:[photo('safe-stock')]})}),async()=>{generations++;return bad})
 const result=await e.resolveSlot({}, {...slot,slot_id:'a',needs_visual:true,preferred_source:'ai_generated',treatment:'isolated_subject'},null,'stock-key',null,new Set())
 assert.equal(generations,1);assert.equal(result.source,'ai_generated')
 assert.equal(result.warning,null)
 assert.equal(result.resolvedAsset.url,bad.url)
})

test('brand library match bypasses generation, while a different activity generates once',async()=>{
 const request={...slot,needs_visual:true,slot_id:'a',preferred_source:'ai_generated',treatment:'isolated_subject',image_style:'photograph',subject_description:'warehouse operator scanning parcel barcode with handheld scanner'}
 const saved={id:'saved',brand_id:'brand-a',status:'ready',source:'ai_generated',url:'/api/uploads/saved',width:100,height:100,subject_description:request.subject_description,treatment:request.treatment,image_style:'photograph'}
 let calls=0
 const db={collection:()=>({find:query=>({toArray:async()=>query.brand_id==='brand-a'?[saved]:[]}),updateOne:async()=>{}})}
 const e=engine(async()=>{throw Error('No stock')},async()=>{calls++;return {url:'new-image'}})
 const reused=await e.resolveSlot(db,request,'brand-a',null,null,new Set())
 assert.equal(calls,0);assert.equal(reused.resolvedAsset.url,saved.url);assert.equal(reused.resolvedAsset.reused,true)
 const fresh=await e.resolveSlot(db,{...request,subject_description:'customer paying at a contactless payment terminal'},'brand-a',null,null,new Set())
 assert.equal(calls,1);assert.equal(fresh.resolvedAsset.url,'new-image')
})

test('object-only scene overrides brand requests for people without generating images',()=>{
 const brief=engine(async()=>{throw Error('No generation expected')}).buildGenerationBrief({...slot,treatment:'isolated_subject',subject_description:'Object-only: a hammer and rolled blueprint, no people',generation_prompt:'Brand usually shows a worker at a desk'},true)
 assert.match(brief,/MANDATORY OBJECT-ONLY COMPOSITION/)
 assert.match(brief,/Zero people, faces, hands, workers/)
 assert.match(brief,/neither|both left and right/i)
 assert.ok(!brief.includes('Use a compact freestanding desk'))
})

test('stock-first background plans consult the brand gallery before network', async () => {
 const e=engine(async()=>{throw Error('Stock should not run')})
 const db={collection:()=>({find:()=>({limit:()=>({toArray:async()=>[
  {id:'wrong',url:'wrong',tags:['garden'],description:'office',description_tags:['office']},
  {id:'right',url:'right',description:'Jardim',description_tags:['garden'],status:'processing'}
 ]})})})}
 const result=await e.resolveSlot(db,{...slot,needs_visual:true,treatment:'environmental',preferred_source:'unsplash'},'brand','key',null,new Set())
 assert.equal(result.source,'uploaded_asset');assert.equal(result.resolvedAsset.asset_id,'right')
})

test('missing planned background falls back to stock and rejects unrelated gallery tags', async () => {
 const e=engine(async()=>({ok:true,json:async()=>({results:[photo('fallback')]})}))
 const db={collection:()=>({findOne:async()=>null,find:()=>({limit:()=>({toArray:async()=>[{id:'wrong',url:'wrong',tags:['office']}]})})})}
 const result=await e.resolveSlot(db,{...slot,needs_visual:true,treatment:'environmental',preferred_source:'uploaded_asset',selected:{asset_id:'deleted'}},'brand','key',null,new Set())
 assert.equal(result.source,'unsplash');assert.equal(result.resolvedAsset.unsplash_id,'fallback')
})

test('stock rejects low resolution and unrelated results, preserving raw URL tracking',async()=>{
 const e=engine(async()=>({ok:true,json:async()=>({results:[
  {...photo('small'),width:640,height:480,alt_description:'garden'},
  {...photo('wrong'),width:3000,height:2000,alt_description:'office computer'},
  {...photo('sharp'),width:3000,height:2000,alt_description:'garden soil',urls:{raw:'https://images.unsplash.com/photo?ixid=tracking',regular:'preview'}}
 ]})}))
 const result=await e.searchUnsplash(slot,'key',new Set())
 assert.equal(result.unsplash_id,'sharp')
 const url=new URL(result.url)
 assert.equal(url.searchParams.get('ixid'),'tracking');assert.equal(url.searchParams.get('w'),'2400');assert.equal(url.searchParams.get('q'),'90')
})


test('watermarked stock photos are skipped',async()=>{
 const e=engine(async()=>({ok:true,json:async()=>({results:[{...photo('marked'),alt_description:'garden with watermark'},photo('clean')]})}))
 assert.equal((await e.searchUnsplash(slot,'key',new Set())).unsplash_id,'clean')
})

test('watermarked planned gallery photos are rejected before stock fallback',async()=>{
 const e=engine(async()=>({ok:true,json:async()=>({results:[photo('clean')]})}))
 const marked={id:'marked',url:'marked',status:'ready',tags:['garden'],watermarked:true}
 const db={collection:()=>({findOne:async()=>marked,find:()=>({limit:()=>({toArray:async()=>[marked]})})})}
 const result=await e.resolveSlot(db,{...slot,needs_visual:true,treatment:'environmental',preferred_source:'uploaded_asset',selected:{asset_id:'marked'}},'brand','key',null,new Set())
 assert.equal(result.resolvedAsset.unsplash_id,'clean')
})

const pexelsPhoto=(id,alt='garden soil')=>({id,alt,width:3000,height:2000,url:'https://www.pexels.com/photo/'+id,photographer:'Example Photographer',src:{original:'https://images.pexels.com/photos/'+id+'/image.jpeg',medium:'https://images.pexels.com/photos/'+id+'/thumb.jpeg'}})

test('stock compares both providers and chooses the stronger content match',async()=>{
 const requests=[]
 const e=engine(async(url,options)=>{
  requests.push({url,options})
  return {ok:true,json:async()=>url.includes('pexels')?{photos:[pexelsPhoto(1)]}:{results:[{...photo('u'),width:4000,height:3000,alt_description:'garden'}]}}
 })
 const result=await e.searchStock({...slot,search_keywords:['garden','soil']},'unsplash-key','pexels-key',new Set())
 assert.equal(requests.length,2);assert.equal(result.source,'pexels');assert.equal(result.pexels_id,'1')
 assert.equal(requests.find(r=>r.url.includes('pexels')).options.headers.Authorization,'pexels-key')
 assert.equal(result.photographer,'Example Photographer');assert.match(result.photo_page,/pexels/)
})

test('stock survives one provider failing and supports Pexels alone',async()=>{
 const e=engine(async url=>url.includes('unsplash')?{ok:false,status:429}:{ok:true,json:async()=>({photos:[pexelsPhoto(2)]})})
 assert.equal((await e.searchStock(slot,'key','key',new Set())).source,'pexels')
 const result=await e.resolveSlot(null,{...slot,needs_visual:true,treatment:'environmental',preferred_source:'unsplash'},null,null,null,new Set())
 assert.match(result.warning,/configure/)
 const pexelsOnly=engine(async()=>({ok:true,json:async()=>({photos:[pexelsPhoto(3)]})}),null,{PEXELS_API_KEY:'key'})
 assert.equal((await pexelsOnly.resolveSlot(null,{...slot,needs_visual:true,treatment:'environmental',preferred_source:'unsplash'},null,null,null,new Set())).source,'pexels')
})

test('Pexels excludes watermarked, undersized, unrelated and recently used photos',async()=>{
 const e=engine(async()=>({ok:true,json:async()=>({photos:[
  pexelsPhoto(1,'garden with watermark'),{...pexelsPhoto(2),width:640,height:480},pexelsPhoto(3,'office computer'),pexelsPhoto(4),pexelsPhoto(5)
 ]})}))
 assert.equal((await e.searchStock(slot,null,'key',new Set(['pexels:4']))).pexels_id,'5')
})

test('concurrent combined searches reserve distinct winners, not losing candidates',async()=>{
 const e=engine(async url=>({ok:true,json:async()=>url.includes('pexels')?{photos:[pexelsPhoto(1),pexelsPhoto(2)]}:{results:[{...photo('u'),alt_description:'garden'}]}}))
 const used=new Set()
 const results=await Promise.all([e.searchStock({...slot,search_keywords:['garden','soil']},'key','key',used),e.searchStock({...slot,search_keywords:['garden','soil']},'key','key',used)])
 assert.equal(new Set(results.map(r=>r.pexels_id)).size,2)
 assert.equal(used.has('unsplash:u'),false)
})

test('a photo slot with no fitting stock photo may use one transparent AI cutout, shaped to its area',async()=>{
 const calls=[]
 const e=engine(async()=>({ok:true,json:async()=>({results:[]})}),async(...args)=>{calls.push(args);return {source:'ai_generated',url:'data:image/png;base64,cut',width:1024,height:1536}})
 const result=await e.resolveSlot(null,{...slot,slot_id:'a',needs_visual:true,preferred_source:'unsplash',treatment:'environmental',cutout_fallback:true,frame_aspect:.5,subject_description:'hand holding a smartphone'},null,'key',null,new Set())
 assert.equal(calls.length,1);assert.equal(calls[0][1],.5)
 assert.match(calls[0][0],/alpha transparency/,'the generation brief asks for a transparent background')
 assert.equal(result.source,'ai_generated');assert.equal(result.treatment,'isolated_subject')
 assert.match(result.warning,/No relevant unused high-resolution stock photo found; used a transparent cutout instead/)
 const plain=engine(async()=>({ok:true,json:async()=>({results:[]})}),async()=>{throw Error('A photo is never generated')})
 const photo=await plain.resolveSlot(null,{...slot,slot_id:'b',needs_visual:true,preferred_source:'unsplash',treatment:'environmental'},null,'key',null,new Set())
 assert.equal(photo.resolvedAsset,null);assert.equal(photo.treatment,'environmental')
})

test('the gallery cutout chosen by the copy plan is reused without generating, once per post',async()=>{
 const asset={id:'generated-phone',brand_id:'brand-a',status:'ready',source:'ai_generated',url:'/api/uploads/gen',width:1024,height:1024,subject:{url:'/api/uploads/cut',width:500,height:800}}
 const updates=[]
 const db={collection:()=>({findOne:async q=>q.id===asset.id&&q.brand_id==='brand-a'?asset:null,updateOne:async(q,u)=>updates.push([q,u]),find:()=>({toArray:async()=>[]})})}
 let generations=0
 const e=engine(async()=>{throw Error('No stock')},async()=>{generations++;return {source:'ai_generated',url:'data:image/png;base64,new',width:1024,height:1024}})
 const used=new Set(),request={...slot,needs_visual:true,preferred_source:'ai_generated',treatment:'isolated_subject',reuse_asset_id:'generated-phone',subject_description:'hand holding a smartphone'}
 const first=await e.resolveSlot(db,{...request,slot_id:'a'},'brand-a',null,null,used)
 assert.equal(generations,0);assert.equal(first.resolvedAsset.url,asset.url);assert.equal(first.resolvedAsset.subject.url,'/api/uploads/cut');assert.equal(first.resolvedAsset.reused,true)
 assert.equal(updates[0][1].$inc.usage_count,1)
 const second=await e.resolveSlot(db,{...request,slot_id:'b'},'brand-a',null,null,used)
 assert.equal(generations,1,'the same cutout is not placed twice in one post');assert.equal(second.resolvedAsset.url,'data:image/png;base64,new')
})

test('every OpenAI image is a transparent PNG whose canvas follows the target area',async()=>{
 const png=await require('sharp')({create:{width:32,height:32,channels:4,background:'#00000000'}}).png().toBuffer()
 const requests=[]
 const e=engine(async(_url,options)=>{requests.push(JSON.parse(options.body));return new Response(JSON.stringify({data:[{b64_json:png.toString('base64')}]}))},null,{OPENAI_API_KEY:'test-only'})
 for(const aspect of [.45,2,1,undefined])await e.generateImageOpenAI('subject',aspect)
 assert.deepEqual(requests.map(r=>r.size),['1024x1536','1536x1024','1024x1024','1024x1024'])
 assert.ok(requests.every(r=>r.background==='transparent'&&r.output_format==='png'))
})

test('an OpenAI account without credits is reported plainly and not called again for the rest of the post',async()=>{
 let calls=0
 const e=engine(async()=>{calls++;return new Response(JSON.stringify({error:{type:'insufficient_quota',code:'credit_balance_exhausted',message:'You have no credits remaining.'}}),{status:429})},null,{OPENAI_API_KEY:'test-only'})
 await assert.rejects(e.generateImageOpenAI('subject'),/OpenAI has no credits left.*platform\.openai\.com/)
 await assert.rejects(e.generateImageOpenAI('subject'),/no credits left/)
 assert.equal(calls,1,'the second slide does not repeat the failing call')
})

test('when AI generation fails, a stock photo of the same subject is used to be cut out locally instead of leaving the space empty',async()=>{
 const queries=[]
 const e=engine(async url=>{queries.push(new URL(url).searchParams.get('query'));return {ok:true,json:async()=>({results:[{id:'leaf',urls:{regular:'https://images.example/leaf',raw:'https://images.example/leaf'},width:2000,height:2000,alt_description:'green leaf isolated on white'}]})}},async()=>{throw Error('OpenAI has no credits left')},{UNSPLASH_ACCESS_KEY:'key'})
 const result=await e.resolveSlot(null,{...slot,slot_id:'fill',needs_visual:true,preferred_source:'ai_generated',treatment:'isolated_subject',search_queries:['green leaf'],search_keywords:['leaf'],subject_description:'green leaf'},null,'key',null,new Set())
 assert.equal(result.source,'unsplash');assert.equal(result.treatment,'isolated_subject','the photo is cut out afterwards')
 assert.match(queries[0],/green leaf isolated white background/)
 assert.match(result.warning,/no credits left; used a stock photo cut out locally instead/)
})

test('when OpenAI fails, fal then Pollinations draw the subject on a studio backdrop before stock is used',async()=>{
 const png=await require('sharp')({create:{width:64,height:64,channels:3,background:'#dddddd'}}).png().toBuffer()
 const calls=[]
 const fetch=async(url,options={})=>{
  calls.push(String(url).replace(/\?.*/,''))
  if(String(url).startsWith('https://fal.run/'))return new Response(JSON.stringify({detail:'User is locked. Reason: Exhausted balance.'}),{status:403})
  if(String(url).startsWith('https://gen.pollinations.ai/image/')){assert.match(decodeURIComponent(url),/plain uniform light grey seamless studio background/);assert.match(url,/width=768&height=1024/);return new Response(png,{status:200,headers:{'content-type':'image/png'}})}
  throw Error('unexpected '+url)
 }
 const e=engine(fetch,async()=>{throw Error('OpenAI has no credits left')},{FAL_KEY:'fal-test',POLLINATIONS_API_KEY:'poll-test',UNSPLASH_ACCESS_KEY:'stock'})
 const result=await e.resolveSlot(null,{...slot,slot_id:'a',needs_visual:true,preferred_source:'ai_generated',treatment:'isolated_subject',subject_description:'hard hat on a stack of blueprints',frame_aspect:.6},null,'key',null,new Set())
 assert.deepEqual(calls,['https://fal.run/fal-ai/flux/schnell','https://gen.pollinations.ai/image/'+encodeURIComponent('Realistic commercial studio photograph of hard hat on a stack of blueprints. One complete subject, centred and large, filling about three quarters of the frame, fully inside it with a small margin on every side, on a plain uniform light grey seamless studio background, flat and evenly lit to the edges with no vignette or gradient, no shadow on the background, no text, no logos, no watermark, no frame.')])
 assert.equal(result.source,'ai_generated');assert.equal(result.treatment,'isolated_subject','the backdrop is removed afterwards')
 assert.match(result.resolvedAsset.url,/^data:image\/png;base64,/,'kept as an inline image, not an expiring link')
 assert.match(result.warning,/no credits left; fal: HTTP 403 \(no balance left\); generated with Pollinations instead/)
})
