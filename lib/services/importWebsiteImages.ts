import sharp from 'sharp'
import { Binary } from 'mongodb'
import { createHash } from 'node:crypto'
import { fetchWebsiteResource } from './websiteFetch'
import { compactImage } from './imageStorage'

/** Store original pixels and source context; no generated images or per-image AI calls. */
export async function importWebsiteImages(db: any, brandId: string, images: any[], baseUrl: string) {
  const result = { imported: 0, existing: 0, skipped: 0, warnings: [] as string[] }
  for (const image of images.slice(0, 12)) {
    try {
      const sourceId = createHash('sha256').update(brandId + ':' + image.url).digest('hex').slice(0, 24)
      if (await db.collection('assets').findOne({ id: `website_${sourceId}`, brand_id: brandId })) { result.existing++; continue }
      const resource = await fetchWebsiteResource(image.url, 'image')
      const meta = await sharp(resource.bytes, { limitInputPixels: 40_000_000 }).metadata()
      if (!meta.width || !meta.height || meta.width < 320 || meta.height < 200 || !['jpeg', 'png', 'webp', 'avif'].includes(meta.format || '')) { result.skipped++; continue }
      const hash = createHash('sha256').update(resource.bytes).digest('hex')
      if (await db.collection('assets').findOne({ brand_id: brandId, content_hash: hash })) { result.existing++; continue }
      const thumbnail = await sharp(resource.bytes).rotate().resize(400, 400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()
      const now = new Date(), originalId = `website_${sourceId}_original`, thumbId = `website_${sourceId}_thumb`
      const stored = await compactImage(resource.bytes, resource.contentType)
      await db.collection('uploads').updateOne({ id: originalId }, { $setOnInsert: { id: originalId, contentType: stored.contentType, bytes: new Binary(stored.bytes), createdAt: now } }, { upsert: true })
      await db.collection('uploads').updateOne({ id: thumbId }, { $setOnInsert: { id: thumbId, contentType: 'image/jpeg', bytes: new Binary(thumbnail), createdAt: now } }, { upsert: true })
      const filename = decodeURIComponent(new URL(image.url).pathname.split('/').pop() || 'website-photo')
      const asset = {
        id: `website_${sourceId}`, brand_id: brandId, source: 'website', source_url: image.url, source_page: image.sourcePage,
        content_hash: hash, filename, url: `${baseUrl}/api/uploads/${originalId}`, thumbnail_url: `${baseUrl}/api/uploads/${thumbId}`,
        mime_type: stored.contentType, width: meta.width, height: meta.height, orientation: meta.width === meta.height ? 'square' : meta.width > meta.height ? 'landscape' : 'portrait',
        description: image.description, search_description: image.search_description, description_tags: image.description_tags,
        tags: image.description_tags, description_source: 'website_context', status: 'ready', usage_count: 0, last_used_at: null, created_at: now, updated_at: now,
      }
      await db.collection('assets').updateOne({ id: asset.id, brand_id: brandId }, { $setOnInsert: asset }, { upsert: true })
      result.imported++
    } catch { result.skipped++; result.warnings.push(`Could not import ${image.alt || image.url}`) }
  }
  return result
}
