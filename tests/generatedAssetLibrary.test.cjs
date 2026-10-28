const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{stripTypeScriptTypes}=require('node:module')
const code=stripTypeScriptTypes(fs.readFileSync('lib/services/generatedAssetLibrary.ts','utf8').replace(/^import .*$/gm,'').replace(/export /g,''))
const service=new Function('createHash',code+';return {imageMatchScore,findGeneratedAsset,saveGeneratedAsset,isGalleryCutout}')(require('node:crypto').createHash)
const request={subject_description:'warehouse operator scanning parcel barcode with handheld scanner',treatment:'isolated_subject',image_style:'photograph',search_keywords:['warehouse','barcode','scanner']}
function database(){
 const records=[]
 return {records,collection:()=>({find:query=>({toArray:async()=>records.filter(r=>Object.entries(query).every(([k,v])=>r[k]===v))}),updateOne:async(query,update)=>{let found=records.find(r=>Object.entries(query).every(([k,v])=>r[k]===v));if(!found&&update.$setOnInsert){found={...update.$setOnInsert};records.push(found)}if(found){Object.assign(found,update.$set);for(const [k,v] of Object.entries(update.$inc||{}))found[k]=(found[k]||0)+v}}})}
}
test('generated assets are saved once in their brand with reusable subject and descriptive metadata',async()=>{
 const db=database(),asset={url:'/api/uploads/generated',width:1000,height:1000,subject:{url:'/api/uploads/cutout',width:800,height:900}}
 await service.saveGeneratedAsset(db,'brand-a',request,asset)
 await service.saveGeneratedAsset(db,'brand-a',request,asset)
 assert.equal(db.records.length,1);assert.ok(db.records[0].tags.includes('scanner'));assert.equal(db.records[0].description,request.subject_description)
 assert.equal(db.records[0].source,'ai_generated');assert.equal(db.records[0].subject.url,asset.subject.url)
 const hit=await service.findGeneratedAsset(db,'brand-a',request,new Set())
 assert.equal(hit.url,asset.url);assert.equal(hit.match_score,1);assert.equal(hit.reused,true)
 assert.equal(db.records[0].usage_count,2)
 assert.equal(await service.findGeneratedAsset(db,'brand-b',request,new Set()),null)
})
test('reuse threshold rejects different activities and incompatible styles or treatment',()=>{
 const exact={...request,description:request.subject_description}
 assert.equal(service.imageMatchScore(request,exact),1)
 assert.ok(service.imageMatchScore({...request,subject_description:'warehouse operator closing cardboard parcel with packing tape'},exact)<.85)
 assert.equal(service.imageMatchScore({...request,image_style:'drawing'},exact),0)
 assert.equal(service.imageMatchScore({...request,treatment:'environmental'},exact),0)
 const boundary={...request,subject_description:'one two three four five six seven eight nine ten'}
 assert.ok(service.imageMatchScore(boundary,{...boundary,subject_description:'one two three four five six seven eight nine extra'})>=.85)
 assert.ok(service.imageMatchScore(boundary,{...boundary,subject_description:'one two three four five six seven eight extra other'})<.85)
})
test('same carousel reserves images and reused results are not inserted again',async()=>{
 const db=database();await service.saveGeneratedAsset(db,'brand-a',request,{url:'/api/uploads/image',width:100,height:100,subject:{url:'/api/uploads/image-cut',width:80,height:90}})
 const used=new Set(),results=await Promise.all([service.findGeneratedAsset(db,'brand-a',request,used),service.findGeneratedAsset(db,'brand-a',request,used)])
 assert.equal(results.filter(Boolean).length,1)
 await service.saveGeneratedAsset(db,'brand-a',request,results.find(Boolean));assert.equal(db.records.length,1)
})

test('gallery aliases cannot reuse identical photo or cutout URLs in a carousel',async()=>{
 const db=database(),used=new Set()
 for(const id of ['one','alias'])db.records.push({...request,id,brand_id:'brand-a',status:'ready',source:'ai_generated',url:'/api/uploads/same',subject:{url:'/api/uploads/cutout'}})
 const first=await service.findGeneratedAsset(db,'brand-a',request,used)
 assert.ok(first)
 assert.equal(await service.findGeneratedAsset(db,'brand-a',request,used),null)
 db.records.push({...db.records[0],id:'different-original',url:'/api/uploads/other'})
 assert.equal(await service.findGeneratedAsset(db,'brand-a',request,used),null)
})

test('only good cutouts are kept and reused: the background came off and the subject is not cut at the sides or the top',async()=>{
 const db=database(),edges=(cropEdges)=>({url:'/api/uploads/'+JSON.stringify(cropEdges),width:100,height:100,subject:{url:'/api/uploads/cut-'+JSON.stringify(cropEdges),width:80,height:90,cropEdges}})
 assert.equal(await service.saveGeneratedAsset(db,'brand-a',request,{url:'/api/uploads/no-cutout',width:100,height:100}),false,'isolation failed: the original photo is not a cutout')
 for(const side of ['left','right','top'])assert.equal(await service.saveGeneratedAsset(db,'brand-a',request,edges({[side]:true})),false,side)
 assert.equal(db.records.length,0)
 assert.equal(await service.saveGeneratedAsset(db,'brand-a',request,edges({left:false,right:false,top:false,bottom:true})),true,'a person shown to the waist is fine')
 assert.equal(db.records.length,1)
 // Cutouts saved before the check are never reused when they fall short of it.
 db.records.push({...request,id:'old-bad',brand_id:'brand-b',status:'ready',source:'ai_generated',url:'/api/uploads/old',subject:{url:'/api/uploads/old-cut',cropEdges:{right:true}}})
 db.records.push({...request,id:'old-photo',brand_id:'brand-b',status:'ready',source:'ai_generated',url:'/api/uploads/photo'})
 assert.equal(await service.findGeneratedAsset(db,'brand-b',request,new Set()),null)
 assert.equal(service.isGalleryCutout({source:'website',subject:{url:'/x'}}),false,'only AI cutouts belong in the gallery')
})
