'use client'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import CaseStudyCard from '@/components/CaseStudyCard'
import StandaloneShell from '@/components/app/StandaloneShell'
import { Eyebrow, appButton, displayClass } from '@/components/app/ui'
import { cn } from '@/lib/utils'

/**
 * Real case studies only. Each one: { id, name, logo, description, services: string[], images: string[] }.
 * Until the first is added the page says so, rather than showing invented clients.
 */
const CASE_STUDIES = []

export default function CaseStudiesPage() {
  const pieces = CASE_STUDIES.reduce((n, c) => n + (c.images?.length || 0), 0)
  return (
    <StandaloneShell back={{ href: '/', label: 'Back to home' }}>
      <div className="mx-auto max-w-[1240px] px-4 pb-28 pt-12 sm:px-6 lg:pt-20">
        <header className="grid gap-6 border-b border-bk-line pb-12 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <Eyebrow>Featured work</Eyebrow>
            <h1 className={cn(displayClass, 'mt-4 text-[clamp(44px,7vw,96px)] leading-[0.95]')}>
              Case <span className="relative isolate inline-block">studies<span aria-hidden="true" className="absolute inset-x-0 bottom-[0.08em] -z-10 h-[0.3em] bg-bk-butter" /></span>
            </h1>
          </div>
          <div className="lg:col-span-4">
            <p className="text-[17px] leading-relaxed text-bk-muted">How brands keep their posts consistent across every campaign, without designing each one from scratch.</p>
            {CASE_STUDIES.length > 0 && <p className="mt-4 font-bk-display text-[15px] font-bold">{CASE_STUDIES.length} {CASE_STUDIES.length === 1 ? 'story' : 'stories'} · {pieces} pieces of work</p>}
          </div>
        </header>
        {CASE_STUDIES.length ? (
          <div className="mt-16 space-y-24 lg:space-y-32">
            {CASE_STUDIES.map((caseStudy, i) => (
              <div key={caseStudy.id} className="motion-safe:animate-bk-page" style={{ animationDelay: `${i * 80}ms` }}>
                <CaseStudyCard caseStudy={caseStudy} index={i} />
              </div>
            ))}
          </div>
        ) : (
          <section className="mt-12 grid grid-cols-1 items-center gap-10 overflow-hidden rounded-[28px] border border-bk-line bg-bk-alt px-6 py-10 motion-safe:animate-bk-page sm:px-10 lg:mt-16 lg:grid-cols-12 lg:py-14">
            <div className="min-w-0 lg:col-span-7">
              <Eyebrow>Coming soon</Eyebrow>
              <h2 className={cn(displayClass, 'mt-3 text-[clamp(28px,3.4vw,44px)] leading-[1.04]')}>The first stories are being written.</h2>
              <p className="mt-4 max-w-[520px] text-[15.5px] leading-relaxed text-bk-muted">
                We are gathering results from the brands that post with Batkle. Until they are ready, the quickest way to see what it makes is to try it with your own brand.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/app" className={appButton('primary', 'md')}>Try it with your brand <ArrowRight className="size-4" aria-hidden="true" /></Link>
                <Link href="/" className={appButton('outline', 'md')}>Back to home</Link>
              </div>
            </div>
            {/* Three blank posts, fanned out: the shape of the work to come. */}
            <div aria-hidden="true" className="relative mx-auto h-[220px] w-[240px] lg:col-span-5 lg:h-[280px] lg:w-[300px]">
              <div className="absolute left-0 top-6 aspect-[4/5] w-[46%] -rotate-[9deg] rounded-2xl border border-bk-line bg-bk-surface shadow-bk-card" />
              <div className="absolute right-0 top-6 aspect-[4/5] w-[46%] rotate-[9deg] rounded-2xl bg-bk-fg shadow-bk-card" />
              <div className="absolute left-1/2 top-0 flex aspect-[4/5] w-[52%] -translate-x-1/2 flex-col justify-end gap-1.5 rounded-2xl bg-bk-butter p-4 shadow-bk-pop">
                <span className="h-2 w-3/4 rounded-full bg-black/80" />
                <span className="h-2 w-1/2 rounded-full bg-black/80" />
                <span className="mt-1 h-1.5 w-2/3 rounded-full bg-black/25" />
              </div>
            </div>
          </section>
        )}
      </div>
    </StandaloneShell>
  )
}
