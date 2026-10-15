import Link from 'next/link'
import { ArrowRight, ArrowUpRight, Check, Plus, X } from 'lucide-react'
import LandingHeader from './LandingHeader'
import HeroArt from './HeroArt'
import BrandDemo from './BrandDemo'
import AppPreview from './AppPreview'
import { PlatformIcon } from '@/components/app/schedule/platforms'
import ScrollReveal from './ScrollReveal'
import SmoothScroll from './SmoothScroll'
import PricingPlans from './PricingPlans'
import NewsletterForm from './NewsletterForm'
import { CONTACT } from '@/lib/billing/plans'
import { contactHref } from '@/lib/client/billing'
import { creditFaqAnswer, creditPackNote, newsletterBlurb, newsletterTitle, pricingFaqAnswer, pricingIntro, trialNote } from './pricingText'
import {
  BatkleLogo,
  Card,
  CardTitle,
  Container,
  Eyebrow,
  HangingBat,
  Section,
  SectionTitle,
  arrowClass,
  buttonClass,
  cn,
  reveal,
} from './brand'

const START_HREF = '/app'

// One avatar per sample brand in the demo, plus one more.
const BRAND_AVATARS = [
  { letter: 'F', className: 'bg-[#F2A900] text-bk-ink' },
  { letter: 'N', className: 'bg-[#3B5BFF] text-white' },
  { letter: 'C', className: 'bg-[#1F7A5A] text-white' },
  { letter: 'S', className: 'bg-[#E4572E] text-bk-ink' },
  { letter: 'K', className: 'bg-bk-ink text-bk-butter dark:bg-bk-chip' },
]

const INDUSTRIES = ['Construction', 'Fintech', 'Local services', 'Agencies', 'Creative studios']

const STEPS = [
  {
    title: 'Add your brand',
    body: 'Paste your website. In about a minute Batkle reads up to five pages and writes your brand profile: services, projects, audience, tone of voice, language, colors, fonts and logo. You confirm the name and post language; everything else stays editable.',
  },
  {
    title: 'Pick your designs',
    body: 'Choose styles from the Design Library, each previewed in your own colors, fonts and logo. A design is a visual language, not a fixed template, so every post varies while keeping one look. Pick several for more variety.',
  },
  {
    title: 'Create posts',
    body: 'Describe a post or let Batkle suggest one from your services and projects. One click writes the headline, slides, caption and hashtags and designs it as a single post or a carousel (1080×1350), with AI images, stock photos or your own gallery.',
  },
  {
    title: 'Edit anything',
    body: 'Every text, shape, image and logo stays editable in the editor, slide by slide. Rebuild the design and keep the copy, or ask for a new version.',
  },
  {
    title: 'Approve and schedule',
    body: 'Approve the posts you like and choose where and when each one goes out: Instagram, TikTok or both. When it’s time, its slides and caption are ready on the Schedule page.',
  },
]

const AUDIENCES = [
  {
    title: 'Small businesses',
    body: 'Stay visible on Instagram without hiring a designer. Batkle already knows your services and your projects.',
  },
  {
    title: 'Agencies',
    body: 'Give every client their own workspace, brand profile and look, and keep each one consistent from post to post.',
  },
  {
    title: 'Marketers',
    body: 'Go from idea to a finished carousel in one click and keep your time for strategy.',
  },
]

const WITHOUT = [
  'Brief a designer for every post',
  'Write every caption from scratch',
  'Watch the brand look drift from post to post',
  'Go quiet when the week gets busy',
]
const WITH = [
  'Paste your website once',
  'Pick the designs you like',
  'Get on-brand posts in one click',
  'Edit anything you want',
  'Approve and schedule them for Instagram and TikTok',
]

// Placeholders from the design: replace with real customer quotes before launch.
const QUOTES = [
  '[CUSTOMER QUOTE: one or two sentences about how Batkle changed their posting routine.]',
  '[CUSTOMER QUOTE: a second quote, ideally about staying on brand or saving time.]',
]

const FAQS = [
  {
    q: 'How does Batkle learn my brand?',
    a: 'Paste your website URL. Batkle reads up to five pages and builds a brand profile with your services, projects, audience, tone of voice, language, colors, fonts and logo. You can edit every part of it.',
  },
  {
    q: 'Can I edit the posts it creates?',
    a: 'Yes. Every text, shape, image and logo stays editable in the canvas editor. The AI drafts, you decide.',
  },
  {
    q: 'Which languages does it write in?',
    a: "Your brand's language, picked up from your website. A business in Lisbon gets European Portuguese, not a translation. You can change it in the brand profile.",
  },
  {
    q: 'Does every post look the same?',
    a: 'No. Each design in the Design Library is a visual language learned from real posts, not a fixed template, so every post varies while keeping one recognizable look.',
  },
  {
    q: 'Can I use my own photos?',
    a: "Yes. Useful photos from your website go into your brand's gallery automatically, and you can upload your own or attach them to a single post idea. Batkle uses them alongside stock photos and AI-generated images and cutouts.",
  },
  {
    q: 'Can Batkle post to Instagram and TikTok for me?',
    a: "You approve posts and schedule them for Instagram, TikTok or both. Batkle doesn't publish on its own yet: when a post is due, the Schedule page has its slides ready to download and its caption ready to copy.",
  },
  {
    q: 'Can I manage more than one brand?',
    a: 'Yes. Each brand gets its own profile, designs, ideas, gallery and schedule, and you switch between them from the sidebar. Agencies give every client their own.',
  },
  {
    q: 'How much does it cost?',
    a: pricingFaqAnswer(),
  },
  {
    q: 'What is a credit?',
    a: creditFaqAnswer(),
  },
  {
    q: 'Is there an API?',
    a: 'Yes. Send the Batkle API a post or a carousel as JSON (its text, images, shapes and gradients) and it sends back the finished images, for one credit each. Developers, in the menu, has the docs.',
  },
]

// Full paths, so the footer also works on the other pages that share it (such as /developers).
const FOOTER_LINKS = [
  {
    title: 'Product',
    links: [
      ['How it works', '/#how-it-works'],
      ['Features', '/#features'],
      ['Pricing', '/#pricing'],
      ['FAQ', '/#faq'],
    ],
  },
  {
    title: 'Developers',
    links: [
      ['API docs', '/developers'],
      ['API & usage', '/developers/dashboard'],
    ],
  },
  {
    title: 'Company',
    links: [
      // NEXT_PUBLIC_CONTACT_EMAIL, once it is set.
      ['Contact', contactHref() || '#'],
      ['Privacy', '#'],
      ['Terms', '#'],
    ],
  },
]

// The hero panel colour. The avatar rings use it too, so they read as cut-outs.
const heroPanel = 'bg-[#EFEEE9] dark:bg-bk-alt'
const heroRing = 'ring-[#EFEEE9] dark:ring-bk-alt'

function WebsiteForm() {
  // A plain GET form, so it works before hydration: /app?website=...
  return (
    <form
      action={START_HREF}
      method="get"
      className="mx-auto mt-[clamp(10px,2.2svh,32px)] flex w-full max-w-[560px] items-center gap-2 rounded-xl border-2 border-bk-fg bg-bk-surface p-1.5 pl-4 transition-shadow focus-within:shadow-[0_0_0_4px_rgb(255_216_77/0.55)] motion-safe:animate-bk-enter sm:p-2 sm:pl-5"
      style={{ animationDelay: '280ms' }}
    >
      <label htmlFor="bk-hero-website" className="sr-only">
        Your website
      </label>
      <input
        id="bk-hero-website"
        name="website"
        type="text"
        inputMode="url"
        autoComplete="url"
        spellCheck={false}
        placeholder="yourwebsite.com"
        className="h-[clamp(40px,5.4svh,52px)] min-w-0 flex-1 bg-transparent text-[16px] text-bk-fg outline-none placeholder:text-bk-muted/80 sm:text-[18px]"
      />
      <button
        type="submit"
        className="h-[clamp(40px,5.4svh,52px)] shrink-0 rounded-lg bg-bk-ink px-3.5 text-[15px] min-[380px]:px-4 min-[380px]:text-[16px] font-bold text-bk-butter transition-[background-color,transform] duration-200 hover:bg-black active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg dark:bg-bk-butter dark:text-bk-ink dark:hover:bg-[#FFCD24] sm:px-6 sm:text-[17px]"
      >
        Add your brand
      </button>
    </form>
  )
}

function Thumb({ kind }) {
  if (kind === 'schedule') {
    return (
      <span className="flex size-[clamp(36px,6svh,52px)] shrink-0 flex-col overflow-hidden rounded-[5px] bg-bk-surface ring-1 ring-bk-ink/10">
        <span className="h-[30%] bg-bk-butter" />
        <span className="flex flex-1 items-center justify-center gap-[3px] text-bk-ink dark:text-bk-fg">
          <PlatformIcon id="instagram" className="size-[clamp(10px,1.7svh,14px)]" />
          <PlatformIcon id="tiktok" className="size-[clamp(10px,1.7svh,14px)]" />
        </span>
      </span>
    )
  }
  if (kind === 'palette') {
    return (
      <span className="grid size-[clamp(36px,6svh,52px)] shrink-0 grid-cols-2 overflow-hidden rounded-[4px] ring-1 ring-bk-ink/10">
        <span className="bg-bk-ink" />
        <span className="bg-[#F2A900]" />
        <span className="bg-[#F5F1E8]" />
        <span className="bg-[#3B5BFF]" />
      </span>
    )
  }
  const dark = kind === 'story'
  return (
    <span
      className={cn(
        'flex h-[clamp(44px,7.4svh,64px)] w-[clamp(36px,6svh,52px)] shrink-0 flex-col justify-center overflow-hidden rounded-[3px] p-[4px] font-bk-display text-[7px] font-bold leading-[1.05] tracking-[-0.02em] ring-1 sm:text-[8px]',
        dark ? 'justify-end bg-bk-ink text-bk-butter ring-white/10' : 'bg-bk-butter text-bk-ink ring-bk-ink/10',
      )}
      lang="pt-PT"
    >
      {dark ? 'A nossa história.' : 'Menos tarefas, mais tempo.'}
    </span>
  )
}

const HERO_CARDS = [
  { label: 'Brand profile', title: 'Learns your brand from your URL', href: '#how-it-works', thumb: 'palette' },
  { label: 'Creation', title: 'Finished posts in one click', href: '#studio', thumb: 'story' },
  { label: 'Schedule', title: 'Plan Instagram and TikTok', href: '#schedule', thumb: 'schedule' },
]

/**
 * The hero is exactly one screen: the panel fills the viewport below the sticky header (65 px, 73 px from sm) and
 * its type, spacing and cards scale with the screen height, so nothing falls below the fold. The illustration takes
 * whatever height is left, with the cards resting on its lower edge. Very short screens let the panel grow instead.
 */
function Hero() {
  return (
    <section className="bg-bk-bg px-3 py-3 sm:px-5 sm:py-5">
      <div
        className={cn(
          'mx-auto flex min-h-[calc(100svh-89px)] max-w-[1600px] flex-col overflow-hidden rounded-[24px] border border-bk-line sm:min-h-[min(calc(100svh-113px),1100px)]',
          heroPanel,
        )}
      >
        <div className="px-5 pt-[clamp(16px,3.6svh,96px)] text-center sm:px-8">
          <h1
            className="mx-auto max-w-[9.2em] font-bk-display text-[length:clamp(28px,min(9.4vw,5.4svh),104px)] font-bold leading-[0.98] tracking-[-0.025em] motion-safe:animate-bk-enter sm:text-[length:clamp(36px,min(7.3vw,7.4svh),104px)]"
          >
            Paste your website. <br className="hidden sm:inline" />
            Get{' '}
            <span className="relative isolate whitespace-nowrap dark:text-bk-ink">
              <span
                aria-hidden="true"
                className="absolute -inset-x-[0.04em] bottom-[-0.06em] top-[0.79em] -z-10 bg-bk-butter dark:top-[0.1em]"
              />
              on-brand
            </span>{' '}
            <br className="hidden sm:inline" />
            Instagram posts.
          </h1>

          <div
            className="mt-[clamp(8px,1.6svh,28px)] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 motion-safe:animate-bk-enter"
            style={{ animationDelay: '70ms' }}
          >
            <span className="flex" aria-hidden="true">
              {BRAND_AVATARS.map((a, i) => (
                <span
                  key={a.letter}
                  className={cn(
                    'flex size-[26px] items-center justify-center rounded-full text-[11px] font-bold ring-2',
                    heroRing,
                    i > 0 && '-ml-1.5',
                    a.className,
                  )}
                >
                  {a.letter}
                </span>
              ))}
            </span>
            <span className="text-[13px] text-bk-muted sm:text-[15px]">One website each, a different look for every brand.</span>
          </div>

          <p
            className="mx-auto mt-[clamp(6px,1.4svh,24px)] max-w-[620px] text-[length:clamp(14px,2.1svh,17px)] leading-[1.45] text-bk-muted motion-safe:animate-bk-enter sm:text-[length:clamp(15px,2.1svh,19px)]"
            style={{ animationDelay: '140ms' }}
          >
            Batkle learns your brand from your website, then writes and designs posts in your language, colors, fonts
            and logo, ready to schedule for Instagram and TikTok.
          </p>

          <WebsiteForm />
        </div>

        {/* The illustration fills the remaining height; the cards rest on its lower edge. Below lg they swipe. */}
        <div className="relative mt-[clamp(8px,1.6svh,40px)] flex min-h-[clamp(120px,20svh,300px)] flex-1 flex-col justify-end">
          <HeroArt className="absolute inset-0 h-full w-full motion-safe:animate-bk-art" />
          <ul className="relative z-10 mx-4 flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden rounded-t-[14px] bg-bk-surface [scrollbar-width:none] sm:mx-auto sm:w-full sm:max-w-[760px] lg:grid lg:max-w-[1000px] lg:grid-cols-3 lg:overflow-hidden [&::-webkit-scrollbar]:hidden">
            {HERO_CARDS.map((card, i) => (
              <li key={card.label} className={cn('w-[84%] shrink-0 snap-start sm:w-[48%] lg:w-auto', i > 0 && 'border-l border-bk-line')}>
                <a
                  href={card.href}
                  className="group flex h-full min-h-[clamp(88px,14svh,156px)] flex-col justify-between gap-[clamp(6px,1.2svh,12px)] p-[clamp(12px,1.9svh,20px)] transition-colors hover:bg-bk-alt/60 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bk-fg"
                >
                  <span className="flex items-center justify-between text-[13px] text-bk-fg/85">
                    {card.label}
                    <ArrowUpRight
                      className="size-3.5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </span>
                  <span className="flex items-end justify-between gap-4">
                    <span className="max-w-[9.5em] font-bk-display text-[length:clamp(16px,2.3svh,19px)] font-bold leading-[1.2] tracking-[-0.01em]">
                      {card.title}
                    </span>
                    <span aria-hidden="true">
                      <Thumb kind={card.thumb} />
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative border-t border-bk-line bg-bk-surface">
          <div className="flex items-center gap-x-6 overflow-x-auto whitespace-nowrap px-4 py-[clamp(10px,1.8svh,20px)] text-[13px] [scrollbar-width:none] sm:mx-auto sm:max-w-[760px] sm:px-0 sm:text-[15px] lg:max-w-[1000px] lg:gap-x-8 [&::-webkit-scrollbar]:hidden">
            <span className="shrink-0 text-bk-muted">Built for teams in</span>
            <ul className="flex shrink-0 gap-x-6 font-bold lg:gap-x-8">
              {INDUSTRIES.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

function HowItWorks() {
  return (
    <Section id="how-it-works" tone="alt">
      <Eyebrow>How it works</Eyebrow>
      <SectionTitle className="max-w-[11em]">From a URL to a finished post in five steps.</SectionTitle>
      <ol {...reveal(2)} className="mt-12 border-t border-bk-fg sm:mt-14">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="grid gap-x-8 gap-y-2 border-b border-bk-field/70 py-7 sm:grid-cols-[56px_minmax(0,1fr)] md:grid-cols-[56px_minmax(0,1fr)_minmax(0,694px)] md:py-[30px]"
          >
            <p className="pt-1 text-[17px] font-bold text-bk-muted">{String(i + 1).padStart(2, '0')}</p>
            <h3 className="font-bk-display text-[24px] font-bold leading-tight tracking-[-0.03em] sm:text-[26px]">{step.title}</h3>
            <p className="text-[17px] leading-relaxed text-bk-muted sm:col-start-2 md:col-start-auto">{step.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  )
}

/** The app as it is: the Creation page of one brand, with the sidebar every brand shares. */
function Studio() {
  return (
    <Section id="studio">
      <Eyebrow>Inside Batkle</Eyebrow>
      <SectionTitle className="max-w-[13em]">One studio per brand, from first idea to scheduled post.</SectionTitle>
      <p {...reveal(2)} className="mt-4 max-w-[720px] text-[17px] leading-relaxed text-bk-muted">
        Every brand gets its own workspace: Creation for ideas and posts, a Schedule for what goes out when, a Gallery of
        photos and cutouts, its brand profile and the designs it uses. Switch brands from the sidebar.
      </p>
      <div {...reveal(3)} className="mt-10 sm:mt-12">
        <AppPreview />
      </div>
      <ol {...reveal(4)} className="mt-6 grid gap-x-8 gap-y-4 text-[15px] leading-relaxed text-bk-muted md:grid-cols-3">
        <li><span className="font-bold text-bk-fg">Watch it build.</span> Each post goes through its content and design plan, its visuals, then the build.</li>
        <li><span className="font-bold text-bk-fg">Approve what you like.</span> Approved posts move on to the schedule; the rest you rebuild or edit.</li>
        <li><span className="font-bold text-bk-fg">See what’s next.</span> Scheduled posts show their day, time and platforms right in the idea list.</li>
      </ol>
    </Section>
  )
}

function Demo() {
  return (
    <Section id="demo">
      <Eyebrow>Demo</Eyebrow>
      <SectionTitle>
        Every business gets its <br className="hidden sm:inline" />
        own look and its own voice.
      </SectionTitle>
      <p {...reveal(2)} className="mt-4 max-w-[720px] text-[17px] leading-relaxed text-bk-muted">
        Pick a type of business to see the brand profile Batkle builds and the post it drafts. Sample brands, for
        illustration.
      </p>
      <BrandDemo />
    </Section>
  )
}

const pill = 'inline-flex items-center rounded-full border border-bk-field px-3 py-1 text-[13px]'
const pillOn = 'inline-flex items-center rounded-full border border-transparent bg-bk-butter px-3 py-1 text-[13px] font-bold text-bk-ink'
const bodyText = 'mt-3 text-[17px] leading-[1.65] text-bk-muted'

// The brand profile's chapters, in the order the app shows them.
const PROFILE_CHAPTERS = ['About the business', 'Services & products', 'Projects & work', 'Ideal customers', 'Voice & tone']
const PROFILE_COLORS = ['#F2A900', '#1E1D24', '#F5F1E8']

/** The brand profile's header and chapters, as the app shows them for a researched brand. */
function BrandBookMock() {
  return (
    <div aria-hidden="true" className="w-full max-w-[300px] shrink-0 overflow-hidden rounded-xl border border-bk-line bg-bk-surface shadow-bk-card">
      <div className="flex items-center justify-between gap-3 bg-bk-ink px-4 py-3.5 text-bk-cream dark:bg-[#0C0B10]">
        <span className="min-w-0">
          <span className="block text-[9.5px] font-bold uppercase tracking-[0.14em] text-bk-cream/60">Brand book</span>
          <span className="block truncate font-bk-display text-[18px] font-bold tracking-[-0.03em]">Ferreira Construções</span>
        </span>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-bk-butter font-bk-display text-[17px] font-bold text-bk-ink">F</span>
      </div>
      <ul className="divide-y divide-bk-line px-4 text-[13px]">
        {PROFILE_CHAPTERS.map((chapter, i) => (
          <li key={chapter} className="flex items-center justify-between gap-3 py-2">
            <span className="flex items-center gap-2.5">
              <span className="text-[11px] font-bold tabular-nums text-bk-muted">{String(i + 1).padStart(2, '0')}</span>
              {chapter}
            </span>
            <Check className="size-3.5 text-[#1E8A5A] dark:text-[#4CC38A]" strokeWidth={3} />
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 py-2">
          <span className="flex items-center gap-2.5">
            <span className="text-[11px] font-bold tabular-nums text-bk-muted">06</span>Colors, fonts and logo
          </span>
          <span className="flex gap-1">
            {PROFILE_COLORS.map((color) => <span key={color} className="size-3.5 rounded-full ring-1 ring-inset ring-bk-ink/15" style={{ backgroundColor: color }} />)}
          </span>
        </li>
      </ul>
    </div>
  )
}

// Three designs from the library, previewed in the sample brand's colors, as the design step shows them.
const DESIGN_PICKS = [
  { name: 'Bold Statement', bg: '#1E1D24', fg: '#F2A900', layout: 'bottom', on: true },
  { name: 'Soft Editorial', bg: '#F5F1E8', fg: '#1E1D24', layout: 'top', on: true },
  { name: 'Color Block', bg: '#F2A900', fg: '#1E1D24', layout: 'block', on: false },
]

function DesignPicksMock() {
  return (
    <ul aria-hidden="true" className="grid w-full max-w-[330px] shrink-0 grid-cols-3 gap-2">
      {DESIGN_PICKS.map((design) => (
        <li key={design.name} className={cn('min-w-0 rounded-xl border bg-bk-surface p-1.5', design.on ? 'border-bk-fg ring-1 ring-bk-fg' : 'border-bk-line')}>
          <span lang="pt-PT" className="relative block aspect-[4/5] overflow-hidden rounded-lg [container-type:inline-size]" style={{ backgroundColor: design.bg, color: design.fg }}>
            {design.layout === 'block' && <span className="absolute inset-x-0 bottom-0 h-[42%]" style={{ backgroundColor: '#1E1D24' }} />}
            <span
              className={cn(
                'absolute left-[10cqw] font-bk-display text-[14cqw] font-bold leading-[1] tracking-[-0.03em]',
                // Text near the top keeps clear of the selection badge in the corner.
                design.layout === 'top' ? 'right-[28cqw] top-[12cqw]' : design.layout === 'block' ? 'right-[28cqw] top-[16cqw]' : 'right-[10cqw] bottom-[12cqw]',
              )}
            >
              Cada obra conta.
            </span>
            {design.layout === 'top' && <span className="absolute bottom-[12cqw] left-[10cqw] h-[2px] w-[30cqw]" style={{ backgroundColor: design.fg }} />}
            <span className={cn('absolute right-[6cqw] top-[6cqw] flex size-[18cqw] items-center justify-center rounded-full border-2', design.on ? 'border-bk-butter bg-bk-butter text-bk-ink' : 'border-white/80 bg-black/20 text-transparent')}>
              <Check className="size-[62%]" strokeWidth={3} />
            </span>
          </span>
          <span className="mt-1.5 block truncate px-0.5 text-[11px] font-bold">{design.name}</span>
        </li>
      ))}
    </ul>
  )
}

/** The schedule dialog after approving a post: both platforms on, tomorrow evening chosen. */
function ScheduleMock() {
  return (
    <div aria-hidden="true" className="w-full max-w-[320px] shrink-0 rounded-xl border border-bk-line bg-bk-surface p-4 shadow-bk-card">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-bk-muted">Approved · Schedule it</p>
      <p className="mt-1 font-bk-display text-[15px] font-bold leading-snug tracking-[-0.02em]">Before and after: a full rehab in Lisbon</p>
      <p className="mt-3 text-[12px] font-bold">Where</p>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        {[['instagram', 'Instagram'], ['tiktok', 'TikTok']].map(([id, label]) => (
          <span key={id} className="flex h-10 items-center gap-2 rounded-lg border border-bk-fg px-2 text-[12.5px] font-bold shadow-[0_0_0_2px_rgb(255_216_77/0.55)]">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-bk-fg text-bk-bg"><PlatformIcon id={id} className="size-3.5" /></span>
            {label}
            <Check className="ml-auto size-3 shrink-0" strokeWidth={3} />
          </span>
        ))}
      </div>
      <p className="mt-3 text-[12px] font-bold">When</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {['Tomorrow, 10:00', 'Tomorrow, 18:00', 'Monday, 10:00'].map((option) => (
          <span key={option} className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', option === 'Tomorrow, 18:00' ? 'border-bk-fg bg-bk-fg text-bk-bg' : 'border-bk-field')}>{option}</span>
        ))}
      </div>
      <span className="mt-4 inline-flex h-9 items-center rounded-lg bg-bk-butter px-3.5 text-[12.5px] font-bold text-bk-ink">Schedule post</span>
    </div>
  )
}

function Features() {
  return (
    <Section id="features" tone="alt">
      <Eyebrow>Features</Eyebrow>
      <SectionTitle>
        Built around your brand, <br className="hidden sm:inline" />
        not around templates.
      </SectionTitle>

      <div className="mt-12 grid gap-5 sm:mt-14 lg:grid-cols-[minmax(0,1.59fr)_minmax(0,1fr)]">
        <Card i={2} lift className="flex flex-col gap-7 p-6 sm:flex-row sm:items-center sm:gap-9 sm:p-8">
          <div className="sm:max-w-[320px]">
            <CardTitle>It learns your brand from your website</CardTitle>
            <p className={bodyText}>
              No long setup. Batkle reads your site and writes your brand profile, grounded in your real services and
              projects. Every chapter stays editable.
            </p>
          </div>
          <BrandBookMock />
        </Card>

        <Card i={3} lift className="p-6 sm:p-8">
          <CardTitle>Your language, your tone</CardTitle>
          <p className={bodyText}>Posts come out in your brand&apos;s language, European Portuguese included.</p>
          <ul className="mt-5 space-y-2 text-[15px]" aria-label="Example headlines">
            <li lang="pt-PT" className="rounded-lg border border-bk-line px-3 py-2.5">
              Casa limpa, cabeça leve.
            </li>
            <li className="rounded-lg border border-bk-line px-3 py-2.5">Pay every supplier in one click.</li>
          </ul>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.59fr)]">
        <Card i={0} lift className="p-6 sm:p-8">
          <CardTitle>Ideas that never repeat</CardTitle>
          <p className={bodyText}>Suggestions rotate across your services, projects and strengths. Or describe the post you want.</p>
          <ul className="mt-5 space-y-2 text-[14px]" aria-label="Example ideas">
            {[
              ['Service', 'Why every project starts with a site visit'],
              ['Project', 'Before and after: a Lisbon rehab'],
              ['Strength', 'Meet the team behind the work'],
            ].map(([kind, idea]) => (
              <li key={kind} className="flex items-baseline gap-2">
                <span className="rounded-[5px] bg-bk-chip px-2 py-0.5 text-[12px] font-bold">{kind}</span>
                {idea}
              </li>
            ))}
          </ul>
        </Card>

        <Card i={1} lift className="flex flex-col gap-7 p-6 sm:flex-row sm:items-center sm:gap-9 sm:p-8">
          <div className="sm:max-w-[320px]">
            <CardTitle>Designs you choose, in your look</CardTitle>
            <p className={bodyText}>
              Pick styles from the Design Library, each learned from real posts and previewed in your colors, fonts and
              logo. Layouts adapt to every post, so nothing looks like a template.
            </p>
          </div>
          <DesignPicksMock />
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.59fr)_minmax(0,1fr)]">
        <Card i={0} lift className="flex scroll-mt-24 flex-col gap-7 p-6 sm:flex-row sm:items-center sm:gap-9 sm:p-8">
          <div id="schedule" className="scroll-mt-24 sm:max-w-[320px]">
            <CardTitle>Approve, then schedule</CardTitle>
            <p className={bodyText}>
              Approve the posts you&apos;re happy with and choose where and when each goes out: Instagram, TikTok or
              both. When it&apos;s time, its slides and caption are ready to post.
            </p>
          </div>
          <ScheduleMock />
        </Card>

        <Card i={1} lift className="p-6 sm:p-8">
          <CardTitle>Nothing is a flat image</CardTitle>
          <p className={bodyText}>Text, shapes, images and logo stay editable in the editor, slide by slide. The AI drafts, you decide.</p>
          <ul className="mt-5 overflow-hidden rounded-lg border border-bk-line text-[14px]" aria-label="Example layers">
            <li className="bg-bk-butter px-3 py-2 font-bold text-bk-ink">Headline</li>
            <li className="border-t border-bk-line px-3 py-2">Image</li>
            <li className="border-t border-bk-line px-3 py-2">Logo</li>
          </ul>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Card i={0} lift className="p-6 sm:p-8">
          <CardTitle>AI images and cutouts</CardTitle>
          <p className={bodyText}>AI-generated images and transparent cutouts, stock photos and your own gallery, all saved for reuse.</p>
          <div className="bk-checker mt-5 flex h-[85px] items-center justify-center rounded-lg border border-bk-line" aria-hidden="true">
            <span className="h-[60px] w-12 rounded-b-md rounded-t-full border-[1.5px] border-bk-ink bg-[#F2A900]" />
          </div>
        </Card>

        <Card i={1} lift className="p-6 sm:p-8">
          <CardTitle>Render through an API</CardTitle>
          <p className={bodyText}>Describe a post as JSON (its text, images and shapes) and get the finished image back with a single API call.</p>
          <p className="mt-5 flex items-center gap-2.5 text-[13px] font-bold">
            <span className="rounded-md border border-bk-field px-2.5 py-1.5">JSON</span>
            <ArrowRight className="size-3.5" aria-hidden="true" />
            <span className="rounded-md border border-bk-field px-2.5 py-1.5">API</span>
            <ArrowRight className="size-3.5" aria-hidden="true" />
            <span className="rounded-md border border-transparent bg-bk-butter px-2.5 py-1.5 text-bk-ink">Image</span>
          </p>
          <Link href="/developers" className="group mt-5 inline-flex items-center gap-1.5 text-[15px] font-bold underline-offset-4 hover:underline">
            Read the API docs <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </Card>
      </div>
    </Section>
  )
}

function WhoItsFor() {
  return (
    <Section id="who-its-for">
      <Eyebrow>Who it&apos;s for</Eyebrow>
      <SectionTitle>
        For teams that post regularly but <br className="hidden md:inline" />
        don&apos;t want to design every post.
      </SectionTitle>
      <p {...reveal(2)} className="mt-4 text-[17px] leading-relaxed text-bk-muted">
        Construction firms, fintechs, local service companies, creative studios and everyone in between.
      </p>
      <div className="mt-12 grid gap-5 sm:mt-14 md:grid-cols-3">
        {AUDIENCES.map((a, i) => (
          <Card key={a.title} i={i + 3} lift className="p-6 sm:p-7">
            <CardTitle>{a.title}</CardTitle>
            <p className="mt-3 text-[17px] leading-relaxed text-bk-muted">{a.body}</p>
          </Card>
        ))}
      </div>
    </Section>
  )
}

function BeforeAfter() {
  return (
    <Section tone="alt">
      <SectionTitle>
        Your posting routine, <br className="hidden sm:inline" />
        before and after.
      </SectionTitle>
      <div className="mt-12 grid gap-5 sm:mt-14 md:grid-cols-2">
        <Card i={2} className="p-6 sm:p-9">
          <CardTitle className="text-[21px] text-bk-muted">Without Batkle</CardTitle>
          <ul className="mt-5 space-y-3.5">
            {WITHOUT.map((item) => (
              <li key={item} className="flex gap-3 text-[17px] text-bk-muted">
                <X className="mt-[3px] size-[18px] shrink-0" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </Card>
        <div {...reveal(3)} className="rounded-2xl border border-bk-fg bg-bk-surface p-6 shadow-bk-pop sm:p-9">
          <CardTitle className="text-[21px]">With Batkle</CardTitle>
          <ul className="mt-5 space-y-3.5">
            {WITH.map((item) => (
              <li key={item} className="flex gap-3 text-[17px]">
                <span className="mt-[2px] flex size-5 shrink-0 items-center justify-center rounded-full bg-bk-butter text-bk-ink">
                  <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  )
}

function Testimonials() {
  return (
    <Section>
      <SectionTitle>What customers say.</SectionTitle>
      <div className="mt-12 grid gap-5 sm:mt-14 md:grid-cols-2">
        {QUOTES.map((quote, i) => (
          <Card as="figure" key={quote} i={i + 2} className="p-6 sm:p-9">
            <blockquote className="font-bk-display text-[21px] font-bold leading-snug tracking-[-0.02em] sm:text-[24px]">
              {quote}
            </blockquote>
            <figcaption className="mt-6 flex items-center gap-3 text-[15px] text-bk-muted">
              <span aria-hidden="true" className="size-[42px] rounded-full border border-bk-field/70 bg-bk-alt" />
              [Name, role, company]
            </figcaption>
          </Card>
        ))}
      </div>
    </Section>
  )
}

const noteLink =
  'font-bold text-bk-fg underline decoration-bk-field underline-offset-4 transition-colors hover:decoration-bk-fg focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg'

/** What the plans leave out: extra credits, the trial's terms, more brands, the API; and the newsletter discount. */
function PricingNotes() {
  const contact = contactHref()
  const notes = [creditPackNote(), trialNote()]
  return (
    <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] lg:gap-12">
      <ul {...reveal(2)} className="self-start border-t border-bk-line text-[16px] leading-relaxed text-bk-muted">
        {notes.map((note) => (
          <li key={note.title} className="border-b border-bk-line py-4">
            <span className="font-bold text-bk-fg">{note.title}</span> {note.text}
          </li>
        ))}
        <li className="border-b border-bk-line py-4">
          {contact ? (
            <a href={contact} className={noteLink}>
              {CONTACT.label}
            </a>
          ) : (
            <span className="font-bold text-bk-fg">{CONTACT.label}</span>
          )}
        </li>
        <li className="border-b border-bk-line py-4">
          <Link href="/developers" className={noteLink}>
            Developer API
          </Link>
          : separate, pay-as-you-go.
        </li>
      </ul>
      <Card i={3} className="p-6 sm:p-8">
        <CardTitle className="text-[21px]">{newsletterTitle()}</CardTitle>
        <p className="mt-2 text-[16px] leading-relaxed text-bk-muted">{newsletterBlurb()}</p>
        <NewsletterForm />
      </Card>
    </div>
  )
}

function Pricing() {
  return (
    <Section id="pricing" tone="alt">
      <Eyebrow>Pricing</Eyebrow>
      <SectionTitle>Simple pricing, no surprises.</SectionTitle>
      <PricingPlans startHref={START_HREF} intro={pricingIntro()} />
      <PricingNotes />
    </Section>
  )
}

function Faq() {
  return (
    <Section id="faq">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,740px)] lg:gap-16">
        <div>
          <Eyebrow>FAQ</Eyebrow>
          <SectionTitle className="max-w-[7.6em]">Frequently asked questions</SectionTitle>
        </div>
        <div {...reveal(2)} className="border-t border-bk-line">
          {FAQS.map((item) => (
            <details key={item.q} className="bk-faq group border-b border-bk-line">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-[22px] text-[17px] font-bold transition-colors can-hover:text-bk-fg/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg sm:text-[18px] [&::-webkit-details-marker]:hidden">
                {item.q}
                <Plus className="size-5 shrink-0 transition-transform duration-300 group-open:rotate-45" aria-hidden="true" />
              </summary>
              <p className="bk-faq-answer -mt-1 max-w-[620px] pb-6 text-[17px] leading-relaxed text-bk-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  )
}

function FinalCta() {
  return (
    <section className="bg-bk-bg pb-20 sm:pb-28 lg:pb-[120px]">
      <Container>
        <div {...reveal(0)} className="relative overflow-hidden rounded-[20px] bg-bk-ink px-6 pb-14 pt-32 sm:px-12 sm:py-20 lg:px-16 lg:py-[84px] dark:bg-bk-surface dark:ring-1 dark:ring-inset dark:ring-bk-line">
          <HangingBat
            className="absolute right-8 top-0 text-[44px] text-bk-butter sm:right-[10%] sm:text-[60px]"
            stemClassName="h-[44px] sm:h-[96px]"
          />
          <h2 className="font-bk-display text-[clamp(34px,4vw,54px)] font-bold leading-[1.05] tracking-[-0.02em] text-bk-cream">
            Paste your website. <br className="hidden sm:inline" />
            Get your first post.
          </h2>
          <p className="mt-6 max-w-[520px] text-[18px] leading-relaxed text-[#C4C1CE] sm:text-[19px]">
            Batkle learns your brand, drafts the ideas and designs the posts. You review, approve and schedule them.
          </p>
          <Link href={START_HREF} className={buttonClass('primary', 'lg', 'mt-8')}>
            Add your brand <ArrowRight className={arrowClass} aria-hidden="true" />
          </Link>
        </div>
      </Container>
    </section>
  )
}

export function Footer() {
  return (
    <footer className="border-t border-bk-line bg-bk-bg">
      <Container className="flex flex-col gap-12 py-14 sm:py-16 md:flex-row md:justify-between">
        <div>
          <BatkleLogo size={34} />
          <p className="mt-4 max-w-[300px] text-[15px] leading-relaxed text-bk-muted">
            On-brand Instagram posts and carousels, drafted by AI and finished by you.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-12 gap-y-10 sm:flex sm:gap-16">
          {FOOTER_LINKS.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-bk-muted">{group.title}</p>
              <ul className="mt-5 space-y-3.5">
                {group.links.map(([label, href]) => (
                  <li key={label}>
                    <Link href={href} className="text-[15px] text-bk-fg/90 transition-colors hover:text-bk-fg hover:underline hover:underline-offset-4">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </Container>
      <div className="border-t border-bk-line">
        <Container className="py-6 text-[14px] text-bk-muted">© {new Date().getFullYear()} Batkle. All rights reserved.</Container>
      </div>
    </footer>
  )
}

export default function LandingPage({ className = '' }) {
  return (
    <div className={cn('bk-root min-h-screen bg-bk-bg font-bk-body text-bk-fg antialiased', className)}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-bk-butter focus:px-4 focus:py-2 focus:font-bold focus:text-bk-ink"
      >
        Skip to content
      </a>
      <ScrollReveal />
      <SmoothScroll />
      <LandingHeader />
      <main id="main">
        <Hero />
        <HowItWorks />
        <Studio />
        <Demo />
        <Features />
        <WhoItsFor />
        <BeforeAfter />
        <Testimonials />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}
