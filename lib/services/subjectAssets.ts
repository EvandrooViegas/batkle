import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { downloadLogo } from './logoBackground'
import { compactImage } from './imageStorage'
import { loadUpload } from './uploadCache'
import { saveUpload } from './uploadStore'
import type { ResolvedAssetPlan } from '../handlers/assetResolverHandler'

// General subjects, including people and products. Model card:
// https://huggingface.co/onnx-community/ormbg-ONNX (Apache-2.0).
const MODEL = 'onnx-community/ormbg-ONNX'
const VERSION = 'hybrid-v4-border-fill'
let modelPromise: Promise<any> | undefined
let inferenceQueue: Promise<unknown> = Promise.resolve()

export interface SubjectAsset { url: string; width: number; height: number; silhouette?:Array<{top:number;bottom:number;left:number;right:number}>; cropVersion?:number; cropEdges?: {left:boolean;right:boolean;top:boolean;bottom:boolean} }

async function segment(input: Buffer) {
  const { pipeline, RawImage, env } = require('@huggingface/transformers')
  // Vercel's function files are read-only; only the temp folder can hold the downloaded model.
  env.cacheDir = process.env.VERCEL ? require('node:path').join(require('node:os').tmpdir(), 'huggingface') : './.cache/huggingface'
  if (!modelPromise) modelPromise = pipeline('background-removal', MODEL, { dtype: 'q8', device: 'cpu' }).catch((error: unknown) => { modelPromise = undefined; throw error })
  const model = await modelPromise
  const image = await RawImage.fromBlob(new Blob([new Uint8Array(input)], { type: 'image/png' }))
  const output = await model(image)
  const result = Array.isArray(output) ? output[0] : output
  if (result.channels !== 4) throw new Error('Background remover returned no alpha channel')
  return sharp(Buffer.from(result.data), { raw: { width: result.width, height: result.height, channels: 4 } }).png().toBuffer()
}

/** Remove detached mask debris without eroding connected hair or fingers.
 * Large disconnected props remain intact; only small islands are discarded.
 */
export async function cleanSubjectMask(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png, { limitInputPixels: 16000000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const count = info.width * info.height
  const labels = new Int32Array(count), queue = new Int32Array(count)
  const sizes: number[] = [0]
  let label = 0
  for (let seed = 0; seed < count; seed++) {
    if (labels[seed] || data[seed * 4 + 3] < 16) continue
    label++; let head = 0, tail = 1; queue[0] = seed; labels[seed] = label
    while (head < tail) {
      const pixel = queue[head++], x = pixel % info.width, y = Math.floor(pixel / info.width)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || nx >= info.width || ny < 0 || ny >= info.height) continue
        const next = ny * info.width + nx
        if (!labels[next] && data[next * 4 + 3] >= 16) { labels[next] = label; queue[tail++] = next }
      }
    }
    sizes.push(tail)
  }
  const largest = sizes.reduce((a, b) => Math.max(a, b), 0)
  for (let pixel = 0; pixel < count; pixel++) {
    // Low-opacity disconnected haze is excluded from connectivity. Retain the
    // soft edge of surviving components using their immediate neighbourhood.
    let keep = labels[pixel] > 0 && sizes[labels[pixel]] >= largest * .025
    if (!labels[pixel] && data[pixel * 4 + 3] > 0) {
      const x = pixel % info.width, y = Math.floor(pixel / info.width)
      for (let dy = -1; dy <= 1 && !keep; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx >= 0 && nx < info.width && ny >= 0 && ny < info.height) {
          const neighbour = labels[ny * info.width + nx]
          if (neighbour && sizes[neighbour] >= largest * .025) keep = true
        }
      }
    }
    if (!keep) data[pixel * 4 + 3] = 0
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
}

/** Restore enclosed opaque surfaces only when their source colour differs from
 * the studio backdrop. Background-coloured gaps between arms remain transparent.
 * RGB comes from the original, not the segmented PNG (which may zero RGB).
 */
export async function restoreSubjectSurfaces(mask: Buffer, source: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(mask).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const original = await sharp(source).resize(info.width, info.height).ensureAlpha().raw().toBuffer()
  const count = info.width * info.height
  const samples: number[][] = [[], [], []]
  for (let i = 0; i < count; i++) {
    const x = i % info.width, y = Math.floor(i / info.width)
    if ((x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) && data[i * 4 + 3] < 16)
      for (let c = 0; c < 3; c++) samples[c].push(original[i * 4 + c])
  }
  if (samples[0].length < 20) return mask
  const background = samples.map(values => [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)])
  // A complex environment has no reliable background colour: do not guess.
  const stable = samples[0].filter((_, i) => samples.every((values,c) => Math.abs(values[i] - background[c]) < 25)).length / samples[0].length
  if (stable < .8) return mask
  const visited = new Uint8Array(count), queue = new Int32Array(count)
  for (let seed = 0; seed < count; seed++) {
    if (visited[seed] || data[seed * 4 + 3] >= 220) continue
    let head = 0, tail = 1, edge = false, different = 0
    queue[0] = seed; visited[seed] = 1
    while (head < tail) {
      const pixel = queue[head++], x = pixel % info.width, y = Math.floor(pixel / info.width)
      if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) edge = true
      if (Math.hypot(...background.map((value,c) => original[pixel * 4 + c] - value)) > 65) different++
      for (const next of [x > 0 ? pixel-1 : -1, x+1 < info.width ? pixel+1 : -1, y > 0 ? pixel-info.width : -1, y+1 < info.height ? pixel+info.width : -1]) {
        if (next >= 0 && !visited[next] && data[next * 4 + 3] < 220) { visited[next] = 1; queue[tail++] = next }
      }
    }
    if (edge || tail < 9 || tail > count * .45 || different / tail < .9) continue
    for (let i = 0; i < tail; i++) {
      const pixel = queue[i]
      for (let c = 0; c < 3; c++) data[pixel * 4 + c] = original[pixel * 4 + c]
      data[pixel * 4 + 3] = 255
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
}

/** Plain-code removal for uniform studio backgrounds. Only border-connected
 * colours are removed, so enclosed screens are never treated as background.
 * Reject nonuniform borders and extreme masks instead of guessing.
 */
export async function removeStudioBackground(input: Buffer): Promise<Buffer | null> {
  const { data, info } = await sharp(input, { limitInputPixels: 16000000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info, count = width * height
  const border: number[] = []
  for (let x = 0; x < width; x++) { border.push(x, (height-1)*width+x) }
  for (let y = 1; y < height-1; y++) { border.push(y*width, y*width+width-1) }
  const background = [0,1,2].map(c => {
    const values = border.map(i => data[i*4+c]).sort((a,b) => a-b)
    return values[Math.floor(values.length/2)]
  })
  const distance = (i: number) => Math.hypot(data[i*4]-background[0], data[i*4+1]-background[1], data[i*4+2]-background[2])
  if (border.filter(i => distance(i) < 18).length / border.length < .97) return null
  const visited = new Uint8Array(count), queue = new Int32Array(count)
  let head = 0, tail = 0
  const visit = (i: number) => {
    if (!visited[i] && distance(i) < 38) { visited[i] = 1; queue[tail++] = i }
  }
  border.forEach(visit)
  while (head < tail) {
    const i = queue[head++], x = i % width, y = Math.floor(i/width)
    if (x) visit(i-1)
    if (x+1 < width) visit(i+1)
    if (y) visit(i-width)
    if (y+1 < height) visit(i+width)
  }
  if (tail/count < .15 || tail/count > .95) return null
  for (let i = 0; i < count; i++) if (visited[i]) {
    const d = distance(i)
    data[i*4+3] = Math.round(255 * Math.max(0, Math.min(1, (d-18)/20)))
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer()
}

/** Retain soft hair edges; reject degenerate masks and trim only transparent margins. */
export async function validateSubject(png: Buffer): Promise<{ png: Buffer; width: number; height: number; cropEdges: {left:boolean;right:boolean;bottom:boolean;top:boolean} } | null> {
  const { data, info } = await sharp(png, { limitInputPixels: 16000000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const total = info.width * info.height
  let opaque = 0, clear = 0, left = info.width, top = info.height, right = 0, bottom = 0
  for (let i = 0; i < total; i++) {
    const alpha = data[i * 4 + 3]
    if (alpha < 15) clear++
    if (alpha > 220) opaque++
    if (alpha > 12) {
      const x = i % info.width, y = Math.floor(i / info.width)
      left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
  }
  if (opaque / total < .025 || clear / total < .08 || clear / total > .97 || left >= right || top >= bottom) return null
  // Record hard source edges before trimming transparency; fitting can align them with the canvas.
  const edgeCoverage=(edge:string)=>{
    const length=edge==='left'||edge==='right'?info.height:info.width
    let solid=0
    for(let i=0;i<length;i++){
      const x=edge==='left'?0:edge==='right'?info.width-1:i
      const y=edge==='top'?0:edge==='bottom'?info.height-1:i
      if(data[(y*info.width+x)*4+3]>220)solid++
    }
    if(solid/length>.1)return true
    // Native alpha and older trimmed PNGs can have transparent padding around a hard crop.
    // Look for a sustained straight boundary at the silhouette, not just the PNG border.
    const padding=edge==='left'?left:edge==='right'?info.width-1-right:edge==='top'?top:info.height-1-bottom
    if(padding>8)return false
    let boundary=0
    for(let i=0;i<length;i++){
      const x=edge==='left'?Math.min(right,left+2):edge==='right'?Math.max(left,right-2):i
      const y=edge==='top'?Math.min(bottom,top+2):edge==='bottom'?Math.max(top,bottom-2):i
      if(data[(y*info.width+x)*4+3]>220)boundary++
    }
    return boundary/length>.6
  }
  const cropEdges={left:edgeCoverage('left'),right:edgeCoverage('right'),top:edgeCoverage('top'),bottom:edgeCoverage('bottom')}
  const padding = 4
  left = Math.max(0, left - padding); top = Math.max(0, top - padding)
  right = Math.min(info.width - 1, right + padding); bottom = Math.min(info.height - 1, bottom + padding)
  const width = right - left + 1, height = bottom - top + 1
  const output = await sharp(png).extract({ left, top, width, height }).png().toBuffer()
  return { png: output, width, height, cropEdges }
}

export async function createSubject(input: Buffer): Promise<{ png: Buffer; width: number; height: number; cropEdges: {left:boolean;right:boolean;bottom:boolean;top:boolean} } | null> {
  // Gallery originals go up to 25 MB (about 40 megapixels); they are scaled down to 1200 px straight away.
  const normalized = await sharp(input, { limitInputPixels: 40_000_000 }).rotate()
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).ensureAlpha().png().toBuffer()
  const existing = await validateSubject(normalized)
  if (existing) return existing
  const studio = await removeStudioBackground(normalized)
  if (studio) {
    const result = await validateSubject(studio)
    if (result) return result
  }
  // Serialize CPU inference across concurrent requests to avoid memory spikes.
  const work = inferenceQueue.then(async () => validateSubject(await cleanSubjectMask(await restoreSubjectSurfaces(await segment(normalized), normalized))))
  inferenceQueue = work.catch(() => undefined)
  return work
}

async function sourceBytes(db: any, url: string): Promise<Buffer> {
  // Uploaded images are read directly from storage, never fetched through localhost.
  const path = new URL(url, 'http://local.invalid').pathname
  const match = path.match(/^\/api\/uploads\/([a-zA-Z0-9-]+)$/)
  if (match) {
    const upload = await loadUpload(db, match[1])
    if (!upload) throw new Error('Source upload missing')
    if (upload.bytes.length > 25 * 1024 * 1024) throw new Error('Source too large')
    return upload.bytes
  }
  if (url.startsWith('data:image/')) {
    if (url.length > 8 * 1024 * 1024) throw new Error('Source too large')
    return Buffer.from(url.split(',')[1] ?? '', 'base64')
  }
  return downloadLogo(url, 6 * 1024 * 1024, 15000)
}

/** Add optional derivatives; preserve original assets and the existing resolver contract. */
export async function hydrateSubjectCrops(db:any,plan:ResolvedAssetPlan):Promise<ResolvedAssetPlan> {
 const inspected=new Map<string,any>()
 const slots=[]
 for(const slot of plan.slots){
  const subject=slot.resolvedAsset?.subject as SubjectAsset|undefined
  if(!subject||subject.cropVersion===3&&subject.silhouette){slots.push(slot);continue}
  try{
   if(!inspected.has(subject.url)){
    const bytes=await sourceBytes(db,subject.url)
    const cutout=await validateSubject(bytes)
    const {data,info}=await sharp(bytes,{limitInputPixels:16000000}).ensureAlpha().raw().toBuffer({resolveWithObject:true})
    const silhouette=[]
    for(let band=0;band<24;band++){
     const top=Math.floor(band*info.height/24),bottom=Math.floor((band+1)*info.height/24)
     let left=info.width,right=-1
     for(let y=top;y<bottom;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>32){left=Math.min(left,x);right=Math.max(right,x)}
     if(right>=left)silhouette.push({top:top/info.height,bottom:bottom/info.height,left:left/info.width,right:(right+1)/info.width})
    }
    inspected.set(subject.url,cutout?{cropEdges:cutout.cropEdges,silhouette}:undefined)
   }
   const metadata=inspected.get(subject.url)
   slots.push(metadata?{...slot,resolvedAsset:{...slot.resolvedAsset,subject:{...subject,...metadata,cropVersion:3}}}:slot)
  }catch(error){console.warn('[subject-assets] crop inspection unavailable:',(error as Error).message);slots.push(slot)}
 }
 return {...plan,slots}
}

export async function prepareSubjectAssets(db: any, plan: ResolvedAssetPlan): Promise<ResolvedAssetPlan> {
  const slots = []
  const prepared = new Map<string, SubjectAsset | null>()
  const failures = new Map<string, string>()
  for (const slot of plan.slots) {
    const asset = slot.resolvedAsset
    if (!asset?.url || asset.subject || slot.treatment === 'environmental') { slots.push(slot); continue }
    let subject = prepared.get(asset.url)
    if (subject === undefined) {
      subject = null
      try {
        const bytes = await sourceBytes(db, asset.url)
        const id = 'subject-' + createHash('sha256').update(VERSION).update(bytes).digest('hex')
        // Only the cutout's metadata is needed here, never its bytes.
        const cached = await db.collection('uploads').findOne({ id }, { projection: { _id: 0, subject: 1 } })
        if (cached?.subject) subject = { url: `/api/uploads/${id}`, width: cached.subject.width, height: cached.subject.height, cropEdges: cached.subject.cropEdges }
        else {
          const cutout = await createSubject(bytes)
          if (!cutout) failures.set(asset.url, "No usable foreground silhouette detected")
          if (cutout) {
            const stored = await compactImage(cutout.png, 'image/png')
            await saveUpload(db, {
              id, bytes: stored.bytes, contentType: stored.contentType,
              subject: { width: cutout.width, height: cutout.height, cropEdges: cutout.cropEdges, model: MODEL },
            }, { ifAbsent: true })
            subject = { url: `/api/uploads/${id}`, width: cutout.width, height: cutout.height, cropEdges: cutout.cropEdges }
          }
        }
      } catch (error) { failures.set(asset.url, (error as Error).message); console.warn('[subject-assets] keeping original photo:', (error as Error).message) }
      prepared.set(asset.url, subject)
    }
    slots.push({ ...slot, warning: !subject && slot.treatment === 'isolated_subject' ? [slot.warning?.split('; ').filter(part => !part.startsWith('Subject isolation failed')).join('; '), 'Subject isolation failed: ' + (failures.get(asset.url) ?? 'Unknown failure') + '; original photo retained'].filter(Boolean).join('; ') : slot.warning, resolvedAsset: { ...asset, subject: subject ?? undefined } })
  }
  return { ...plan, slots }
}
