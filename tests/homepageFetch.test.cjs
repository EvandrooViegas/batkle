const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const source = fs.readFileSync('lib/services/websiteResearch.js', 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '')
const { fetchHomepage, isPlaceholderPage } = new Function('load', source + ';return { fetchHomepage, isPlaceholderPage }')(require('cheerio').load)

const site = `<!doctype html><html><head><title>Kachica</title><script src="/app.js"></script></head><body><header><a href="/">Kachica</a></header><main><h1>Handmade ceramics</h1><p>${'Studio pottery from Lisbon. '.repeat(20)}</p></main></body></html>`
const registrar = '<html><head></head><FRAMESET rows="100%,*"><FRAME SRC="http://courtesy.amen.pt/index.html" NAME="top"><FRAME SRC="" NAME="bottom"><noframes><body><a href="http://courtesy.amen.pt/index.html">http://courtesy.amen.pt/index.html</a></body></noframes></FRAMESET></html>'

/** `pages` maps URL → HTML, or an Error to throw for that URL; requests are recorded in order. */
function web(pages) {
  const requested = []
  return { requested, fetchPage: async url => {
    requested.push(url)
    const page = pages[url]
    if (page instanceof Error) throw page
    if (page == null) throw Error('getaddrinfo ENOTFOUND ' + new URL(url).hostname)
    return { html: page, url }
  } }
}

test('a bare domain with an expired certificate falls back to its www site', async () => {
  const { fetchPage, requested } = web({ 'https://kachica.pt/': Error('certificate has expired'), 'https://www.kachica.pt/': site })
  const page = await fetchHomepage('https://kachica.pt', fetchPage)
  assert.equal(page.url, 'https://www.kachica.pt/')
  assert.deepEqual(requested, ['https://kachica.pt/', 'https://www.kachica.pt/'])
})

test('a domain provider placeholder is skipped for the www site; an answering address is used as typed', async () => {
  const placeholder = web({ 'https://kachica.pt/': registrar, 'https://www.kachica.pt/': site })
  assert.equal((await fetchHomepage('https://kachica.pt/', placeholder.fetchPage)).url, 'https://www.kachica.pt/')
  const direct = web({ 'https://www.kachica.pt/about': site })
  assert.equal((await fetchHomepage('https://www.kachica.pt/about', direct.fetchPage)).url, 'https://www.kachica.pt/about')
  assert.equal(direct.requested.length, 1)
  const bareOnly = web({ 'https://acme.pt/': site })
  assert.equal((await fetchHomepage('https://www.acme.pt', bareOnly.fetchPage)).url, 'https://acme.pt/')
})

test('sites without HTTPS are read over HTTP after both HTTPS addresses fail', async () => {
  const { fetchPage, requested } = web({ 'http://oldshop.pt/': site })
  assert.equal((await fetchHomepage('https://oldshop.pt', fetchPage)).url, 'http://oldshop.pt/')
  assert.deepEqual(requested, ['https://oldshop.pt/', 'https://www.oldshop.pt/', 'http://oldshop.pt/'])
})

test('only placeholders explain themselves; a dead site reports the first failure', async () => {
  const parked = web({ 'https://parked.pt/': registrar, 'https://www.parked.pt/': registrar, 'http://parked.pt/': registrar, 'http://www.parked.pt/': registrar })
  await assert.rejects(fetchHomepage('https://parked.pt', parked.fetchPage), /parked\.pt only shows a placeholder page from its domain provider/)
  const dead = web({ 'https://dead.pt/': Error('connect ECONNREFUSED') })
  await assert.rejects(fetchHomepage('https://dead.pt', dead.fetchPage), /ECONNREFUSED/)
  assert.equal(dead.requested.length, 4)
})

test('placeholder detection leaves real sites alone, including script-only app shells', () => {
  assert.equal(isPlaceholderPage(registrar, 'http://kachica.pt/'), true)
  assert.equal(isPlaceholderPage('<html><head><meta http-equiv="refresh" content="0; url=https://parking.example/acme"></head><body></body></html>', 'https://acme.pt/'), true)
  assert.equal(isPlaceholderPage(site, 'https://www.kachica.pt/'), false)
  const shell = `<!doctype html><html><head>${'<link rel="modulepreload" href="/assets/chunk.js">'.repeat(30)}</head><body><div id="root"></div></body></html>`
  assert.equal(isPlaceholderPage(shell, 'https://app.acme.pt/'), false)
  assert.equal(isPlaceholderPage('<html><head><meta http-equiv="refresh" content="0;url=/pt/"></head><body></body></html>', 'https://acme.pt/'), false)
})

test('a homepage that redirects to its language page with <meta refresh> is followed, not mistaken for a placeholder', async () => {
  const { fetchPage, requested } = web({ 'https://acme.pt/': '<html><head><meta http-equiv="refresh" content="0; URL=\'/pt/\'"></head><body></body></html>', 'https://acme.pt/pt/': site })
  assert.equal((await fetchHomepage('https://acme.pt', fetchPage)).url, 'https://acme.pt/pt/')
  assert.deepEqual(requested, ['https://acme.pt/', 'https://acme.pt/pt/'])
})
