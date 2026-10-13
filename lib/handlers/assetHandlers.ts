/**
 * Asset handlers — upload, local AI analysis, list, delete.
 */

import { NextResponse } from 'next/server'
import { Binary } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import sharp from 'sharp'
import { corsify, getBaseUrl } from '@/lib/services/middleware'
import { analyseImageBuffer } from '@/lib/services/visionAnalysis'
import { indexAssetDescription } from '@/lib/services/assetDescription'
import { compactImage } from '@/lib/services/imageStorage'

// ─── thumbnail ────────────────────────────────────────────────────────────────

async function makeThumbnail(buf: Buffer): Promise<Buffer> {
  return sharp(buf)
    .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer()
}

function calcOrientation(w: number, h: number): string {
  if (w > h) return 'landscape'
  if (h > w) return 'portrait'
  return 'square'
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

/** Saves an image (compacted) and a 400 px JPEG thumbnail; returns their URLs and the stored type. */
export async function storeImageBytes(db: any, buf: Buffer, mime_type: string, baseUrl: string) {
  const uploadId = uuidv4()
  const thumbId  = uuidv4()
  const now      = new Date()
  const stored   = await compactImage(buf, mime_type)
  await db.collection('uploads').insertOne({ id: uploadId, contentType: stored.contentType, bytes: new Binary(stored.bytes), createdAt: now })
  await db.collection('uploads').insertOne({ id: thumbId, contentType: 'image/jpeg', bytes: new Binary(await makeThumbnail(buf)), createdAt: now })
  return { url: `${baseUrl}/api/uploads/${uploadId}`, thumbnail_url: `${baseUrl}/api/uploads/${thumbId}`, mime_type: stored.contentType }
}

export function newAssetId() {
  return `asset_${uuidv4().replace(/-/g, '').slice(0, 16)}`
}

// ─── route handlers ───────────────────────────────────────────────────────────

export async function handleUploadAsset(db: any, body: any, request: Request) {
  const { data, filename, brand_id } = body

  if (!data || typeof data !== 'string' || !data.startsWith('data:')) {
    return corsify(NextResponse.json({ error: 'data must be a base64 data URL' }, { status: 400 }))
  }
  if (!brand_id) {
    return corsify(NextResponse.json({ error: 'brand_id is required' }, { status: 400 }))
  }
  if (body.description != null && (typeof body.description !== 'string' || body.description.length > 2000)) {
    return corsify(NextResponse.json({ error: 'Description must be text with at most 2000 characters' }, { status: 400 }))
  }

  const parsed = parseDataUrl(data)
  if (!parsed) {
    return corsify(NextResponse.json({ error: 'Invalid data URL' }, { status: 400 }))
  }
  const { mime_type, buf } = parsed

  if (buf.length > 10 * 1024 * 1024) {
    return corsify(NextResponse.json({ error: 'Image too large (max 10MB)' }, { status: 413 }))
  }

  let width = 0, height = 0
  try {
    const meta = await sharp(buf).metadata()
    width  = meta.width  ?? 0
    height = meta.height ?? 0
  } catch {
    return corsify(NextResponse.json({ error: 'Could not read image metadata' }, { status: 400 }))
  }

  const descriptionData=await indexAssetDescription(body.description??'')
  const assetId     = newAssetId()
  const orientation = calcOrientation(width, height)
  const now         = new Date()
  const { url, thumbnail_url, mime_type: storedType } = await storeImageBytes(db, buf, mime_type, getBaseUrl(request))

  const assetDoc: any = {
    id: assetId,
    ...descriptionData,
    brand_id,
    url,
    thumbnail_url,
    filename:    filename || 'image',
    mime_type:   storedType,
    width,
    height,
    orientation,
    tags:        [],
    embedding:   [],
    status:      'processing',
    usage_count: 0,
    last_used_at: null,
    created_at:  now,
    updated_at:  now,
  }

  await db.collection('assets').insertOne(assetDoc)

  // Async analysis — does not block the HTTP response
  ;(async () => {
    try {
      const analysis = await analyseImageBuffer(buf, mime_type)

      console.log('\n========== ASSET PROCESSED ==========')
      console.log(JSON.stringify({
        id:          assetId,
        filename:    filename || 'image',
        mime_type,
        width,
        height,
        orientation,
        tags:        analysis.tags,
      }, null, 2))
      console.log('======================================\n')

      await db.collection('assets').updateOne(
        { id: assetId },
        { $set: { tags: analysis.tags, status: 'ready', updated_at: new Date() } },
      )
    } catch (err: any) {
      console.error('[asset] Analysis failed:', err?.message ?? err)
      await db.collection('assets').updateOne(
        { id: assetId },
        { $set: { status: 'failed', updated_at: new Date() } },
      )
    }
  })()

  const { _id, ...rest } = assetDoc
  return corsify(NextResponse.json(rest))
}

export async function handleListAssets(db: any, brand_id: string) {
  if (!brand_id) {
    return corsify(NextResponse.json({ error: 'brand_id is required' }, { status: 400 }))
  }
  const list = await db.collection('assets')
    .find({ brand_id })
    .sort({ created_at: -1 })
    .limit(500)
    .toArray()
  return corsify(NextResponse.json(list.map(({ _id, ...rest }: any) => rest)))
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
  const data = await indexAssetDescription(body.description)
  await db.collection('assets').updateOne(filter, { $set: { ...data, updated_at: new Date() } })
  const { _id, ...updated } = await db.collection('assets').findOne(filter)
  return corsify(NextResponse.json(updated))
}

export async function handleDeleteAsset(db: any, id: string) {
  await db.collection('assets').deleteOne({ id })
  return corsify(NextResponse.json({ success: true }))
}
