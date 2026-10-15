import { randomUUID } from 'node:crypto'
import { Binary } from 'mongodb'
import sharp from 'sharp'
import { deleteObject, getObject, headObject, presignPut, putObject, r2Configured } from './objectStore'
import { forgetUpload, storedBytes } from './uploadCache'

/**
 * The one place image bytes are written. With R2 set up, the bytes go to the bucket (uploads/<id>,
 * renders/<id>.png|zip) and MongoDB keeps a small record with their key; without it, the record holds the bytes, as
 * before. Images keep their address either way (/api/uploads/<id>, /api/rendered/<id>), and posts store those
 * addresses, so where the bytes live never shows.
 *
 * Every upload record has `size` (stored bytes). The person's own images also have `ownerId` and `userUpload: true`,
 * which is what their plan's uploads allowance counts (uploadUsage in lib/billing/account.ts).
 */

export interface NewUpload {
  id: string
  bytes: Buffer
  contentType: string
  /** The account the image belongs to. */
  ownerId?: string | null
  /** True for the person's own images, which count against their plan. */
  userUpload?: boolean
  purpose?: string
  [field: string]: unknown
}

export interface NewRender {
  id: string
  png?: Buffer
  zip?: Buffer
  [field: string]: unknown
}

export const uploadKey = (id: string) => `uploads/${id}`
export const renderKey = (id: string, kind: 'png' | 'zip') => `renders/${id}.${kind}`

const present = (fields: Record<string, unknown>) => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null))

/**
 * Saves an image as upload `id`. With `ifAbsent`, an upload that already exists is kept as it is (for ids that are
 * content hashes: the same image is stored once however often it is saved).
 */
export async function saveUpload(db: any, upload: NewUpload, { ifAbsent = false }: { ifAbsent?: boolean } = {}) {
  const { id, bytes, contentType, ...fields } = upload
  const uploads = db.collection('uploads')
  const record: Record<string, unknown> = { id, contentType, size: bytes.length, ...present(fields) }
  if (!record.createdAt) record.createdAt = new Date()
  if (r2Configured()) {
    // An image that is already stored needs no second upload to R2.
    if (ifAbsent && await uploads.findOne({ id }, { projection: { _id: 1 } })) return { id, size: bytes.length, stored: false }
    await putObject(uploadKey(id), bytes, contentType)
    Object.assign(record, { storage: 'r2', key: uploadKey(id) })
  } else {
    Object.assign(record, { bytes: new Binary(bytes), storage: 'mongo' })
  }
  if (ifAbsent) await uploads.updateOne({ id }, { $setOnInsert: record }, { upsert: true })
  else await uploads.insertOne(record)
  return { id, size: bytes.length, stored: true }
}

/** Deletes an upload's record and its bytes. False when there was none. */
export async function deleteUpload(db: any, id: string): Promise<boolean> {
  const doc = await db.collection('uploads').findOne({ id }, { projection: { _id: 0, key: 1 } })
  if (!doc) return false
  if (doc.key) await deleteObject(doc.key)
  await db.collection('uploads').deleteOne({ id })
  forgetUpload(id)
  return true
}

/** Saves a render: a single post's PNG, or a carousel's ZIP of slides, with the rest of its record. */
export async function saveRender(db: any, render: NewRender) {
  const { id, png, zip, ...fields } = render
  const kind = zip ? 'zip' : 'png'
  const bytes = zip || png
  if (!bytes) throw new Error('A render needs its PNG or ZIP bytes')
  const record: Record<string, unknown> = { id, ...fields, size: bytes.length }
  if (r2Configured()) {
    await putObject(renderKey(id, kind), bytes, kind === 'zip' ? 'application/zip' : 'image/png')
    Object.assign(record, { storage: 'r2', key: renderKey(id, kind) })
  } else {
    Object.assign(record, { [kind]: new Binary(bytes), storage: 'mongo' })
  }
  await db.collection('renders').insertOne(record)
  return { id, size: bytes.length }
}

/** A render's bytes, wherever they are stored, or null when it is missing. */
export async function loadRender(db: any, id: string): Promise<{ bytes: Buffer; contentType: string; kind: 'png' | 'zip' } | null> {
  const doc = await db.collection('renders').findOne({ id }, { projection: { _id: 0, png: 1, zip: 1, key: 1 } })
  if (!doc) return null
  const kind = doc.zip || (!doc.png && /\.zip$/.test(doc.key || '')) ? 'zip' : 'png'
  const contentType = kind === 'zip' ? 'application/zip' : 'image/png'
  const inline = kind === 'zip' ? doc.zip : doc.png
  if (inline) return { bytes: storedBytes(inline), contentType, kind }
  if (!doc.key) return null
  const object = await getObject(doc.key)
  return object ? { bytes: object.bytes, contentType, kind } : null
}

/** Deletes a render's record and its bytes. */
export async function deleteRender(db: any, id: string) {
  const doc = await db.collection('renders').findOne({ id }, { projection: { _id: 0, key: 1 } })
  if (doc?.key) await deleteObject(doc.key)
  await db.collection('renders').deleteOne({ id })
}

// ─── Direct uploads: browser → R2, past the host's 4.5 MB limit on requests ─────────────────────────────────────

export type UploadPurpose = 'gallery' | 'post-image' | 'editor'
export const UPLOAD_PURPOSES: UploadPurpose[] = ['gallery', 'post-image', 'editor']
/** The largest image the browser may send straight to R2. */
export const DIRECT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024
/** Image types each kind of upload takes. Post photos are photographs only. */
export const DIRECT_UPLOAD_TYPES: Record<UploadPurpose, string[]> = {
  gallery: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
  editor: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
  'post-image': ['image/jpeg', 'image/png', 'image/webp'],
}
const SIGNED_SECONDS = 10 * 60
// A little longer than the signed URL, so a PUT that finishes at the last second can still be used.
const PENDING_MS = 30 * 60 * 1000
export const incomingKey = (id: string) => `incoming/${id}`

const uploadFailure = (status: number, message: string) => Object.assign(new Error(message), { status })

let pendingIndexes: Promise<unknown> | null = null
function ensurePendingIndexes(db: any) {
  // MongoDB removes expired records itself; R2's lifecycle rule removes their incoming/ objects after a day.
  pendingIndexes ||= Promise.all([
    db.collection('pendingUploads').createIndex({ id: 1 }, { unique: true }),
    db.collection('pendingUploads').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]).catch(error => { pendingIndexes = null; console.warn('[uploads] could not create pending upload indexes:', error?.message) })
  return pendingIndexes
}

/**
 * Starts a direct upload: records who may use it, for what and until when, and answers a presigned PUT for
 * incoming/<id>. The caller has already checked the type, the size and the plan's room.
 */
export async function createPendingUpload(db: any, pending: { ownerId: string; purpose: UploadPurpose; brand_id?: string | null; contentType: string; size: number }) {
  await ensurePendingIndexes(db)
  const id = randomUUID(), now = new Date()
  const signed = await presignPut(incomingKey(id), pending.contentType, SIGNED_SECONDS)
  await db.collection('pendingUploads').insertOne({ id, ownerId: pending.ownerId, purpose: pending.purpose, brand_id: pending.brand_id || null, contentType: pending.contentType, size: pending.size, createdAt: now, expiresAt: new Date(now.getTime() + PENDING_MS) })
  return { id, url: signed.url, headers: signed.headers }
}

/** Removes a direct upload's incoming object and record, used or not. */
export async function discardPendingUpload(db: any, id: string) {
  await deleteObject(incomingKey(id)).catch(error => console.warn('[uploads] could not delete', incomingKey(id), error?.message))
  await db.collection('pendingUploads').deleteOne({ id })
}

// What sharp reads the bytes as, as the type they are stored with: the browser's word is not taken for it.
const IMAGE_FORMATS: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }
async function imageType(bytes: Buffer): Promise<string | null> {
  try {
    const meta = await sharp(bytes, { limitInputPixels: false }).metadata()
    if (!meta.width || !meta.height) return null
    if (meta.format === 'heif') return meta.compression === 'av1' ? 'image/avif' : null
    return IMAGE_FORMATS[meta.format || ''] || null
  } catch {
    return null
  }
}

/**
 * Hands the image a direct upload delivered to `use`, the same pipeline as an image sent inside the request, then
 * removes the incoming object and the record, whether `use` succeeded or not. The record must be the caller's (any
 * other reads as missing, and is left alone), unexpired and made for this purpose and brand; the object must exist,
 * fit the 25 MB cap (checked before it is read) and really be an image.
 */
export async function withDirectUpload<T>(db: any, claim: { id: unknown; ownerId?: string | null; purpose: UploadPurpose; brandId?: string | null }, use: (image: { bytes: Buffer; contentType: string }) => Promise<T>): Promise<T> {
  const id = typeof claim.id === 'string' ? claim.id : ''
  const pending = id && claim.ownerId ? await db.collection('pendingUploads').findOne({ id }, { projection: { _id: 0 } }) : null
  if (!pending || pending.ownerId !== claim.ownerId) throw uploadFailure(404, 'This upload was not found. Please choose the image again.')
  try {
    if (new Date(pending.expiresAt).getTime() <= Date.now()) throw uploadFailure(410, 'This upload took too long. Please choose the image again.')
    if (pending.purpose !== claim.purpose || (pending.brand_id && pending.brand_id !== claim.brandId)) throw uploadFailure(400, 'This upload was started for something else. Please choose the image again.')
    const head = await headObject(incomingKey(id))
    if (!head) throw uploadFailure(400, 'The image did not arrive. Please try again.')
    if (head.size > DIRECT_UPLOAD_MAX_BYTES) throw uploadFailure(413, 'Image too large (max 25 MB).')
    const object = await getObject(incomingKey(id))
    if (!object) throw uploadFailure(400, 'The image did not arrive. Please try again.')
    if (object.bytes.length > DIRECT_UPLOAD_MAX_BYTES) throw uploadFailure(413, 'Image too large (max 25 MB).')
    const contentType = await imageType(object.bytes)
    if (!contentType) throw uploadFailure(415, 'This file is not an image Batkle can use. Use a JPEG, PNG, WebP, GIF or AVIF image.')
    return await use({ bytes: object.bytes, contentType })
  } finally {
    await discardPendingUpload(db, id)
  }
}
