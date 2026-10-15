const {test} = require('node:test')
const assert = require('node:assert/strict')
const {stripTypeScriptTypes} = require('node:module')
const source = stripTypeScriptTypes(require('node:fs').readFileSync('lib/handlers/copywritingHandler.ts','utf8').replace(/^import .*$/gm,'').replace(/export /g,''))
const valid = {format:'single',headline:'Supported headline',caption:'Supported caption'}
const strategyLoad = p => stripTypeScriptTypes(require('node:fs').readFileSync(p,'utf8').replace(/^import .*$/gm,'').replace(/export /g,''))
const strategy = new Function(strategyLoad('lib/services/contentLanguage.ts') + strategyLoad('lib/services/copyFacts.ts') + strategyLoad('lib/services/contentAngles.ts') + ';return {postLanguage,contentLanguage,languageIssues,copyTexts,withModernSpelling,inventedFigures,mentionsSubject}')()
function setup(outputs, catalog = ['canopylabs/orpheus-v1-english','llama-3.3-70b-versatile'], idea = {format:'single'}) {
 const requests=[]
 const run = new Function('Groq','process','loadGenerationBrandContext','EXTRACTED_CONTEXT_RULES','compactBrand','budgetedModels','budgetedCompletion','NextResponse','corsify','cleanCopy','retrySeconds',...Object.keys(strategy),source+';return handleGenerateCopywriting')(
  class {}, {env:{GROQ_API_KEY:'test'}},async()=>({name:'Brand'}),'',x=>x,async()=>({data:catalog.map(id=>({id}))}),async(_,request)=>{requests.push(request);const output=outputs.shift();if(output instanceof Error)throw output;return {choices:[{message:{content:typeof output==='string'?output:JSON.stringify(output)},finish_reason:'stop'}]}}, {json:(body,options)=>({body,status:options?.status||200})},x=>x,x=>x,()=>60,...Object.values(strategy))
 return {requests,run:()=>run({idea},{})}
}
test('requests JSON mode with a chat model, excluding speech models',async()=>{
 const {run,requests}=setup([valid]);assert.equal((await run()).status,200);assert.equal(requests[0].model,'llama-3.3-70b-versatile');assert.deepEqual(requests[0].response_format,{type:'json_object'})
})
test('regenerates malformed JSON once using the original brief',async()=>{
 const {run,requests}=setup(['{ headline: "Example", slides: [], Please return valid JSON',valid]);assert.equal((await run()).status,200);assert.equal(requests.length,2);assert.equal(requests[1].max_tokens,4800);assert.match(requests[1].messages[1].content,/CONTENT BRIEF/)
})
test('regenerates a wordy carousel cover as a short hook and teaser',async()=>{
 const wordy={format:'carousel',slides:[{headline:'A civil construction company can and really should also win the digital game this year, and here is exactly why',body:'Explanation on the cover',cta:''},{headline:'Start here',body:'Details',cta:''}],caption:'Caption'}
 const concise={format:'carousel',slides:[{headline:'Build beyond the jobsite',body:'See what is holding your growth back.',cta:''},{headline:'Start here',body:'Details',cta:''}],caption:'Caption'}
 const {run,requests}=setup([wordy,concise],undefined,{format:'carousel'})
 const result=await run();assert.equal(result.status,200);assert.equal(requests.length,2)
 assert.equal(result.body.slides[0].headline,'Build beyond the jobsite');assert.equal(result.body.slides[0].body,'See what is holding your growth back.')
 assert.match(requests[1].messages[1].content,/maximum is 14/)
})
test('rejects invalid output after a bounded retry without returning raw model text',async()=>{
 const {run,requests}=setup(['invalid','null']);const result=await run();assert.equal(result.status,502);assert.equal(requests.length,2);assert.equal(result.body.raw,undefined)
 assert.match(result.body.error,/\(Expected a copywriting object\)/,'the reason is reported')
})
const wordyCover={format:'carousel',slides:[{headline:'A civil construction company can and really should also win the digital game this year, and here is exactly why',body:'See why',cta:''},{headline:'Start here',body:'Details',cta:''}],caption:'Caption'}
test('keeps the complete first draft when the corrective retry is rate limited',async()=>{
 const {run,requests}=setup([wordyCover,Object.assign(new Error('quota'),{status:429})],undefined,{format:'carousel'})
 const result=await run();assert.equal(result.status,200);assert.equal(requests.length,2);assert.equal(result.body.slides[0].headline,wordyCover.slides[0].headline)
})
test('keeps the complete first draft when the corrective retry is malformed',async()=>{
 const {run,requests}=setup([wordyCover,'invalid'],undefined,{format:'carousel'})
 const result=await run();assert.equal(result.status,200);assert.equal(requests.length,2);assert.equal(result.body.slides[0].headline,wordyCover.slides[0].headline)
})
test('clears a carousel cover CTA without spending a retry',async()=>{
 const withCta={format:'carousel',slides:[{headline:'Build beyond the jobsite',body:'See what holds growth back.',cta:'Swipe'},{headline:'Start here',body:'Details',cta:''}],caption:'Caption'}
 const {run,requests}=setup([withCta],undefined,{format:'carousel'})
 const result=await run();assert.equal(result.status,200);assert.equal(requests.length,1);assert.equal(result.body.slides[0].cta,'')
})
test('retries provider JSON validation failures',async()=>{
 const error=Object.assign(new Error('invalid JSON'),{status:400,code:'json_validate_failed'});const {run,requests}=setup([error,valid]);assert.equal((await run()).status,200);assert.equal(requests.length,2)
})
test('preserves quota errors without an extra generation attempt',async()=>{
 const {run,requests}=setup([Object.assign(new Error('quota'),{status:429})]);assert.equal((await run()).status,429);assert.equal(requests.length,1)
})
test('never falls back to an arbitrary speech model',async()=>{
 const {run,requests}=setup([],['canopylabs/orpheus-v1-english']);assert.equal((await run()).status,500);assert.equal(requests.length,0)
})
const invented={format:'single',headline:'Barber PH: 2 → 15 leads por mês',supportingText:'ROI 3,5× com segmentação',caption:'Caption'}
const honest={format:'single',headline:'Barber PH: marcações sem chamadas',supportingText:'Um site com plataforma de reservas',caption:'Caption'}
test('copy that invents result figures is rewritten, naming the figures in the retry',async()=>{
 const {run,requests}=setup([invented,honest]);const result=await run()
 assert.equal(result.status,200);assert.equal(result.body.headline,honest.headline)
 assert.match(requests[1].messages[1].content,/Facts: .*15 leads.*ROI 3,5/)
})
test('invented figures are never published, even when the rewrite still has them',async()=>{
 const {run}=setup([invented,invented]);const result=await run()
 assert.equal(result.status,502);assert.match(result.body.error,/figures that are not in the brand profile/)
})
test('a first draft with invented figures is not a fallback when the rewrite cannot run',async()=>{
 const carousel={format:'carousel',slides:[{headline:'Resultados reais',body:'Veja como 45% mais clientes chegaram',cta:''},{headline:'Mais',body:'Detalhes',cta:''}],caption:'Caption'}
 const again=setup([carousel,Object.assign(new Error('quota'),{status:429})],undefined,{format:'carousel'})
 assert.equal((await again.run()).status,429)
})
test('figures the person typed in their own request may be used',async()=>{
 const {run}=setup([invented],undefined,{format:'single',userRequest:'Fala do Barber PH: passaram de 2 para 15 leads por mês, ROI 3,5'})
 assert.equal((await run()).status,200)
})
const slide=(headline,body='Details')=>({headline,body,cta:''})
test('a language picked for the post replaces the brand language in the copy request',async()=>{
 const spanish={format:'single',headline:'Menos tareas, más tiempo',caption:'Descubra cómo trabajamos.'}
 const {run,requests}=setup([spanish],undefined,{format:'single',languageChoice:{language:'Spanish',languageVariant:'es-ES'}})
 assert.equal((await run()).status,200)
 assert.match(requests[0].messages[0].content,/OUTPUT LANGUAGE: Spanish \(es-ES\)/)
 assert.match(requests[0].messages[1].content,/OUTPUT LANGUAGE: Spanish \(es-ES\)/)
 const brandOnly=setup([valid])
 assert.equal((await brandOnly.run()).status,200)
 assert.match(brandOnly.requests[0].messages[0].content,/OUTPUT LANGUAGE: English — American \(en-US\)/,'without a pick, the brand language stays')
})
test('a carousel follows the brief outline: one slide per entry, retried once when it does not',async()=>{
 const outline=['Cover: the hook','First sign','Second sign','Third sign','What to do next','Takeaway']
 const five={format:'carousel',slides:[slide('3 signs your site loses clients','Swipe to check yours.'),slide('One'),slide('Two'),slide('Three'),slide('Close')],caption:'Caption'}
 const six={...five,slides:[...five.slides.slice(0,4),slide('What to do next'),slide('Close')]}
 const {run,requests}=setup([five,six],undefined,{format:'carousel',outline})
 const result=await run();assert.equal(result.status,200);assert.equal(requests.length,2)
 assert.match(requests[1].messages[1].content,/5 slides but the brief's outline has 6 entries; write exactly one slide per outline entry/)
 assert.equal(result.body.slides.length,6)
 assert.match(requests[0].messages[1].content,/"outline"/,'the outline reaches the copywriter')
})
test('a carousel that matches its outline is accepted at once, and without an outline any length is fine',async()=>{
 const four={format:'carousel',slides:[slide('The mistake that delays renovations','Most owners make it early.'),slide('One'),slide('Two'),slide('Close')],caption:'Caption'}
 const a=setup([four],undefined,{format:'carousel',outline:['a','b','c','d']});assert.equal((await a.run()).status,200);assert.equal(a.requests.length,1)
 const b=setup([four],undefined,{format:'carousel'});assert.equal((await b.run()).status,200);assert.equal(b.requests.length,1)
})
test('the cover is briefed as a hook that makes people swipe, and the slides stay on its subject',async()=>{
 const {run,requests}=setup([valid]);await run()
 const system=requests[0].messages[0].content
 assert.match(system,/THE COVER \(slide 1\) has one job: make the right viewer stop and swipe\./)
 assert.match(system,/THE HEADLINE .* is the hook/)
 // The headline picks its reader at once; the call to action is a few words; the single post's label is not a sentence.
 assert.match(system,/know in one second that the post is for them/)
 assert.match(system,/1–3 words, never more than 4/)
 assert.match(system,/1–3 word label shown small and in capitals above the headline/)
 assert.match(system,/Never a label or topic name/)
 assert.match(system,/Every slide stays on the cover's exact subject/)
 assert.match(system,/deliver exactly that number/)
 assert.match(system,/Never default to five and never pad/)
})

// The graphic is read in a second: a long headline, a sentence where the small label goes, or a long call to action
// gets one corrective retry, and the shorter rewrite is the one kept.
test('a single post with a long headline, a sentence for a label or a long call to action is rewritten once, shorter', async () => {
  const long = { format: 'single', headline: 'Business owners who have already paid to promote a post on Facebook and then sold absolutely nothing at all', subheadline: 'A short sentence that explains the headline', supportingText: 'Likes do not pay the bills.', cta: 'Send us a message to find out how we can help', caption: 'Caption' }
  const tight = { format: 'single', headline: 'Business owners who paid to boost a post and sold nothing', subheadline: 'For you', supportingText: 'Likes do not pay the bills.', cta: 'Talk to us', caption: 'Caption' }
  const { run, requests } = setup([long, tight])
  const result = await run()
  assert.equal(result.status, 200)
  assert.equal(requests.length, 2)
  const feedback = requests[1].messages[1].content
  assert.match(feedback, /headline has 19 words; maximum is 14/)
  assert.match(feedback, /small label above the headline: 1–3 words/)
  assert.match(feedback, /call to action has 11 words; use 1–3/)
  assert.equal(result.body.headline, tight.headline)
  assert.equal(result.body.cta, 'Talk to us')
})

test('a carousel closing call to action of more than four words is rewritten once; an empty cover body is fine', async () => {
  const slides = cta => [
    { slideNumber: 1, purpose: 'hook', headline: 'No time for social media? Makes sense.', body: '', cta: '' },
    { slideNumber: 2, purpose: 'explanation', headline: 'One post a week is enough', body: 'Consistency beats volume.', cta: '' },
    { slideNumber: 3, purpose: 'closing', headline: 'Start with one post', body: '', cta },
  ]
  const wordy = { format: 'carousel', slides: slides('Send us a direct message today so we can help'), caption: 'Caption' }
  const short = { format: 'carousel', slides: slides('Send a DM'), caption: 'Caption' }
  const { run, requests } = setup([wordy, short], undefined, { format: 'carousel' })
  const result = await run()
  assert.equal(requests.length, 2)
  assert.match(requests[1].messages[1].content, /closing slide's call to action has 10 words; use 1–3/)
  assert.doesNotMatch(requests[1].messages[1].content, /cover body/, 'an empty cover body is not a problem')
  assert.equal(result.body.slides.at(-1).cta, 'Send a DM')

  // Short copy with an empty cover body needs no second call.
  const clean = setup([short], undefined, { format: 'carousel' })
  assert.equal((await clean.run()).status, 200)
  assert.equal(clean.requests.length, 1)
})

test('a closing headline that repeats the call to action at its end keeps only the payoff', () => {
  const { withoutTrailingCta } = new Function(source + ';return { withoutTrailingCta }')()
  assert.equal(withoutTrailingCta('Não desperdice dinheiro – fale connosco'), 'Não desperdice dinheiro')
  assert.equal(withoutTrailingCta('Pare de desperdiçar dinheiro, fale connosco.'), 'Pare de desperdiçar dinheiro')
  assert.equal(withoutTrailingCta('Atualize, alinhe e responda – contacte-nos'), 'Atualize, alinhe e responda')
  assert.equal(withoutTrailingCta('Stop guessing — talk to us'), 'Stop guessing')
  // Nothing to cut, or too little would be left: the headline stays as written.
  assert.equal(withoutTrailingCta('Reative o seu Instagram hoje'), 'Reative o seu Instagram hoje')
  assert.equal(withoutTrailingCta('Pronto – fale connosco'), 'Pronto – fale connosco')
  assert.equal(withoutTrailingCta('Fale connosco sobre o seu projeto'), 'Fale connosco sobre o seu projeto')
})
