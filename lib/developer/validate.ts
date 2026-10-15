/** Checks on what API callers send. Pure functions, so they are tested without a server. */

// Vercel refuses request bodies over 4.5 MB, so the API stops a little below that, with a clear error.
export const MAX_BODY_BYTES = 4 * 1024 * 1024

/** An API error: an HTTP status, a stable `type` for code to branch on, and a message for people. */
export function apiError(status: number, type: string, message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { status, type, api: true, ...extra })
}

/** The error type for a status, for errors that did not set one. */
export function errorType(status: number): string {
  if (status === 401) return 'authentication_error'
  if (status === 402) return 'insufficient_credits'
  if (status === 403) return 'permission_error'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  if (status === 503) return 'unavailable'
  if (status >= 400 && status < 500) return 'invalid_request'
  return 'server_error'
}

/** Parses a JSON object body of at most MAX_BODY_BYTES. */
export function parseBody(text: string): Record<string, any> {
  if (Buffer.byteLength(text || '') > MAX_BODY_BYTES) throw apiError(413, 'invalid_request', `The request body is larger than ${MAX_BODY_BYTES / 1024 / 1024} MB. Send large images as URLs instead of data URLs.`)
  if (!text?.trim()) throw apiError(400, 'invalid_request', 'The request body is empty. Send the post as JSON.')
  let body: any
  try { body = JSON.parse(text) } catch { throw apiError(400, 'invalid_request', 'The request body is not valid JSON.') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw apiError(400, 'invalid_request', 'The request body must be a JSON object.')
  return body
}

// Hosts on the server's own network, by name or literal address. The addresses a name resolves to are checked
// separately when the image is downloaded (lib/developer/render.ts).
const PRIVATE_HOST = /^(localhost|.+\.localhost|.+\.local|.+\.internal|metadata\.google\.internal|0\.0\.0\.0|127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|169\.254(\.\d{1,3}){2}|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])(\.\d{1,3}){2}|\[[0-9a-f:.]*\])$/i

/** Whether a URL is one the renderer may download: http(s) on a public host, without credentials. */
export function publicHttpUrl(value: string): boolean {
  let url: URL
  try { url = new URL(value) } catch { return false }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  return !PRIVATE_HOST.test(url.hostname)
}

/** A time zone the database can group by; UTC when it is missing or unknown. */
export function readTimeZone(value: string | null): string {
  if (!value || value.length > 64 || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(value)) return 'UTC'
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return value } catch { return 'UTC' }
}
