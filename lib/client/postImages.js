// Photos the user attaches to a post idea, from the browser side.
import { DIRECT_MAX_BYTES, FALLBACK_MAX_BYTES, readAsDataUrl, uploadFile } from './directUpload'

export const MAX_POST_IMAGES = 4
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIDE = 2048

/** Images among dropped or pasted files. */
export function imageFiles(list) {
  return Array.from(list || []).filter(file => file && file.type?.startsWith('image/'))
}

/**
 * Only for servers without direct uploads, and only for a photo too large to fit inside a request (the host refuses
 * requests over 4.5 MB): scales it down to 2048 px and re-encodes it (PNGs stay PNG, the rest become JPEG). This loses
 * quality, which is why it is a last resort: every other photo is stored exactly as chosen.
 */
async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88)
}

/** The fallback's data URL: the original when it fits inside a request, a smaller copy only when it cannot. */
export async function fallbackPhoto(file) {
  return file.size <= FALLBACK_MAX_BYTES ? readAsDataUrl(file) : shrinkPhoto(file)
}

/**
 * Uploads one photo, unchanged; the server reads it and returns the stored asset with its description. Errors keep
 * their billing code (apiError), so a full plan can offer an upgrade.
 */
export async function uploadPostImage(file, brandId) {
  if (!ACCEPTED_TYPES.includes(file.type)) throw new Error(`${file.name}: use a JPEG, PNG or WebP photo`)
  if (file.size > DIRECT_MAX_BYTES) throw new Error(`${file.name} is too large (max 25 MB)`)
  return uploadFile('/api/post-images', file, { purpose: 'post-image', fields: { filename: file.name, brand_id: brandId }, fallback: fallbackPhoto })
}

/** Deletes a photo that was removed before any post used it. Best effort. */
export function discardPostImage(id, brandId) {
  return fetch(`/api/post-images/${encodeURIComponent(id)}?brand_id=${encodeURIComponent(brandId)}`, { method: 'DELETE' }).catch(() => {})
}
