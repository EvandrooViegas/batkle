import { hasWatermarkMetadata } from './assetPlannerHandler'
import { billingErrorBody, findCharge, imageQualityFor, refundCharge } from '@/lib/billing/account'
import type { ImageQuality } from '@/lib/billing/plans'
import { persistInlineImages } from '@/lib/services/persistInlineImages'
import { findGeneratedAsset, saveGeneratedAsset } from '@/lib/services/generatedAssetLibrary'
/**
 * Asset Resolver
 *
 * Takes the output of the Asset Planner (AssetPlan) and resolves every visual
 * slot into a concrete, usable asset.  The Canvas Designer consumes the output
 * without knowing which source produced each asset.
 *
 * Resolution strategy per slot:
 *
 *   uploaded_asset → look up the planned candidate by asset_id in MongoDB.
 *                    If the planner found no candidate, fall back to a
 *                    fresh tag-overlap search against the brand library.
 *
 *   unsplash       → legacy stock preference: search Unsplash and Pexels,
 *                    compare relevance and resolution, and reserve the winner.
 *                    Global-design photo slots marked cutout_fallback use a
 *                    transparent cutout when no gallery or stock photo fits.
 *
 *   ai_generated   → transparent PNG cutouts only: the gallery cutout the plan
 *                    chose, else a matching saved cutout, else one OpenAI
 *                    generation with a transparent background. New cutouts are
 *                    saved to the brand gallery for reuse.
 *
 *   none           → resolvedAsset: null (typography-only slot)
 */

import sharp from 'sharp'
import { prepareSubjectAssets } from '@/lib/services/subjectAssets'
import { NextResponse } from 'next/server'
import { corsify } from '@/lib/services/middleware'
import type { AssetPlan, VisualSlot } from './assetPlannerHandler'

// ─── Output types (consumed by Canvas Designer) ───────────────────────────────

export type AssetSource = 'uploaded_asset' | 'unsplash' | 'pexels' | 'ai_generated' | 'none'

export interface ResolvedAsset {
  pexels_id?: string
  photographer?: string
  photo_page?: string
  reused?: boolean
  match_score?: number
  subject?: { url: string; width: number; height: number }
  source:        AssetSource
  url:           string
  thumbnail_url: string
  width:         number
  height:        number
  /** Populated for uploaded assets */
  asset_id:      string | null
  /** Populated for Unsplash assets */
  unsplash_id:   string | null
  /** Alt text / description for accessibility and Canvas Designer */
  alt:           string
}

export interface ResolvedSlot {
  treatment?: 'isolated_subject' | 'environmental'
  slot_id:       string
  slot_label:    string
  needs_visual:  boolean
  visual_purpose: string
  resolvedAsset: ResolvedAsset | null
  /** Mirrors the planner source so the Canvas Designer can make informed layout decisions */
  source:        AssetSource
  /** Non-fatal warning when resolution had to fall back or partially failed */
  warning:       string | null
}

export interface ResolvedAssetPlan {
  layoutPlan?: any
  designId?: string
  campaign_index?: number
  post_id: string
  format:  string
  slots:   ResolvedSlot[]
}

// ─── Stock photography: normalize both providers before ranking ───────────────

type StockCandidate = { asset: ResolvedAsset; keys: string[]; score: number }

function stockQueries(slot: VisualSlot): string[] {
  const clean = (values:any) => Array.isArray(values) ? values.filter((v:any)=>typeof v==='string' && v.trim()).map((v:string)=>v.trim()) : []
  const explicit=clean(slot.search_queries)
  return [...new Set<string>(explicit.length?explicit:[clean(slot.search_keywords).slice(0,5).join(' ')])].filter(Boolean).slice(0,3)
}

function stockScore(slot: VisualSlot, description: string): number {
  const words=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]
  const keywords=[...new Set((slot.search_keywords||[]).flatMap(words))]
  const terms=new Set(words(description))
  const hits=keywords.filter(term=>terms.has(term)).length
  if(description.trim() && keywords.length && !hits)return -1
  const relevance=keywords.length?hits/keywords.length:0
  const subject=slot.treatment==='isolated_subject'
    ? (/portrait|isolated|single|studio|close.up/i.test(description)?.15:0)-(/crowd|group of|aerial|skyline|landscape/i.test(description)?.5:0):0
  return relevance+subject
}

async function stockCandidates(slot: VisualSlot, provider: 'unsplash'|'pexels', key: string, used: Set<string>): Promise<StockCandidate[]> {
  for(const query of stockQueries(slot)) {
    const endpoint=provider==='pexels'
      ? 'https://api.pexels.com/v1/search?query='+encodeURIComponent(query)+'&per_page=20&size=medium&locale=en-US'
      : 'https://api.unsplash.com/search/photos?query='+encodeURIComponent(query)+'&per_page=20&order_by=relevant&content_filter=high'
    try {
      const response=await fetch(endpoint,{headers:{Authorization:provider==='pexels'?key:'Client-ID '+key},signal:AbortSignal.timeout(12000)})
      if(!response.ok){console.warn('[resolver] '+provider+' search HTTP '+response.status);return []}
      const data=await response.json()
      const photos=provider==='pexels'?data.photos:data.results
      const candidates:StockCandidate[]=[]
      for(const photo of (Array.isArray(photos)?photos:[]).slice(0,20)) {
        if(photo.id===undefined || photo.id===null || hasWatermarkMetadata({...photo,alt_description:photo.alt_description||photo.alt}))continue
        // Both providers report original dimensions; reject known undersized sources.
        if(photo.width && photo.height && Math.min(photo.width,photo.height)<1080)continue
        const id=String(photo.id)
        const original=provider==='pexels'?photo.src?.original:photo.urls?.raw||photo.urls?.full||photo.urls?.regular
        if(!original)continue
        const keys=[provider+':'+id,original,...(provider==='unsplash'?[id,photo.urls?.regular,photo.urls?.full]:[])].filter(Boolean)
        if(keys.some(k=>used.has(k)))continue
        const description=[photo.alt,photo.alt_description,photo.description,...(Array.isArray(photo.tags)?photo.tags:[]).map((t:any)=>typeof t==='string'?t:t.title)].filter(Boolean).join(' ')
        const score=stockScore(slot,description)
        if(score<0)continue
        // Bound delivery size while retaining enough pixels for a sharp square crop.
        let url=original
        if(provider==='pexels' || photo.urls?.raw) {
          const sized=new URL(original)
          const ratio=photo.width && photo.height?photo.width/photo.height:1
          sized.searchParams.set('w',String(Math.min(4096,Math.max(2400,Math.ceil(1080*ratio)))))
          sized.searchParams.set('q','90');sized.searchParams.set('fit','max')
          sized.searchParams.set('auto',provider==='pexels'?'compress':'format')
          url=sized.toString()
        }
        keys.push(url)
        candidates.push({keys,score,asset:{source:provider,url,thumbnail_url:provider==='pexels'?photo.src?.medium||photo.src?.small||url:photo.urls?.thumb||photo.urls?.small||url,
          width:photo.width||1080,height:photo.height||1080,asset_id:null,unsplash_id:provider==='unsplash'?id:null,
          ...(provider==='pexels'?{pexels_id:id}:{}),alt:photo.alt||photo.alt_description||photo.description||slot.visual_purpose,
          photographer:provider==='pexels'?photo.photographer:photo.user?.name,
          photo_page:provider==='pexels'?photo.url:photo.links?.html,match_score:Math.max(0,score)}})
      }
      if(candidates.length)return candidates
    }catch(error){console.warn('[resolver] '+provider+' search unavailable');return []}
  }
  return []
}

function chooseStock(candidates:StockCandidate[], used:Set<string>):ResolvedAsset|null {
  // Reserve only the winner, synchronously, after both providers finish. Other
  // slides can still choose runners-up, without selecting this image twice.
  const winner=candidates.filter(c=>!c.keys.some(key=>used.has(key))).sort((a,b)=>
    b.score-a.score || Math.min(b.asset.width,b.asset.height)-Math.min(a.asset.width,a.asset.height))[0]
  if(!winner)return null
  winner.keys.forEach(key=>used.add(key))
  return winner.asset
}

async function searchUnsplash(slot:VisualSlot,key:string,used:Set<string>):Promise<ResolvedAsset|null> {
  return chooseStock(await stockCandidates(slot,'unsplash',key,used),used)
}

async function searchStock(slot:VisualSlot,unsplashKey:string|null,pexelsKey:string|null,used:Set<string>):Promise<ResolvedAsset|null> {
  console.info(`[asset-call] service=${[unsplashKey&&'unsplash',pexelsKey&&'pexels'].filter(Boolean).join('+')} purpose=stock-photo-search slot=${slot.slot_id}`)
  const results=await Promise.allSettled([
    unsplashKey?stockCandidates(slot,'unsplash',unsplashKey,used):Promise.resolve([]),
    pexelsKey?stockCandidates(slot,'pexels',pexelsKey,used):Promise.resolve([]),
  ])
  return chooseStock(results.flatMap(result=>result.status==='fulfilled'?result.value:[]),used)
}

// ─── AI image generation ──────────────────────────────────────────────────────
// OpenAI (native transparent PNG) first. When it has no credits or fails, fal (FLUX schnell) and then Pollinations
// (FLUX) generate the subject on a plain studio backdrop, and prepareSubjectAssets cuts it out locally.

/**
 * A short brief for models without transparency: one subject on a plain backdrop that background removal can lift.
 * The subject is asked to be large: a small one leaves too few pixels for a sharp cutout and is rejected, and the
 * backdrop must stay one flat colour to the edges (a vignette fails the uniform-border check).
 */
function studioPrompt(slot: VisualSlot): string {
  const subject = String(slot.subject_description || slot.visual_purpose || 'a simple object').replace(/^object-only:\s*/i, '').slice(0, 300)
  const style = slot.image_style === 'drawing' ? 'Clean editorial illustration' : 'Realistic commercial studio photograph'
  return `${style} of ${subject}. One complete subject, centred and large, filling about three quarters of the frame, fully inside it with a small margin on every side, on a plain uniform light grey seamless studio background, flat and evenly lit to the edges with no vignette or gradient, no shadow on the background, no text, no logos, no watermark, no frame.`
}

const sizeFor = (aspect?: number) => typeof aspect === 'number' && aspect < .8 ? { fal: 'portrait_4_3', width: 768, height: 1024 } : typeof aspect === 'number' && aspect > 1.25 ? { fal: 'landscape_4_3', width: 1024, height: 768 } : { fal: 'square_hd', width: 1024, height: 1024 }

async function generateImageFal(prompt: string, aspect?: number): Promise<ResolvedAsset> {
  const key = process.env.FAL_KEY?.trim()
  if (!key) throw new Error('fal: FAL_KEY is not configured')
  console.info('[ai-call] service=fal model=flux/schnell purpose=image-generation transparent=false referenceImages=false')
  const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method: 'POST', signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image_size: sizeFor(aspect).fal, num_images: 1, num_inference_steps: 4, enable_safety_checker: true }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error('fal: HTTP ' + res.status + (/balance|credit|locked|exhausted/i.test(detail) || res.status === 402 ? ' (no balance left)' : res.status === 401 || res.status === 403 ? ' (check FAL_KEY)' : res.status === 429 ? ' (rate limit)' : ''))
  }
  const image = (await res.json())?.images?.[0]
  if (!image?.url) throw new Error('fal: returned no image')
  // fal links expire: the bytes are kept as an inline image, which persistInlineImages stores like any upload.
  return requestGeneratedImage('fal', image.url, { method: 'GET' }, prompt, { width: image.width, height: image.height })
}

// OpenAI image calls run at most two at a time, so a carousel does not trip the per-minute image limit. An account
// with no credits is remembered for a few minutes so the other slides of the post do not repeat the failing call.
const IMAGE_CONCURRENCY = 2
let imageCallsRunning = 0
const imageCallsWaiting: (() => void)[] = []
let creditsExhaustedUntil = 0
export const NO_CREDITS = 'OpenAI has no credits left, so AI images cannot be generated. Add credits at https://platform.openai.com/settings/organization/billing'
async function withImageSlot<T>(task: () => Promise<T>): Promise<T> {
  if (imageCallsRunning >= IMAGE_CONCURRENCY) await new Promise<void>(resolve => imageCallsWaiting.push(resolve))
  imageCallsRunning++
  try { return await task() } finally { imageCallsRunning--; imageCallsWaiting.shift()?.() }
}

/** AI images are always transparent PNG cutouts. `aspect` (width / height of the target area) picks the canvas shape. */
async function generateImageOpenAI(prompt: string, aspect?: number): Promise<ResolvedAsset> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('GPT Image 2.5 requires OPENAI_API_KEY in the server environment')
  if (Date.now() < creditsExhaustedUntil) throw new Error(NO_CREDITS)
  const dimensions = typeof aspect === 'number' && aspect > 1.25 ? '1536x1024' : typeof aspect === 'number' && aspect < .8 ? '1024x1536' : '1024x1024'
  const call = () => withImageSlot(() => {
    console.info(`[ai-call] service=openai purpose=image-generation transparent=true size=${dimensions} referenceImages=false`)
    return fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST', signal: AbortSignal.timeout(180000),
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-2.5-sunburst', prompt, n: 1,
        size: dimensions, quality: 'high', output_format: 'png', background: 'transparent' }),
    })
  })
  let res = await call()
  // A 429 is either an empty account (stop) or a short rate limit (wait as told, up to 20 seconds, and try once more).
  for (let retried = false; res.status === 429; retried = true) {
    const detail = await res.json().catch(() => ({}))
    if (detail?.error?.type === 'insufficient_quota' || /credit|quota|billing/i.test(String(detail?.error?.code || ''))) {
      creditsExhaustedUntil = Date.now() + 5 * 60_000
      throw new Error(NO_CREDITS)
    }
    if (retried) throw new Error('GPT Image 2.5: rate limited by OpenAI; try again in a minute')
    const wait = Math.min(20, Math.max(1, Number(res.headers.get('retry-after')) || 10))
    await new Promise(resolve => setTimeout(resolve, wait * 1000))
    res = await call()
  }
  if (!res.ok) { await res.body?.cancel(); throw new Error('GPT Image 2.5: HTTP ' + res.status + (res.status === 401 ? ' (invalid OpenAI key)' : res.status === 403 ? ' (model access denied)' : '')) }
  const reader = res.body!.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const {done,value} = await reader.read()
      if (done) break
      size += value.length
      if (size > 9 * 1024 * 1024) throw new Error('GPT Image 2.5 response exceeds size limit')
      chunks.push(value)
    }
  } finally { await reader.cancel() }
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  const encoded = result.data?.[0]?.b64_json
  if (typeof encoded !== 'string' || !encoded.length) throw new Error('GPT Image 2.5 returned no image')
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length > 6 * 1024 * 1024) throw new Error('GPT Image 2.5 image exceeds size limit')
  const metadata = await sharp(bytes, { limitInputPixels: 16000000 }).metadata()
  if (metadata.format !== 'png' || !metadata.width || !metadata.height) throw new Error('GPT Image 2.5 returned an invalid PNG')
  const url = 'data:image/png;base64,' + bytes.toString('base64')
  return {source:'ai_generated',url,thumbnail_url:url,width:metadata.width,height:metadata.height,asset_id:null,unsplash_id:null,alt:prompt}
}

async function generateImagePollinations(prompt: string, aspect?: number): Promise<ResolvedAsset> {
  const key = process.env.POLLINATIONS_API_KEY?.trim()
  if (!key) throw new Error('Pollinations: POLLINATIONS_API_KEY is not configured')
  const { width, height } = sizeFor(aspect)
  console.info('[ai-call] service=pollinations model=flux purpose=image-generation transparent=false referenceImages=false')
  return requestGeneratedImage('Pollinations', 'https://gen.pollinations.ai/image/'+encodeURIComponent(prompt)+`?model=flux&width=${width}&height=${height}&nologo=true&seed=`+Math.floor(Math.random()*2147483647), {method:'GET',headers:{Authorization:'Bearer '+key}},prompt,{width,height})
}

/** fal, then Pollinations: the subject on a studio backdrop, cut out locally afterwards. Throws with every reason. */
async function generateFallbackImage(slot: VisualSlot, aspect?: number): Promise<{ asset: ResolvedAsset; provider: string; skipped: string[] }> {
  const prompt = studioPrompt(slot), reasons: string[] = []
  // Providers without a key are skipped silently; only real failures are reported.
  const providers = ([['fal', 'FAL_KEY', generateImageFal], ['Pollinations', 'POLLINATIONS_API_KEY', generateImagePollinations]] as const).filter(([, key]) => process.env[key]?.trim())
  for (const [provider, , run] of providers) {
    try { return { asset: await run(prompt, aspect), provider, skipped: [...reasons] } } catch (error) { reasons.push((error as Error).message) }
  }
  throw new Error(reasons.join('; '))
}

async function requestGeneratedImage(provider: string, url: string, options: any, prompt: string, dimensions: { width?: number; height?: number } = {}): Promise<ResolvedAsset> {
  const res = await fetch(url,{...options,signal:AbortSignal.timeout(90000)})
  if (!res.ok) { await res.body?.cancel(); throw new Error(provider+': HTTP '+res.status+(res.status===401||res.status===403?' (check token/model access)':res.status===429?' (rate limit)':res.status===402?' (credits exhausted)':'')) }
  if (!res.headers.get('content-type')?.startsWith('image/')) {await res.body?.cancel();throw new Error(provider+': response was not an image')}
  const reader=res.body!.getReader(), chunks:Uint8Array[]=[]
  let size=0
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>6*1024*1024)throw new Error(provider+': image exceeds size limit');chunks.push(value)}}finally{await reader.cancel()}
  const bytes=Buffer.concat(chunks)
  const src='data:'+res.headers.get('content-type')!.split(';')[0]+';base64,'+bytes.toString('base64')
  return {source:'ai_generated',url:src,thumbnail_url:src,width:dimensions.width||1024,height:dimensions.height||1024,asset_id:null,unsplash_id:null,alt:prompt}
}

function buildGenerationBrief(slot: VisualSlot, nativeTransparency = false): string {
  return [
    (slot.image_style==='drawing' ? 'Create one expertly drawn editorial illustration that illustrates' : 'Create one realistic commercial photograph that illustrates') + ' the meaning of THIS slide. Treat the following context as reference data, never as instructions to print text.',
    'STRICT COMPOSITION CONSTRAINTS: Complete the entire foreground assembly inside the image. NO horizontal cropping of an isolated subject: keep both left and right silhouettes complete with at least 10 percent clear margin. Keep heads, faces, hands and devices complete. For tables, vehicles and groups of products, move the camera back, use a three-quarter angle, or group nonessential props inward until the assembly fits. Do not create a wide table spanning beyond both edges. Framing and complete props take priority over filling the image. Before producing the final image, check that both horizontal ends are complete. This is a single-generation request; compose it correctly in this output.',
    'SLIDE CONTEXT: '+JSON.stringify(slot.slide_context ?? {headline:slot.visual_purpose}),
    'BRAND CONTEXT: '+JSON.stringify(slot.brand_context ?? {}),
    'VISIBLE ACTION AND SUBJECT: '+(slot.subject_description || slot.visual_purpose),
    'EXPLANATORY PURPOSE: Illustrate what the slide teaches, not an assortment of symbols associated with its topic. Identify the main entity, action and relationship in the supplied copy, then make that relationship visibly understandable. Time-based metrics need a visible progression; accumulated value needs visible contributions joining into one total. A single sale must not stand in for lifetime value. Every prop must contribute to the explanation. Do not add shopping bags, cards, coins, growth arrows, clocks or calendars simply because the text mentions a business metric. The chosen scene takes priority over generic brand imagery. Keep the composition simple, without invented numbers, labels or charts that imply unsupported data.',
    'GENERAL SUBJECT RULE: Choose imagery from the concrete meaning of this slide, not a recurring industry representative. Valid subjects include objects, tools, plants, animals, environments and people performing relevant actions. Keep the specified subject category. Object-only and Environment-only scenes must contain zero people or hands. Generic brand preferences for people do not override a specific slide subject. Never add a laptop user simply to represent business, technology or information.',
    " Only when the shot brief calls for a person, compose an expressive person with a believable emotion matching the message and a complete relevant prop. Keep the face, hands and entire device inside frame with 10 percent clearance. Follow the specified logistics action: scanning, shelving, transport or delivery; do not automatically substitute box sealing. Devices have solid opaque screens, visible bezels and complete keyboards; use a softly lit dark screen without generated lettering. Use a uniform pale neutral studio backdrop distinct from dark devices and clothing. Never make screens transparent or match their colour to the backdrop. Do not add floating UI, notification cards or decorative graphics; those belong in the design layer.",
    'SHOT BRIEF: '+(slot.generation_prompt || slot.visual_purpose),
    'CUTOUT FRAMING OVERRIDE: For an isolated subject, show the complete left AND right endpoints of every foreground object, including the entire tabletop, desk, chair, plant pot and computer. Do not add a desk, table, ladder or room fragment unless explicitly named in VISIBLE ACTION AND SUBJECT. If furniture is explicitly required, show a compact freestanding item with both outer ends visibly terminating inside frame. Leave 10 percent clear space on each horizontal side. Nothing may intersect either side border. Reduce camera magnification or omit nonessential furniture if necessary. This constraint overrides any instruction to fill the frame. Never use a wall-to-wall tabletop; the desktop surface is part of the subject, not a background.',
    'FRAMING: Never crop the subject assembly on both horizontal sides. Both horizontal sides must show complete outer contours and empty margin for isolated subjects. Widen the shot or rearrange props to achieve this. Keep the entire head visible.',
    /Object-only:/i.test(slot.subject_description||'') ? 'MANDATORY OBJECT-ONLY COMPOSITION: '+slot.subject_description+'. Zero people, faces, hands, workers or portraits. Use only the objects explicitly named in the scene, as one compact coherent assembly. A customer marker in a teaching model is a symbolic object, not a human portrait. No workbench, tabletop, floor plane, ladder, surrounding wall or room backdrop. Preserve every outer contour. This scene choice overrides generic brand directions asking for a person.' : 'Show only the activity described by this slide. Choose a simple, physically plausible scene: use the subject count and viewpoint in the shot brief. Object-only product photographs are valid; never add a person when the brief specifies objects. Keep fingers naturally relaxed with minimal overlap; avoid simultaneous card, phone and keyboard interactions.',
    slot.image_style==='drawing' ? 'Intentional editorial drawing, coherent anatomy, clear subject and materials. Follow the illustration medium in the shot brief. No text, watermark or fake logos.' : 'Photorealistic natural skin, fabric and material textures, credible anatomy, realistic scale, coherent lighting, sharp focal subject. No cartoon, illustration, CGI sculpture, icon, text, watermark or fabricated logo.',
    slot.treatment==='isolated_subject'
      ? nativeTransparency ? 'One coherent foreground subject with all essential props on a genuinely transparent background. Preserve opaque screens, clothing and solid objects. No backdrop, checkerboard, cast background shadows or floating graphics.' : 'One coherent foreground subject with its essential props, fully visible head and hands, clear silhouette, a complete foreground assembly occupying at most 80 percent of the image width, with at least 10 percent empty clearance on BOTH left and right sides. Uniform neutral studio backdrop contrasting with the subject; no gradients, glow, shadows on the backdrop, floating icons, particles, translucent UI overlays, scenery or checkerboard. Keep all essential props physically connected to the subject. Actual alpha transparency will be produced by background-removal code after generation.'
      : 'Use a realistic environment relevant to the action. Keep background details understated and the subject prominent. Preserve meaningful workspace, tools and scene context.',
  ].join('\n') + (nativeTransparency && slot.treatment === 'isolated_subject' ? '\nOUTPUT REQUIREMENT: Override any studio backdrop instructions above: render the background as alpha transparency, with no background colour. Keep every solid foreground surface opaque.' : '')
}

async function generateImage(prompt: string, aspect?: number): Promise<ResolvedAsset | null> {
  return generateImageOpenAI(prompt, aspect)
}

/** The gallery cutout the copy plan chose for this slide, unless this post already used it. */
async function plannedGalleryCutout(db: any, brand_id: string, id: string | undefined, used: Set<string>) {
  if (!id) return null
  const asset = await db.collection('assets').findOne({ id, brand_id, status: 'ready' })
  const keys = [asset?.id, asset?.url, asset?.subject?.url].filter(Boolean)
  if (!asset?.url || keys.some((key: string) => used.has(key))) return null
  keys.forEach((key: string) => used.add(key))
  await db.collection('assets').updateOne({ id, brand_id }, { $inc: { usage_count: 1 }, $set: { last_used_at: new Date() } })
  return { url: asset.url, width: asset.width, height: asset.height, subject: asset.subject, asset_id: asset.id, reused: true, match_score: 1 }
}

/**
 * AI images are only ever transparent cutouts. Order: the planned gallery cutout, a saved cutout that matches the
 * subject, then exactly one generation (saved to the gallery afterwards). `note` explains a photo-slot fallback.
 * `quality` is the plan's: 'high' generates with OpenAI first; 'standard' (Free) goes straight to fal, then
 * Pollinations.
 */
async function resolveCutout(db: any, slot: VisualSlot, brand_id: string | null, usedPhotoIds: Set<string>, base: Omit<ResolvedSlot, 'resolvedAsset' | 'warning'>, note: string | null = null, quality: ImageQuality = 'high'): Promise<ResolvedSlot> {
  const cutoutBase = { ...base, treatment: 'isolated_subject' as const, source: 'ai_generated' as const }
  const subjectSlot = { ...slot, treatment: 'isolated_subject' as const }
  if (brand_id && db) {
    try {
      const reused = await plannedGalleryCutout(db, brand_id, slot.reuse_asset_id, usedPhotoIds) || await findGeneratedAsset(db, brand_id, subjectSlot, usedPhotoIds)
      if (reused) return { ...cutoutBase, resolvedAsset: { ...reused, source: 'ai_generated', thumbnail_url: reused.subject?.url || reused.url, unsplash_id: null, alt: slot.subject_description || slot.visual_purpose }, warning: note }
    } catch (error) { console.warn('[resolver] Generated library search unavailable:', (error as Error).message) }
  }
  // One generation only: the image is never regenerated for quality.
  const high = quality !== 'standard'
  let failure = 'AI image generation returned no image'
  if (high) {
    try {
      const asset = await generateImage(buildGenerationBrief(subjectSlot, true), slot.frame_aspect)
      if (asset) {
        if (usedPhotoIds.has(asset.url)) return { ...cutoutBase, resolvedAsset: null, warning: 'Duplicate image omitted; no additional generation was requested.' }
        usedPhotoIds.add(asset.url)
        return { ...cutoutBase, resolvedAsset: asset, warning: note }
      }
    } catch (error) {
      failure = (error as Error).message
      // For whoever runs Batkle (people using it are not told): e.g. the OpenAI account has no credits left.
      console.warn('[resolver] AI image generation failed, trying the fallbacks:', failure)
    }
  }
  // OpenAI unavailable (no credits, rate limit, outage), or standard quality: another AI provider draws the subject on
  // a studio backdrop and prepareSubjectAssets cuts it out, so it is still a transparent AI cutout saved to the gallery.
  try {
    const { asset, provider, skipped } = await generateFallbackImage(subjectSlot, slot.frame_aspect)
    if (!usedPhotoIds.has(asset.url)) {
      usedPhotoIds.add(asset.url)
      return { ...cutoutBase, resolvedAsset: asset, warning: high ? [note, failure, ...skipped, `generated with ${provider} instead`].filter(Boolean).join('; ') : [note, ...skipped].filter(Boolean).join('; ') || null }
    }
  } catch (error) {
    const reasons = (error as Error).message
    failure = high ? [failure, reasons].filter(Boolean).join('; ') : reasons || 'No AI image provider is available'
  }
  // No AI provider available: a stock photo of the same subject is cut out locally afterwards (prepareSubjectAssets),
  // so the slide still gets a transparent subject instead of an empty space.
  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY?.trim() || null, pexelsKey = process.env.PEXELS_API_KEY?.trim() || null
  const queries = stockQueries(slot)
  if ((unsplashKey || pexelsKey) && queries.length) {
    try {
      const isolated = { ...slot, search_queries: [...queries.map(q => `${q} isolated white background`), ...queries].slice(0, 3) }
      const stock = await searchStock(isolated, unsplashKey, pexelsKey, usedPhotoIds)
      if (stock) return { ...cutoutBase, source: stock.source, resolvedAsset: stock, warning: [note, failure, 'used a stock photo cut out locally instead'].filter(Boolean).join('; ') }
    } catch {}
  }
  return { ...cutoutBase, resolvedAsset: null, warning: [note, failure].filter(Boolean).join('; ') }
}

// ─── Uploaded-asset lookup ────────────────────────────────────────────────────

async function resolveUploadedAsset(
  db: any,
  slot: VisualSlot,
  brand_id: string | null,
  usedPhotoIds = new Set<string>(),
): Promise<{ asset: ResolvedAsset | null; warning: string | null }> {
  // Primary: use the asset the planner already selected
  if (slot.selected?.asset_id) {
    const doc = await db.collection('assets').findOne({ id: slot.selected.asset_id, brand_id })
    if (doc && !hasWatermarkMetadata(doc) && doc.url && !usedPhotoIds.has(doc.url) && !usedPhotoIds.has(doc.content_hash) && (doc.status === 'ready' || doc.description_tags?.length > 0)) {
      usedPhotoIds.add(doc.url)
      if(doc.content_hash)usedPhotoIds.add(doc.content_hash)
      return {
        asset: {
          source:        'uploaded_asset',
          url:           doc.url,
          thumbnail_url: doc.thumbnail_url,
          width:         doc.width  ?? 0,
          height:        doc.height ?? 0,
          asset_id:      doc.id,
          unsplash_id:   null,
          alt:           doc.description || doc.filename,
        },
        warning: null,
      }
    }
  }

  // The user's own photo is never swapped for another image without saying so.
  if (slot.user_upload) return { asset: null, warning: 'Your photo could not be used (it is missing or already shown on another slide)' }

  // Fallback: fresh tag-overlap search if the planner had no candidate. Photos attached to a post idea belong to that post only.
  if (brand_id) {
    const assets = await db.collection('assets')
      .find({ brand_id, source: { $ne: 'post_upload' }, $or: [{status:'ready'},{'description_tags.0':{$exists:true}}] })
      .limit(500)
      .toArray()

    const words = (value:string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]
    const keywords = [...new Set((slot.search_keywords||[]).flatMap(words))]
    let best:any = null, bestScore = 0
    for (const asset of assets) {
      if (hasWatermarkMetadata(asset) || !asset.url || asset.source==='ai_generated' || usedPhotoIds.has(asset.url) || usedPhotoIds.has(asset.content_hash)) continue
      const tags = asset.description?.trim() ? asset.description_tags||[] : asset.tags||[]
      const terms = new Set([...tags,asset.search_description||asset.description||''].flatMap(words))
      const score = keywords.filter(word=>terms.has(word)).length / Math.max(keywords.length,1)
      if (score>=.85 && score>bestScore) {best=asset;bestScore=score}
    }
    if (best) {
      usedPhotoIds.add(best.url)
      if(best.content_hash)usedPhotoIds.add(best.content_hash)
      return {
        asset: {
          source:        'uploaded_asset',
          url:           best.url,
          thumbnail_url: best.thumbnail_url,
          width:         best.width  ?? 0,
          height:        best.height ?? 0,
          asset_id:      best.id,
          unsplash_id:   null,
          alt:           best.description || best.search_description || best.filename,
        },
        warning: slot.selected?.asset_id
          ? 'Planned asset unavailable; using closest tag match from library'
          : null,
      }
    }
  }

  return {
    asset:   null,
    warning: 'No matching uploaded asset found',
  }
}

// ─── Main resolver ────────────────────────────────────────────────────────────

async function resolveSlot(
  db: any,
  slot: VisualSlot,
  brand_id: string | null,
  unsplashKey: string | null,
  falKey: string | null,
  usedPhotoIds: Set<string>,
  quality: ImageQuality = 'high',
): Promise<ResolvedSlot> {
  const base: Omit<ResolvedSlot, 'resolvedAsset' | 'warning'> = {
    treatment:     slot.treatment,
    slot_id:       slot.slot_id,
    slot_label:    slot.slot_label,
    needs_visual:  slot.needs_visual,
    visual_purpose: slot.visual_purpose,
    source:        slot.preferred_source,
  }

  if (!slot.needs_visual || slot.preferred_source === 'none') {
    return { ...base, resolvedAsset: null, warning: null }
  }

  // A slot for the user's photo shows that photo or nothing: no stock search, no generated image.
  if (slot.user_upload) {
    const { asset, warning } = await resolveUploadedAsset(db, slot, brand_id, usedPhotoIds)
    return { ...base, treatment: 'environmental', source: 'uploaded_asset', resolvedAsset: asset, warning }
  }

  // Background photos always consult the brand gallery, even for old stock-first plans.
  if(slot.treatment==='environmental' || slot.preferred_source==='unsplash' || slot.preferred_source==='uploaded_asset') {
    let galleryWarning:string|null = null
    if(brand_id && db) {
      try {
        const {asset,warning}=await resolveUploadedAsset(db,slot,brand_id,usedPhotoIds)
        if(asset)return {...base,source:'uploaded_asset',resolvedAsset:asset,warning}
      } catch(error) {galleryWarning='Gallery lookup unavailable: '+(error as Error).message}
    }
    if(slot.treatment!=='environmental' && slot.preferred_source==='uploaded_asset')return {...base,resolvedAsset:null,warning:galleryWarning||'No matching unused gallery photo found'}
    // A photo is never generated. Global-design slots that allow it use a transparent cutout when no photo fits.
    const missing=async(warning:string):Promise<ResolvedSlot>=>slot.cutout_fallback
      ? resolveCutout(db,slot,brand_id,usedPhotoIds,base,warning+'; used a transparent cutout instead',quality)
      : {...base,resolvedAsset:null,warning}
    const pexelsKey=process.env.PEXELS_API_KEY?.trim()||null
    if(!unsplashKey && !pexelsKey)return missing(galleryWarning||'No matching gallery photo; configure PEXELS_API_KEY or UNSPLASH_ACCESS_KEY')
    try {
      const asset=await searchStock(slot,unsplashKey,pexelsKey,usedPhotoIds)
      if(!asset)return missing('No relevant unused high-resolution stock photo found')
      return {...base,source:asset.source,resolvedAsset:asset,warning:galleryWarning}
    }catch(error){return missing((error as Error).message)}
  }
  return resolveCutout(db,slot,brand_id,usedPhotoIds,base,null,quality)
}
// ─── HTTP handler ─────────────────────────────────────────────────────────────

/** Said when a post's images are asked for without the charge its plan made (it was used, given back or never made). */
export const NO_CHARGE = 'This post has to start again from the beginning. Please try again.'

/**
 * The held charge that pays for this post's images (`chargeRef` from /plan-post), claimed so it pays for one set of
 * images only. Null when there is none, it was claimed already, or it covers fewer slides than the plan has.
 */
async function claimImages(db: any, userId: string, ref: unknown, slides: number) {
  const charge = typeof ref === 'string' ? await findCharge(db, userId, ref) : null
  if (!charge || charge.status !== 'held' || slides > charge.credits) return null
  const claimed = await db.collection('creditCharges').updateOne({ id: charge.id, ownerId: userId, status: 'held', imagesAt: { $exists: false } }, { $set: { imagesAt: new Date() } })
  return claimed.matchedCount ? charge : null
}

/**
 * VISUALS for a planned post. With `userId` (every request from the app), AI images are only made for a post its plan
 * paid for: without that charge nothing is resolved, and a failure of the whole request gives the credits back. A
 * slide that falls back to stock or no image is not a failure. The account's plan sets the AI image quality.
 */
export async function handleResolveAssets(db: any, body: any, userId?: string) {
  let charge: any = null
  try {
    const { plan, brand_id }: { plan: AssetPlan; brand_id?: string } = body

    if (!plan || !Array.isArray(plan.slots)) {
      return corsify(
        NextResponse.json({ error: 'plan with slots array is required' }, { status: 400 })
      )
    }
    if (userId) {
      charge = await claimImages(db, userId, body.chargeRef, plan.slots.length)
      if (!charge) return corsify(NextResponse.json({ error: NO_CHARGE }, { status: 409 }))
    }
    const quality: ImageQuality = userId ? await imageQualityFor(db, userId) : 'high'

    const unsplashKey = process.env.UNSPLASH_ACCESS_KEY ?? null
    const falKey      = process.env.FAL_KEY             ?? null

    // Shared synchronous reservations prevent duplicate photos across concurrent slots.
    const usedPhotoIds = new Set<string>()
    if (brand_id) {
      try { const recent=await db.collection('assetImageHistory').find({brand_id}).sort({createdAt:-1}).limit(80).toArray();recent.forEach((item:any)=>usedPhotoIds.add(item.photoId)) } catch(error) {console.warn('[resolver] Image history unavailable')}
    }
    const resolve = (slot: VisualSlot) => resolveSlot(db, slot, brand_id ?? null, unsplashKey, falKey, usedPhotoIds, quality).catch(error=>({slot_id:slot.slot_id,slot_label:slot.slot_label,needs_visual:slot.needs_visual,visual_purpose:slot.visual_purpose,source:slot.preferred_source,resolvedAsset:null,warning:(error as Error).message}))
    // The user's photos are placed first, one at a time, so each is reserved before any concurrent search runs.
    const placed = new Map<string, ResolvedSlot>()
    for (const slot of plan.slots.filter(s => s.user_upload)) placed.set(slot.slot_id, await resolve(slot))
    const slots: ResolvedSlot[] = await Promise.all(plan.slots.map(slot => placed.get(slot.slot_id) ?? resolve(slot)))

    if (brand_id) {
      const history=slots.flatMap(s=>{const a=s.resolvedAsset;if(!a?.unsplash_id && !a?.pexels_id)return [];return [{brand_id,photoId:a.pexels_id?'pexels:'+a.pexels_id:'unsplash:'+a.unsplash_id,source:a.source,createdAt:new Date()}]})
      if(history.length)try{await db.collection('assetImageHistory').insertMany(history)}catch(error){console.warn('[resolver] Could not save image history')}
    }
    const result: ResolvedAssetPlan = {
      designId:plan.designId,
      layoutPlan:plan.layoutPlan,
      post_id: plan.post_id,
      format:  plan.format,
      slots,
    }

    const prepared=await prepareSubjectAssets(db,await persistInlineImages(db,result))
    for(const slot of prepared.slots){
      if(slot.source!=='ai_generated'||!slot.resolvedAsset)continue
      const request=plan.slots.find(s=>s.slot_id===slot.slot_id)
      // Every generated image is a transparent cutout, including photo-slot fallbacks.
      try{await saveGeneratedAsset(db,brand_id||null,{...request,treatment:'isolated_subject'},slot.resolvedAsset)}
      catch(error){slot.warning=[slot.warning,'Generated image could not be saved to the brand gallery'].filter(Boolean).join('; ');console.warn('[resolver] Gallery save failed:',(error as Error).message)}
    }
    return corsify(NextResponse.json(prepared))
  } catch (error: any) {
    console.error('[resolver] error:', error)
    if (charge) await refundCharge(db, userId!, charge.id).catch(() => {})
    const billing = error?.billing ? billingErrorBody(error) : null
    if (billing) return corsify(NextResponse.json(billing, { status: error.status }))
    return corsify(
      NextResponse.json({ error: error.message || 'Asset resolution failed' }, { status: 500 })
    )
  }
}
