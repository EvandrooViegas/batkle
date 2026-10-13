/**
 * In-memory cache of uploaded image bytes, least recently used out first. Uploads are written once (ids are random
 * or content hashes), so a cached copy never goes stale; repeated renders, previews and editor loads stop
 * re-reading MongoDB.
 */
export interface CachedUpload { bytes: Buffer; contentType: string }

const MAX_TOTAL = 96 * 1024 * 1024
const MAX_ENTRY = 8 * 1024 * 1024

// One cache per server process, kept across hot reloads in development.
const key = Symbol.for('kand.upload-cache.v1')
const state: { entries: Map<string, CachedUpload>; total: number } =
  (globalThis as any)[key] || ((globalThis as any)[key] = { entries: new Map(), total: 0 })

export function cachedUpload(id: string): CachedUpload | undefined {
  const hit = state.entries.get(id)
  if (!hit) return undefined
  // Re-insert so iteration order tracks recency.
  state.entries.delete(id)
  state.entries.set(id, hit)
  return hit
}

export function rememberUpload(id: string, upload: CachedUpload) {
  if (upload.bytes.length > MAX_ENTRY) return
  const previous = state.entries.get(id)
  if (previous) { state.total -= previous.bytes.length; state.entries.delete(id) }
  state.entries.set(id, upload)
  state.total += upload.bytes.length
  for (const [oldest, entry] of state.entries) {
    if (state.total <= MAX_TOTAL) break
    state.entries.delete(oldest)
    state.total -= entry.bytes.length
  }
}

const toBuffer = (bytes: any): Buffer =>
  Buffer.isBuffer(bytes) ? bytes : typeof bytes?.value === 'function' ? Buffer.from(bytes.value()) : Buffer.from(bytes?.buffer ?? bytes)

/** An upload's bytes and type from memory, else from MongoDB (reading only those two fields). Null when missing. */
export async function loadUpload(db: any, id: string): Promise<CachedUpload | null> {
  const hit = cachedUpload(id)
  if (hit) return hit
  const doc = await db.collection('uploads').findOne({ id }, { projection: { _id: 0, bytes: 1, contentType: 1 } })
  if (!doc?.bytes) return null
  const upload = { bytes: toBuffer(doc.bytes), contentType: doc.contentType || 'image/png' }
  rememberUpload(id, upload)
  return upload
}

/** For tests: drops everything. */
export function clearUploadCache() {
  state.entries.clear()
  state.total = 0
}
