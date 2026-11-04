'use client'

import Link from 'next/link'
import { ArrowRight, Check, Lightbulb } from 'lucide-react'
import { BrandTile, appButton, brandLogo } from '../ui'
import { stepHeading } from './styles'

/** Done: the brand exists; point straight at the first useful thing to do with it. */
export default function ReadyStep({ flowId, brand, languageLabel, headingRef }) {
  const logo = brandLogo(brand)
  return (
    <div className="mx-auto max-w-[560px] text-center">
      <div className="relative mx-auto w-fit motion-safe:animate-bk-rise">
        <BrandTile name={brand.name} logo={logo.src} logoOnDark={logo.onDark} size={88} className="rounded-2xl shadow-bk-card" />
        <span aria-hidden="true" className="absolute -bottom-2 -right-2 flex size-9 items-center justify-center rounded-full border-4 border-bk-alt bg-bk-butter text-bk-ink">
          <Check className="size-4" strokeWidth={3} />
        </span>
      </div>
      <h1 ref={headingRef} tabIndex={-1} className={`${stepHeading} mt-8`}>{brand.name} is ready</h1>
      <p className="mx-auto mt-3 max-w-[460px] text-[16px] leading-relaxed text-bk-muted">
        Batkle now writes post ideas in {languageLabel}, built on your services and projects, and designs them in your colours, fonts and logo.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-2 sm:flex-row">
        <Link href={`/app/${flowId}/creation`} className={appButton('primary', 'md', 'h-11 px-5')}>
          <Lightbulb className="size-4" />Get your first post ideas<ArrowRight className="size-4" />
        </Link>
        <Link href={`/app/${flowId}/brand-information`} className={appButton('outline', 'md', 'h-11')}>
          Review brand profile
        </Link>
      </div>
    </div>
  )
}
