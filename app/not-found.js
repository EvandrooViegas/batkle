import Link from 'next/link'
import StandaloneShell from '@/components/app/StandaloneShell'
import { appButton, displayClass } from '@/components/app/ui'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Page not found · Batkle' }

export default function NotFound() {
  return (
    <StandaloneShell back={null}>
      <div className="mx-auto flex min-h-[calc(100dvh-56px)] max-w-[560px] flex-col items-center justify-center px-6 py-16 text-center">
        <p className="relative isolate font-bk-display text-[clamp(72px,14vw,120px)] font-bold leading-none tracking-[-0.06em]">404<span aria-hidden="true" className="absolute inset-x-[-0.06em] bottom-[0.06em] -z-10 h-[0.3em] bg-bk-butter" /></p>
        <h1 className={cn(displayClass, 'mt-4 text-[clamp(26px,4vw,34px)] leading-tight')}>This page flew off</h1>
        <p className="mt-3 text-[16px] leading-relaxed text-bk-muted">The link may be old, or the page was moved. Your brands and posts are safe.</p>
        <div className="mt-8 flex flex-col gap-2 sm:flex-row">
          <Link href="/app" className={appButton('primary', 'md', 'h-11 px-5')}>Open the app</Link>
          <Link href="/" className={appButton('outline', 'md', 'h-11')}>Go to the home page</Link>
        </div>
      </div>
    </StandaloneShell>
  )
}
