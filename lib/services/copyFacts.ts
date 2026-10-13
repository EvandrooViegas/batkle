/**
 * Result figures in generated text that the source facts do not contain. Percentages, multipliers, money, ROI and
 * counts of leads, clients or sales read as results; inventing them is the most damaging kind of made-up fact
 * for a real business, so they are checked in code, not left to the prompt.
 */

const NUMBER = /\d+(?:[.,]\d+)*/g
const RESULT_NOUNS = [
  'leads?', 'clientes?', 'clients?', 'customers?', 'vendas?', 'ventas?', 'ventes?', 'sales',
  'marcações', 'marcacoes', 'reservas?', 'bookings?', 'réservations?', 'seguidores', 'followers', 'abonnés',
  'visitas?', 'visits?', 'visites?', 'conversões', 'conversoes', 'conversiones', 'conversions?',
  'contactos?', 'contacts?', 'pedidos?', 'orders?', 'encomendas?', 'projetos', 'projects?',
].join('|')
// Unicode-aware word edges: \b is ASCII-only in JavaScript.
const CLAIM = new RegExp([
  String.raw`[+-]?\d+(?:[.,]\d+)?\s*(?:%|por\s*cento|percent|pour\s*cent)`,
  String.raw`\d+(?:[.,]\d+)?\s*(?:×|x(?!\p{L}|\d))`,
  String.raw`[€$£]\s*\d+(?:[.,]\d+)*`,
  String.raw`\d+(?:[.,]\d+)*\s*(?:€|euros?|eur|usd|dólares|dollars?)(?!\p{L})`,
  String.raw`(?<!\p{L})ROI\s*(?:de\s+|of\s+|:\s*)?\d+(?:[.,]\d+)?`,
  String.raw`(?<![\p{L}\d.,])\d+(?:[.,]\d+)?\s*(?:${RESULT_NOUNS})(?!\p{L})`,
].join('|'), 'giu')

/** "3,5" and "3.5" are the same figure; "1.000" and "1,000" are a thousand. */
function normalize(number: string): string {
  if (/^\d{1,3}([.,]\d{3})+$/.test(number)) return String(Number(number.replace(/[.,]/g, '')))
  return String(Number(number.replace(',', '.')))
}

/** Every number in the source text, normalised. */
export function sourceNumbers(source: string): Set<string> {
  return new Set((String(source || '').match(NUMBER) || []).map(normalize))
}

/**
 * The result figures in `texts` whose numbers do not appear in `source`, as written (e.g. "45%", "ROI 3,5").
 * "100%" is an everyday intensifier ("100% focused"), not a result, so it is allowed.
 */
export function inventedFigures(texts: string[], source: string): string[] {
  const known = sourceNumbers(source)
  const found: string[] = []
  for (const text of texts) {
    if (typeof text !== 'string') continue
    for (const match of text.matchAll(CLAIM)) {
      const claim = match[0].trim()
      if (/^\+?100\s*%$/.test(claim)) continue
      const numbers = (claim.match(NUMBER) || []).map(normalize)
      if (numbers.length && !numbers.every(n => known.has(n)) && !found.includes(claim)) found.push(claim)
    }
  }
  return found
}
