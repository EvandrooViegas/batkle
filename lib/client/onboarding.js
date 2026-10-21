// Pure helpers for the brand onboarding: website input, research progress and post language.

/** Turns what someone typed ("acme.pt", "https://www.acme.pt/about") into a URL to research. */
export function normalizeWebsite(input) {
  let value = String(input ?? '').trim()
  if (!value) return { error: 'Enter your website address.' }
  if (/\s/.test(value)) return { error: 'A website address has no spaces. Try something like yourbrand.com.' }
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) value = `https://${value}`
  let url
  try { url = new URL(value) } catch { return { error: 'That doesn’t look like a website address. Try something like yourbrand.com.' } }
  if (!/^https?:$/.test(url.protocol)) return { error: 'Use a website address that starts with http:// or https://.' }
  // A public site needs a dot and a real top-level domain ("localhost" or "acme" alone cannot be researched).
  if (!/\.[a-z\d-]{2,}$/i.test(url.hostname)) return { error: 'That doesn’t look like a website address. Try something like yourbrand.com.' }
  return { url: url.href, domain: url.hostname.replace(/^www\./i, '') }
}

/**
 * What the research step shows while the single research request runs. The server sends no progress,
 * so each step gets a typical duration; the last one stays active until the response arrives.
 */
export const RESEARCH_STEPS = [
  { id: 'open', label: domain => `Opening ${domain}`, ms: 3000 },
  { id: 'pages', label: () => 'Reading up to five pages', ms: 9000 },
  { id: 'services', label: () => 'Understanding services and projects', ms: 12000 },
  { id: 'audience', label: () => 'Finding your audience and tone of voice', ms: 10000 },
  { id: 'identity', label: () => 'Picking up colours and fonts', ms: 6000 },
  { id: 'logo', label: () => 'Preparing logo versions', ms: Infinity },
]

/** Index of the active research step after `elapsed` ms; never past the last step while the request runs. */
export function researchStepAt(elapsed) {
  let total = 0
  for (let i = 0; i < RESEARCH_STEPS.length; i++) {
    total += RESEARCH_STEPS[i].ms
    if (elapsed < total) return i
  }
  return RESEARCH_STEPS.length - 1
}

/** Post languages offered when reviewing a new brand. The variant is stored explicitly so it always wins. */
export const POST_LANGUAGES = [
  { code: 'en-US', label: 'English (United States)', language: 'English', languageVariant: 'en-US' },
  { code: 'en-GB', label: 'English (United Kingdom)', language: 'English', languageVariant: 'en-GB' },
  { code: 'pt-PT', label: 'Portuguese (Portugal)', language: 'Portuguese', languageVariant: 'pt-PT' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)', language: 'Portuguese', languageVariant: 'pt-BR' },
  { code: 'es-ES', label: 'Spanish (Spain)', language: 'Spanish', languageVariant: 'es-ES' },
  { code: 'es', label: 'Spanish (Latin America)', language: 'Spanish', languageVariant: 'es-419' },
  { code: 'fr', label: 'French', language: 'French', languageVariant: 'fr' },
  { code: 'de', label: 'German', language: 'German', languageVariant: 'de' },
  { code: 'it', label: 'Italian', language: 'Italian', languageVariant: 'it' },
]

/**
 * The language options for a brand and the one currently in effect. A detected language outside the
 * list (for example Dutch) is kept as its own option, so reviewing never silently changes it.
 */
export function languageChoices(brand, contentLanguage) {
  const detected = contentLanguage(brand || {})
  // Unsupported languages come back with an English code but their own name, so both must match.
  const known = POST_LANGUAGES.find(option => option.code === detected.code && option.language === detected.name)
  if (known) return { options: POST_LANGUAGES, selected: known.code }
  const custom = { code: `other:${detected.name}`, label: detected.name, language: brand?.language || detected.name, languageVariant: brand?.languageVariant || '' }
  return { options: [custom, ...POST_LANGUAGES], selected: custom.code }
}

/** Short, human summary of what research found, for the review step. */
export function researchSummary({ pages } = {}) {
  return pages ? `${pages} ${pages === 1 ? 'page' : 'pages'} read` : ''
}
