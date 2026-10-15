const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const body=fs.readFileSync('lib/client/postGeneration.js','utf8').replace(/^import .*$/gm,'').replace(/^export /gm,'')
const {apiError}=new Function('process',fs.readFileSync('lib/client/billing.js','utf8').replace(/^export /gm,'')+';return {apiError}')({env:{}})
// The page's window: the credits meter listens for 'bk:credits-changed'.
function page(){const events=[];return {events,window:{dispatchEvent:e=>events.push(e.type)},CustomEvent:class{constructor(type){this.type=type}}}}
const load=(fetch,browser=page())=>new Function('fetch','apiError','window','CustomEvent',body+';return runPostGeneration')(fetch,apiError,browser.window,browser.CustomEvent)
function setup({needsVisuals=false,fail,failure={error:'boom'},status=500}={}) {
 const requests=[], stages=[], results={}, browser=page()
 const fetch=async(url,init)=>{
  const payload=JSON.parse(init.body);requests.push([url,payload])
  const ok=url!==fail
  const data=!ok?failure:url==='/api/plan-post'?{copy:payload.copy||{headline:'Fresh'},needsVisuals,chargeRef:'post_ref',credits:{charged:1,left:29},plan:{designId:'global-x',layoutPlan:{source:'global'},slots:[{slot_id:'single_main',slot_label:'Main',needs_visual:needsVisuals}]}}:url==='/api/resolve-assets'?{slots:[{slot_id:'single_main',resolvedAsset:{url:'/photo'}}]}:{id:'canvas-1'}
  return {ok,status:ok?200:status,json:async()=>data}
 }
 const run=load(fetch,browser)
 const record=key=>v=>{results[key]=v}
 const go=(extra={})=>run({idea:{topic:'T'},brandContext:{id:'b',name:'B'},brandId:'brand_b',keepCopy:null,onStage:s=>stages.push(s),onCopy:record('copy'),onPlan:record('plan'),onResolve:record('resolve'),onDesign:record('design'),...extra})
 return {go,requests,stages,results,events:browser.events}
}
test('a design without imagery goes PLAN → BUILD with no asset request',async()=>{
 const s=setup();await s.go()
 assert.deepEqual(s.requests.map(r=>r[0]),['/api/plan-post','/api/design-canvas'])
 assert.deepEqual(s.stages,['content','build'])
 assert.equal(s.results.resolve.skipped,true)
 assert.equal(s.requests[1][1].copy.headline,'Fresh')
})
test('a design with imagery prepares visuals between plan and build',async()=>{
 const s=setup({needsVisuals:true});await s.go()
 assert.deepEqual(s.requests.map(r=>r[0]),['/api/plan-post','/api/resolve-assets','/api/design-canvas'])
 assert.deepEqual(s.stages,['content','visuals','build'])
 assert.equal(s.requests[2][1].resolvedPlan.slots[0].resolvedAsset.url,'/photo')
})
test('failure stops downstream work and reports the stage error',async()=>{
 const s=setup({needsVisuals:true,fail:'/api/plan-post'})
 await assert.rejects(s.go(),/boom/)
 assert.deepEqual(s.requests.map(r=>r[0]),['/api/plan-post'])
 assert.equal(s.results.plan.error,'boom')
})
test('rebuilding with kept copy sends the copy so the server plans without writing again',async()=>{
 const s=setup();await s.go({keepCopy:{headline:'Kept'}})
 assert.deepEqual(s.requests[0][1].copy,{headline:'Kept'})
 assert.equal(s.requests[1][1].copy.headline,'Kept')
})
test('an empty image account is an operator notice, never a warning to people using Batkle',async()=>{
 const warnings=[],notices=[]
 const fetch=async(url,init)=>{
  const payload=JSON.parse(init.body)
  const data=url==='/api/plan-post'?{copy:{headline:'H'},needsVisuals:true,plan:{designId:'d',layoutPlan:{},slots:[{slot_id:'s',needs_visual:true}]}}:url==='/api/resolve-assets'?{slots:[{slot_id:'s',warning:'OpenAI: no credits left'}]}:{id:'c',payload}
  return {ok:true,json:async()=>data}
 }
 const run=load(fetch)
 const noop=()=>{}
 await run({idea:{topic:'T'},brandContext:{id:'b'},brandId:'brand_b',keepCopy:null,onStage:noop,onCopy:noop,onPlan:noop,onResolve:noop,onDesign:noop,onWarning:m=>warnings.push(m),onOperatorNotice:m=>notices.push(m)})
 assert.equal(warnings.length,0,'the post was made with fallback images, so people are not told')
 assert.equal(notices.length,1)
 assert.match(notices[0],/no credits left/)
})
test('the charge reference from PLAN goes to VISUALS and BUILD, and the credits meter hears about it',async()=>{
 const s=setup({needsVisuals:true});await s.go()
 assert.equal(s.requests[1][1].chargeRef,'post_ref')
 assert.equal(s.requests[2][1].chargeRef,'post_ref')
 assert.deepEqual(s.events,['bk:credits-changed','bk:credits-changed'],'once when charged, once when the post is built')
})
test('a plan limit keeps its code and details, stops the build and refreshes the meter',async()=>{
 const failure={error:'You have used all your credits for this month.',code:'insufficient_credits',needed:1,available:0,plan:'free'}
 const s=setup({fail:'/api/plan-post',failure,status:402})
 const error=await s.go().catch(e=>e)
 assert.equal(error.message,failure.error);assert.equal(error.code,'insufficient_credits');assert.equal(error.status,402);assert.equal(error.billing.needed,1)
 assert.deepEqual(s.requests.map(r=>r[0]),['/api/plan-post'])
 assert.deepEqual(s.events,['bk:credits-changed'])
 const other=setup({fail:'/api/plan-post'});const plain=await other.go().catch(e=>e)
 assert.equal(plain.code,undefined,'other failures carry no billing code');assert.deepEqual(other.events,[])
})
test('a failed stage after PLAN refreshes the meter, since the server gives the credits back',async()=>{
 for(const stage of ['/api/resolve-assets','/api/design-canvas']){
  const s=setup({needsVisuals:true,fail:stage})
  await assert.rejects(s.go(),/boom/)
  assert.deepEqual(s.events,['bk:credits-changed','bk:credits-changed'],stage)
 }
})
