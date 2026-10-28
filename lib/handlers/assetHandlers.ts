/**
 * The brand gallery — its saved AI cutouts: list, read, describe, delete. Nothing is uploaded to the gallery; people add
 * their own photos to a post in Posts & stories (postImageHandler.ts, which uses the storage helpers here).
 */

import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import sharp from 'sharp'
import { corsify } from '@/lib/services/middleware'
import { indexAssetDescription } from '@/lib/services/assetDescription'
import { compactImage } from '@/lib/services/imageStorage'
import { saveUpload } from '@/lib/services/uploadStore'
import { isGalleryCutout } from '@/lib/services/generatedAssetLibrary'

// ─── thumbnail ────────────────────────────────────────────────────────────────

async function makeThumbnail(buf: Buffer): Promise<Buffer> {
  // rotate() turns a phone photo upright: the thumbnail is a new image and keeps no EXIF orientation of its own.
  return sharp(buf)
    .rotate()
    .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer()
}

/** Splits a base64 data URL without regex (regex on multi-MB strings blows the call stack). */
export function parseDataUrl(data: string): { mime_type: string; buf: Buffer } | null {
  const commaIdx     = data.indexOf(',')
  const headerPart   = commaIdx !== -1 ? data.slice(0, commaIdx) : ''
  const base64Part   = commaIdx !== -1 ? data.slice(commaIdx + 1) : ''
  const colonIdx     = headerPart.indexOf(':')
  const semicolonIdx = headerPart.indexOf(';')
  const mime_type = (colonIdx !== -1 && semicolonIdx !== -1) ? headerPart.slice(colonIdx + 1, semicolonIdx) : ''
  if (!mime_type || !base64Part) return null
  return { mime_type, buf: Buffer.from(base64Part, 'base64') }
}

/**
 * Saves an image (compacted) and a 400 px JPEG thumbnail; returns their URLs and the stored type. With an owner, both
 * are recorded as theirs, and the image as one of the person's own (`userUpload: true`).
 */
export async function storeImageBytes(db: any, buf: Buffer, mime_type: string, baseUrl: string, ownerId?: string | null) {
  const uploadId = uuidv4()
  const thumbId  = uuidv4()
  const now      = new Date()
  const stored   = await compactImage(buf, mime_type)
  await saveUpload(db, { id: uploadId, bytes: stored.bytes, contentType: stored.contentType, ...(ownerId ? { ownerId, userUpload: true } : {}), createdAt: now })
  await saveUpload(db, { id: thumbId, bytes: await makeThumbnail(buf), contentType: 'image/jpeg', ...(ownerId ? { ownerId, userUpload: false } : {}), createdAt: now })
  return { url: `${baseUrl}/api/uploads/${uploadId}`, thumbnail_url: `${baseUrl}/api/uploads/${thumbId}`, mime_type: stored.contentType }
}

/**
 * Marks a deleted image's uploads as no longer in use: `userUpload: false` and `removedAt`. The bytes are kept, because
 * posts made with the image link to it directly and would lose it otherwise. Only the person's own uploads (those with
 * an owner) change: AI images and cutouts belong to nobody.
 */
export async function releaseUploads(db: any, asset: { url?: unknown; thumbnail_url?: unknown } | null) {
  const ids = [asset?.url, asset?.thumbnail_url].map(url => typeof url === 'string' ? url.match(/\/api\/uploads\/([^/?#]+)/)?.[1] : undefined).filter(Boolean)
  if (!ids.length) return
  await db.collection('uploads').updateMany({ id: { $in: ids }, ownerId: { $exists: true } }, { $set: { userUpload: false, removedAt: new Date() } })
}

export function newAssetId() {
  return `asset_${uuidv4().replace(/-/g, '').slice(0, 16)}`
}

// ─── route handlers ───────────────────────────────────────────────────────────

/** The brand's gallery: its good AI cutouts (isGalleryCutout), newest first. */
export async function handleListAssets(db: any, brand_id: string) {
  if (!brand_id) {
    return corsify(NextResponse.json({ error: 'brand_id is required' }, { status: 400 }))
  }
  const list = await db.collection('assets')
    .find({ brand_id, source: 'ai_generated' })
    .sort({ created_at: -1 })
    .limit(500)
    .toArray()
  return corsify(NextResponse.json(list.filter(isGalleryCutout).map(({ _id, ...rest }: any) => rest)))
}

export async function handleGetAsset(db: any, id: string) {
  const asset = await db.collection('assets').findOne({ id })
  if (!asset) return corsify(NextResponse.json({ error: 'Not found' }, { status: 404 }))
  const { _id, ...rest } = asset
  return corsify(NextResponse.json(rest))
}

export async function handleUpdateAsset(db: any, id: string, body: any) {
  if (typeof body?.brand_id !== 'string' || !body.brand_id || typeof body.description !== 'string' || body.description.length > 2000) {
    return corsify(NextResponse.json({ error: 'brand_id and a description of at most 2000 characters are required' }, { status: 400 }))
  }
  const filter = { id, brand_id: body.brand_id }
  const asset = await db.collection('assets').findOne(filter)
  if (!asset) return corsify(NextResponse.json({ error: 'Image not found' }, { status: 404 }))
  if (body.description.trim() === asset.description && (asset.search_description || !asset.description)) {
    const { _id, ...unchanged } = asset
    return corsify(NextResponse.json(unchanged))
  }
  const data: any = await indexAssetDescription(body.description)
  // A cutout is matched to new slides by its subject (in English), so the owner's words become that subject.
  if (asset.source === 'ai_generated' && data.description) data.subject_description = data.search_description || data.description
  await db.collection('assets').updateOne(filter, { $set: { ...data, updated_at: new Date() } })
  const { _id, ...updated } = await db.collection('assets').findOne(filter)
  return corsify(NextResponse.json(updated))
}

export async function handleDeleteAsset(db: any, id: string) {
  const asset = await db.collection('assets').findOne({ id }, { projection: { _id: 0, url: 1, thumbnail_url: 1 } })
  const result = await db.collection('assets').deleteOne({ id })
  if (result?.deletedCount) await releaseUploads(db, asset)
  return corsify(NextResponse.json({ success: true }))
}
