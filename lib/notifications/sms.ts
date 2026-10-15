/**
 * Text messages and phone verification through Twilio's REST API, with no SDK: form-encoded HTTPS calls with Basic
 * auth (TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN).
 * - Texts go out from TWILIO_MESSAGING_SERVICE_SID (preferred: it handles STOP replies with Advanced Opt-Out) or
 *   from TWILIO_FROM_NUMBER.
 * - Phone numbers are checked with a code through Twilio Verify (TWILIO_VERIFY_SERVICE_SID).
 * Without those keys smsConfigured() / verifyConfigured() are false and the calls refuse.
 *
 * The phone helpers at the top import nothing and run in the browser too (onboarding and settings use them).
 */

type Env = Record<string, string | undefined>
type Fetch = (url: string, init?: any) => Promise<any>
interface TwilioOptions { env?: Env; fetch?: Fetch }

// ─── Phone numbers (browser-safe) ────────────────────────────────────────────

/** Countries offered in the phone number pickers, with their calling codes. Any other country: type the + code. */
export const CALLING_CODES: { country: string; name: string; code: string }[] = [
  ['AO', 'Angola', '244'], ['AR', 'Argentina', '54'], ['AU', 'Australia', '61'], ['AT', 'Austria', '43'],
  ['BE', 'Belgium', '32'], ['BR', 'Brazil', '55'], ['CA', 'Canada', '1'], ['CV', 'Cape Verde', '238'],
  ['CL', 'Chile', '56'], ['CO', 'Colombia', '57'], ['CZ', 'Czechia', '420'], ['DK', 'Denmark', '45'],
  ['FI', 'Finland', '358'], ['FR', 'France', '33'], ['DE', 'Germany', '49'], ['GR', 'Greece', '30'],
  ['HK', 'Hong Kong', '852'], ['HU', 'Hungary', '36'], ['IN', 'India', '91'], ['ID', 'Indonesia', '62'],
  ['IE', 'Ireland', '353'], ['IL', 'Israel', '972'], ['IT', 'Italy', '39'], ['JP', 'Japan', '81'],
  ['KE', 'Kenya', '254'], ['LU', 'Luxembourg', '352'], ['MY', 'Malaysia', '60'], ['MX', 'Mexico', '52'],
  ['MZ', 'Mozambique', '258'], ['NL', 'Netherlands', '31'], ['NZ', 'New Zealand', '64'], ['NG', 'Nigeria', '234'],
  ['NO', 'Norway', '47'], ['PE', 'Peru', '51'], ['PH', 'Philippines', '63'], ['PL', 'Poland', '48'],
  ['PT', 'Portugal', '351'], ['RO', 'Romania', '40'], ['SA', 'Saudi Arabia', '966'], ['SG', 'Singapore', '65'],
  ['ZA', 'South Africa', '27'], ['KR', 'South Korea', '82'], ['ES', 'Spain', '34'], ['SE', 'Sweden', '46'],
  ['CH', 'Switzerland', '41'], ['TR', 'Türkiye', '90'], ['AE', 'United Arab Emirates', '971'],
  ['GB', 'United Kingdom', '44'], ['US', 'United States', '1'],
].map(([country, name, code]) => ({ country, name, code }))

/** The calling code ("351") for a country ("PT") or a code given as "+351" / "351"; '' when unknown. */
export function callingCode(country: unknown): string {
  const value = typeof country === 'string' ? country.trim() : ''
  if (/^[a-z]{2}$/i.test(value)) return CALLING_CODES.find(c => c.country === value.toUpperCase())?.code || ''
  const digits = value.replace(/^\+/, '')
  return /^[1-9]\d{0,3}$/.test(digits) ? digits : ''
}

/**
 * A phone number in E.164 ("+351912345678"), or null when it isn't one. Spaces, dashes, dots and brackets are
 * dropped; anything else makes it invalid. A number without "+" (or "00") takes `defaultCountry`'s calling code,
 * without the leading 0 national prefix most countries use ("07700 900123" in GB is +447700900123). E.164 allows
 * 8 to 15 digits after the "+"; nothing looser is accepted.
 */
export function toE164(input: unknown, defaultCountry?: string): string | null {
  if (typeof input !== 'string') return null
  let value = input.trim().replace(/[\s\-.()[\]]/g, '')
  if (!value) return null
  if (value.startsWith('00')) value = `+${value.slice(2)}`
  if (!value.startsWith('+')) {
    const code = callingCode(defaultCountry)
    if (!code || !/^\d+$/.test(value)) return null
    // Italy keeps its leading 0 after the country code.
    value = `+${code}${code === '39' ? value : value.replace(/^0/, '')}`
  }
  return /^\+[1-9]\d{7,14}$/.test(value) ? value : null
}

/** A number with all but its last 3 digits hidden: "+•••••••••678". */
export function maskPhone(number: unknown): string {
  const digits = typeof number === 'string' ? number.replace(/\D/g, '') : ''
  if (digits.length < 4) return ''
  return `+${'•'.repeat(digits.length - 3)}${digits.slice(-3)}`
}

// ─── Configuration ───────────────────────────────────────────────────────────

const value = (env: Env, key: string) => env[key]?.trim() || ''

/** Texts can be sent: the account keys and a Messaging Service or a sending number. */
export function smsConfigured(env: Env = process.env): boolean {
  return Boolean(value(env, 'TWILIO_ACCOUNT_SID') && value(env, 'TWILIO_AUTH_TOKEN') && (value(env, 'TWILIO_MESSAGING_SERVICE_SID') || value(env, 'TWILIO_FROM_NUMBER')))
}

/** Phone numbers can be checked with a code: the account keys and a Verify service. */
export function verifyConfigured(env: Env = process.env): boolean {
  return Boolean(value(env, 'TWILIO_ACCOUNT_SID') && value(env, 'TWILIO_AUTH_TOKEN') && value(env, 'TWILIO_VERIFY_SERVICE_SID'))
}

// ─── Twilio calls ────────────────────────────────────────────────────────────

/** Twilio's error code for a person who replied STOP: nothing more may be texted to them. */
export const OPTED_OUT = 21610

/**
 * One form-encoded POST to Twilio. A failed call throws with Twilio's numeric error code as `error.code` (when it
 * sent one) and its HTTP status as `error.twilioStatus`; the message names Twilio, so publicMessage hides it.
 */
async function twilioPost(url: string, params: Record<string, string>, { env = process.env, fetch: fetcher = fetch as any }: TwilioOptions) {
  const sid = value(env, 'TWILIO_ACCOUNT_SID'), token = value(env, 'TWILIO_AUTH_TOKEN')
  if (!sid || !token) throw Object.assign(new Error('Text messages are not set up: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required.'), { status: 503 })
  const res = await fetcher(url, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) {
    const code = Number(data?.code) || undefined
    throw Object.assign(new Error(`Twilio: HTTP ${res.status}${code ? ` (error ${code})` : ''}`), { status: 502, code, twilioStatus: res.status })
  }
  return data
}

/** Sends a text and returns its Twilio message SID. Throws with Twilio's error code on `error.code` (21610: STOP). */
export async function sendSms(to: string, body: string, options: TwilioOptions = {}): Promise<string> {
  const env = options.env || process.env
  const service = value(env, 'TWILIO_MESSAGING_SERVICE_SID'), from = value(env, 'TWILIO_FROM_NUMBER')
  if (!smsConfigured(env)) throw Object.assign(new Error('Text messages are not set up: TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER is required.'), { status: 503 })
  if (!toE164(to)) throw Object.assign(new Error('That phone number is not valid.'), { status: 400 })
  const sender: Record<string, string> = service ? { MessagingServiceSid: service } : { From: from }
  const data = await twilioPost(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(value(env, 'TWILIO_ACCOUNT_SID'))}/Messages.json`, { To: to, Body: body, ...sender }, options)
  return String(data?.sid || '')
}

function verifyUrl(env: Env, path: string) {
  const service = value(env, 'TWILIO_VERIFY_SERVICE_SID')
  if (!verifyConfigured(env)) throw Object.assign(new Error('Phone verification is not set up: TWILIO_VERIFY_SERVICE_SID is required.'), { status: 503 })
  return `https://verify.twilio.com/v2/Services/${encodeURIComponent(service)}/${path}`
}

/** Texts a verification code to `to`. */
export async function startVerification(to: string, options: TwilioOptions = {}): Promise<{ status: string }> {
  const env = options.env || process.env
  if (!toE164(to)) throw Object.assign(new Error('That phone number is not valid.'), { status: 400 })
  const data = await twilioPost(verifyUrl(env, 'Verifications'), { To: to, Channel: 'sms' }, options)
  return { status: String(data?.status || '') }
}

/** Whether `code` is the one sent to `to`. A wrong code is `approved: false`; an expired one throws (code 20404). */
export async function checkVerification(to: string, code: string, options: TwilioOptions = {}): Promise<{ approved: boolean }> {
  const env = options.env || process.env
  if (!toE164(to)) throw Object.assign(new Error('That phone number is not valid.'), { status: 400 })
  const data = await twilioPost(verifyUrl(env, 'VerificationCheck'), { To: to, Code: code }, options)
  return { approved: data?.status === 'approved' }
}

/**
 * Words for people for the Twilio errors they can do something about, with the status to answer with; null for
 * the rest (those become a plain "something went wrong").
 */
export function smsErrorMessage(error: any): { status: number; message: string } | null {
  switch (Number(error?.code)) {
    case 60200: case 21211: case 21217:
      return { status: 400, message: 'That phone number doesn’t look right. Check it and try again.' }
    case 21614: case 60205:
      return { status: 400, message: 'That number can’t get texts. Use a mobile number.' }
    case 21408: case 60410: case 60605: case 21612:
      return { status: 400, message: 'Batkle can’t send texts to that number yet.' }
    case 60203:
      return { status: 429, message: 'Too many codes were sent to this number. Wait a few minutes and try again.' }
    case 60202:
      return { status: 429, message: 'Too many wrong codes. Send a new code and try again.' }
    case 20404:
      return { status: 400, message: 'That code has expired. Send a new one.' }
    case OPTED_OUT:
      return { status: 400, message: 'This number replied STOP to Batkle’s texts. Reply START to one of them to get texts again.' }
    default:
      return null
  }
}
