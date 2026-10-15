import axios from 'axios'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

function privateAddress(address: string): boolean {
  if (isIP(address) === 6) return /^(::|fc|fd|fe[89ab]|ff)/i.test(address) || address.includes('.')
  const [a, b] = address.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

const ACCEPT = { html: 'text/html', image: 'image/*', css: 'text/css,*/*;q=0.1' }

/** Bounded public HTTP fetch. Validate and pin DNS on every redirect. */
export async function fetchWebsiteResource(input: string, kind: 'html' | 'image' | 'css' = 'html', origin?: string) {
  let url = new URL(input)
  for (let redirect = 0; redirect <= 3; redirect++) {
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw Error('Unsupported website URL')
    if (origin && url.hostname.replace(/^www\./, '') !== new URL(origin).hostname.replace(/^www\./, '')) throw Error('Page redirected outside the business website')
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const addresses = await lookup(hostname, { all: true })
    if (!addresses.length || addresses.some(item => privateAddress(item.address))) throw Error('Website must have a public internet address')
    const response = await axios.get(url.href, {
      responseType: 'arraybuffer', timeout: 12000, maxRedirects: 0,
      maxContentLength: kind === 'image' ? 10 * 1024 * 1024 : 3 * 1024 * 1024,
      proxy: false,
      lookup: (_host: any, options: any, callback: any) => options?.all
        ? callback(null, addresses)
        : callback(null, addresses[0].address, addresses[0].family),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BrandWebsiteResearch/1.0)', Accept: ACCEPT[kind] },
      validateStatus: status => status >= 200 && status < 400,
    } as any)
    if (response.status >= 300) {
      if (!response.headers.location || redirect === 3) throw Error('Too many website redirects')
      url = new URL(response.headers.location, url)
      continue
    }
    const contentType = String(response.headers['content-type'] || '')
    if (kind === 'html' && !/text\/html|application\/xhtml/i.test(contentType)) throw Error('Page is not HTML')
    if (kind === 'image' && !/^image\//i.test(contentType)) throw Error('Resource is not an image')
    // Servers label stylesheets loosely; an HTML body here is an error page.
    if (kind === 'css' && /text\/html|^image\//i.test(contentType)) throw Error('Resource is not a stylesheet')
    return { url: url.href, bytes: Buffer.from(response.data), contentType }
  }
  throw Error('Could not fetch website')
}
