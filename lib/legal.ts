/**
 * Who sells Batkle, as the Terms, Privacy and Refund pages state it. EU law asks a seller online to give a postal
 * address and, once registered, a tax number (NIF): fill them in here and every legal page shows them.
 */
export const SELLER = {
  name: 'Evandro Viegas',
  trading: 'Batkle',
  country: 'Portugal',
  /** Street, postcode and city. */
  address: '',
  /** NIF (Portuguese tax number), or a VAT number once registered for VAT. */
  taxId: '',
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'hello@batkle.com',
}

/** The date each page last changed in substance (shown on it). */
export const LEGAL_UPDATED = { terms: '8 November 2026', privacy: '8 November 2026', refunds: '8 November 2026' }

/** The legal pages, in the order the tabs and the footer show them. */
export const LEGAL_PAGES = [
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/refunds', label: 'Refunds' },
]
