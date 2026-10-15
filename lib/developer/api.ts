import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/services/db/mongo'
import { getBaseUrl } from '@/lib/services/middleware'
import { publicMessage } from '@/lib/services/publicError'
import { readPostDocument } from './document'
import { newId, readApiKey } from './keys'
import { RATE_LIMITS, imageCost } from './pricing'
import { renderDocument } from './render'
import { authenticateKey, checkRateLimit, creditCharge, developerAccount, recordUsage } from './store'
import { apiError, errorType, parseBody } from './validate'

/**
 * The public REST API, /api/v1. It has one endpoint for now: POST /v1/posts takes a post described as nodes
 * (document.ts) and answers with the rendered image, a PNG, or a ZIP of PNGs for a carousel. Every call carries an
 * API key ("Authorization: Bearer bk_live_…") and costs one credit per image, taken before rendering and given back
 * when it fails. Each call is recorded for the developer dashboard. The docs page (/developers) describes it.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Expose-Headers': 'X-Request-Id, X-Credits-Charged, X-Credits-Remaining, X-Images, Content-Disposition',
}

/** Sends bytes as a stream: Vercel limits buffered function responses to 4.5 MB, and a carousel can be larger. */
function streamed(bytes: Buffer) {
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return }
      controller.enqueue(bytes.subarray(offset, offset + 256 * 1024))
      offset += 256 * 1024
    },
  })
}

function headersFor(requestId: string, charged: number, remaining: number | undefined, extra: Record<string, string> = {}) {
  return {
    ...CORS,
    'X-Request-Id': requestId,
    'Cache-Control': 'no-store',
    ...(remaining != null ? { 'X-Credits-Charged': String(charged), 'X-Credits-Remaining': String(remaining) } : {}),
    ...extra,
  }
}

export async function handleApiRequest(request: Request, path: string[]) {
  const started = Date.now()
  const requestId = newId('req')
  const method = request.method.toUpperCase()
  if (method === 'OPTIONS') return new NextResponse(null, { status: 204, headers: CORS })
  const route = '/' + path.filter(Boolean).join('/')
  const origin = getBaseUrl(request)
  if (route === '/' && method === 'GET') {
    return NextResponse.json({ object: 'api', name: 'Batkle API', version: 'v1', endpoints: ['POST /v1/posts'], docs: `${origin}/developers` }, { headers: headersFor(requestId, 0, undefined) })
  }

  const endpoint = route === '/posts' ? `${method} /v1/posts` : `${method} /v1${route}`.slice(0, 120)
  let db: any = null, key: any = null, credits: ReturnType<typeof creditCharge> | null = null
  const meta: Record<string, unknown> = {}
  let status = 500, failure: string | undefined
  let result: { bytes: Buffer; contentType: string; filename: string; images: number } | null = null
  let errorBody: any = null, errorHeaders: Record<string, string> = {}

  try {
    const raw = readApiKey(request.headers.get('authorization'))
    if (!raw) {
      throw apiError(401, 'authentication_error', request.headers.get('authorization')
        ? 'That is not a Batkle API key. Keys start with "bk_live_".'
        : 'Send your API key in the Authorization header: "Authorization: Bearer bk_live_…". Create a key in the developer dashboard.')
    }
    db = await connectToMongo()
    key = await authenticateKey(db, raw)
    if (!key) throw apiError(401, 'authentication_error', 'This API key is not valid, or it was revoked.')
    if (route !== '/posts') throw apiError(404, 'not_found', `There is no ${method} /v1${route} endpoint. The API has one endpoint, POST /v1/posts; see ${origin}/developers.`)
    if (method !== 'POST') throw apiError(405, 'invalid_request', `/v1/posts takes POST, with the post as JSON.`, { headers: { Allow: 'POST' } })
    await checkRateLimit(db, `key:${key.id}`, RATE_LIMITS.perKey)

    const doc = readPostDocument(parseBody(await request.text()))
    Object.assign(meta, { carousel: doc.carousel, images: doc.slides.length, size: `${doc.width}×${doc.height}` })
    credits = creditCharge(db, key.ownerId)
    await credits.take(imageCost(doc.slides.length))
    result = await renderDocument(db, doc, origin)
    status = 200
  } catch (error: any) {
    // A failed request costs nothing.
    if (credits?.charged) await credits.refundAll().catch(e => console.error('[api] refund failed:', e?.message))
    status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500
    // The API's own errors are written for developers; anything else is made plain (see publicMessage).
    const message = error?.api ? error.message : publicMessage(error?.message, status)
    if (!error?.api || status >= 500) console.error(`[api] ${endpoint} ${status}:`, error?.message)
    failure = message
    errorBody = { error: { type: error?.type || errorType(status), message, request_id: requestId, ...(error?.needed != null ? { needed: error.needed, balance: error.balance } : {}) } }
    errorHeaders = { ...(error?.headers || {}) }
  }

  const charged = credits?.charged || 0
  let remaining: number | undefined
  if (key && db) {
    remaining = (await developerAccount(db, key.ownerId).catch(() => null))?.balance
    await recordUsage(db, {
      requestId, ownerId: key.ownerId, keyId: key.id, method, endpoint, status, credits: charged, durationMs: Date.now() - started,
      ...(Object.keys(meta).length ? { meta } : {}), ...(failure ? { error: failure.slice(0, 300) } : {}),
    })
  }

  if (!result) return NextResponse.json(errorBody, { status, headers: headersFor(requestId, charged, remaining, errorHeaders) })
  return new Response(streamed(result.bytes), {
    status: 200,
    headers: headersFor(requestId, charged, remaining, {
      'Content-Type': result.contentType,
      'Content-Disposition': `${result.contentType === 'image/png' ? 'inline' : 'attachment'}; filename="${result.filename}"`,
      'X-Images': String(result.images),
    }),
  })
}
