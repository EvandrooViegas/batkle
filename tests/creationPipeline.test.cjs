const {test}=require('node:test')
const assert=require('node:assert/strict')
const body=require('node:fs').readFileSync('lib/client/postGeneration.js','utf8').replace(/^import .*$/gm,'').replace(/^export /gm,'')
function setup({needsVisuals=false,fail}={}) {
 const requests=[], stages=[], results={}
 const fetch=async(url,init)=>{
  const payload=JSON.parse(init.body);requests.push([url,payload])
  const ok=url!==fail
  const data=!ok?{error:'boom'}:url==='/api/plan-post'?{copy:payload.copy||{headline:'Fresh'},needsVisuals,plan:{designId:'global-x',layoutPlan:{source:'global'},slots:[{slot_id:'single_main',slot_label:'Main',needs_visual:needsVisuals}]}}:url==='/api/resolve-assets'?{slots:[{slot_id:'single_main',resolvedAsset:{url:'/photo'}}]}:{id:'canvas-1'}
  return {ok,json:async()=>data}
 }
 const run=new Function('fetch',body+';return runPostGeneration')(fetch)
 const record=key=>v=>{results[key]=v}
 const go=(extra={})=>run({idea:{topic:'T'},brandContext:{id:'b',name:'B'},brandId:'brand_b',keepCopy:null,onStage:s=>stages.push(s),onCopy:record('copy'),onPlan:record('plan'),onResolve:record('resolve'),onDesign:record('design'),...extra})
 return {go,requests,stages,results}
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
 const run=new Function('fetch',body+';return runPostGeneration')(fetch)
 const noop=()=>{}
 await run({idea:{topic:'T'},brandContext:{id:'b'},brandId:'brand_b',keepCopy:null,onStage:noop,onCopy:noop,onPlan:noop,onResolve:noop,onDesign:noop,onWarning:m=>warnings.push(m),onOperatorNotice:m=>notices.push(m)})
 assert.equal(warnings.length,0,'the post was made with fallback images, so people are not told')
 assert.equal(notices.length,1)
 assert.match(notices[0],/no credits left/)
})
