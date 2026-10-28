import Groq from 'groq-sdk'
import { ownPostsVoice } from '@/lib/services/brandPosts'
/** Shared queue with independent credential cooldowns and immediate quota failover. */
const stateKey=Symbol.for('kand.groq.key-pool.v1')
const root=globalThis as any
const state=root[stateKey]||(root[stateKey]={tail:Promise.resolve(),cooldowns:new Map(),clients:new Map(),anonymous:new WeakMap(),active:null})
export function groqKeys() {
 return [...new Set([process.env.GROQ_API_KEY,process.env.GROQ_API_KEY_2].map(k=>k?.trim()).filter(Boolean))]
}
export function retrySeconds(error:any) {
 const header=Number(error.headers?.get?.('retry-after')||error.headers?.['retry-after'])
 const message=error.error?.error?.message||error.message||''
 const duration=message.match(/try again in\s+((?:[\d.]+[hms])+)/i)?.[1]||''
 const seconds=[...duration.matchAll(/([\d.]+)([hms])/g)].reduce((n,m)=>n+Number(m[1])*({h:3600,m:60,s:1}[m[2]]||1),0)
 return Math.max(1,Math.ceil(header||seconds||60))
}
/** A request above the per-minute input cap is rejected outright; waiting never helps, so say what to change. */
export function tooLarge(error:any,model?:string) {
 const message=error.error?.error?.message||error.message||''
 const match=message.match(/Limit\s+(\d+),\s*Requested\s+(\d+)/i)
 const limitTokens=match?Number(match[1]):undefined,requestedTokens=match?Number(match[2]):undefined
 const detail=match?` (this request needed about ${requestedTokens} input tokens; the limit is ${limitTokens} per minute)`:''
 return Object.assign(new Error(`The request is larger than your Groq plan allows for ${model||'this model'}${detail}. Use fewer or smaller inputs, choose a model with a higher limit, or upgrade the Groq plan.`),{status:413,limitTokens,requestedTokens,cause:error})
}
// A cooldown of a few seconds (Groq's per-minute token limit, which the free tier reaches with one or two calls) is
// waited out once instead of failing the post, story or ad; a longer one (a daily quota) still fails at once.
const SHORT_WAIT=20
export async function budgetedCompletion(groq:any,request:any,backups?:any[],operation='completion',patient=true):Promise<any> {
 const run=async()=>{
  const keys=groqKeys()
  const clients=[groq,...(backups||keys.filter(key=>key!==groq.apiKey).map(key=>{
   if(!state.clients.has(key))state.clients.set(key,new Groq({apiKey:key,maxRetries:0}))
   return state.clients.get(key)
  }))]
  const identify=(client:any)=>{
   if(client.apiKey)return client.apiKey
   if(!state.anonymous.has(client))state.anonymous.set(client,Symbol())
   return state.anonymous.get(client)
  }
  const unique=clients.filter((c,i)=>clients.findIndex(d=>identify(c)===identify(d))===i)
  if(state.active)unique.sort((a,b)=>Number(identify(b)===state.active)-Number(identify(a)===state.active))
  let authError:any
  for(const client of unique) {
   const id=identify(client)
   if((state.cooldowns.get(id)||0)>Date.now())continue
   try {const response=operation==='models'?await client.models.list():await client.chat.completions.create(request);state.active=id;return response}
   catch(error:any){
    if(error.status===429){state.cooldowns.set(id,Date.now()+retrySeconds(error)*1000);continue}
    if(error.status===401){authError=error;state.cooldowns.set(id,Date.now()+60000);continue}
    if(error.status===413)throw tooLarge(error,request?.model)
    throw error
   }
  }
  if(authError)throw authError
  const wait=Math.max(1,Math.ceil((Math.min(...unique.map(c=>state.cooldowns.get(identify(c))||Date.now()))-Date.now())/1000))
  throw Object.assign(new Error('All configured AI keys are cooling down. Retry in '+wait+' seconds.'),{status:429,headers:{'retry-after':String(wait)}})
 }
 const work=state.tail.then(run,run);state.tail=work.catch(()=>{})
 if(!patient||operation==='models')return work
 return work.catch(async(error:any)=>{
  const wait=Number(error?.headers?.['retry-after'])
  if(error?.status!==429||!(wait>0&&wait<=SHORT_WAIT))throw error
  await new Promise(resolve=>setTimeout(resolve,wait*1000+250))
  return budgetedCompletion(groq,request,backups,operation,false)
 })
}
// The model catalog rarely changes; listing it per request spent rate-limited calls on every generation.
const MODEL_CACHE_MS=10*60*1000
export function budgetedModels(groq:any) {
 const cached=state.models
 if(cached&&cached.expires>Date.now())return cached.value
 const value=budgetedCompletion(groq,null,undefined,'models')
 state.models={value,expires:Date.now()+MODEL_CACHE_MS}
 value.catch(()=>{if(state.models?.value===value)state.models=null})
 return value
}
/**
 * The brand profile as prompts send it, each field cut to a length. With `budget` (characters of JSON), for a request
 * that must fit a smaller AI plan (see writeCopy), the research pages are left out and every other field but the name is
 * shortened by the same share until the whole fits.
 */
export function compactBrand(brand:any,budget?:number) {
 const out:any={}
 const limits:Record<string,number>={about:6500,description:1200,services:3500,projects:5000,targetAudience:1800,tone:1000,suggestedCtas:1500,differentiators:1800,contentTopics:2000}
 for(const key of ['name','about','description','industry','services','products','projects','audience','targetAudience','values','tone','language','languageVariant','profileLanguage','positioning','differentiators','suggestedCtas','contentTopics']) {
  const value=brand?.[key]
  if(value!=null)out[key]=(typeof value==='string'?value:JSON.stringify(value)).slice(0,limits[key]||450)
 }
 // How the brand writes in its own posts, while its switch on the Brand profile is on (see EXTRACTED_CONTEXT_RULES).
 const voice=ownPostsVoice(brand)
 if(voice)out.voiceFromOwnPosts=voice
 if(Array.isArray(brand?.researchSources)&&!budget)out.researchSources=brand.researchSources.slice(0,5).map((page:any)=>({url:String(page.url||'').slice(0,500),title:String(page.title||'').slice(0,200)}))
 const size=JSON.stringify(out).length
 if(budget&&size>budget){
  // The keys and quotes stay, so only the text shrinks: by the share of it that fits in what they leave.
  const keys=Object.keys(out).filter(key=>key!=='name'&&typeof out[key]==='string')
  const text=keys.reduce((n,key)=>n+out[key].length,0)
  const share=Math.max(0,budget-(size-text))/text
  for(const key of keys)out[key]=out[key].slice(0,Math.floor(out[key].length*share))
 }
 return out
}
