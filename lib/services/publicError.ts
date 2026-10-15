/**
 * What an error says to the people using Batkle. Errors that only matter to whoever runs Batkle (AI and photo
 * providers, keys, accounts and billing, model or HTTP details, stack traces) become a plain message; the original
 * stays in the server log. Errors written for people (a missing brand, a photo that cannot be used) pass unchanged.
 */

// Rate limits and quotas: the person can wait and try again.
const BUSY = /quota (reached|exceeded)|rate.?limit(ed)?|too many requests|\b429\b|tokens? per (minute|day)|\b(TPM|RPM|TPD)\b/i
// Missing setup or an exhausted account: nothing the person can do about it.
const UNAVAILABLE = /\b[A-Z][A-Z0-9]*_(API_)?(KEY|TOKEN|SECRET|MODEL|URL)\b|\bapi[ _-]?key\b|not (set|configured)|\bconfigure\b|environment variable|credits?\b|billing|balance|insufficient_quota|model (permissions|access)|chat models?\b|access denied|\b40[13]\b/i
// Names and internals of the services Batkle runs on, and programming errors.
const INTERNAL = /\b(groq|openai|gpt[- ]?image|fal(\.ai)?|flux|pollinations|replicate|hugging ?face|unsplash|pexels|mongo\w*|atlas|satori|resvg|llama|whisper|orpheus|stripe|resend|twilio|cloudflare)\b|\bHTTP \d{3}\b|\bstatus code\b|\bE(CONN\w+|TIMEDOUT|NOTFOUND|AI_AGAIN)\b|fetch failed|socket|Unexpected token|JSON at position|is not valid JSON|invalid JSON|(Type|Reference|Syntax|Range)Error|Cannot read propert|is not a function|undefined is not|finish_reason|max_tokens|context length|truncated|Empty response from AI|Internal server error/i

export const BUSY_MESSAGE = 'Batkle is busy right now. Please try again in a minute.'
export const UNAVAILABLE_MESSAGE = 'Batkle can’t do this right now. Please try again later.'
export const FAILED_MESSAGE = 'Something went wrong on our side. Please try again.'
export const COPY_FAILED_MESSAGE = 'Batkle could not write the copy for this post. Please try again; your saved content is unchanged.'

/** The message to show for an API error: the original when it is written for people, otherwise a plain one. */
export function publicMessage(message: unknown, status = 500): string {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) return FAILED_MESSAGE
  // The copywriter's validation reason (in brackets) is logged; people only need to know to try again.
  if (/^AI could not generate complete, valid copywriting\b/i.test(text)) return COPY_FAILED_MESSAGE
  if (status === 429 || BUSY.test(text)) {
    const seconds = Number(text.match(/(\d+)\s*s(ec(ond)?s?)?\b/i)?.[1])
    return seconds > 0 && seconds <= 600 ? `Batkle is busy right now. Please try again in ${seconds} seconds.` : BUSY_MESSAGE
  }
  if (UNAVAILABLE.test(text)) return UNAVAILABLE_MESSAGE
  if (INTERNAL.test(text)) return FAILED_MESSAGE
  return text
}
