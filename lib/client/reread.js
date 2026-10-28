/**
 * Reading a brand's website again: what it would change in each chapter of the brand profile, and the profile with
 * only the chapters the person chose. A chapter the website says nothing about is never offered, so reading the site
 * again can't wipe what someone wrote by hand.
 */

export const REREAD_CHAPTERS = [
  { id: 'name', title: 'Business name', fields: ['name'], kind: 'text' },
  { id: 'about', title: 'About the business', fields: ['about', 'profileLanguage'], kind: 'text' },
  { id: 'services', title: 'Services & products', fields: ['services'], kind: 'list' },
  { id: 'projects', title: 'Projects & work', fields: ['projects'], kind: 'projects' },
  { id: 'audience', title: 'Ideal customers', fields: ['targetAudience'], kind: 'text' },
  { id: 'voice', title: 'Voice & tone', fields: ['tone'], kind: 'text' },
  { id: 'apart', title: 'What sets you apart', fields: ['differentiators'], kind: 'list' },
  { id: 'ctas', title: 'Calls to action', fields: ['suggestedCtas'], kind: 'list' },
  { id: 'topics', title: 'Content opportunities', fields: ['contentTopics'], kind: 'list' },
  { id: 'logo', title: 'Logo', fields: ['logo', 'logoVariants'], kind: 'logo' },
  { id: 'colours', title: 'Colours', fields: ['colors'], kind: 'colours' },
  { id: 'type', title: 'Typography', fields: ['fonts'], kind: 'list' },
  { id: 'language', title: 'Post language', fields: ['language', 'languageVariant'], kind: 'text' },
]

// Where the profile came from: always taken from the new reading.
const SOURCE_FIELDS = ['website', 'researchSources', 'researchWarnings', 'researchedAt', 'pagesAnalyzed']

const listOf = value => (Array.isArray(value) ? value : String(value || '').split('\n')).map(item => (typeof item === 'string' ? item.trim() : item)).filter(Boolean)
const normal = value => {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => (typeof item === 'string' ? item.trim() : item)).filter(Boolean))
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value ?? '').trim()
}
const empty = (kind, value) => (kind === 'text' || kind === 'logo' ? !String(value ?? '').trim() || value === 'Unknown' || value === 'unknown' : listOf(value).length === 0)

/** The chapters the new reading would change: each with what the profile has now and what the website says. */
export function rereadChanges(current = {}, next = {}) {
  return REREAD_CHAPTERS.flatMap(chapter => {
    const [field] = chapter.fields
    const now = current?.[field], fresh = next?.[field]
    if (empty(chapter.kind, fresh) || normal(now) === normal(fresh)) return []
    return [{ ...chapter, now, fresh, added: empty(chapter.kind, now) }]
  })
}

/** The profile with the chosen chapters (by id) taken from the new reading, and where it came from. */
export function applyReread(current = {}, next = {}, chosen = []) {
  const merged = { ...current }
  for (const field of SOURCE_FIELDS) if (next[field] !== undefined) merged[field] = next[field]
  for (const chapter of REREAD_CHAPTERS) {
    if (!chosen.includes(chapter.id)) continue
    for (const field of chapter.fields) if (next[field] !== undefined) merged[field] = next[field]
  }
  return merged
}

/** A short, readable line for a chapter's value in the review. */
export function summary(kind, value) {
  if (kind === 'list') {
    const items = listOf(value)
    if (!items.length) return ''
    const first = items.slice(0, 3).map(item => String(item).split(/\s+[—–]\s+/)[0]).join(', ')
    return items.length > 3 ? `${first} and ${items.length - 3} more` : first
  }
  if (kind === 'projects') {
    const items = Array.isArray(value) ? value.filter(p => p?.name || p?.description) : []
    if (!items.length) return ''
    const first = items.slice(0, 3).map(p => p.name || 'Untitled project').join(', ')
    return items.length > 3 ? `${first} and ${items.length - 3} more` : first
  }
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text
}
