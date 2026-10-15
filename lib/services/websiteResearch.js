import { load } from 'cheerio'
import { fetchWebsiteResource } from './websiteFetch'

const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
const normal = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export function pageUrl(href, base) {
  try {
    const url = new URL(href, base)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    if (url.hostname.replace(/^www\./, '') !== new URL(base).hostname.replace(/^www\./, '')) return null
    if (/\.(pdf|zip|jpe?g|png|webp|svg|gif|mp4|css|js)$/i.test(url.pathname)) return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key)
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.href
  } catch { return null }
}

export function rankPage(url, label = '') {
  let path = new URL(url).pathname
  try { path = decodeURI(path) } catch { /* malformed percent-encoding on the website */ }
  const text = normal(path + ' ' + label)
  if (/privacy|privacidade|cookie|login|sign.in|cart|checkout|termos|terms|politica|wp-admin/.test(text)) return { category: 'excluded', score: -1 }
  if (/servic|servic|soluco|solution|produto|product|oferta/.test(text)) return { category: 'services', score: 100 }
  if (/projet|project|portfolio|obra|case.stud|trabalhos|realisations/.test(text)) return { category: 'projects', score: 95 }
  if (/sobre|about|quem.somos|empresa|company|equipe|team|nosotros|a-propos/.test(text)) return { category: 'about', score: 90 }
  if (/contact|contato|orcamento|quote/.test(text)) return { category: 'contact', score: 40 }
  if (/blog|news|noticia|artigo/.test(text)) return { category: 'articles', score: 25 }
  return { category: 'specialty', score: 55 }
}

function imageUrl(value, base) {
  if (!value || typeof value !== 'string') return null
  try {
    let url = new URL(value, base)
    if (!['https:', 'http:'].includes(url.protocol)) return null
    if (url.pathname === '/_next/image' && url.searchParams.has('url')) url = new URL(url.searchParams.get('url'), base)
    if (!['https:', 'http:'].includes(url.protocol) || /logo|favicon|sprite|icon|placeholder|avatar|\.svg(?:$|\?)/i.test(url.href)) return null
    url.hash = ''
    return url.href
  } catch { return null }
}

export function readResearchPage(html, url, category = 'home') {
  const $ = load(html)
  const title = clean($('title').text()).slice(0, 200)
  const contactDetails = clean($('address').text() + ' ' + $('a[href^="mailto:"],a[href^="tel:"]').map((_, el) => $(el).attr('href')).get().join(' ')).slice(0, 2000)
  const links = []
  $('a[href]').each((_, element) => {
    const link = $(element), target = pageUrl(link.attr('href'), url)
    if (!target) return
    const label = clean(link.text() || link.attr('aria-label'))
    const rank = rankPage(target, label)
    if (rank.score > 0) links.push({ url: target, label, ...rank })
  })
  const structured = []
  $('script[type="application/ld+json"]').each((_, el) => {
    try { structured.push(JSON.parse($(el).text())) } catch { /* malformed website metadata */ }
  })
  $('script,style,noscript,nav,footer,header,[aria-hidden="true"],form').remove()
  const images = []
  const addImage = (src, alt, context, width, height) => {
    const image = imageUrl(src, url)
    if (!image || (width && width < 240) || (height && height < 160) || /logo|icon|avatar/i.test(alt)) return
    if (images.some(item => item.url === image)) return
    images.push({ url: image, sourcePage: url, alt: clean(alt).slice(0, 220), context: clean(context).slice(0, 650), pageTitle: title, category })
  }
  $('img').each((_, element) => {
    const img = $(element)
    const srcset = img.attr('data-srcset') || img.attr('srcset') || ''
    const largest = srcset.split(',').map(entry => entry.trim().split(/\s+/)).sort((a, b) => parseFloat(b[1] || '0') - parseFloat(a[1] || '0'))[0]?.[0]
    const context = img.closest('figure,article,section,li').text() || img.parent().parent().text()
    addImage(img.attr('data-src') || img.attr('data-lazy-src') || largest || img.attr('src'), img.attr('alt'), context, Number(img.attr('width')), Number(img.attr('height')))
  })
  $('[style*="background"]').each((_, element) => {
    const el = $(element), src = el.attr('style')?.match(/url\(['"]?([^'")]+)['"]?\)/)?.[1]
    if (src) addImage(src, el.attr('aria-label') || '', el.text(), 0, 0)
  })
  $('p,h1,h2,h3,h4,li,div,section,br').each((_, element) => { $(element).append('\n') })
  const lines = [...new Set($('main').length ? $('main').text().split('\n').map(clean).filter(Boolean) : $('body').text().split('\n').map(clean).filter(Boolean))]
  return { url, category, title, html, contactDetails, text: lines.join('\n').slice(0, 10000), structured: JSON.stringify(structured).slice(0, 2500), links, images: images.slice(0, 35) }
}

const siteHost = url => new URL(url).hostname.replace(/^www\./, '')

/** Where a `<meta http-equiv="refresh">` sends the browser, as an absolute URL. */
function refreshTarget($, url) {
  const target = $('meta[http-equiv="refresh" i]').attr('content')?.match(/url\s*=\s*(.+)$/i)?.[1]
  try { return target ? new URL(target.trim().replace(/^['"]|['"]$/g, ''), url).href : null } catch { return null }
}

/** A domain provider's placeholder rather than the business site: frames or a redirect to another domain, or an empty page. */
export function isPlaceholderPage(html, url) {
  const $ = load(html)
  const elsewhere = value => { try { return siteHost(new URL(value, url).href) !== siteHost(url) } catch { return false } }
  const refresh = refreshTarget($, url)
  if (refresh) return elsewhere(refresh)
  const text = clean($('body').text())
  if ($('frame[src], iframe[src]').toArray().some(el => elsewhere($(el).attr('src'))) && text.length < 200) return true
  return html.length < 1500 && text.length < 80
}

const readHomepage = async target => {
  const page = await fetchWebsiteResource(target, 'html')
  return { html: page.bytes.toString('utf8'), url: page.url }
}

/** The page, after one same-site `<meta refresh>` hop ("/" → "/pt/" on many small sites). */
async function readFollowingRefresh(url, fetchPage) {
  const page = await fetchPage(url)
  const next = refreshTarget(load(page.html), page.url)
  return next && next !== page.url && siteHost(next) === siteHost(page.url) ? fetchPage(next) : page
}

/**
 * The homepage, trying the address as typed first. Many small-business domains answer on only one of "acme.pt" and
 * "www.acme.pt" (the other has an expired certificate or the domain provider's placeholder), and a few lack HTTPS.
 */
export async function fetchHomepage(url, fetchPage = readHomepage) {
  const typed = new URL(url), twin = new URL(url)
  twin.hostname = typed.hostname.startsWith('www.') ? typed.hostname.slice(4) : `www.${typed.hostname}`
  const candidates = [typed, twin]
  if (typed.protocol === 'https:') candidates.push(...candidates.map(candidate => Object.assign(new URL(candidate.href), { protocol: 'http:' })))
  let placeholder = false, firstError = null
  for (const candidate of candidates) {
    try {
      const page = await readFollowingRefresh(candidate.href, fetchPage)
      if (!isPlaceholderPage(page.html, page.url)) return page
      placeholder = true
    } catch (error) { firstError ||= error }
  }
  if (placeholder) throw Error(`${typed.hostname.replace(/^www\./, '')} only shows a placeholder page from its domain provider. Try the address you open in your browser.`)
  throw firstError
}

/** Homepage + at most four linked pages. Re-rank discovered links after each page. */
export async function crawlBusinessWebsite(url, homepageHtml, fetchHtml = async target => (await fetchWebsiteResource(target, 'html', url)).bytes.toString('utf8')) {
  const start = pageUrl(url, url)
  if (!start) throw Error('Invalid business website URL')
  const pages = [readResearchPage(homepageHtml, start)]
  const visited = new Set([start]), queue = new Map(), warnings = [], categories = new Set(['home'])
  const discover = page => page.links.forEach(link => { if (!visited.has(link.url) && (!queue.has(link.url) || queue.get(link.url).score < link.score)) queue.set(link.url, link) })
  discover(pages[0])
  while (visited.size < 5 && queue.size) {
    const next = [...queue.values()].sort((a, b) => (b.score - (categories.has(b.category) ? 65 : 0)) - (a.score - (categories.has(a.category) ? 65 : 0)))[0]
    queue.delete(next.url); visited.add(next.url)
    try {
      const html = await fetchHtml(next.url)
      if (!html) throw Error('Empty page')
      const page = readResearchPage(html, next.url, next.category)
      pages.push(page); categories.add(next.category); discover(page)
    } catch { warnings.push({ url: next.url, message: 'This page could not be read.' }) }
  }
  const images = [...new Map(pages.flatMap(page => page.images).map(image => [image.url, image])).values()]
    .sort((a, b) => Number(b.category === 'projects') - Number(a.category === 'projects') || Number(Boolean(b.alt)) - Number(Boolean(a.alt)))
    .slice(0, 40).map((image, i) => ({ ...image, id: `website-image-${i + 1}` }))
  return { pages, images, warnings }
}
