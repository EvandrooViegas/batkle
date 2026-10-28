'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

// Transparent cutouts are shown whole on a checkerboard so their missing background is visible.
const CHECKERBOARD = { backgroundImage: 'repeating-conic-gradient(rgb(var(--bk-fg) / 0.07) 0% 25%, transparent 0% 50%)', backgroundSize: '12px 12px' }

/** The brand gallery inside the editor: its saved transparent AI cutouts. */
export default function GalleryPicker({ flowId, onPick }) {
  const [assets, setAssets] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!flowId) return
    let live = true
    fetch(`/api/assets?brand_id=${encodeURIComponent(`brand_${flowId}`)}`)
      .then(res => res.json())
      .then(data => { if (live) setAssets(Array.isArray(data) ? data.filter(a => a.subject?.url || a.url) : []) })
      .catch(() => { if (live) setError('Could not load the brand gallery.') })
    return () => { live = false }
  }, [flowId])

  if (!flowId) return <p className="py-6 text-center text-[13.5px] text-bk-muted">This canvas is not linked to a brand, so it has no gallery.</p>
  if (error) return <p className="py-6 text-center text-[13.5px] text-[#C2412F] dark:text-[#F0826F]">{error}</p>
  if (!assets) return <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-bk-muted" /></div>
  if (!assets.length) return <p className="py-6 text-center text-[13.5px] text-bk-muted">No cutouts yet. The AI cutouts made for this brand’s posts appear here.</p>

  return (
    <div className="max-h-80 overflow-y-auto pr-1">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-bk-muted">Transparent cutouts (PNG)</p>
      <div className="grid grid-cols-4 gap-1.5">
        {assets.map(asset => {
          const src = asset.subject?.url || asset.url
          return (
            <button key={asset.id} type="button" onClick={() => onPick(src, asset)} title={asset.description || ''}
              className="aspect-square overflow-hidden rounded-lg border-2 border-transparent bg-bk-alt transition-colors hover:border-bk-fg focus-visible:border-bk-fg focus-visible:outline-none"
              style={CHECKERBOARD}>
              <img src={src} alt={asset.description || ''} loading="lazy" className="h-full w-full object-contain p-1" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
