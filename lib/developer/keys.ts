import { createHash, randomBytes, randomUUID } from 'node:crypto'

/**
 * API keys: "bk_live_" and 32 letters and digits. Only the SHA-256 hash is stored, so a key is shown once, when it
 * is created; the dashboard identifies it by its start and last four characters.
 */
export const KEY_PREFIX = 'bk_live_'
const SECRET_LENGTH = 32
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function newApiKey() {
  // Bytes from 248 up are skipped, so every character is equally likely (248 is 4 × 62).
  let secret = ''
  while (secret.length < SECRET_LENGTH) {
    for (const byte of randomBytes(48)) if (byte < 248 && secret.length < SECRET_LENGTH) secret += ALPHABET[byte % 62]
  }
  const key = KEY_PREFIX + secret
  return { key, hash: hashApiKey(key), start: key.slice(0, KEY_PREFIX.length + 4), last4: key.slice(-4) }
}

/** The Batkle key in an "Authorization: Bearer …" header, or null when there is none. */
export function readApiKey(header: string | null | undefined): string | null {
  const key = /^Bearer\s+(\S+)\s*$/i.exec(header || '')?.[1] || ''
  const secret = key.slice(KEY_PREFIX.length)
  return key.startsWith(KEY_PREFIX) && secret.length === SECRET_LENGTH && /^[0-9A-Za-z]+$/.test(secret) ? key : null
}

/** How the dashboard shows a key: its start and last four characters. */
export function maskedKey(record: { start?: string; last4?: string }): string {
  return `${record.start || KEY_PREFIX}…${record.last4 || ''}`
}

/** A short random id with a type prefix, such as key_3f9c… or req_81ad…. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`
}
