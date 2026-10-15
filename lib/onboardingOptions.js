// Account onboarding (/onboarding) asks for the name and, optionally, a mobile number for text reminders; both are
// stored on the account in `users`. The number is saved unverified: nothing is texted to it until it is verified
// in Settings.

import { CALLING_CODES, toE164 } from './notifications/sms'

export const NAME_MAX = 80
/** Longest phone number input kept (spaces and dashes included). */
export const PHONE_INPUT_MAX = 32

const country = value => (typeof value === 'string' && CALLING_CODES.some(c => c.country === value.toUpperCase()) ? value.toUpperCase() : '')

/** The country whose calling code a phone field starts on: the browser's language region ("pt-PT" is PT), else US. */
export function defaultPhoneCountry(languages = []) {
  for (const tag of languages || []) {
    const region = String(tag).split(/[-_]/)[1]
    if (region && country(region)) return country(region)
  }
  return 'US'
}

/** The optional phone answer as E.164 (`phone: null` when left empty), or `{ error }` when it isn't a number. */
export function parsePhoneAnswer(phone, phoneCountry) {
  const raw = typeof phone === 'string' ? phone.trim() : ''
  if (!raw) return { phone: null }
  const number = raw.length <= PHONE_INPUT_MAX ? toE164(raw, country(phoneCountry)) : null
  return number ? { phone: number } : { error: 'That doesn’t look like a mobile number. Check it, or leave it empty.' }
}

/** Answers typed but not yet submitted, kept so someone who leaves finds them filled in. */
export function parseOnboardingDraft(body) {
  const { name, phone, phoneCountry } = body?.answers || {}
  const answers = { name: typeof name === 'string' ? name.slice(0, NAME_MAX) : '' }
  if (typeof phone === 'string' && phone.trim()) answers.phone = phone.slice(0, PHONE_INPUT_MAX)
  if (country(phoneCountry)) answers.phoneCountry = country(phoneCountry)
  return { step: 'about', answers }
}

/** The validated name and optional phone number, or `{ error, field }` naming what to fix. */
export function parseOnboarding(body) {
  const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : ''
  if (!name) return { error: 'Tell us your name.', field: 'name' }
  if (name.length > NAME_MAX) return { error: `Use at most ${NAME_MAX} characters for your name.`, field: 'name' }
  const phone = parsePhoneAnswer(body?.phone, body?.phoneCountry)
  if (phone.error) return { error: phone.error, field: 'phone' }
  return phone.phone ? { name, phone: phone.phone } : { name }
}
