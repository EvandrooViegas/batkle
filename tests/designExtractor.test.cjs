const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const sharp = require('sharp')
const source = fs.readFileSync('lib/services/designExtractor.js', 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '')
const design = new Function('load', 'sharp', 'fetchWebsiteResource', source + ';return { extractDesignSystem, parseColor, cleanFontName }')(require('cheerio').load, sharp, async () => { throw Error('Tests never use the network') })

/** Serves `files` by URL the way fetchWebsiteResource does, and records what was requested. */
function website(files) {
  const requested = []
  const fetchResource = async (url, kind) => {
    requested.push(url)
    if (!(url in files)) throw Error('Request failed with status code 404')
    return { url, bytes: Buffer.isBuffer(files[url]) ? files[url] : Buffer.from(files[url]), contentType: kind === 'css' ? 'text/css' : 'image/svg+xml' }
  }
  return { requested, read: (html, url = 'https://brand.test/') => design.extractDesignSystem(html, url, { fetchResource, deadline: 2000 }) }
}
const page = (head, body, bodyClass = '') => `<!doctype html><html><head>${head}</head><body class="${bodyClass}">${body}${'<p>Copy</p>'.repeat(40)}</body></html>`
const close = (hex, expected) => {
  const channels = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16))
  const [a, b] = [channels(hex), channels(expected)]
  assert.ok(a.every((v, i) => Math.abs(v - b[i]) <= 3), `${hex} is not close to ${expected}`)
}

test('reads every colour syntax sites ship, including Tailwind v4 oklch', () => {
  const hex = color => '#' + [color.r, color.g, color.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
  assert.equal(hex(design.parseColor('#E30613')), '#e30613')
  assert.equal(hex(design.parseColor('#f00')), '#ff0000')
  assert.equal(hex(design.parseColor('rgb(18, 52, 86)')), '#123456')
  assert.equal(hex(design.parseColor('rgb(18 52 86 / 50%)')), '#123456')
  assert.equal(design.parseColor('rgba(0,0,0,0.25)').a, 0.25)
  close(hex(design.parseColor('hsl(346.8 77.2% 49.8%)')), '#e11d48')
  close(hex(design.parseColor('oklch(54.6% 0.245 262.881)')), '#155dfc')
  close(hex(design.parseColor('oklch(0.577 0.245 27.325)')), '#e7000b')
  assert.equal(hex(design.parseColor('navy')), '#000080')
  assert.equal(design.parseColor('transparent'), null)
  assert.equal(design.parseColor('currentColor'), null)
})

test('font names lose build hashes, weights and file-name spelling', () => {
  assert.equal(design.cleanFontName('__Inter_d65c78'), 'Inter')
  assert.equal(design.cleanFontName("'__Playfair_Display_9a8b7c'"), 'Playfair Display')
  assert.equal(design.cleanFontName('Montserrat-Bold'), 'Montserrat')
  assert.equal(design.cleanFontName('OpenSans-SemiBold'), 'Open Sans')
  assert.equal(design.cleanFontName('HelveticaNeue-Medium'), 'Helvetica Neue')
  assert.equal(design.cleanFontName('proxima-nova'), 'Proxima Nova')
  assert.equal(design.cleanFontName('Inter Variable'), 'Inter')
  assert.equal(design.cleanFontName('DMSans'), 'DM Sans')
})

test('a Next.js + Tailwind site: button and heading styles from the linked stylesheet decide colour and fonts', async () => {
  const css = `
    @font-face{font-family:'__Inter_d65c78';src:url(/inter.woff2)}
    @font-face{font-family:'__Playfair_Display_9a8b7c';src:url(/playfair.woff2)}
    .__variable_d65c78{--font-sans:'__Inter_d65c78','__Inter_Fallback_d65c78'}
    .__variable_9a8b7c{--font-display:'__Playfair_Display_9a8b7c','__Playfair_Display_Fallback_9a8b7c'}
    :root{--color-brand:oklch(54.6% 0.245 262.881);--color-ink:#111827}
    body{font-family:var(--font-sans),ui-sans-serif,system-ui;color:var(--color-ink);background:#fff}
    .font-display{font-family:var(--font-display)}
    .bg-brand{background-color:var(--color-brand)}
    .hover\\:bg-brand-dark:hover{background-color:#1447e6}
    .text-white{color:#fff}
    .bg-unused{background-color:#00ff00}
    @media (prefers-color-scheme:dark){body{background:#ff00aa}}`
  const site = website({ 'https://brand.test/_next/static/css/app.css': css })
  const result = await site.read(page('<link rel="stylesheet" href="/_next/static/css/app.css">',
    '<header><nav><a href="/">Home</a></nav></header><main><h1 class="font-display">Bold coffee</h1><a class="bg-brand text-white hover:bg-brand-dark rounded" href="/shop">Shop</a><button class="bg-brand text-white">Order</button></main>',
    '__variable_d65c78 __variable_9a8b7c'))
  close(result.colors[0], '#155dfc')
  assert.ok(!result.colors.includes('#00ff00'), 'rules no element uses are ignored')
  assert.ok(!result.colors.includes('#ff00aa'), 'dark-mode overrides are not the brand')
  assert.deepEqual(result.fonts, ['Playfair Display', 'Inter'])
})

test('a WordPress/Elementor site: kit colours and typography win over Swiper and Bootstrap defaults', async () => {
  const kit = `<style>.elementor-kit-7{--e-global-color-primary:#C8102E;--e-global-color-secondary:#1D3557;--e-global-color-text:#7A7A7A;--e-global-typography-primary-font-family:"Poppins";--e-global-typography-text-font-family:"Lato"}
    .elementor-kit-7 h1{font-family:var(--e-global-typography-primary-font-family),sans-serif}
    .elementor-kit-7{font-family:var(--e-global-typography-text-font-family),sans-serif}
    .elementor-kit-7 .elementor-button{background-color:var(--e-global-color-primary)}</style>`
  const vendor = ':root{--swiper-theme-color:#007aff;--bs-primary:#0d6efd}.btn-primary{background-color:#0d6efd}.swiper-button-next{color:var(--swiper-theme-color)}'
  const site = website({ 'https://brand.test/wp-content/themes/shop/vendor.css': vendor })
  const result = await site.read(page(`<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Poppins:400,700|Lato:400&display=swap"><link rel="stylesheet" href="/wp-content/themes/shop/vendor.css">${kit}`,
    '<header class="site-header"><a class="elementor-button" href="/contact">Contact us</a></header><h1>Padaria</h1>', 'home elementor-kit-7'))
  assert.equal(result.colors[0], '#c8102e')
  assert.ok(result.colors.includes('#1d3557'))
  assert.ok(!result.colors.includes('#007aff') && !result.colors.includes('#0d6efd'))
  assert.deepEqual(result.fonts, ['Poppins', 'Lato'])
  assert.ok(!site.requested.some(url => url.includes('fonts.googleapis')), 'Google Fonts families come from the URL, not a download')
})

test('a black-and-white brand stays black instead of picking up a stray link colour', async () => {
  const css = 'header{background:#111}.btn{background:#111;color:#fff}body{color:#222;background:#fff}a:hover{color:#2563eb}'
  const result = await website({ 'https://brand.test/style.css': css }).read(page('<link rel="stylesheet" href="style.css">',
    '<header><a class="btn" href="/">Studio</a></header><a href="/work">Work</a><button class="btn">Book</button>'))
  assert.deepEqual(result.colors, ['#111111'])
})

test('system font stacks and icon fonts are never reported as brand fonts', async () => {
  const css = `@font-face{font-family:"Font Awesome 6 Free";src:url(fa.woff2)}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
    .fa:before{font-family:"Font Awesome 6 Free";content:"\\f007"}
    .icon{font-family:"Font Awesome 6 Free"}`
  const result = await website({ 'https://brand.test/app.css': css }).read(page('<link rel="stylesheet" href="/app.css">', '<i class="fa icon"></i><h1>Hello</h1>'))
  assert.deepEqual(result.fonts, [])
})

test('Wix and shadcn style channel variables resolve inside rgb() and hsl()', async () => {
  const css = ':root{--color_18:22,94,200;--primary:346.8 77.2% 49.8%}.wixbtn{background-color:rgb(var(--color_18))}h1{color:hsl(var(--primary))}'
  const result = await website({ 'https://brand.test/site.css': css }).read(page('<link rel="stylesheet" href="/site.css">', '<a class="wixbtn" href="/book">Book</a><h1>Title</h1>'))
  assert.ok(result.colors.includes('#165ec8'))
  close(result.colors.find(hex => hex !== '#165ec8'), '#e11d48')
})

test('the logo adds its colours when the stylesheets have none', async () => {
  const logo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="80" height="80" fill="#e30613"/><rect x="100" y="20" width="100" height="40" fill="#111111"/></svg>')
  const result = await website({ 'https://brand.test/img/logo.svg': logo }).read(page('', '<header><a href="/"><img src="/img/logo.svg" alt="Brand logo"></a></header><h1>Hi</h1>'))
  assert.equal(result.colors[0], '#e30613')
  assert.equal(result.evidence.logo, 'https://brand.test/img/logo.svg')
})

test('unreachable stylesheets do not fail extraction; theme-color and one level of @import still count', async () => {
  const site = website({
    'https://cdn.brand.test/main.css': '@import url("https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Work+Sans:wght@400;600");@import "parts/buttons.css";body{font-family:"Work Sans",sans-serif}h1,h2{font-family:"DM Serif Display",serif}',
    'https://cdn.brand.test/parts/buttons.css': '.cta{background:#0f766e;color:#fff}',
  })
  const result = await site.read(page('<meta name="theme-color" content="#0f766e"><link rel="stylesheet" href="https://cdn.brand.test/main.css"><link rel="stylesheet" href="/missing.css">',
    '<h1>Garden studio</h1><a class="cta" href="/quote">Get a quote</a>'))
  assert.equal(result.colors[0], '#0f766e')
  assert.deepEqual(result.fonts, ['DM Serif Display', 'Work Sans'])
  assert.ok(site.requested.includes('https://brand.test/missing.css'))
})
