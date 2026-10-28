'use client'

import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { BrandTile, brandLogo } from '../ui'

const fontName = font => String(font || '').replace(/-?(Thin|ExtraLight|Light|Regular|Medium|SemiBold|Bold|ExtraBold|Black|Italic|Oblique)/gi, '').trim()

// Text colour that stays readable on a brand colour (WCAG relative luminance).
function onColor(hex) {
  const full = /^#([a-f\d]{6})$/i.test(hex) ? hex.slice(1) : /^#([a-f\d]{3})$/i.test(hex) ? hex.slice(1).split('').map(c => c + c).join('') : null
  if (!full) return '#14131A'
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#14131A' : '#FFFFFF'
}

/** Loads the brand's first fonts from Google Fonts so the preview can show them; unknown names just fall back. */
function useBrandFonts(fonts) {
  useEffect(() => {
    for (const font of (fonts || []).slice(0, 2).map(fontName).filter(Boolean)) {
      const id = `bk-font-${font.replace(/\W+/g, '-').toLowerCase()}`
      if (document.getElementById(id)) continue
      const link = Object.assign(document.createElement('link'), { id, rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font).replace(/%20/g, '+')}:wght@400;700&display=swap` })
      document.head.appendChild(link)
    }
  }, [fonts])
}

function Skeleton({ className }) {
  return <span aria-hidden="true" className={cn('block animate-pulse rounded-md bg-bk-line', className)} />
}

/**
 * The brand as Batkle sees it: a card that starts as an outline, shimmers while research runs
 * and fills in with the real logo, colours, fonts and language.
 */
export default function BrandPreview({ domain, brand, languageLabel, loading = false, compact = false }) {
  useBrandFonts(brand?.fonts)
  const colors = (brand?.colors || []).filter(c => /^#([a-f\d]{3}|[a-f\d]{6})$/i.test(c)).slice(0, 6)
  const fonts = (brand?.fonts || []).map(fontName).filter(Boolean).slice(0, 2)
  const primary = colors[0] || '#FFD84D'
  const logo = brandLogo(brand)
  const name = brand?.name || ''
  const headline = fonts[0] || 'inherit'

  return (
    <div className={cn('overflow-hidden rounded-2xl bg-bk-surface shadow-bk-card', compact ? '' : 'lg:sticky lg:top-8')}>
      {!compact && (
        <div className="relative flex aspect-[4/5] flex-col justify-between p-6 transition-colors duration-500" style={{ backgroundColor: brand ? primary : undefined, color: brand ? onColor(primary) : undefined }}>
          {!brand && <div aria-hidden="true" className={cn('absolute inset-0 bg-bk-alt', loading && 'animate-pulse')} />}
          <div className="relative flex items-center gap-2.5">
            {brand ? <BrandTile name={name} logo={logo.src} logoOnDark={logo.onDark} size={34} /> : <Skeleton className="size-[34px] rounded-lg" />}
            {brand ? <span className="truncate text-[14px] font-bold">{name}</span> : <Skeleton className="h-3.5 w-28" />}
          </div>
          <div className="relative">
            {brand ? (
              <p className="text-[34px] font-bold leading-[1.02] tracking-[-0.03em]" style={{ fontFamily: `"${headline}", var(--font-bk-display), sans-serif` }}>
                Your posts, in your colours and voice.
              </p>
            ) : (
              <div className="space-y-2.5">
                <Skeleton className="h-7 w-[85%]" />
                <Skeleton className="h-7 w-[65%]" />
                <Skeleton className="h-7 w-[40%]" />
              </div>
            )}
            {brand && colors.length > 1 && (
              <div className="mt-6 flex gap-1.5" aria-hidden="true">
                {colors.slice(1, 5).map(color => <span key={color} className="h-1.5 w-8 rounded-full" style={{ backgroundColor: color }} />)}
              </div>
            )}
          </div>
        </div>
      )}

      <dl className="divide-y divide-bk-line text-[14px]">
        <div className="flex items-center justify-between gap-4 px-5 py-3.5">
          <dt className="text-bk-muted">Website</dt>
          <dd className="min-w-0 truncate font-semibold">{domain || 'yourbrand.com'}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 px-5 py-3.5">
          <dt className="text-bk-muted">Colours</dt>
          <dd className="flex gap-1.5">
            {colors.length
              ? colors.map(color => <span key={color} title={color} className="size-5 rounded-full ring-1 ring-inset ring-black/10" style={{ backgroundColor: color }} />)
              : loading ? <Skeleton className="h-5 w-24 rounded-full" /> : <span className="text-bk-muted">—</span>}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 px-5 py-3.5">
          <dt className="text-bk-muted">Fonts</dt>
          <dd className="min-w-0 truncate text-right font-semibold">
            {fonts.length ? fonts.join(' · ') : loading ? <Skeleton className="h-4 w-28" /> : <span className="font-normal text-bk-muted">—</span>}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 px-5 py-3.5">
          <dt className="text-bk-muted">Post language</dt>
          <dd className="min-w-0 truncate text-right font-semibold">
            {languageLabel || (loading ? <Skeleton className="h-4 w-24" /> : <span className="font-normal text-bk-muted">—</span>)}
          </dd>
        </div>
      </dl>
    </div>
  )
}
