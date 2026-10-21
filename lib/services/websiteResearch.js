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
  $('p,h1,h2,h3,h4,li,div,section,br').each((_, element) => { $(element).append('\n') })
  const lines = [...new Set($('main').length ? $('main').text().split('\n').map(clean).filter(Boolean) : $('body').text().split('\n').map(clean).filter(Boolean))]
  return { url, category, title, html, contactDetails, text: lines.join('\n').slice(0, 10000), structured: JSON.stringify(structured).slice(0, 2500), links }
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
  throw Object.assign(Error(unreachableMessage(typed.hostname.replace(/^www\./, ''), firstError)), { unreachable: true, cause: firstError })
}

/** Why a website could not be opened, in words the person can act on. */
export function unreachableMessage(host, error) {
  const status = error?.response?.status, code = String(error?.code || error?.cause?.code || '')
  if (status === 404 || status === 410) return `${host} answered “page not found”. Check the address, or try again once the site is back.`
  if (status === 401 || status === 403 || status === 429) return `${host} doesn’t let Batkle read it: it blocks automatic visitors. Set up the brand by hand instead.`
  if (status >= 500) return `${host} is having problems right now (error ${status}). Try again in a few minutes.`
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return `Batkle couldn’t find ${host}. Check the address for typos.`
  if (/ECONNABORTED|ETIMEDOUT|ECONNRESET/.test(code) || /timeout/i.test(error?.message || '')) return `${host} took too long to answer. Try again in a minute.`
  if (/CERT|SSL|TLS/i.test(code)) return `${host}’s security certificate isn’t valid, so Batkle can’t open it safely.`
  return `Batkle couldn’t open ${host}. Check the address, or try again in a few minutes.`
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
  return { pages, warnings }
}
