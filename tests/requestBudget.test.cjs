const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{stripTypeScriptTypes}=require('node:module')
// compactBrand adds the voice learned from the brand's own posts (lib/services/brandPosts.ts).
const source=['lib/services/brandPosts.ts','lib/services/ai/requestBudget.ts'].map(file=>stripTypeScriptTypes(fs.readFileSync(file,'utf8').replace(/^import .*$/gm,'').replace(/export /g,''))).join(';\n')
const create=()=>new Function('globalThis','process',source+';return {retrySeconds,budgetedCompletion,compactBrand}')({},{env:{}})
test('daily quota message uses the provider wait, not a fixed 15 seconds',()=>{
 const e=create();assert.equal(e.retrySeconds({message:'Please try again in 5m24.864s.'}),325)
 assert.equal(e.retrySeconds({headers:{'retry-after':'420'}}),420)
 assert.equal(e.compactBrand({name:'Brand',designs:[{huge:'x'.repeat(10000)}],logoVariants:{}}).designs,undefined)
})
test('simultaneous requests are serialized and a quota failure suppresses subsequent API calls',async()=>{
 const e=create();let active=0,peak=0,calls=0
 const groq={chat:{completions:{create:async()=>{calls++;active++;peak=Math.max(peak,active);await Promise.resolve();active--;return 'ok'}}}}
 await Promise.all([e.budgetedCompletion(groq,{}),e.budgetedCompletion(groq,{})]);assert.equal(peak,1)
 groq.chat.completions.create=async()=>{calls++;throw {status:429,message:'Please try again in 5m24.864s.'}}
 await assert.rejects(e.budgetedCompletion(groq,{}))
 await assert.rejects(e.budgetedCompletion(groq,{}),err=>err.status===429)
 assert.equal(calls,3)
})
test('429 switches immediately to backup and subsequent requests stay on the available key',async()=>{
 const e=create(),calls=[]
 const primary={apiKey:'primary',chat:{completions:{create:async()=>{calls.push('primary');throw {status:429,message:'Please try again in 5m.'}}}}}
 const backup={apiKey:'backup',chat:{completions:{create:async()=>{calls.push('backup');return {ok:true}}}}}
 assert.deepEqual(await e.budgetedCompletion(primary,{},[backup]),{ok:true})
 await e.budgetedCompletion(primary,{},[backup])
 assert.deepEqual(calls,['primary','backup','backup'])
})
test('both keys exhausted return earliest retry without exposing credentials or retrying them',async()=>{
 const e=create();let calls=0
 const client=(apiKey,seconds)=>({apiKey,chat:{completions:{create:async()=>{calls++;throw {status:429,headers:{'retry-after':String(seconds)}}}}}})
 const a=client('private-a',300),b=client('private-b',120)
 await assert.rejects(e.budgetedCompletion(a,{},[b]),err=>err.status===429&&Number(err.headers['retry-after'])===120&&!err.message.includes('private'))
 await assert.rejects(e.budgetedCompletion(a,{},[b]))
 assert.equal(calls,2)
})
test('a cooldown of a few seconds is waited out once, so a post is not lost to the per-minute limit',async()=>{
 const e=create();let calls=0
 const groq={apiKey:'only',chat:{completions:{create:async()=>{calls++;if(calls===1)throw {status:429,headers:{'retry-after':'1'}};return {ok:true}}}}}
 const started=Date.now()
 assert.deepEqual(await e.budgetedCompletion(groq,{},[]),{ok:true})
 assert.equal(calls,2)
 assert.ok(Date.now()-started>=1000,'it waited for the cooldown')
})
test('malformed requests do not rotate credentials',async()=>{
 const e=create();let backupCalls=0
 const a={chat:{completions:{create:async()=>{throw {status:400}}}}}
 const b={chat:{completions:{create:async()=>{backupCalls++}}}}
 await assert.rejects(e.budgetedCompletion(a,{},[b]),err=>err.status===400)
 assert.equal(backupCalls,0)
})
test('a brand profile with a budget drops the research pages and shortens every field but the name to fit',()=>{
 const e=create()
 const brand={name:'Swonkie',about:'a'.repeat(2400),services:'s'.repeat(1100),projects:'p'.repeat(1000),researchSources:[{url:'https://swonkie.com',title:'Home'}]}
 const full=e.compactBrand(brand)
 assert.equal(full.researchSources.length,1)
 const fitted=e.compactBrand(brand,1500)
 assert.equal(fitted.researchSources,undefined)
 assert.equal(fitted.name,'Swonkie')
 assert.ok(JSON.stringify(fitted).length<=1500,`fits in 1,500 characters (${JSON.stringify(fitted).length})`)
 assert.ok(fitted.about.length>fitted.projects.length,'each field keeps its share')
 assert.deepEqual(e.compactBrand({name:'Small',about:'short'},1500),{name:'Small',about:'short'},'a profile already within the budget is unchanged')
})
