'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Brand logo tile: the logo on white (or ink, for light logos), or the brand's initial on butter. A logo that can't be
 * loaded (often a link to an old copy of the brand's website) falls back to the initial instead of an empty tile.
 */
export default function BrandTile({ name, logo, logoOnDark = false, size = 36, className = '' }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?'
  const [failed, setFailed] = useState(null)
  const image = useRef(null)
  // An image that failed before the page became interactive never fires onError: check it once mounted.
  useEffect(() => {
    const el = image.current
    if (el && el.complete && el.naturalWidth === 0) setFailed(logo)
  }, [logo])

  if (logo && failed !== logo) {
    return (
      <span
        className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-lg border p-1', logoOnDark ? 'border-transparent bg-bk-ink' : 'border-bk-line bg-white', className)}
        style={{ width: size, height: size }}
      >
        <img ref={image} src={logo} alt="" onError={() => setFailed(logo)} className="max-h-full max-w-full object-contain" />
      </span>
    )
  }
  return (
    <span
      aria-hidden="true"
      className={cn('flex shrink-0 items-center justify-center rounded-lg bg-bk-butter font-bk-display font-bold text-bk-ink', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {initial}
    </span>
  )
}
