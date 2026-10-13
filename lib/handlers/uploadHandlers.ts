/**
 * Upload/Image handlers for API routes
 */

import { NextResponse } from 'next/server'
import { Binary } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import { corsify, getBaseUrl } from '@/lib/services/middleware'
import { MAX_IMAGE_SIZE } from '@/lib/services/constants'
import { compactImage } from '@/lib/services/imageStorage'
import { loadUpload } from '@/lib/services/uploadCache'

export async function handleUploadImage(db: any, body: any, request: Request) {
  const dataUrl = body.data
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    return corsify(NextResponse.json({ error: 'data must be a data: URL string' }, { status: 400 }))
  }

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return corsify(NextResponse.json({ error: 'Invalid data URL' }, { status: 400 }))

  const contentType = match[1]
  const buf = Buffer.from(match[2], 'base64')

  if (buf.length > MAX_IMAGE_SIZE) {
    return corsify(NextResponse.json({ error: 'Image too large (max 6MB)' }, { status: 413 }))
  }

  const uploadId = uuidv4()
  const stored = await compactImage(buf, contentType)
  await db.collection('uploads').insertOne({
    id: uploadId,
    contentType: stored.contentType,
    bytes: new Binary(stored.bytes),
    createdAt: new Date(),
  })

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
 * Serves an upload. Uploads never change after they are written, so browsers keep them for a year, a revalidation
 * is answered with 304 without touching MongoDB, and recently served images come from memory.
 * The ETag is weak: a stored image may be re-encoded losslessly, which keeps it pixel-identical.
 */
export async function handleGetUpload(db: any, id: string, request?: Request) {
  const etag = `W/"${id}"`
  const cacheHeaders = { 'Cache-Control': 'public, max-age=31536000, immutable', ETag: etag, 'Access-Control-Allow-Origin': '*' }
  const conditional = request?.headers.get('if-none-match')
  if (conditional && conditional.split(',').some(tag => tag.trim() === etag || tag.trim() === '*')) {
    return new NextResponse(null, { status: 304, headers: cacheHeaders })
  }

  const upload = await loadUpload(db, id)
  if (!upload) return corsify(NextResponse.json({ error: 'Not found' }, { status: 404 }))

  return new NextResponse(upload.bytes, {
    status: 200,
    headers: { 'Content-Type': upload.contentType, ...cacheHeaders },
  })
}
