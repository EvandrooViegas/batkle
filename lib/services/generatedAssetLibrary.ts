import { createHash } from 'node:crypto'

const STOP=new Set('a an the of to and or with on in for at by de da do dos das e o os as um uma com para no na ao em que'.split(' '))
export function imageTerms(value:string):string[]{
 return [...new Set(String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]+/g)?.filter(t=>t.length>2&&!STOP.has(t))||[])]
}
/**
 * The brand gallery keeps AI cutouts only, and only good ones: the background came off (a transparent subject) and the
 * subject is whole, not cut by the image's left, right or top edge. A subject cut at the bottom, like a person shown to
 * the waist, is fine. Only these are saved, listed and reused, so a slide never inherits a bad cutout.
 */
export function isGalleryCutout(asset:any):boolean{
 const subject=asset?.subject,edges=subject?.cropEdges||{}
 return asset?.source==='ai_generated'&&typeof subject?.url==='string'&&!!subject.url&&!edges.left&&!edges.right&&!edges.top
}
/** isGalleryCutout as a MongoDB filter, for counting. */
export const GALLERY_CUTOUT_FILTER={source:'ai_generated','subject.url':{$type:'string'},'subject.cropEdges.left':{$ne:true},'subject.cropEdges.right':{$ne:true},'subject.cropEdges.top':{$ne:true}}
export function imageMatchScore(request:any,asset:any):number{
 if(asset.treatment!==request.treatment||asset.image_style!==(request.image_style||'photograph'))return 0
 const wanted=imageTerms(request.subject_description||request.search_queries?.[0]||request.search_keywords?.join(' ')||'')
 const saved=imageTerms(asset.subject_description||asset.description||'')
 if(wanted.length<2||saved.length<2)return 0
 const overlap=wanted.filter(t=>saved.includes(t)).length
 // Symmetric matching prevents a generic shared tag from matching a different activity.
 return 2*overlap/(wanted.length+saved.length)
}
export async function findGeneratedAsset(db:any,brandId:string|null,request:any,used:Set<string>){
 if(!brandId)return null
 const assets=await db.collection('assets').find({brand_id:brandId,source:'ai_generated',status:'ready'}).toArray()
 const match=assets.filter((a:any)=>isGalleryCutout(a)&&a.url&&!used.has(a.id)&&!used.has(a.url)&&(!a.subject?.url||!used.has(a.subject.url))).map((asset:any)=>({asset,score:imageMatchScore(request,asset)})).filter((m:any)=>m.score>=.85).sort((a:any,b:any)=>b.score-a.score||(a.asset.usage_count||0)-(b.asset.usage_count||0))[0]
 if(!match)return null
 used.add(match.asset.id)
 used.add(match.asset.url)
 if(match.asset.subject?.url)used.add(match.asset.subject.url)
 await db.collection('assets').updateOne({id:match.asset.id,brand_id:brandId},{$inc:{usage_count:1},$set:{last_used_at:new Date()}})
 return {url:match.asset.url,width:match.asset.width,height:match.asset.height,subject:match.asset.subject,asset_id:match.asset.id,reused:true,match_score:match.score}
}
/** Saves a generated image to the brand gallery when it is a good cutout (isGalleryCutout); true when it was kept. */
export async function saveGeneratedAsset(db:any,brandId:string|null,request:any,asset:any):Promise<boolean>{
 if(!brandId||!asset?.url||asset.reused||!isGalleryCutout({source:'ai_generated',subject:asset.subject}))return false
 const id='generated-'+createHash('sha256').update(brandId+'|'+asset.url).digest('hex')
 const description=String(request.subject_description||request.visual_purpose||request.slide_context?.headline||'Generated brand image').slice(0,1500)
 const tags=[...new Set([...(request.search_keywords||[]),...imageTerms(description)])].slice(0,30)
 await db.collection('assets').updateOne({id,brand_id:brandId},{$setOnInsert:{id,brand_id:brandId,source:'ai_generated',status:'ready',url:asset.url,thumbnail_url:asset.subject?.url||asset.url,subject:asset.subject,width:asset.width,height:asset.height,mime_type:'image/png',orientation:asset.width>asset.height?'landscape':asset.width<asset.height?'portrait':'square',filename:description.slice(0,90),description,subject_description:description,tags,treatment:request.treatment,image_style:request.image_style||'photograph',generation_prompt:request.generation_prompt,created_at:new Date(),updated_at:new Date(),usage_count:1,last_used_at:new Date()}},{upsert:true})
 return true
}
