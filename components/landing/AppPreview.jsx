import { ArrowRight, CalendarClock, Check, Code2, Fingerprint, ImagePlus, Images, LayoutTemplate, SlidersHorizontal, Wand2 } from 'lucide-react'
import { BrandTile, appButton } from '@/components/app/ui'
import { StageBar } from '@/components/app/creation/StageBar'
import { PlatformIcon } from '@/components/app/schedule/platforms'
import { cn } from '@/lib/utils'
import { BatkleLogo } from './brand'

// A sample brand, as in the demo. Its posts keep their own colours in both themes: they are content, not chrome.
const BRAND = { name: 'Ferreira Construções', ink: '#1E1D24', gold: '#F2A900', cream: '#F5F1E8' }

const NAV = [
  { label: 'Creation', Icon: Wand2, count: 12, active: true },
  { label: 'Schedule', Icon: CalendarClock, count: 3 },
  { label: 'Gallery', Icon: Images, count: 48 },
  { label: 'Brand profile', Icon: Fingerprint },
  { label: 'Design Library', Icon: LayoutTemplate },
  { label: 'API & usage', Icon: Code2 },
]

const DONE = ['content', 'visuals', 'build'].map(key => ({ key, state: 'done' }))
const NOT_STARTED = ['content', 'visuals', 'build'].map(key => ({ key, state: 'pending' }))

/** A 4:5 slide that scales with its width (container query units). */
function Slide({ bg, fg, label, headline, page, className = '' }) {
  return (
    <span lang="pt-PT" className={cn('relative block aspect-[4/5] overflow-hidden rounded-md [container-type:inline-size]', className)} style={{ backgroundColor: bg, color: fg }}>
      <span className="absolute inset-0 flex flex-col p-[9cqw]">
        <span className="text-[5cqw] font-bold uppercase tracking-[0.08em]">{label}</span>
        <span className="my-auto font-bk-display text-[12cqw] font-bold leading-none tracking-[-0.04em]">{headline}</span>
        <span className="flex justify-between text-[5cqw] font-bold"><span>{BRAND.name}</span><span>{page}</span></span>
      </span>
    </span>
  )
}

function Sidebar() {
  return (
    <div className="hidden w-[216px] shrink-0 flex-col border-r border-bk-line bg-bk-bg px-3 pb-3.5 pt-3.5 lg:flex">
      <BatkleLogo size={24} />
      <div className="mt-3.5 flex items-center gap-2 rounded-xl border border-bk-line bg-bk-surface p-2">
        <BrandTile name={BRAND.name} size={28} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-bold leading-tight">{BRAND.name}</span>
          <span className="block text-[10.5px] text-bk-muted">Brand · PT</span>
        </span>
        <span className={appButton('outline', 'xs', 'h-6 px-1.5 text-[11px]')}>Switch</span>
      </div>
      <p className="mb-1 mt-5 px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-bk-muted">Studio</p>
      <ul className="space-y-0.5">
        {NAV.map(({ label, count, active }) => (
          <li
            key={label}
            className={cn('flex h-8 items-center gap-2 rounded-lg px-2.5 text-[12.5px]', active ? 'bg-bk-butter font-bold text-bk-ink' : 'text-bk-fg/75')}
          >
            <span className="flex-1 truncate">{label}</span>
            {count !== undefined && (
              <span className={cn('tabular-nums', active ? 'rounded-full bg-bk-ink px-1.5 text-[10px] font-bold text-white' : 'text-[11px] text-bk-muted')}>{count}</span>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-auto flex items-center gap-2 rounded-xl border border-bk-line bg-bk-surface p-2">
        <span className="flex size-7 items-center justify-center rounded-full bg-bk-ink text-[10px] font-bold text-bk-cream ring-2 ring-bk-butter ring-offset-2 ring-offset-bk-surface">AF</span>
        <span className="min-w-0">
          <span className="block truncate text-[12px] font-bold leading-tight">Ana Ferreira</span>
          <span className="block truncate text-[10.5px] text-bk-muted">ana@ferreira.pt</span>
        </span>
      </div>
    </div>
  )
}

function FeaturedCard() {
  return (
    <div className="mt-4 overflow-hidden rounded-2xl bg-bk-ink text-bk-cream shadow-bk-pop sm:grid sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] dark:ring-1 dark:ring-inset dark:ring-white/10">
      <div className="p-4 sm:p-5">
        <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-bk-butter">
          <span className="size-1.5 rounded-full bg-bk-butter" />Post ready · Carousel · Projects
        </p>
        <p className="mt-2.5 font-bk-display text-[17px] font-bold leading-[1.15] tracking-[-0.025em] sm:text-[19px]">Before and after: a full rehab in Lisbon</p>
        <p className="mt-2 text-[12px] italic text-bk-cream/75">“Same walls, a whole new home.”</p>
        <StageBar steps={DONE} tone="dark" className="mt-4" />
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className={appButton('primary', 'sm')}><Check className="size-3.5" strokeWidth={3} />Approve</span>
          <span className={appButton('onDark', 'sm')}>Open in editor</span>
          <span className="ml-1 text-[11.5px] font-semibold text-bk-cream/75 underline underline-offset-4">New version</span>
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 bg-[#0C0B10] px-4 py-5">
        <Slide bg={BRAND.gold} fg={BRAND.ink} label="Reabilitação · Lisboa" headline="Cada obra começa com uma boa base." page="1 / 5" className="w-[44%] max-w-[170px] shadow-bk-pop" />
        <Slide bg={BRAND.ink} fg={BRAND.cream} label="Antes" headline="Paredes sem vida." page="2 / 5" className="w-[30%] max-w-[118px] opacity-60" />
      </div>
    </div>
  )
}

function IdeaRows() {
  return (
    <ul className="mt-4 divide-y divide-bk-line overflow-hidden rounded-2xl border border-bk-line bg-bk-surface">
      <li className="flex items-center gap-3 px-3.5 py-3">
        <span className="hidden font-bk-display text-[18px] font-bold tabular-nums text-bk-field sm:block">02</span>
        <Slide bg={BRAND.ink} fg={BRAND.gold} label="Obra" headline="Tudo começa com uma visita." page="1 / 1" className="w-[46px] shrink-0 rounded-[4px]" />
        <span className="min-w-0 flex-1">
          <span className="block text-[10.5px] font-semibold text-bk-muted">Single</span>
          <span className="block truncate font-bk-display text-[13px] font-bold">Why every project starts with a site visit</span>
          <span className="mt-1 flex items-center gap-1 text-[11px] font-bold">
            <CalendarClock className="size-3" />Scheduled · Thu 16 Oct, 18:00 · <PlatformIcon id="instagram" className="size-3" /><PlatformIcon id="tiktok" className="size-3" />
          </span>
        </span>
        <span className={appButton('outline', 'xs', 'hidden sm:inline-flex')}><CalendarClock className="size-3" />Edit schedule</span>
      </li>
      <li className="flex items-center gap-3 px-3.5 py-3">
        <span className="hidden font-bk-display text-[18px] font-bold tabular-nums text-bk-field sm:block">03</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10.5px] font-semibold text-bk-muted">Carousel</span>
          <span className="block truncate font-bk-display text-[13px] font-bold">Meet the team behind every renovation</span>
          <StageBar steps={NOT_STARTED} className="mt-2 hidden max-w-[300px] sm:grid" />
        </span>
        <span className={appButton('primary', 'xs')}>Generate post</span>
      </li>
    </ul>
  )
}

/**
 * The Creation page of the app, scaled down: the sidebar with its brand switcher and studio sections, the idea box,
 * the featured post with its build progress and Approve, and the idea list with a scheduled post. Decorative: the
 * section around it says what it shows.
 */
export default function AppPreview() {
  return (
    <div aria-hidden="true" className="bk-app pointer-events-none select-none overflow-hidden rounded-2xl border border-bk-line bg-bk-alt shadow-bk-pop">
      <div className="flex items-center gap-3 border-b border-bk-line bg-bk-bg px-4 py-2.5">
        <span className="flex gap-1.5">
          {['#FF5F57', '#FEBC2E', '#28C840'].map(color => <span key={color} className="size-2.5 rounded-full" style={{ backgroundColor: color }} />)}
        </span>
        <span className="mx-auto max-w-[60%] truncate rounded-md bg-bk-alt px-3 py-1 text-[11px] text-bk-muted">batkle.app/app/ferreira-construcoes/creation</span>
        <span className="w-[46px]" />
      </div>
      <div className="flex">
        <Sidebar />
        <div className="min-w-0 flex-1 px-4 pb-5 pt-4 sm:px-6 sm:pt-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-bk-muted">{BRAND.name} · Creation</p>
          <p className="mt-1 font-bk-display text-[22px] font-bold leading-tight tracking-[-0.04em] sm:text-[24px]">Content ideas</p>
          <div className="mt-3.5 rounded-xl border border-bk-line bg-bk-surface p-3">
            <p className="text-[12px] text-bk-muted">Describe a post idea, or leave it empty and let Batkle suggest one.</p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className={appButton('outline', 'xs')}><SlidersHorizontal className="size-3" />Settings · Auto</span>
              <span className={appButton('quiet', 'xs', 'hidden sm:inline-flex')}><ImagePlus className="size-3" />Add photos</span>
              <span className={appButton('primary', 'xs', 'ml-auto')}>Create idea<ArrowRight className="size-3" /></span>
            </div>
          </div>
          <FeaturedCard />
          <IdeaRows />
        </div>
      </div>
    </div>
  )
}
