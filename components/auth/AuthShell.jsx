import Link from 'next/link'
import { Check } from 'lucide-react'
import { BatkleLogo, HangingBat } from '@/components/landing/brand'
import HeroArt from '@/components/landing/HeroArt'
import { ThemeButton } from '@/components/app/StandaloneShell'
import { appLayer } from '@/components/app/ui'
import { cn } from '@/lib/utils'

const POINTS = [
  'Learns your services, tone and language from your website',
  'Designs every post in your colours, fonts and logo',
  'Nothing is a flat image: every post stays editable',
]

/** The home page's sand panel, dunes and swinging bat beside the sign-in form. */
function BrandPanel() {
  return (
    <aside
      aria-label="About Batkle"
      className="relative m-3 hidden h-[calc(100dvh-24px)] flex-col overflow-hidden rounded-[24px] border border-bk-line bg-[#EFEEE9] dark:bg-bk-alt lg:sticky lg:top-3 lg:flex"
    >
      <HangingBat className="absolute right-[9%] top-0 text-[52px] text-bk-fg" stemClassName="h-[clamp(40px,9vh,96px)]" />
      <div className="relative z-10 px-12 pt-[clamp(40px,11vh,128px)] xl:px-16">
        <p className="max-w-[8.8em] font-bk-display text-[clamp(36px,3.5vw,54px)] font-bold leading-[1.02] tracking-[-0.03em] motion-safe:animate-bk-enter">
          Paste your website. Get{' '}
          <span className="relative isolate whitespace-nowrap dark:text-bk-ink">
            <span aria-hidden="true" className="absolute -inset-x-[0.04em] bottom-[-0.06em] top-[0.79em] -z-10 bg-bk-butter dark:top-[0.1em]" />
            on-brand
          </span>{' '}
          posts.
        </p>
        <ul className="mt-8 space-y-3 motion-safe:animate-bk-enter" style={{ animationDelay: '90ms' }}>
          {POINTS.map(point => (
            <li key={point} className="flex items-start gap-3 text-[15px] leading-snug text-bk-fg/80">
              <span aria-hidden="true" className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-bk-butter text-bk-ink">
                <Check className="size-3" strokeWidth={3.5} />
              </span>
              {point}
            </li>
          ))}
        </ul>
      </div>
      <HeroArt className="absolute inset-x-0 bottom-0 h-[34%] w-full motion-safe:animate-bk-art" />
    </aside>
  )
}

/** Sign-in, sign-up and the sign-in callback: the form on the left, the brand panel on the right from lg up. */
export default function AuthShell({ children }) {
  return (
    <div className={cn(appLayer, 'grid min-h-dvh bg-bk-bg lg:grid-cols-2')}>
      <div className="flex min-h-dvh flex-col">
        <header className="flex items-center justify-between gap-4 px-5 py-4 sm:px-8 sm:py-5">
          <Link href="/" aria-label="Batkle home" className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bk-fg">
            <BatkleLogo size={30} />
          </Link>
          <ThemeButton />
        </header>
        <main id="main" className="flex flex-1 items-center justify-center px-5 pb-16 pt-4 sm:px-8">
          <div className="w-full max-w-[400px] motion-safe:animate-bk-rise">{children}</div>
        </main>
      </div>
      <BrandPanel />
    </div>
  )
}
