const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const {stripTypeScriptTypes}=require('node:module')
const {Binary,BSON}=require('mongodb')
const source=fs.readFileSync('lib/services/persistInlineImages.ts','utf8').replace(/^import .*$/gm,'').replace(/export /g,'')
const persist=new Function('createHash','Binary','compactImage',stripTypeScriptTypes(source)+';return persistInlineImages')(require('node:crypto').createHash,Binary,require('./uploadTestHelpers.cjs').keepImage)
test('large duplicated generated images become small persistent references',async()=>{
 const writes=[]
 const db={collection:name=>{assert.equal(name,'uploads');return {findOne:async()=>null,updateOne:async(...args)=>writes.push(args)}}}
 const url='data:image/png;base64,'+Buffer.alloc(3*1024*1024,1).toString('base64')
 const input={posts:Array.from({length:6},()=>({asset:{url,thumbnail_url:url},nodes:[{src:url}]})),updatedAt:new Date()}
 assert.ok(BSON.calculateObjectSize(input)>16*1024*1024)
 const result=await persist(db,input)
 assert.equal(writes.length,1)
 assert.ok(BSON.calculateObjectSize(result)<10000)
 assert.match(result.posts[0].asset.url,/^\/api\/uploads\/image-/)
 assert.equal(result.posts[0].nodes[0].src,result.posts[0].asset.url)
 assert.equal(input.posts[0].asset.url,url)
 assert.equal(result.updatedAt,input.updatedAt)
 assert.equal(writes[0][1].$setOnInsert.bytes.value().length,3*1024*1024)
})
test('upload failure propagates rather than saving unusable references',async()=>{
 await assert.rejects(persist({collection:()=>({findOne:async()=>null,updateOne:async()=>{throw Error('storage unavailable')}})},{url:'data:image/png;base64,AQID'}),/storage unavailable/)
})
