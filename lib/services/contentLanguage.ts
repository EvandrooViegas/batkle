/**
 * The one output language for a brand's ideas and posts, and code-level checks that the model kept to it.
 * Brand profiles are researched and stored in English, so the language must be stated precisely and verified,
 * otherwise English wording (or the wrong regional variant) leaks into the copy.
 */
export interface ContentLanguage { name: string; code: string; label: string; rules: string }

// A code matches only as a whole code ("es", "es-ES"), so names like "Estonian" or "Frisian" are not mistaken for one.
const LANGUAGES: [RegExp, string, string][] = [
  [/^(pt([-_]|$)|portug)/i, 'Portuguese', 'pt'], [/^(en([-_]|$)|engl|ingl)/i, 'English', 'en'], [/^(es([-_]|$)|span|espa)/i, 'Spanish', 'es'],
  [/^(fr([-_]|$)|fren|fran)/i, 'French', 'fr'], [/^(de([-_]|$)|germ|deut|alem)/i, 'German', 'de'], [/^(it([-_]|$)|ital)/i, 'Italian', 'it'],
]

// Common languages Batkle has no special rules for; used to give a stored name ("Dutch") its code ("nl").
const OTHER_CODES = ['nl', 'pl', 'sv', 'da', 'nb', 'no', 'fi', 'cs', 'sk', 'ro', 'el', 'tr', 'ru', 'uk', 'ar', 'he', 'ja', 'zh', 'ko', 'hi', 'ca', 'gl', 'eu', 'hu', 'bg', 'hr', 'sl', 'sr', 'lt', 'lv', 'et', 'id', 'ms', 'th', 'vi', 'is', 'ga', 'cy', 'af', 'sw', 'fa', 'ur', 'bn']
const displayName = (code: string) => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || '' } catch { return '' } }

/** Name and code for a language without its own rules: "nl" → Dutch (nl), "Dutch" → Dutch (nl). */
function otherLanguage(raw: string): { name: string; code: string } {
  if (/^[a-z]{2,3}([-_][a-z0-9]{2,8})?$/i.test(raw)) {
    const code = raw.replace('_', '-').toLowerCase()
    return { name: displayName(code) || raw, code }
  }
  const code = OTHER_CODES.find(c => displayName(c).toLowerCase() === raw.toLowerCase())
  return { name: raw, code: code || raw.toLowerCase().replace(/[^\p{L}]+/gu, '-') }
}

const hostOf = (website: any) => { try { return new URL(String(website)).hostname.toLowerCase() } catch { return String(website || '').toLowerCase() } }

const PT_PT = `European Portuguese (Portugal). Address the reader with "o seu/a sua" or the imperative, never "você". Use Portugal's vocabulary: equipa (not equipe/time), contacto (not contato), registo (not registro), telemóvel (not celular), utilizador (not usuário), ecrã (not tela), facto (not fato), objetivo/otimizar as in Portugal. Spell as the current Acordo Ortográfico does: otimização, ação, direção, ótimo (never optimização, acção, direcção). Use "estar a + infinitivo" (estamos a trabalhar), never the gerund (estamos trabalhando).`
const PT_BR = `Brazilian Portuguese. Use Brazilian vocabulary and grammar (você, equipe, contato, celular, usuário; estamos trabalhando), never European forms (equipa, contacto, telemóvel, estar a + infinitivo).`

export function contentLanguage(brand: any = {}): ContentLanguage {
  const raw = String(brand.languageVariant || brand.language || '').trim()
  const match = LANGUAGES.find(([pattern]) => pattern.test(raw))
  // A language without its own rules keeps its name and code; only a missing language falls back to English.
  const other = !match && raw && raw.toLowerCase() !== 'unknown' ? otherLanguage(raw) : null
  const name = match?.[1] || other?.name || 'English'
  const host = hostOf(brand.website)
  const evidence = `${brand.about || ''} ${brand.targetAudience || ''}`
  let code = match?.[2] || other?.code || 'en'
  // Explicit variants win; otherwise the site's country and the profile decide.
  if (code === 'pt') code = /pt-?pt|portugal/i.test(raw) ? 'pt-PT' : /pt-?br|brasil|brazil/i.test(raw) || host.endsWith('.br') || /\b(brasil|brazil|são paulo|rio de janeiro)\b/i.test(evidence) && !/\bportugal\b/i.test(evidence) ? 'pt-BR' : 'pt-PT'
  if (code === 'en') code = /en-?us|americ/i.test(raw) ? 'en-US' : /en-?gb|british|uk\b/i.test(raw) || host.endsWith('.uk') ? 'en-GB' : 'en-US'
  if (code === 'es') code = /es-?419|latin/i.test(raw) ? 'es' : /es-?es|spain|españa/i.test(raw) || host.endsWith('.es') ? 'es-ES' : 'es'
  const label = code === 'pt-PT' ? 'Portuguese — European (pt-PT)' : code === 'pt-BR' ? 'Portuguese — Brazilian (pt-BR)' : code === 'en-GB' ? 'English — British (en-GB)' : code === 'en-US' ? 'English — American (en-US)' : `${name} (${code})`
  const variant = code === 'pt-PT' ? PT_PT : code === 'pt-BR' ? PT_BR : code === 'en-GB' ? 'British spelling (organise, colour, centre).' : ''
  const english = code.startsWith('en')
  const rules = `OUTPUT LANGUAGE: ${label}.
Write every reader-facing word in ${label}: topics, hooks, messages, headlines, body text, CTAs, captions and hashtags. ${variant}
${english ? '' : `The brand profile is English research notes: use it only for facts and translate every idea from it; never copy its English sentences, service descriptions or CTA wording. Keep only proper nouns, brand and product names (e.g. Facebook Ads, TikTok, LinkedIn) and standard acronyms (SEO, ROI) unchanged. Translate English marketing jargon when a natural ${name} term exists (engagement, leads, insights, tips, call to action). Name app buttons and features the way the reader sees them in ${name} (in Portuguese, Facebook's "Boost" button is "Impulsionar").
`}Never mix languages or regional variants inside one post. Exception: design.image.subject and design.image.queries are internal stock-search terms and stay in English.`
  return { name, code, label, rules }
}

/** The language of one post: the one chosen for it in the composer ({ language, languageVariant }), else the brand's. */
export function postLanguage(brand: any = {}, choice?: any): ContentLanguage {
  const language = typeof choice?.language === 'string' ? choice.language.trim() : ''
  const languageVariant = typeof choice?.languageVariant === 'string' ? choice.languageVariant.trim() : ''
  // The brand's own variant must not leak into another language (a pt-PT brand writing one post in Spanish).
  return language || languageVariant ? contentLanguage({ ...brand, language: language || languageVariant, languageVariant }) : contentLanguage(brand)
}

// High-precision English function words; none of them is a word in the other supported languages.
const ENGLISH = new Set(['the', 'and', 'your', 'you', 'with', 'for', 'our', 'this', 'that', 'how', 'why', 'what', 'from', 'more', 'will', 'can', 'get', 'into', 'are', 'is', 'of', 'to', 'we', 'they', 'their', 'about', 'just', 'now', 'learn', 'discover', 'business', 'today'])
// English marketing jargon the rules ask to translate; one occurrence is already a mixed-language post.
const JARGON = new Set(['leads', 'insights', 'engagement', 'tips', 'boost', 'unlock', 'growth'])
// \b is ASCII-only in JavaScript, so word edges are Unicode letter lookarounds (accented words like "você").
const BRAZILIAN = /(?<!\p{L})(você|vocês|equipe|celular|contato|registro|usuários?|ônibus|a gente)(?!\p{L})|(?<!\p{L})(estou|está|estamos|estão|esteja)\s+\p{L}+ndo(?!\p{L})/giu
const EUROPEAN = /(?<!\p{L})(equipa|telemóvel|contacto|registo|utilizadores?|ecrã)(?!\p{L})|(?<!\p{L})(estou|está|estamos|estão)\s+a\s+\p{L}+(ar|er|ir)(?!\p{L})/giu

/** Reader-facing problems with the language of generated text. Empty when the text is consistent. */
export function languageIssues(texts: string[], language: ContentLanguage): string[] {
  const text = texts.filter(t => typeof t === 'string').join('\n')
  if (!text.trim()) return []
  const issues: string[] = []
  if (!language.code.startsWith('en')) {
    const words = text.toLowerCase().match(/\p{L}+/gu) || []
    const english = words.filter(w => ENGLISH.has(w)), jargon = words.filter(w => JARGON.has(w))
    // The word lists are exact for the six languages with rules. Others (Dutch: "is", "we", "of", "tips")
    // share words with English, so only text that is mostly English is flagged there.
    const listed = /^(pt|es|fr|de|it)(-|$)/.test(language.code)
    const mixed = listed
      ? jargon.length || english.length >= 3 || (words.length >= 12 && english.length / words.length > .05)
      : words.length >= 12 && english.length / words.length > .15
    if (mixed) issues.push(`contains English wording (${[...new Set([...(listed ? jargon : []), ...english])].slice(0, 6).join(', ')}); write it entirely in ${language.label}`)
  }
  const wrong = language.code === 'pt-PT' ? text.match(BRAZILIAN) : language.code === 'pt-BR' ? text.match(EUROPEAN) : null
  if (wrong?.length) issues.push(`uses ${language.code === 'pt-PT' ? 'Brazilian' : 'European'} Portuguese forms (${[...new Set(wrong.map(w => w.toLowerCase()))].slice(0, 5).join(', ')}); use ${language.label} consistently`)
  return issues
}

/** Reader-facing strings of a copy object (never internal design or search fields). */
export function copyTexts(copy: any): string[] {
  if (!copy || typeof copy !== 'object') return []
  const slides = Array.isArray(copy.slides) ? copy.slides : []
  return [copy.headline, copy.subheadline, copy.supportingText, copy.cta, copy.caption,
    ...slides.flatMap((s: any) => [s?.headline, s?.body, s?.cta])].filter((t: any) => typeof t === 'string')
}

// Spellings the 1990 Acordo Ortográfico changed, which models still write ("optimização"). Only stems that are never
// right any more in Portugal or Brazil: words Portugal kept, such as facto and contacto, are not touched.
const OLD_PORTUGUESE: [RegExp, string][] = [
  [/(?<!\p{L})optimiz/giu, 'otimiz'], [/(?<!\p{L})óptim/giu, 'ótim'],
  [/(?<!\p{L})(re|inter|)acç(ão|ões)(?!\p{L})/giu, '$1aç$2'],
  [/(?<!\p{L})(dire|cole|sele|prote|corre|infe|reda)cç(ão|ões)(?!\p{L})/giu, '$1ç$2'],
  [/(?<!\p{L})project(o|os|ar|ado|ada|ados|adas|ista|istas)(?!\p{L})/giu, 'projet$1'],
  [/(?<!\p{L})arquitect(o|os|a|as|ura|uras|ónico|ónica)(?!\p{L})/giu, 'arquitet$1'],
  [/(?<!\p{L})efectiv/giu, 'efetiv'], [/(?<!\p{L})objectiv/giu, 'objetiv'],
  [/(?<!\p{L})actua(l|is|lmente)(?!\p{L})/giu, 'atua$1'], [/(?<!\p{L})actualiz/giu, 'atualiz'],
  [/(?<!\p{L})exact(o|a|os|as|amente)(?!\p{L})/giu, 'exat$1'],
  [/(?<!\p{L})direct(o|a|os|as|amente|or|ora|ores|oras|ório|órios)(?!\p{L})/giu, 'diret$1'],
]

/** `text` in the current Portuguese spelling, keeping each word's capitalisation. */
export function modernPortuguese(text: string): string {
  return OLD_PORTUGUESE.reduce((out, [pattern, replacement]) => out.replace(pattern, (...match) => {
    const word = match[0] as string
    const groups = match.slice(1, -2).filter(g => typeof g === 'string')
    const fixed = replacement.replace(/\$(\d)/g, (_, i) => groups[Number(i) - 1] ?? '')
    if (word === word.toUpperCase()) return fixed.toUpperCase()
    return word[0] === word[0].toUpperCase() ? fixed[0].toUpperCase() + fixed.slice(1) : fixed
  }), text)
}

/** For a post in Portuguese, its reader-facing text in the current spelling (the fields copyTexts reads, and hashtags). */
export function withModernSpelling(copy: any, code: string): any {
  if (!/^pt/i.test(code || '') || !copy || typeof copy !== 'object') return copy
  const fix = (value: any) => (typeof value === 'string' ? modernPortuguese(value) : value)
  const out = { ...copy }
  for (const key of ['headline', 'subheadline', 'supportingText', 'cta', 'caption']) out[key] = fix(out[key])
  if (Array.isArray(out.hashtags)) out.hashtags = out.hashtags.map(fix)
  if (Array.isArray(out.slides)) out.slides = out.slides.map((s: any) => (s && typeof s === 'object' ? { ...s, headline: fix(s.headline), body: fix(s.body), cta: fix(s.cta) } : s))
  return out
}
