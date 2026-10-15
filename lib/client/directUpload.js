// Image uploads from the browser. When the server offers it, the file goes straight to storage (a presigned PUT), so
// the host's 4.5 MB limit on requests never applies and the file is stored exactly as chosen. Otherwise it travels
// as a data URL inside the request, as before.
import { apiError } from './billing'

/** The largest image Batkle takes straight from the browser. */
export const DIRECT_MAX_BYTES = 25 * 1024 * 1024
/**
 * The largest file sent inside the request: base64 makes it a third larger, so 3 MB becomes a request of about
 * 4 MB, under the host's 4.5 MB cap.
 */
export const FALLBACK_MAX_BYTES = 3 * 1024 * 1024

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const megabytes = bytes => `${Math.round(bytes / 1024 / 1024)} MB`

/** Reads a file as a data URL. */
export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error(`${file.name} could not be read`))
    reader.readAsDataURL(file)
  })
}

/** The fallback's data URL: the file unchanged, when it fits inside a request. */
async function sameFile(file) {
  if (file.size > FALLBACK_MAX_BYTES) throw new Error(`${file.name} is larger than ${megabytes(FALLBACK_MAX_BYTES)}. Use a smaller image.`)
  return readAsDataUrl(file)
}

/**
 * Uploads `file` and posts it to `endpoint` (/api/assets, /api/post-images or /api/uploads) with `fields`; returns
 * the endpoint's JSON. With direct uploads: POST /api/uploads/sign, PUT the file to the URL it gives, then
 * `{ upload: id, ...fields }`. When the server answers 404 `{ direct: false }`: `{ data, ...fields }`, where `fallback`
 * turns the file into the data URL to send. Failed requests throw apiError, which keeps billing codes for the page.
 */
export async function uploadFile(endpoint, file, { purpose, fields = {}, fallback = sameFile, fetch: request = (...args) => fetch(...args) } = {}) {
  if (file.size > DIRECT_MAX_BYTES) throw new Error(`${file.name} is larger than ${megabytes(DIRECT_MAX_BYTES)}. Use a smaller image.`)
  const signed = await request('/api/uploads/sign', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ contentType: file.type, size: file.size, purpose, ...(fields.brand_id ? { brand_id: fields.brand_id } : {}) }),
  })
  const ticket = await signed.json().catch(() => ({}))
  let body
  if (signed.ok && ticket.id && ticket.url) {
    let put
    try {
      put = await request(ticket.url, { method: 'PUT', headers: ticket.headers || { 'Content-Type': file.type }, body: file })
    } catch {
      put = null
    }
    if (!put?.ok) throw new Error(`${file.name} could not be uploaded. Please check your connection and try again.`)
    body = { ...fields, upload: ticket.id }
  } else if (signed.status === 404 && ticket.direct === false) {
    body = { ...fields, data: await fallback(file) }
  } else {
    throw apiError(ticket, signed.status, `${file.name} could not be uploaded. Please try again.`)
  }
  const res = await request(endpoint, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) })
  const result = await res.json().catch(() => ({}))
  if (!res.ok) throw apiError(result, res.status, res.status === 413 ? `${file.name} is too large. Use a smaller image.` : `${file.name} could not be uploaded. Please try again.`)
  return result
}
