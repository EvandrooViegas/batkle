'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { ArrowRight, Bell, Check, Coins, Plus } from 'lucide-react'
import { PLANS, approxPosts } from '@/lib/billing/plans'
import { BrandTile } from '../ui'
import { cn } from '@/lib/utils'

/**
 * What an upgrade unlocks, shown with the product itself: real posts from Batkle's own designs, this month's calendar,
 * the plan's real numbers. No drawn stand-ins (bars for text, shapes for photos): those read as a template.
 */

// Real posts, loaded only when a picture shows (they bring the design composer with them).
const RealPost = dynamic(() => import('./RealPost'), { ssr: false, loading: () => <span className="block aspect-[4/5] w-full rounded-lg bg-bk-surface" /> })

// Each picture is laid out at this size and scaled to the space it gets, so it reads the same in a notice and in the
// dialog.
const W = 360, H = 240
const card = 'rounded-xl bg-bk-surface shadow-bk-card'
const caption = 'text-[10px] font-bold uppercase tracking-[0.12em] text-bk-muted'
// The Design Library's demo brand: a design drawn in colours other than its own.
const YOUR_BRAND = { name: 'Your brand' }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function Post({ design, sample = 0, brand, width, className = '' }) {
  return <div className={cn('overflow-hidden rounded-lg shadow-bk-card', className)} style={{ width }}><RealPost design={design} sample={sample} brand={brand} /></div>
}

/** This week and the next, as the Schedule page shows them, with posts on some days and today's reminder. */
function Schedule() {
  const today = new Date()
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (today.getDay() + 6) % 7)
  const days = Array.from({ length: 14 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i))
  const todayIndex = (today.getDay() + 6) % 7
  // Posts on days the reminder card doesn't cover: today, another day this week, and early next week.
  const posts = { [todayIndex]: ['highlight-editorial', 0], [todayIndex === 2 ? 4 : 2]: ['serif-escape', 1], 7: ['highlight-editorial', 3], 8: ['serif-escape', 3] }
  return (
    <>
      <div className={cn(card, 'absolute left-3 top-3 w-[334px] p-3')}>
        <div className="flex items-baseline justify-between">
          <p className="text-[13px] font-bold">{MONTHS[today.getMonth()]} {today.getFullYear()}</p>
          <p className="text-[10px] font-semibold text-bk-muted">This week and next</p>
        </div>
        <div className="mt-2 grid grid-cols-7 gap-1.5">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="text-center text-[9px] font-bold text-bk-muted">{d}</span>)}
          {days.map((day, i) => (
            <div key={i} className={cn('flex h-[62px] flex-col items-center gap-0.5 rounded-lg bg-bk-alt pt-1', i === todayIndex && 'ring-2 ring-bk-butter')}>
              <span className={cn('text-[9px] font-bold', i === todayIndex ? 'text-bk-fg' : 'text-bk-muted')}>{day.getDate()}</span>
              {posts[i] && <Post design={posts[i][0]} sample={posts[i][1]} width={34} className="rounded-[4px]" />}
            </div>
          ))}
        </div>
      </div>
      <div className="absolute bottom-2.5 right-3 flex w-[212px] items-center gap-2.5 rounded-xl bg-bk-ink px-3 py-2.5 text-bk-cream shadow-bk-pop">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-bk-butter text-bk-ink"><Bell className="size-3.5" /></span>
        <span className="min-w-0">
          <span className="block text-[11px] font-bold">Due today, 10:00</span>
          <span className="block text-[10px] opacity-75">Slides and caption are ready to post</span>
        </span>
      </div>
    </>
  )
}

/** An example someone uploads, and the design Batkle makes from it, drawn in another brand's colours. */
function Designs() {
  return (
    <div className="flex h-full items-center justify-center gap-4">
      <figure>
        <figcaption className={caption}>Your example</figcaption>
        <img src="/design-references/3.png" alt="" className="mt-1.5 aspect-[4/5] w-[128px] rounded-lg object-cover shadow-bk-card" />
      </figure>
      <ArrowRight className="mt-4 size-5 shrink-0 text-bk-muted" />
      <figure>
        <figcaption className={caption}>Your design, any brand</figcaption>
        <Post design="highlight-editorial" sample={1} brand={YOUR_BRAND} width={150} className="mt-1.5" />
      </figure>
    </div>
  )
}

/** Designs members publish, each drawn in the brand's own colours. */
function Community() {
  const designs = [['momentum-timeline', 0, 'Momentum Timeline'], ['highlight-editorial', 1, 'Highlight Editorial'], ['serif-escape', 0, 'Serif Escape']]
  return (
    <div className="flex h-full items-center justify-center gap-3">
      {designs.map(([design, sample, name], i) => (
        <figure key={design} className={cn(card, 'w-[104px] p-1.5', i === 1 && '-translate-y-2')}>
          <Post design={design} sample={sample} brand={YOUR_BRAND} width={92} className="shadow-none" />
          <figcaption className="mt-1.5 px-0.5 text-[10px] font-bold leading-tight">{name}</figcaption>
        </figure>
      ))}
    </div>
  )
}

/** The Team page's people list. */
function Team() {
  const people = [['AM', 'Ana Moreira', 'ana@yourbrand.com', 'Owner', 'bg-bk-ink text-bk-cream'], ['MS', 'Marta Silva', 'marta@yourbrand.com', 'Editor', 'bg-[#ED5125] text-white'], ['JC', 'João Costa', 'joao@yourbrand.com', 'Viewer', 'bg-[#1F7A5A] text-white']]
  return (
    <div className="flex h-full items-center justify-center">
      <div className={cn(card, 'w-[300px] overflow-hidden')}>
        <div className="flex items-center justify-between border-b border-bk-line px-3.5 py-2.5">
          <p className="text-[12.5px] font-bold">People</p>
          <p className="text-[10.5px] text-bk-muted">3 of 20</p>
        </div>
        {people.map(([initials, name, email, role, tone]) => (
          <div key={name} className="flex items-center gap-2.5 border-b border-bk-line px-3.5 py-2 last:border-0">
            <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', tone)}>{initials}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11.5px] font-bold">{name}</span>
              <span className="block truncate text-[10px] text-bk-muted">{email}</span>
            </span>
            <span className={cn('rounded-md px-1.5 py-0.5 text-[9.5px] font-bold', role === 'Owner' ? 'bg-bk-fg text-bk-bg' : 'bg-bk-chip text-bk-fg')}>{role}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The same ad in the feed and as a story, as Meta shows them. */
function Ads() {
  const header = <div className="flex items-center gap-1.5 px-2 py-1.5"><span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[#ED5125] text-[8px] font-bold text-white">Y</span><span className="min-w-0 leading-tight"><span className="block truncate text-[9.5px] font-bold">Your brand</span><span className="block text-[8px] text-bk-muted">Sponsored</span></span></div>
  return (
    <div className="flex h-full items-center justify-center gap-4">
      <figure className="text-center">
        <div className={cn(card, 'w-[122px] overflow-hidden text-left')}>
          {header}
          <Post design="serif-escape" sample={0} width={122} className="rounded-none shadow-none" />
          <div className="flex items-center justify-between gap-1.5 bg-bk-alt px-2 py-1.5">
            <span className="min-w-0 truncate text-[8.5px] font-semibold text-bk-muted">yourbrand.com</span>
            <span className="shrink-0 whitespace-nowrap rounded bg-bk-chip px-1.5 py-0.5 text-[8.5px] font-bold">Learn more</span>
          </div>
        </div>
        <figcaption className={cn(caption, 'mt-1.5')}>Feed 4:5</figcaption>
      </figure>
      <figure className="text-center">
        <div className="flex h-[178px] w-[100px] flex-col overflow-hidden rounded-xl bg-[#14131A] shadow-bk-card">
          <div className="flex items-center gap-1 px-1.5 py-1.5 text-white"><span className="size-3.5 shrink-0 rounded-full bg-[#ED5125]" /><span className="min-w-0 leading-tight"><span className="block truncate text-[8px] font-bold">Your brand</span><span className="block text-[7px] opacity-70">Sponsored</span></span></div>
          <div className="flex flex-1 items-center"><Post design="highlight-editorial" sample={3} brand={YOUR_BRAND} width={100} className="rounded-none shadow-none" /></div>
          <span className="mx-auto mb-2 rounded-full bg-white px-2.5 py-0.5 text-[8px] font-bold text-[#14131A]">Learn more</span>
        </div>
        <figcaption className={cn(caption, 'mt-1.5')}>Story 9:16</figcaption>
      </figure>
    </div>
  )
}

/** Captions from the brand's own posts, and a new one written the same way. */
function Voice() {
  const theirs = ['Sourdough sold out by ten again. Tomorrow we bake two more batches.', 'We close at two on Sundays so the team can rest. See you Monday at seven.']
  return (
    <div className="flex h-full items-center justify-center gap-3">
      <div className="w-[146px] space-y-2">
        {theirs.map(text => (
          <div key={text} className={cn(card, 'p-2.5')}>
            <p className={caption}>Your post</p>
            <p className="mt-1 text-[11px] leading-snug">{text}</p>
          </div>
        ))}
      </div>
      <ArrowRight className="size-5 shrink-0 text-bk-muted" />
      <div className={cn(card, 'w-[150px] p-2.5 ring-2 ring-bk-butter')}>
        <p className={caption}>New post</p>
        <p className="mt-1 text-[11.5px] font-semibold leading-snug">New on the counter: rye with fennel. Same 7 a.m. start, so come early.</p>
        <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-bk-butter px-1.5 py-0.5 text-[9.5px] font-bold text-bk-ink"><Check className="size-3" />Sounds like you</span>
      </div>
    </div>
  )
}

/** The sidebar's brand switcher with the brands the next plan holds; those past this plan's limit carry its name. */
function Brands({ current, target }) {
  const names = [['Corner Bakery', 'EN-GB'], ['Studio Norte', 'PT-PT'], ['Barber PH', 'EN-US']]
  const shown = names.slice(0, Math.min(3, target.brands))
  return (
    <div className="flex h-full items-center justify-center">
      <div className={cn(card, 'w-[260px] p-1.5')}>
        <p className={cn(caption, 'px-2 pb-1 pt-1')}>Your brands</p>
        {shown.map(([name, language], i) => (
          <div key={name} className={cn('flex items-center gap-2.5 rounded-lg px-2 py-1.5', i === 0 && 'bg-bk-alt')}>
            <BrandTile name={name} size={26} />
            <span className="min-w-0 flex-1"><span className="block truncate text-[11.5px] font-bold">{name}</span><span className="block text-[9.5px] text-bk-muted">Brand · {language}</span></span>
            {i === 0 ? <Check className="size-3.5 text-bk-fg" /> : i >= current.brands && <span className="rounded-md bg-bk-butter px-1.5 py-0.5 text-[9px] font-bold text-bk-ink">{target.name}</span>}
          </div>
        ))}
        {target.brands > shown.length && <p className="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold text-bk-muted">Up to {target.brands} brands on {target.name}</p>}
      </div>
    </div>
  )
}

/** The post composer with photos attached; each one becomes a slide. */
function Photos({ current, target }) {
  // Four different pictures from the two sample images: the whole landscape, close-ups of its rocks and clouds, and
  // the potted plant on a backdrop.
  const photos = [
    { src: '/samples/landscape.jpg', zoom: 1, origin: '50% 50%' },
    { src: '/samples/cutout.png', zoom: 1, origin: '50% 50%', backdrop: '#E7DED0', contain: true },
    { src: '/samples/landscape.jpg', zoom: 2.6, origin: '20% 95%' },
    { src: '/samples/landscape.jpg', zoom: 2.2, origin: '85% 10%' },
  ]
  const have = Math.min(current.photosPerPost, photos.length)
  const slots = Math.min(8, target.photosPerPost)
  return (
    <div className="flex h-full items-center justify-center">
      <div className={cn(card, 'w-[320px] p-3')}>
        <p className="text-[11.5px] text-bk-fg/80">Before and after of the bathroom job in Alfama</p>
        <div className="mt-2.5 grid grid-cols-4 gap-1.5">
          {Array.from({ length: slots }, (_, i) => i < have
            ? <span key={i} className="block aspect-square w-full overflow-hidden rounded-md" style={{ background: photos[i].backdrop }}><img src={photos[i].src} alt="" className={cn('size-full', photos[i].contain ? 'object-contain p-1' : 'object-cover')} style={{ transform: `scale(${photos[i].zoom})`, transformOrigin: photos[i].origin }} /></span>
            : <span key={i} className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-bk-field text-bk-muted"><Plus className="size-3.5" /></span>)}
        </div>
        <div className="mt-2.5 flex items-center justify-between text-[10.5px]">
          <span className="font-semibold text-bk-muted">{have} of {target.photosPerPost} photos</span>
          <span className="font-bold">One photo on each slide</span>
        </div>
      </div>
    </div>
  )
}

/** The account menu's credits meter for this plan beside the next one's. */
function Credits({ current, target }) {
  const meter = (plan, full) => (
    <div className={cn(card, 'w-[150px] p-3', full && 'ring-2 ring-bk-butter')}>
      <p className={caption}>{plan.name}</p>
      <p className="mt-1.5 flex items-center gap-1.5 text-[18px] font-bold tabular-nums"><Coins className="size-4 text-bk-fg/70" />{plan.credits}</p>
      <p className="text-[10px] text-bk-muted">credits a month</p>
      <span className="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-bk-alt"><span className="block h-full rounded-full bg-bk-butter" style={{ width: `${Math.round(100 * plan.credits / target.credits)}%` }} /></span>
      <p className="mt-1.5 text-[10.5px] font-semibold">≈ {approxPosts(plan.credits)} posts</p>
    </div>
  )
  return <div className="flex h-full items-center justify-center gap-3">{meter(current, false)}{meter(target, true)}</div>
}

const VISUALS = { schedule: Schedule, designs: Designs, community: Community, team: Team, ads: Ads, voice: Voice, brands: Brands, photos: Photos, credits: Credits }

/** Which picture a plan limit shows. */
export function visualFor(info = {}) {
  if (info.limit === 'brands') return 'brands'
  if (info.limit === 'photos') return 'photos'
  return { scheduling: 'schedule', emailReminders: 'schedule', textReminders: 'schedule', customDesigns: 'designs', communityDesigns: 'community', teams: 'team', adDesigns: 'ads', postVoice: 'voice' }[info.feature] || 'credits'
}

/** The picture, scaled to its container's width. `current` and `target` are plans (ids or plan objects). */
export default function FeatureVisual({ name, current = 'free', target = 'pro', className = '' }) {
  const Visual = VISUALS[name] || Credits
  const ref = useRef(null), [scale, setScale] = useState(0)
  useEffect(() => {
    const box = ref.current
    if (!box) return
    const fit = () => setScale(box.clientWidth / W)
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])
  const plan = value => (typeof value === 'string' ? PLANS[value] : value) || PLANS.pro
  return (
    <div ref={ref} aria-hidden="true" className={cn('relative w-full select-none', className)} style={{ aspectRatio: `${W}/${H}` }}>
      <div className="absolute left-0 top-0 origin-top-left transition-opacity" style={{ width: W, height: H, transform: `scale(${scale})`, opacity: scale ? 1 : 0 }}>
        <Visual current={plan(current)} target={plan(target)} />
      </div>
    </div>
  )
}
