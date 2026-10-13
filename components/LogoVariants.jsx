'use client'
import { useState } from 'react'
import { Loader2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { appButton } from '@/components/app/ui'
import { cn } from '@/lib/utils'

const labels = { originalTransparent: 'Original · transparent', blackTransparent: 'Black · transparent', whiteTransparent: 'White · transparent', blackOnWhite: 'Black on white', whiteOnBlack: 'White on black', originalOnWhite: 'Original on white', originalOnBlack: 'Original on black' }

/** Transparent and contrasting versions of the logo, for light and dark designs. */
export default function LogoVariants({ logo, variants, onChange }) {
  const [busy, setBusy] = useState(false)
  const valid = variants?.source === logo
  async function generate() {
    setBusy(true)
    try {
      const response = await fetch('/api/logo-variants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logo }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      onChange(result)
      toast.success('Logo versions ready. Save the profile to keep them.')
    } catch (error) {
      toast.error(error.message || 'The logo versions could not be made')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] font-bold">Logo versions</span>
        <button type="button" disabled={!logo || busy} onClick={generate} className={appButton('outline', 'xs')}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
          {busy ? 'Making versions…' : valid ? 'Make them again' : 'Make logo versions'}
        </button>
      </div>
      {valid ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Object.entries(labels).map(([key, label]) => variants[key] && (
            <li key={key}>
              <a href={variants[key]} download={`logo-${key}.png`} title={`Download ${label}`} className="block overflow-hidden rounded-xl border border-bk-line transition-colors hover:border-bk-fg/50">
                {/* A light logo's transparent original sits on ink, like the brand tile, or it would vanish. */}
                <span className={cn('block h-20 p-3', key.startsWith('white') || key.endsWith('Black') || (key === 'originalTransparent' && (variants.inkLightness ?? 0) > 0.72) ? 'bg-bk-ink' : 'bg-white')}>
                  <img src={variants[key]} alt={label} className="size-full object-contain" />
                </span>
                <span className="block px-2 py-1.5 text-[12px] font-semibold">{label}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-bk-muted">{logo ? 'Make transparent and high-contrast versions so the logo reads on any background.' : 'Add a logo address below first.'}</p>
      )}
    </div>
  )
}
