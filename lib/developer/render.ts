import { lookup } from 'node:dns/promises'
import JSZip from 'jszip'
import { renderCanvasToPng } from '@/lib/renderCanvas'
import { loadUpload } from '@/lib/services/uploadCache'
import { IMAGE_LIMITS, type PostDocument } from './document'
import { apiError, publicHttpUrl } from './validate'

/**
 * Renders a checked post document (document.ts) to PNG. Every image is loaded here first and handed to the renderer
 * as inline data, so the renderer never downloads anything itself. Web images must be on public addresses: the
 * address is checked again after DNS and on every redirect.
 */

const IMAGE_TYPES = /^image\/(png|jpe?g|webp|gif|avif)$/i

/** Whether an IP address is on a private, loopback, link-local or otherwise internal network. */
export function privateAddress(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  }
  const v6 = ip.toLowerCase()
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)
}

async function readCapped(response: Response, max: number) {
  const reader = response.body!.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > max) throw new Error(`it is larger than ${max / 1024 / 1024} MB`)
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  return Buffer.concat(chunks)
}

/** Downloads an image from the web, checking the address of every hop. */
async function fetchWebImage(url: string) {
  let current = url
  for (let hop = 0; hop <= IMAGE_LIMITS.maxRedirects; hop++) {
    if (!publicHttpUrl(current)) throw new Error('it is not a public http or https address')
    const { hostname } = new URL(current)
    const host = hostname.replace(/^\[|\]$/g, '')
    const addresses = /^[\d.]+$|:/.test(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw new Error('its host could not be found') })
    if (!addresses.length || addresses.some(a => privateAddress(a.address))) throw new Error('it is not a public address')
    const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(IMAGE_LIMITS.timeoutMs), headers: { 'User-Agent': 'BatkleRenderer/1.0 (+https://batkle.com/developers)', Accept: 'image/*' } })
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => {})
      current = new URL(location, current).toString()
      continue
    }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(`the server answered HTTP ${response.status}`) }
    const type = (response.headers.get('content-type') || '').split(';')[0].trim()
    if (!IMAGE_TYPES.test(type)) { await response.body?.cancel().catch(() => {}); throw new Error(`it is not a PNG, JPEG, WebP, GIF or AVIF image (${type || 'no content type'})`) }
    return { bytes: await readCapped(response, IMAGE_LIMITS.maxBytes), type }
  }
  throw new Error('it redirects too many times')
}

/** An image source as inline data the renderer can draw. */
async function loadImage(db: any, src: string, origin: string): Promise<string> {
  if (src.startsWith('data:')) {
    const match = /^data:(image\/(png|jpe?g|webp|gif|avif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(src)
    if (!match) throw new Error('a data URL must be a base64 PNG, JPEG, WebP, GIF or AVIF image')
    if (match[3].length * 0.75 > IMAGE_LIMITS.maxBytes) throw new Error(`it is larger than ${IMAGE_LIMITS.maxBytes / 1024 / 1024} MB`)
    return `data:${match[1]};base64,${match[3].replace(/\s+/g, '')}`
  }
  // Images uploaded to Batkle (as in designs copied from the editor) are read from the database.
  const ownOrigin = origin.replace(/\/$/, '')
  const upload = /^\/api\/uploads\/([A-Za-z0-9._-]+)$/.exec(src.startsWith(ownOrigin + '/') ? src.slice(ownOrigin.length) : src)
  if (upload) {
    const found = await loadUpload(db, upload[1])
    if (!found) throw new Error('no Batkle upload has this address')
    return `data:${found.contentType || 'image/png'};base64,${Buffer.from(found.bytes).toString('base64')}`
  }
  const { bytes, type } = await fetchWebImage(src)
  return `data:${type};base64,${bytes.toString('base64')}`
}

/** Loads every image of a document, four at a time; an image that cannot be used fails the request and names it. */
export async function loadDocumentImages(db: any, doc: PostDocument, origin: string) {
  if (doc.images.length > IMAGE_LIMITS.maxImages) throw apiError(400, 'invalid_request', `A request can use at most ${IMAGE_LIMITS.maxImages} different images.`)
  const loaded = new Map<string, string>()
  const queue = [...doc.images]
  const worker = async () => {
    for (let src = queue.shift(); src !== undefined; src = queue.shift()) {
      try { loaded.set(src, await loadImage(db, src, origin)) } catch (error: any) {
        throw apiError(422, 'image_unavailable', `The image ${src.length > 120 ? src.slice(0, 117) + '…' : src} could not be used: ${error?.message || 'it could not be loaded'}.`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker))
  return loaded
}

/** Renders the document's slides: one PNG, or a ZIP with one PNG per slide (slide-01.png, slide-02.png…). */
export async function renderDocument(db: any, doc: PostDocument, origin: string) {
  const images = await loadDocumentImages(db, doc, origin)
  const pngs: { index: number; png: Buffer }[] = []
  // Slides render one after another, so a carousel never holds more than one slide's work in memory at once.
  for (const { index, canvas } of doc.slides) {
    const nodes = canvas.nodes.map((node: any) => (node.type === 'image' ? { ...node, src: images.get(node.src) } : node))
    pngs.push({ index, png: Buffer.from(await renderCanvasToPng({ ...canvas, nodes })) })
  }
  if (pngs.length === 1) return { bytes: pngs[0].png, contentType: 'image/png', filename: doc.carousel ? `slide-${String(pngs[0].index).padStart(2, '0')}.png` : 'post.png', images: 1 }
  const zip = new JSZip()
  for (const { index, png } of pngs) zip.file(`slide-${String(index).padStart(2, '0')}.png`, png)
  // PNGs are already compressed; storing them keeps the ZIP fast to make.
  return { bytes: await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }), contentType: 'application/zip', filename: 'carousel.zip', images: pngs.length }
}
