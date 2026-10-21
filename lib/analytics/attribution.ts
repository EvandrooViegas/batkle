/**
 * Campaign attribution: where a visitor came from (UTM tags on the link, or the site that sent them), kept in a
 * first-party cookie and saved on their account when they finish onboarding, so the admin dashboard can tell which
 * campaign brought each signup, trial and paying customer.
 *
 * The cookie holds `first` (the first visit) and `last` (the latest visit that came from a campaign or another site;
 * a direct visit never replaces it). No personal data: only the campaign tags, the sending site's host and the page.
 *
 * Shared by the browser (the tracker) and the server, so it imports nothing.
 */

export const ATTRIBUTION_COOKIE = 'bk_attr'
export const VISITOR_COOKIE = 'bk_vid'
export const UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term'] as const

export interface Touch {
  source: string; medium: string; campaign: string; content: string; term: string
  /** The sending site's host, without www; empty for a direct visit or one from Batkle itself. */
  referrer: string
  /** The page the visit landed on. */
  landing: string
  channel: string
  at: string
}
export interface Attribution { first: Touch; last: Touch }

const clean = (value: unknown, max = 120) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '')
const lower = (value: unknown) => clean(value).toLowerCase()

const SOCIAL = /(^|\.)(facebook|fb|instagram|ig|meta|messenger|whatsapp|tiktok|linkedin|lnkd|twitter|t\.co|x|threads|pinterest|youtube|reddit|snapchat)(\.|$)/
const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave|qwant|baidu|yandex)(\.|$)/
const PAID = /^(cpc|ppc|cpm|paid|paid[-_ ]?social|paidsocial|paid[-_ ]?search|ads?|display|sponsored)$/

/** The marketing channel a visit belongs to, from its tags first and its sending site second. */
export function channelOf(touch: Pick<Touch, 'source' | 'medium' | 'referrer'>): string {
  const source = lower(touch.source), medium = lower(touch.medium), referrer = lower(touch.referrer)
  if (PAID.test(medium)) return SOCIAL.test(source) ? 'Paid social' : SEARCH.test(source) ? 'Paid search' : 'Paid other'
  if (/^(e-?mail|newsletter)$/.test(medium) || /newsletter|mailchimp|resend/.test(source)) return 'Email'
  if (source) return SOCIAL.test(source) || /^social/.test(medium) ? 'Organic social' : medium === 'referral' ? 'Referral' : 'Campaign'
  if (referrer) return SEARCH.test(referrer) ? 'Search' : SOCIAL.test(referrer) ? 'Organic social' : 'Referral'
  return 'Direct'
}

/** The sending site's host, unless it is this site (moving between Batkle pages is not a new source). */
export function referrerHost(referrer: string, ownHost = ''): string {
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '').toLowerCase()
    return host && host !== ownHost.replace(/^www\./, '').toLowerCase() ? host.slice(0, 120) : ''
  } catch { return '' }
}

/** One visit, read from the page's query string (utm_*), the referrer and the path. */
export function readTouch(search: string, referrer: string, path: string, ownHost = '', now = new Date()): Touch {
  const params = new URLSearchParams(search || '')
  const tags = Object.fromEntries(UTM_KEYS.map(k => [k, clean(params.get(`utm_${k}`))])) as Record<typeof UTM_KEYS[number], string>
  // Meta and Google mark ad clicks with their own IDs even without UTM tags.
  if (!tags.source && params.get('fbclid')) Object.assign(tags, { source: 'facebook', medium: tags.medium || 'paid-social' })
  if (!tags.source && params.get('gclid')) Object.assign(tags, { source: 'google', medium: tags.medium || 'cpc' })
  const touch = { ...tags, referrer: referrerHost(referrer, ownHost), landing: clean(path, 200) || '/', channel: '', at: now.toISOString() }
  touch.channel = channelOf(touch)
  return touch
}

/** A visit that names where it came from; a direct one never replaces the last campaign. */
export const isAttributed = (touch: Touch) => touch.channel !== 'Direct'

/** The cookie after this visit: the first visit stays, the last attributed one moves. */
export function nextAttribution(previous: Attribution | null, touch: Touch): Attribution {
  if (!previous) return { first: touch, last: touch }
  return { first: previous.first, last: isAttributed(touch) ? touch : previous.last }
}

export const encodeAttribution = (attribution: Attribution) => encodeURIComponent(JSON.stringify(attribution))

function readTouchObject(value: any): Touch | null {
  if (!value || typeof value !== 'object') return null
  const touch: any = Object.fromEntries(UTM_KEYS.map(k => [k, clean(value[k])]))
  touch.referrer = clean(value.referrer); touch.landing = clean(value.landing, 200) || '/'; touch.at = clean(value.at, 40)
  touch.channel = channelOf(touch)
  return touch
}

/** The cookie's value read back, or null when it is missing or not ours. */
export function decodeAttribution(value: unknown): Attribution | null {
  if (typeof value !== 'string' || !value || value.length > 4000) return null
  try {
    const parsed = JSON.parse(decodeURIComponent(value))
    const first = readTouchObject(parsed?.first), last = readTouchObject(parsed?.last)
    return first ? { first, last: last || first } : null
  } catch { return null }
}

/** A cookie's value from a Cookie header. */
export function cookieValue(header: string | null | undefined, name: string): string {
  for (const part of String(header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return ''
}

/** The label a campaign is grouped under on the dashboard. */
export function campaignKey(touch: Pick<Touch, 'source' | 'medium' | 'campaign' | 'channel'> | null | undefined) {
  if (!touch) return { source: '(unknown)', medium: '', campaign: '', channel: 'Unknown' }
  return { source: touch.source || '(none)', medium: touch.medium || '', campaign: touch.campaign || '', channel: touch.channel || 'Direct' }
}

/** A link to Batkle tagged for a campaign, for the dashboard's link builder. */
export function campaignLink(base: string, tags: Partial<Record<typeof UTM_KEYS[number], string>>): string {
  const url = new URL(base)
  for (const key of UTM_KEYS) { const value = clean(tags[key]); if (value) url.searchParams.set(`utm_${key}`, value) }
  return url.toString()
}
