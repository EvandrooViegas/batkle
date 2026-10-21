import { AwsClient } from 'aws4fetch'

/**
 * Image bytes in Cloudflare R2, through its S3-compatible API. Requests are signed with an R2 API token
 * (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET); without all four, r2Configured() is false and
 * images stay in MongoDB. The bucket stays private: people see images through /api/uploads and /api/rendered.
 */

export interface StoredObject { bytes: Buffer; contentType: string }
type Fetch = (url: string, init: RequestInit) => Promise<Response>

const options: { fetch: Fetch | null; timeoutMs: number } = { fetch: null, timeoutMs: 15_000 }

/** For tests: replaces fetch and the time each attempt may take. */
export function configureObjectStore(next: { fetch?: Fetch | null; timeoutMs?: number }) {
  Object.assign(options, next)
}

function settings() {
  const read = (name: string) => process.env[name]?.trim() || ''
  const config = { accountId: read('R2_ACCOUNT_ID'), accessKeyId: read('R2_ACCESS_KEY_ID'), secretAccessKey: read('R2_SECRET_ACCESS_KEY'), bucket: read('R2_BUCKET') }
  return config.accountId && config.accessKeyId && config.secretAccessKey && config.bucket ? config : null
}

/** True when all four R2 settings are present. */
export function r2Configured(): boolean {
  return Boolean(settings())
}

let signer: { keyId: string; secret: string; client: AwsClient } | null = null
function client(config: NonNullable<ReturnType<typeof settings>>) {
  if (signer?.keyId !== config.accessKeyId || signer.secret !== config.secretAccessKey) {
    // Retries are ours (below), so aws4fetch only signs.
    signer = { keyId: config.accessKeyId, secret: config.secretAccessKey, client: new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: 's3', region: 'auto', retries: 0 }) }
  }
  return signer.client
}

function storageError(action: string, key: string, reason: string) {
  return Object.assign(new Error(`Image storage could not ${action} ${key}: ${reason}`), { status: 503, storage: true })
}

/** The error for an answer R2 refused, with R2's own error code (from its XML body) for the log. */
async function refused(response: Response, action: string, key: string) {
  const text = await response.text().catch(() => '')
  const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1]
  return storageError(action, key, `HTTP ${response.status}${code ? ` ${code}` : ''}`)
}

const drain = (response: Response) => response.body?.cancel().catch(() => {})
const objectUrl = (config: NonNullable<ReturnType<typeof settings>>, key: string) =>
  `https://${config.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(config.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`

/**
 * One signed request for `key`, answered by `handle`. A network error, a timeout or a 5xx answer is tried once more
 * (every call here is idempotent); anything else R2 refuses fails straight away.
 */
async function send<T>(method: string, key: string, action: string, init: { body?: Buffer; contentType?: string }, handle: (response: Response) => Promise<T>): Promise<T> {
  const config = settings()
  if (!config) throw storageError(action, key, 'R2 is not configured')
  const url = objectUrl(config, key)
  for (let attempt = 1; ; attempt++) {
    let reason = ''
    try {
      const signed = await client(config).sign(url, { method, body: init.body, headers: init.contentType ? { 'Content-Type': init.contentType } : {} })
      // Sent as the URL, the signed headers and the bytes themselves, never as the signed Request: Next.js's fetch
      // reads a Request's body back as a stream, which loses its length, and R2 refuses an upload without one
      // (411 MissingContentLength).
      const response = await (options.fetch || fetch)(signed.url, {
        method,
        headers: signed.headers,
        body: init.body ? new Uint8Array(init.body) : undefined,
        signal: AbortSignal.timeout(options.timeoutMs),
        // Next.js would otherwise cache these GETs like page data.
        cache: 'no-store',
      })
      if (response.status < 500 || attempt === 2) return await handle(response)
      reason = `HTTP ${response.status}`
      await drain(response)
    } catch (error: any) {
      if (error?.storage) throw error
      reason = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? `timed out after ${options.timeoutMs} ms` : error?.cause?.code || error?.message || String(error)
      if (attempt === 2) throw storageError(action, key, reason)
    }
    console.warn(`[object-store] ${method} ${key}: ${reason}; trying once more`)
  }
}

/** Stores `bytes` at `key`, replacing what was there. */
export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  await send('PUT', key, 'save', { body: bytes, contentType }, async response => {
    if (!response.ok) throw await refused(response, 'save', key)
    await drain(response)
  })
}

/** The object at `key`, or null when there is none. */
export async function getObject(key: string): Promise<StoredObject | null> {
  return send('GET', key, 'read', {}, async response => {
    if (response.status === 404) { await drain(response); return null }
    if (!response.ok) throw await refused(response, 'read', key)
    // Read inside the attempt, so a connection lost mid-image is tried again too.
    const bytes = Buffer.from(await response.arrayBuffer())
    return { bytes, contentType: response.headers.get('content-type') || 'application/octet-stream' }
  })
}

/** The size and type of the object at `key`, without its bytes, or null when there is none. */
export async function headObject(key: string): Promise<{ size: number; contentType: string } | null> {
  return send('HEAD', key, 'check', {}, async response => {
    if (response.status === 404) return null
    if (!response.ok) throw storageError('check', key, `HTTP ${response.status}`)
    return { size: Number(response.headers.get('content-length') || 0), contentType: response.headers.get('content-type') || '' }
  })
}

/**
 * A URL the browser can PUT one file to at `key`, for `seconds`, without any key of ours. The signature covers the
 * Content-Type, so the browser must send exactly `headers` with it.
 */
export async function presignPut(key: string, contentType: string, seconds = 600): Promise<{ url: string; headers: Record<string, string> }> {
  const config = settings()
  if (!config) throw storageError('sign', key, 'R2 is not configured')
  const headers = { 'Content-Type': contentType }
  // allHeaders signs Content-Type too, which aws4fetch would otherwise leave out.
  const signed = await client(config).sign(`${objectUrl(config, key)}?X-Amz-Expires=${seconds}`, { method: 'PUT', headers, aws: { signQuery: true, allHeaders: true } })
  return { url: signed.url, headers }
}

/** Deletes the object at `key`; deleting one that is already gone is fine. */
export async function deleteObject(key: string): Promise<void> {
  await send('DELETE', key, 'delete', {}, async response => {
    if (!response.ok && response.status !== 404) throw await refused(response, 'delete', key)
    await drain(response)
  })
}
