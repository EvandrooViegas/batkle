import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { corsify } from '@/lib/services/middleware'
import { parseDataUrl, storeImageBytes, newAssetId, releaseUploads } from './assetHandlers'
import { describePostImage, POST_IMAGE_SOURCE } from '@/lib/services/postImages'
import { requireUploadRoom } from '@/lib/billing/account'
import { DIRECT_UPLOAD_MAX_BYTES, withDirectUpload } from '@/lib/services/uploadStore'

const TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024
const MIN_SIDE = 300

const error = (message: string, status: number) => corsify(NextResponse.json({ error: message }, { status }))

/**
 * A photo the user attaches to a post idea. It is stored with the brand, read by the vision model so the planner
 * knows what it shows, and kept out of automatic gallery matching: it is used only by the post it is attached to.
 * It is one of the person's own images, so it counts against their plan (402 limit_reached when there is no room).
 * The photo is stored exactly as sent: it comes inside the request as a data URL, or was uploaded to R2 first
 * (`upload`, from POST /api/uploads/sign).
 */
export async function handleUploadPostImage(db: any, body: any, userId?: string | null) {
  if (body?.upload !== undefined) {
    return withDirectUpload(db, { id: body.upload, ownerId: userId, purpose: 'post-image', brandId: body.brand_id }, image => storePostImage(db, body, userId, image.bytes, image.contentType, DIRECT_UPLOAD_MAX_BYTES))
  }
  const { data } = body || {}
  if (typeof data !== 'string' || !data.startsWith('data:')) return error('data must be a base64 data URL', 400)
  const parsed = parseDataUrl(data)
  if (!parsed) return error('Invalid data URL', 400)
  return storePostImage(db, body, userId, parsed.buf, parsed.mime_type, MAX_BYTES)
}

/** The post photo pipeline, however the photo arrived. */
async function storePostImage(db: any, body: any, userId: string | null | undefined, buf: Buffer, mime_type: string, maxBytes: number) {
  const { filename, brand_id } = body || {}
  if (typeof brand_id !== 'string' || !/^brand_[\w-]+$/.test(brand_id)) return error('brand_id is required', 400)
  if (!(await db.collection('flows').findOne({ id: brand_id.slice('brand_'.length) }, { projection: { _id: 1 } }))) return error('Brand not found', 404)
  if (!TYPES.includes(mime_type)) return error('Use a JPEG, PNG or WebP photo.', 415)
  if (buf.length > maxBytes) return error(`Photo too large (max ${Math.round(maxBytes / 1024 / 1024)} MB).`, 413)

  let width = 0, height = 0
  try {
    const meta = await sharp(buf).metadata()
    // EXIF-rotated phone photos report their sides swapped.
    const turned = (meta.orientation || 1) >= 5
    width = (turned ? meta.height : meta.width) ?? 0
    height = (turned ? meta.width : meta.height) ?? 0
  } catch {
    return error('This file could not be read as an image.', 400)
  }
  if (Math.min(width, height) < MIN_SIDE) return error(`Photo too small: use at least ${MIN_SIDE} px on each side.`, 400)

  // Outside any try: a billing error reaches the route, which answers 402 with its code.
  if (userId) await requireUploadRoom(db, userId, buf.length)
  // Relative URLs keep the photo working on any host or port (renderers read /api/uploads/ straight from storage).
  const { url, thumbnail_url, mime_type: storedType } = await storeImageBytes(db, buf, mime_type, '', userId)
  const now = new Date()
  const asset: any = {
    id: newAssetId(), brand_id, url, thumbnail_url,
    filename: typeof filename === 'string' && filename.trim() ? filename.trim().slice(0, 200) : 'photo',
    mime_type: storedType, width, height, orientation: width > height ? 'landscape' : height > width ? 'portrait' : 'square',
    source: POST_IMAGE_SOURCE, status: 'ready', tags: [], embedding: [],
    description: '', search_description: '', description_tags: [],
    usage_count: 0, last_used_at: null, created_at: now, updated_at: now,
  }
  // Read the photo now, so the planner can put it on the slide it belongs to.
  try {
    const seen = await describePostImage(buf)
    Object.assign(asset, { description: seen.description, search_description: seen.description, description_tags: seen.tags, tags: seen.tags })
  } catch (e: any) {
    console.warn('[post-image] description failed:', e?.message || e)
    asset.description_error = e?.status === 429 ? 'Batkle was too busy to read this photo just now' : 'Batkle could not read this photo'
  }
  await db.collection('assets').insertOne(asset)
  const { _id, embedding, ...rest } = asset
  return corsify(NextResponse.json(rest))
}

/**
 * Removes a photo the user detached before it was used by a post, and gives its space back (see releaseUploads).
 * Photos already used by a post are kept.
 */
export async function handleDeletePostImage(db: any, id: string, brandId: string | null) {
  if (!brandId) return error('brand_id is required', 400)
  const filter = { id, brand_id: brandId, source: POST_IMAGE_SOURCE, reserved_for: { $exists: false } }
  const asset = await db.collection('assets').findOne(filter, { projection: { _id: 0, url: 1, thumbnail_url: 1 } })
  const result = await db.collection('assets').deleteOne(filter)
  if (result.deletedCount === 1) await releaseUploads(db, asset)
  return corsify(NextResponse.json({ deleted: result.deletedCount === 1 }))
}
