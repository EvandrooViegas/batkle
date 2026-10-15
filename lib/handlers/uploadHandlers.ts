/**
 * Upload/Image handlers for API routes
 */

import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { corsify, getBaseUrl } from '@/lib/services/middleware'
import { MAX_IMAGE_SIZE } from '@/lib/services/constants'
import { compactImage } from '@/lib/services/imageStorage'
import { loadUpload } from '@/lib/services/uploadCache'
import { DIRECT_UPLOAD_MAX_BYTES, DIRECT_UPLOAD_TYPES, UPLOAD_PURPOSES, createPendingUpload, saveUpload, withDirectUpload } from '@/lib/services/uploadStore'
import { r2Configured } from '@/lib/services/objectStore'
import { requireUploadRoom } from '@/lib/billing/account'

const failure = (message: string, status: number) => corsify(NextResponse.json({ error: message }, { status }))

/**
 * Starts an upload that goes from the browser straight to R2, so images are not limited by the host's 4.5 MB cap on
 * requests: checks the type, the size (up to 25 MB) and the plan's room, and answers `{ id, url, headers }`, a PUT
 * valid for 10 minutes. The browser then sends `{ upload: id }` to the usual endpoint. Without R2 it answers 404
 * `{ direct: false }`, and the browser sends the image inside the request as before.
 */
export async function handleSignUpload(db: any, body: any, userId?: string | null) {
  if (!r2Configured()) return corsify(NextResponse.json({ direct: false }, { status: 404 }))
  if (!userId) return failure('Sign in to continue.', 401)
  const { contentType, size, purpose, brand_id } = body || {}
  if (!UPLOAD_PURPOSES.includes(purpose)) return failure(`purpose must be one of ${UPLOAD_PURPOSES.join(', ')}`, 400)
  if (!DIRECT_UPLOAD_TYPES[purpose as keyof typeof DIRECT_UPLOAD_TYPES].includes(contentType)) {
    return failure(purpose === 'post-image' ? 'Use a JPEG, PNG or WebP photo.' : 'Use a JPEG, PNG, WebP, GIF or AVIF image.', 415)
  }
  if (!Number.isInteger(size) || size < 1) return failure('size must be the file size in bytes', 400)
  if (size > DIRECT_UPLOAD_MAX_BYTES) return failure('Image too large (max 25 MB).', 413)
  if (purpose !== 'editor' && (typeof brand_id !== 'string' || !brand_id)) return failure('brand_id is required', 400)
  // A full allowance refuses here, before anything is sent; the route answers 402 with the billing code.
  await requireUploadRoom(db, userId, size)
  return corsify(NextResponse.json(await createPendingUpload(db, { ownerId: userId, purpose, brand_id: purpose === 'editor' ? null : brand_id, contentType, size })))
}

/**
 * An image added in the editor, sent inside the request as a data URL or uploaded to R2 first (`upload`, from
 * handleSignUpload). With a signed-in person it is one of their own images and counts against their plan (a full
 * allowance answers 402 limit_reached); without one (internal callers) it belongs to nobody.
 */
export async function handleUploadImage(db: any, body: any, request: Request, userId?: string | null) {
  if (body?.upload !== undefined) {
    return withDirectUpload(db, { id: body.upload, ownerId: userId, purpose: 'editor' }, image => storeEditorImage(db, request, userId, image.bytes, image.contentType, DIRECT_UPLOAD_MAX_BYTES))
  }
  const dataUrl = body.data
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    return failure('data must be a data: URL string', 400)
  }

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return failure('Invalid data URL', 400)
  return storeEditorImage(db, request, userId, Buffer.from(match[2], 'base64'), match[1], MAX_IMAGE_SIZE)
}

async function storeEditorImage(db: any, request: Request, userId: string | null | undefined, buf: Buffer, contentType: string, maxBytes: number) {
  // Uploads are served from Batkle's own address, so only images may be stored there.
  if (!/^image\/[\w.+-]+$/i.test(contentType)) return failure('Choose an image file.', 415)
  if (buf.length > maxBytes) return failure(`Image too large (max ${Math.round(maxBytes / 1024 / 1024)}MB)`, 413)

  // Billing errors pass through to the route, which answers them with their status and code.
  if (userId) await requireUploadRoom(db, userId, buf.length)
  const uploadId = uuidv4()
  const stored = await compactImage(buf, contentType)
  await saveUpload(db, { id: uploadId, bytes: stored.bytes, contentType: stored.contentType, ...(userId ? { ownerId: userId, userUpload: true } : {}) })

  const baseUrl = getBaseUrl(request)
  return corsify(
    NextResponse.json({
      id: uploadId,
      url: `${baseUrl}/api/uploads/${uploadId}`,
      relativeUrl: `/api/uploads/${uploadId}`,
    })
  )
}

/**
 * Serves an upload. Uploads never change after they are written, so browsers and Vercel's CDN keep them for a year
 * (s-maxage is the CDN's copy, which keeps most views from reaching this function or storage), a revalidation is
 * answered with 304 without touching storage, and recently served images come from memory.
 * The ETag is weak: a stored image may be re-encoded losslessly, which keeps it pixel-identical.
 */
export async function handleGetUpload(db: any, id: string, request?: Request) {
  const etag = `W/"${id}"`
  const cacheHeaders = { 'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable', ETag: etag, 'Access-Control-Allow-Origin': '*' }
  const conditional = request?.headers.get('if-none-match')
  if (conditional && conditional.split(',').some(tag => tag.trim() === etag || tag.trim() === '*')) {
    return new NextResponse(null, { status: 304, headers: cacheHeaders })
  }

  let upload
  try {
    upload = await loadUpload(db, id)
  } catch (error: any) {
    // Not cached anywhere, so the next view tries storage again.
    console.error('[uploads] could not read', id, error?.message || error)
    return failure('This image could not be loaded right now. Please try again.', 503)
  }
  if (!upload) return failure('Not found', 404)

  return new NextResponse(upload.bytes, {
    status: 200,
    // Opened on its own, an uploaded SVG must not run scripts on Batkle's address.
    headers: { 'Content-Type': upload.contentType, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox', ...cacheHeaders },
  })
}
