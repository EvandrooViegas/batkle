import Link from 'next/link'
import { ArrowRight, KeyRound } from 'lucide-react'
import { Container, HangingBat, arrowClass, buttonClass, cn, displayClass } from '@/components/landing/brand'
import { CREDIT_COSTS, RATE_LIMITS } from '@/lib/developer/pricing'
import {
  COLOURS, COMMON_PROPS, DOCUMENT_FIELDS, ERRORS, EXAMPLES, GRADIENT_NODE_PROPS, GRADIENT_PROPS, IMAGE_PROPS, LIMIT_ROWS,
  SHAPE_PROPS, SPAN_PROPS, TEXT_PROPS, codeExamples,
} from './apiReference'
import { CodeBlock, CodeTabs } from './CodeTabs'

const DASHBOARD = '/developers/dashboard'
const lead = 'text-[17px] leading-[1.7] text-bk-muted'
const body = 'max-w-[720px] text-[16px] leading-[1.7] text-bk-muted'
const h2 = cn(displayClass, 'scroll-mt-28 text-[clamp(28px,calc(1.6vw+16px),38px)] leading-[1.08]')
const h3 = 'scroll-mt-28 font-bk-display text-[24px] font-bold tracking-[-0.03em]'
const h4 = 'mt-8 text-[13px] font-bold uppercase tracking-[0.12em] text-bk-muted'
const code = 'rounded-[5px] bg-bk-chip px-1.5 py-0.5 font-mono text-[0.86em] text-bk-fg'
const json = value => JSON.stringify(value, null, 2)
const example = name => `/developers/examples/${name}.png`

/** Properties as a stacked list, so they read at phone width without a sideways scroll. */
function Props({ rows, className = 'mt-5' }) {
  return (
    <dl className={cn('max-w-[820px] divide-y divide-bk-line border-y border-bk-line', className)}>
      {rows.map(([name, type, fallback, text]) => (
        <div key={name} className="py-3.5">
          <dt className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <code className="font-mono text-[14px] font-bold">{name}</code>
            <span className="font-mono text-[12px] text-bk-muted">{type}</span>
            {/* A literal default is code; one described in words ("the node’s") is plain text. */}
            {fallback && <span className="text-[12px] text-bk-muted">default {/^["{\[\d-]|^(true|false)$/.test(fallback) ? <code className="font-mono text-bk-fg/80">{fallback}</code> : <span className="text-bk-fg/80">{fallback}</span>}</span>}
          </dt>
          {text && <dd className="mt-1 max-w-[720px] text-[15px] leading-relaxed text-bk-muted">{text}</dd>}
        </div>
      ))}
    </dl>
  )
}

/** A rendered example: the image the API returned for the document beside it. */
function Preview({ src, alt, ratio = 'aspect-square', className = '' }) {
  return (
    <figure className={className}>
      <img src={src} alt={alt} loading="lazy" className={cn('w-full rounded-xl border border-bk-line bg-bk-alt object-cover shadow-bk-card', ratio)} />
      <figcaption className="mt-2 text-[13px] text-bk-muted">The image the API returned.</figcaption>
    </figure>
  )
}

function Example({ name, document, ratio }) {
  return (
    <div className="mt-6 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <CodeBlock label="post.json" code={json(document)} scroll />
      <Preview src={example(name)} alt={`The example ${name} post, rendered.`} ratio={ratio} className="max-w-[360px]" />
    </div>
  )
}

/** Where a node goes: x and y from the top-left corner of the post, then its width and height. */
function CoordinatesDiagram() {
  return (
    <figure className="mt-6 max-w-[520px]">
      <svg viewBox="0 0 560 360" role="img" aria-labelledby="coords-title" className="w-full text-bk-fg">
        <title id="coords-title">A post with a node placed x pixels from the left edge and y pixels from the top, sized by its width and height.</title>
        <rect x="40" y="20" width="480" height="320" rx="10" className="fill-bk-surface stroke-bk-field" strokeWidth="2" />
        <text x="52" y="44" className="fill-bk-muted font-mono" fontSize="13">0, 0</text>
        <rect x="200" y="140" width="210" height="120" rx="6" className="fill-bk-butter" />
        <text x="305" y="205" textAnchor="middle" className="fill-bk-ink font-bk-display" fontSize="18" fontWeight="700">node</text>
        <g className="stroke-current" strokeWidth="1.5">
          <line x1="40" y1="200" x2="194" y2="200" strokeDasharray="0" />
          <line x1="300" y1="20" x2="300" y2="134" />
          <line x1="200" y1="276" x2="410" y2="276" />
          <line x1="426" y1="140" x2="426" y2="260" />
        </g>
        <g className="fill-current">
          <path d="M194 200l-8-4v8z" /><path d="M300 134l-4-8h8z" />
          <path d="M200 276l8-4v8z" /><path d="M410 276l-8-4v8z" />
          <path d="M426 140l-4 8h8z" /><path d="M426 260l-4-8h8z" />
        </g>
        <g className="fill-current font-mono" fontSize="14" fontWeight="700">
          <text x="117" y="192" textAnchor="middle">x</text>
          <text x="312" y="80">y</text>
          <text x="305" y="298" textAnchor="middle">width</text>
          <text x="436" y="205">height</text>
        </g>
      </svg>
    </figure>
  )
}

const NAV = [
  ['quickstart', 'Quickstart'],
  ['authentication', 'Authentication'],
  ['request', 'The request'],
  ['nodes', 'Nodes'],
  ['text', 'Text', true],
  ['image', 'Image', true],
  ['shape', 'Shape', true],
  ['gradient', 'Gradient', true],
  ['full-post', 'A full post'],
  ['carousels', 'Carousels'],
  ['response', 'The response'],
  ['fonts', 'Fonts and colours'],
  ['editor', 'From the editor'],
  ['credits', 'Credits'],
  ['errors', 'Errors'],
  ['limits', 'Limits'],
]

/** The developer docs: one endpoint, the post document it takes, and every node it draws. */
export default function DeveloperDocs({ origin, starterCredits }) {
  const base = `${origin}/api`

  return (
    <>
      <section className="bg-bk-bg px-3 py-3 sm:px-5 sm:py-5">
        <div className="mx-auto max-w-[1600px] overflow-hidden rounded-[24px] border border-bk-line bg-[#EFEEE9] dark:bg-bk-alt">
          <Container className="grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:gap-16 lg:py-24">
            <div>
              <p className="text-[13px] font-bold uppercase tracking-[0.14em] text-bk-muted">Developers</p>
              <h1 className={cn(displayClass, 'mt-4 text-[clamp(40px,calc(4vw+12px),72px)] leading-[0.98]')}>
                Describe a post. <br className="hidden sm:inline" />Get the image back.
              </h1>
              <p className={cn(lead, 'mt-6 max-w-[580px] sm:text-[19px]')}>
                Send the Batkle API a post as JSON (its text, images, shapes and gradients, each where you want it) and it answers with the finished PNG. A carousel comes back with one PNG per slide.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={DASHBOARD} className={buttonClass('primary', 'md')}><KeyRound className="size-[18px]" aria-hidden="true" />Get an API key</Link>
                <a href="#quickstart" className={buttonClass('outline', 'md')}>Read the quickstart</a>
              </div>
              <p className="mt-5 text-[14px] text-bk-muted">
                {CREDIT_COSTS.image} credit per image.{starterCredits > 0 ? ` Every account starts with ${starterCredits} free credits.` : ''}
              </p>
            </div>
            <figure className="mx-auto w-full max-w-[400px]">
              <img src={example('post')} alt="A real-estate post with a kitchen photo, a headline, a line of details and a yellow button, made by the API." className="aspect-[4/5] w-full rounded-2xl border border-bk-line object-cover shadow-bk-pop" />
              <figcaption className="mt-3 text-center text-[13px] text-bk-muted">
                Made with one request. <a href="#full-post" className="font-semibold text-bk-fg underline underline-offset-4">See it</a>
              </figcaption>
            </figure>
          </Container>
        </div>
      </section>

      <Container className="grid gap-12 pb-24 pt-14 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16 lg:pt-20">
        <nav aria-label="On this page" className="hidden lg:block">
          <div className="sticky top-28">
            <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-bk-muted">On this page</p>
            <ul className="mt-4 space-y-0.5 border-l border-bk-line">
              {NAV.map(([id, label, sub]) => (
                <li key={id}>
                  <a href={`#${id}`} className={cn('-ml-px block border-l-2 border-transparent py-1 text-bk-fg/75 transition-colors hover:border-bk-fg hover:text-bk-fg', sub ? 'pl-7 text-[13.5px]' : 'pl-4 text-[14.5px]')}>{label}</a>
                </li>
              ))}
            </ul>
            <Link href={DASHBOARD} className="mt-8 inline-flex items-center gap-1.5 text-[14px] font-bold hover:underline hover:underline-offset-4">Open the dashboard<ArrowRight className="size-4" aria-hidden="true" /></Link>
          </div>
        </nav>

        <article className="min-w-0 space-y-20">
          <section aria-labelledby="quickstart">
            <h2 id="quickstart" className={h2}>Quickstart</h2>
            <ol className="mt-8 space-y-10">
              <li className="grid gap-x-6 gap-y-3 sm:grid-cols-[40px_minmax(0,1fr)]">
                <span className="flex size-9 items-center justify-center rounded-full bg-bk-butter text-[15px] font-bold text-bk-ink">1</span>
                <div>
                  <h3 className={h3}>Create a key</h3>
                  <p className={cn(body, 'mt-2')}>
                    Sign in and open the <Link href={DASHBOARD} className="font-semibold text-bk-fg underline underline-offset-4">developer dashboard</Link>. Create a key and keep it on your server, for example as <code className={code}>BATKLE_API_KEY</code>.
                  </p>
                </div>
              </li>
              <li className="grid gap-x-6 gap-y-3 sm:grid-cols-[40px_minmax(0,1fr)]">
                <span className="flex size-9 items-center justify-center rounded-full bg-bk-butter text-[15px] font-bold text-bk-ink">2</span>
                <div className="min-w-0">
                  <h3 className={h3}>Send a post</h3>
                  <p className={cn(body, 'mt-2')}>
                    POST the post to <code className={code}>/api/v1/posts</code>: its size, its background and its nodes. This one has a line of text and a short bar.
                  </p>
                  <CodeTabs examples={codeExamples(base, EXAMPLES.quickstart, { inline: true })} label="Send a post" className="mt-4" />
                </div>
              </li>
              <li className="grid gap-x-6 gap-y-3 sm:grid-cols-[40px_minmax(0,1fr)]">
                <span className="flex size-9 items-center justify-center rounded-full bg-bk-butter text-[15px] font-bold text-bk-ink">3</span>
                <div className="min-w-0">
                  <h3 className={h3}>Get the image</h3>
                  <p className={cn(body, 'mt-2')}>The answer is the PNG itself, saved here as <code className={code}>post.png</code>.</p>
                  <Preview src={example('quickstart')} alt="A yellow square with “Hello from the Batkle API” in large black letters and a short black bar." className="mt-4 max-w-[300px]" />
                </div>
              </li>
            </ol>
          </section>

          <section aria-labelledby="authentication">
            <h2 id="authentication" className={h2}>Authentication</h2>
            <p className={cn(lead, 'mt-5 max-w-[720px]')}>
              Every request carries an API key in the <code className={code}>Authorization</code> header. Keys start with <code className={code}>bk_live_</code> and spend your account’s credits.
            </p>
            <CodeBlock label="Header" code="Authorization: Bearer bk_live_…" className="mt-5 max-w-[560px]" />
            <ul className="mt-6 max-w-[720px] list-disc space-y-2 pl-5 text-[16px] leading-relaxed text-bk-muted">
              <li>Call the API from your server. A key in a browser or an app can be read by anyone who has them.</li>
              <li>A key is shown once, when you create it. Batkle keeps only a fingerprint of it.</li>
              <li>Revoke a key in the dashboard and it stops working at once. Use one key per place it runs, so you can revoke one alone.</li>
            </ul>
          </section>

          <section aria-labelledby="request">
            <h2 id="request" className={h2}>The request</h2>
            <p className={cn(lead, 'mt-5 max-w-[720px]')}>
              There is one endpoint: <code className={code}>POST /api/v1/posts</code>, with the post as a JSON body. A post is a size, a background and a list of nodes, the layers of the design.
            </p>
            <Props rows={DOCUMENT_FIELDS} />
            <h3 className={cn(h3, 'mt-12')}>Where nodes go</h3>
            <p className={cn(body, 'mt-3')}>
              Positions and sizes are in pixels. <code className={code}>x</code> and <code className={code}>y</code> are measured from the top-left corner of the post to the top-left corner of the node. Nodes are drawn in the order of the list, so a later node covers an earlier one. A node can reach past the edges; whatever falls outside the post is cut off.
            </p>
            <CoordinatesDiagram />
          </section>

          <section aria-labelledby="nodes">
            <h2 id="nodes" className={h2}>Nodes</h2>
            <p className={cn(lead, 'mt-5 max-w-[720px]')}>
              There are four kinds of node, the same as the layers in the Batkle editor: <a href="#text" className="font-semibold text-bk-fg underline underline-offset-4">text</a>, <a href="#image" className="font-semibold text-bk-fg underline underline-offset-4">image</a>, <a href="#shape" className="font-semibold text-bk-fg underline underline-offset-4">shape</a> and <a href="#gradient" className="font-semibold text-bk-fg underline underline-offset-4">gradient</a>. Every node takes these properties; the sections below list the rest. A property that isn’t listed is an error, so a typo never fails silently.
            </p>
            <Props rows={COMMON_PROPS} />

            <div className="mt-16 space-y-16">
              <div>
                <h3 id="text" className={h3}>Text</h3>
                <p className={cn(body, 'mt-3')}>A box of text that wraps at its width. Without a width, text keeps the same margin on both sides of the post; without a height, its box runs to the bottom edge.</p>
                <Props rows={TEXT_PROPS} />
                <h4 className={h4}>Spans: styling some words</h4>
                <p className={cn(body, 'mt-3')}>
                  To colour, highlight or change the font of some words, send <code className={code}>text</code> as an array. Plain strings take the node’s style; objects change what they set.
                </p>
                <CodeBlock label="text" className="mt-4 max-w-[720px]" code={json(['Water your plants ', { text: 'less', background: '#FFD84D', padding: 12 }, ', not more.'])} />
                <Props rows={SPAN_PROPS} />
                <Example name="text" document={EXAMPLES.text} />
              </div>

              <div>
                <h3 id="image" className={h3}>Image</h3>
                <p className={cn(body, 'mt-3')}>A picture from a URL, fitted into its box. Rounded corners, masks, crops and colour filters change how it looks.</p>
                <Props rows={IMAGE_PROPS} />
                <Example name="image" document={EXAMPLES.image} />
              </div>

              <div>
                <h3 id="shape" className={h3}>Shape</h3>
                <p className={cn(body, 'mt-3')}>A rectangle or an ellipse in one colour, with an optional outline. Thin rectangles make lines and dividers; rounded ones make buttons and pills.</p>
                <Props rows={SHAPE_PROPS} />
                <Example name="shape" document={EXAMPLES.shape} />
              </div>

              <div>
                <h3 id="gradient" className={h3}>Gradient</h3>
                <p className={cn(body, 'mt-3')}>A rectangle or an ellipse filled with a gradient: for glows, for overlays that keep text readable on a photo, and for colour washes.</p>
                <Props rows={GRADIENT_NODE_PROPS} />
                <h4 className={h4}>The gradient object</h4>
                <p className={cn(body, 'mt-3')}>
                  The same object fills a gradient node, the letters of a text node (its <code className={code}>gradient</code>) and the post’s <code className={code}>background</code>.
                </p>
                <Props rows={GRADIENT_PROPS} />
                <Example name="gradient" document={EXAMPLES.gradient} />
              </div>
            </div>
          </section>

          <section aria-labelledby="full-post">
            <h2 id="full-post" className={h2}>A full post</h2>
            <p className={cn(lead, 'mt-5 max-w-[720px]')}>
              The post at the top of this page: a photo, a gradient that darkens its lower part, a headline with one coloured span, a line of details, and a button made of a shape with text on it.
            </p>
            <Example name="post" document={EXAMPLES.post} ratio="aspect-[4/5]" />
            <p className={cn(body, 'mt-6')}>Save the body as <code className={code}>post.json</code> and send it:</p>
            <CodeTabs examples={codeExamples(base, EXAMPLES.post)} label="Send post.json" className="mt-4" />
          </section>

          <section aria-labelledby="carousels">
            <h2 id="carousels" className={h2}>Carousels</h2>
            <p className={cn(lead, 'mt-5 max-w-[720px]')}>
              For a carousel, send <code className={code}>slides</code> instead of <code className={code}>nodes</code>: 2 to 10 slides, each with its own nodes and, if it differs from the post’s, its own background. Every slide has the post’s size. The answer is a ZIP with one PNG per slide, named <code className={code}>slide-01.png</code>, <code className={code}>slide-02.png</code> and so on.
            </p>
            <div className="mt-6 grid max-w-[720px] grid-cols-3 gap-3">
              {[1, 2, 3].map(i => <img key={i} src={example(`carousel-${i}`)} alt={`Slide ${i} of the example carousel.`} loading="lazy" className="aspect-[4/5] w-full rounded-lg border border-bk-line object-cover shadow-bk-card" />)}
            </div>
            <CodeBlock label="post.json" code={json(EXAMPLES.carousel)} className="mt-6" scroll />
            <CodeTabs examples={codeExamples(base, EXAMPLES.carousel)} label="Send a carousel" className="mt-4" />
            <p className={cn(body, 'mt-6')}>
              To get one slide as a PNG, add <code className={code}>"slide": 2</code> to the body. Only that slide is rendered, for one credit: handy to preview a slide, or to fetch slides one at a time.
            </p>
          </section>

          <section aria-labelledby="response">
            <h2 id="response" className={h2}>The response</h2>
            <p className={cn(lead, 'mt-5 max-w-[720px]')}>
              A successful request answers <code className={code}>200</code> with the image in the body: <code className={code}>image/png</code> for a single post or one slide, <code className={code}>application/zip</code> for a carousel. Batkle keeps no copy, so save it. These headers come with it:
            </p>
            <Props rows={[
              ['X-Credits-Charged', 'integer', '', 'Credits this request cost.'],
              ['X-Credits-Remaining', 'integer', '', 'Your balance after it.'],
              ['X-Images', 'integer', '', 'How many images it rendered.'],
              ['X-Request-Id', 'string', '', 'Quote it when you contact us about a request.'],
            ]} />
            <p className={cn(body, 'mt-6')}>An error answers with JSON instead; see <a href="#errors" className="font-semibold text-bk-fg underline underline-offset-4">Errors</a>. Most posts take one to three seconds a slide, a little longer the first time a font or image is used.</p>
          </section>

          <section aria-labelledby="fonts">
            <h2 id="fonts" className={h2}>Fonts and colours</h2>
            <p className={cn(body, 'mt-5')}>
              <code className={code}>fontFamily</code> takes the name of any font on Google Fonts, as it is written there: <code className={code}>"Poppins"</code>, <code className={code}>"Playfair Display"</code>, <code className={code}>"Bebas Neue"</code>. Batkle loads the weight you ask for, or the nearest one the font has. A name it can’t find falls back to Inter. System fonts such as Arial and Helvetica aren’t available.
            </p>
            <p className={cn(body, 'mt-4')}>
              Fonts are loaded with their Latin characters, which covers English and the other Western European languages, accents included (ã, é, ç, ß). Emoji, arrows such as →, and other scripts such as Greek, Cyrillic or Arabic are not drawn yet.
            </p>
            <p className={cn(body, 'mt-4')}>{COLOURS} Gradient stops take hex colours only.</p>
          </section>

          <section aria-labelledby="editor">
            <h2 id="editor" className={h2}>From the editor</h2>
            <p className={cn(lead, 'mt-5 max-w-[720px]')}>
              The quickest way to a good layout is to design it in Batkle. Open any post in the editor, go to the <strong className="font-semibold text-bk-fg">API</strong> tab and copy it as a request: you get this same JSON for the design, with every node in place. Change its texts and image URLs from your code, and send it.
            </p>
          </section>

          <section aria-labelledby="credits">
            <h2 id="credits" className={h2}>Credits</h2>
            <p className={cn(lead, 'mt-5 max-w-[720px]')}>
              Each image costs {CREDIT_COSTS.image} credit: a single post is one, a carousel one per slide. Credits are taken when rendering starts and given back if it fails. When the balance is too low, the request fails with <code className={code}>402 insufficient_credits</code> and nothing is rendered.
              {starterCredits > 0 ? ` New accounts start with ${starterCredits} free credits.` : ''} The dashboard shows your balance and what each key used.
            </p>
          </section>

          <section aria-labelledby="errors">
            <h2 id="errors" className={h2}>Errors</h2>
            <p className={cn(lead, 'mt-5 max-w-[720px]')}>
              Errors use HTTP status codes and a JSON body with a stable <code className={code}>type</code> for your code and a <code className={code}>message</code> for people. Messages about the body name the property at fault.
            </p>
            <CodeBlock
              label="Response 400"
              className="mt-5 max-w-[720px]"
              code={json({ error: { type: 'invalid_request', message: '"nodes[1].fontsize" is not a property here. Did you mean "fontSize"?', request_id: 'req_4f0c2a9e1b7d4c3a8e6f5d21' } })}
            />
            <dl className="mt-6 max-w-[820px] divide-y divide-bk-line border-y border-bk-line">
              {ERRORS.map(([status, type, text]) => (
                <div key={status} className="grid gap-x-5 gap-y-1 py-3.5 sm:grid-cols-[52px_190px_minmax(0,1fr)]">
                  <dt className="font-mono text-[14px] font-bold tabular-nums">{status}</dt>
                  <dd className="font-mono text-[13px] text-bk-fg/85">{type}</dd>
                  <dd className="text-[15px] leading-relaxed text-bk-muted">{text}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="limits">
            <h2 id="limits" className={h2}>Limits</h2>
            <dl className="mt-6 max-w-[720px] divide-y divide-bk-line border-y border-bk-line">
              {LIMIT_ROWS.map(([label, value]) => (
                <div key={label} className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-3.5 text-[15px]">
                  <dt className="font-semibold">{label}</dt>
                  <dd className="text-bk-muted">{value}</dd>
                </div>
              ))}
            </dl>
            <p className={cn(body, 'mt-5')}>Over {RATE_LIMITS.perKey} requests a minute, the API answers <code className={code}>429</code> with a <code className={code}>Retry-After</code> header: wait that many seconds, then try again.</p>
          </section>
        </article>
      </Container>

      <section className="bg-bk-bg pb-20 sm:pb-28">
        <Container>
          <div className="relative overflow-hidden rounded-[20px] bg-bk-ink px-6 pb-14 pt-32 sm:px-12 sm:py-20 lg:px-16 dark:bg-bk-surface dark:ring-1 dark:ring-inset dark:ring-bk-line">
            <HangingBat className="absolute right-8 top-0 text-[44px] text-bk-butter sm:right-[10%] sm:text-[60px]" stemClassName="h-[44px] sm:h-[96px]" />
            <h2 className="font-bk-display text-[clamp(32px,4vw,50px)] font-bold leading-[1.05] tracking-[-0.02em] text-bk-cream">Render your first post <br className="hidden sm:inline" />in a minute.</h2>
            <p className="mt-6 max-w-[520px] text-[18px] leading-relaxed text-[#C4C1CE]">Create a key, send a few nodes, and get the image back.</p>
            <Link href={DASHBOARD} className={buttonClass('primary', 'lg', 'mt-8')}>Get an API key <ArrowRight className={arrowClass} aria-hidden="true" /></Link>
          </div>
        </Container>
      </section>
    </>
  )
}
