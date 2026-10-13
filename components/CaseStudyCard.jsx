'use client'
import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/** One case study as an editorial spread: a large image carousel beside the story, alternating sides. */
export default function CaseStudyCard({ caseStudy, index = 0 }) {
  const [current, setCurrent] = useState(0)
  const [failed, setFailed] = useState({})
  if (!caseStudy) return null

  const images = caseStudy.images || []
  const go = step => setCurrent(prev => (prev + step + images.length) % images.length)
  const initial = (caseStudy.name || '?').trim().charAt(0).toUpperCase()
  const reverse = index % 2 === 1

  return (
    <article className="grid items-center gap-8 lg:grid-cols-12 lg:gap-12">
      <div className={cn('group relative overflow-hidden rounded-[24px] bg-bk-ink lg:col-span-7', reverse && 'lg:order-2')}>
        <div className="aspect-[4/3]">
          {images[current] && !failed[current] ? (
            <img src={images[current]} alt={`${caseStudy.name}, image ${current + 1}`} className="size-full object-cover" onError={() => setFailed(prev => ({ ...prev, [current]: true }))} />
          ) : (
            // A missing image still shows something on-brand instead of a broken icon.
            <div className="flex size-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,#FFD84D_0,transparent_45%),radial-gradient(circle_at_80%_80%,#FF7A59_0,transparent_40%)]">
              <span className="font-bk-display text-[96px] font-bold text-bk-cream/90">{initial}</span>
            </div>
          )}
        </div>
        {images.length > 1 && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-black/60 to-transparent p-4 pt-10">
            <div className="flex gap-1.5">
              {images.map((_, i) => <button key={i} type="button" aria-label={`Image ${i + 1}`} aria-current={i === current ? 'true' : undefined} onClick={() => setCurrent(i)} className={cn('h-1.5 rounded-full transition-all', i === current ? 'w-6 bg-white' : 'w-1.5 bg-white/55 hover:bg-white/80')} />)}
            </div>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => go(-1)} aria-label="Previous image" className="flex size-9 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/30"><ChevronLeft className="size-5" /></button>
              <button type="button" onClick={() => go(1)} aria-label="Next image" className="flex size-9 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/30"><ChevronRight className="size-5" /></button>
            </div>
          </div>
        )}
      </div>
      <div className={cn('lg:col-span-5', reverse && 'lg:order-1')}>
        <p className="font-bk-display text-[64px] font-bold leading-none tracking-[-0.06em] text-bk-fg/15 tabular-nums">{String(index + 1).padStart(2, '0')}</p>
        <h2 className="mt-3 font-bk-display text-[clamp(28px,3vw,40px)] font-bold leading-[1.02] tracking-[-0.04em]">{caseStudy.name}</h2>
        <p className="mt-4 text-[17px] leading-relaxed text-bk-fg/80">{caseStudy.description}</p>
        {caseStudy.services?.length > 0 && (
          <ul aria-label="Services" className="mt-6 flex flex-wrap gap-2">
            {caseStudy.services.map(service => <li key={service} className="rounded-full border border-bk-fg/20 px-3.5 py-1.5 text-[13px] font-semibold">{service}</li>)}
          </ul>
        )}
        {images.length > 0 && <p className="mt-6 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-bk-muted">{images.length} piece{images.length === 1 ? '' : 's'} of work</p>}
      </div>
    </article>
  )
}
