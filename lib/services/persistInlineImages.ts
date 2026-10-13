import { createHash } from 'node:crypto'
import { Binary } from 'mongodb'
import { compactImage } from './imageStorage'

/** Keep image bytes out of flow/canvas BSON documents, including legacy retries. */
export async function persistInlineImages<T>(db: any, value: T): Promise<T> {
  const uploads = new Map<string, string>()
  async function visit(item: any): Promise<any> {
    if (typeof item === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(item)) {
      const known = uploads.get(item)
      if (known) return known
      const comma = item.indexOf(',')
      const encoded = item.slice(comma + 1)
      if (encoded.length > 12 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid or oversized inline image')
      const bytes = Buffer.from(encoded, 'base64')
      const contentType = item.slice(5, item.indexOf(';')).toLowerCase()
      // The id is the original content's hash, so the same image always maps to one upload however it is stored.
      const id = 'image-' + createHash('sha256').update(contentType).update(bytes).digest('hex')
      if (!await db.collection('uploads').findOne({ id }, { projection: { _id: 1 } })) {
        const stored = await compactImage(bytes, contentType)
        await db.collection('uploads').updateOne({ id }, { $setOnInsert: {
          id, contentType: stored.contentType, bytes: new Binary(stored.bytes), createdAt: new Date(),
        } }, { upsert: true })
      }
      const url = `/api/uploads/${id}`
      uploads.set(item, url)
      return url
    }
    if (Array.isArray(item)) {
      const result = []
      for (const child of item) result.push(await visit(child))
      return result
    }
    if (item && Object.getPrototypeOf(item) === Object.prototype) {
      const entries = []
      for (const [key, child] of Object.entries(item)) entries.push([key, await visit(child)])
      return Object.fromEntries(entries)
    }
    return item
  }
  return visit(value)
}
