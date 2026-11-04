'use client'

import { Lock, Users } from 'lucide-react'
import { BrandTile } from '@/components/app/ui'
import { cn } from '@/lib/utils'

/**
 * Who made a design, from its `library` info (`maker` from the API): the brand it was made in, with its logo, and the
 * person who uploaded it, with their photo. Batkle's bundled designs, and ones saved before bylines, show Batkle.
 */

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** A person's account photo, or their initials on ink, as the account menu shows them. */
function PersonPhoto({ person, size, className = '' }) {
  return (
    <span aria-hidden="true" className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-bk-ink font-bold text-bk-cream dark:bg-bk-butter dark:text-bk-ink', className)} style={{ width: size, height: size, fontSize: Math.max(7, Math.round(size * 0.38)) }}>
      {person.photo ? <img src={person.photo} alt="" className="size-full object-cover" /> : initialsOf(person.name)}
    </span>
  )
}

/**
 * Who made a design, as a picture: the brand's logo with the uploader's photo on its corner (`ring` matches the
 * surface behind it). Batkle's mark for its bundled designs, which have no maker.
 */
export function MakerMark({ maker, size, ring = 'ring-bk-surface' }) {
  if (!maker) return (
    <span aria-hidden="true" className="shrink-0" style={{ width: size, height: size }}>
      <img src="/logo/batkle-icon-color.png" alt="" className="size-full dark:hidden" />
      <img src="/logo/batkle-icon-color-reversed.png" alt="" className="hidden size-full dark:block" />
    </span>
  )
  if (!maker.brand) return <PersonPhoto person={maker.person} size={size} />
  const photo = Math.round(size * 0.58), out = maker.person ? Math.round(size * 0.22) : 0
  return (
    <span className="relative shrink-0" style={{ width: size + out, height: size + out }}>
      <BrandTile name={maker.brand.name} logo={maker.brand.logo} logoOnDark={maker.brand.logoOnDark} size={size} className={size < 28 ? 'rounded-[5px] p-0.5' : ''} />
      {maker.person && <PersonPhoto person={maker.person} size={photo} className={cn('absolute bottom-0 right-0 ring-2', ring)} />}
    </span>
  )
}

function Privacy({ info }) {
  if (info.official || info.visibility !== 'private') return null
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-bk-chip px-1.5 py-px text-[10.5px] font-bold text-bk-fg">
      {info.team ? <Users className="size-3" aria-hidden="true" /> : <Lock className="size-3" aria-hidden="true" />}{info.team ? 'Team' : 'Private'}
    </span>
  )
}

const personName = (person, alone) => (person.you ? (alone ? 'You' : 'you') : person.name)

/** The list's one-line byline: "KACHICA · Eva Lima", with the brand's logo and her photo. */
export function Origin({ info, ring, className = '' }) {
  if (!info) return null
  const { brand, person } = info.maker || {}
  const text = info.maker ? [brand?.name, person && personName(person, !brand)].filter(Boolean).join(' · ') : info.official ? 'Batkle' : info.author
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5 text-[12px] text-bk-muted', className)}>
      <MakerMark maker={info.maker} size={20} ring={ring} />
      <span className="truncate">{text}</span>
      <Privacy info={info} />
    </span>
  )
}

/** The stage's byline: the brand's name over who uploaded it, beside their logo and photo. */
export function Byline({ info, className = '' }) {
  if (!info) return null
  const { brand, person } = info.maker || {}
  const title = brand?.name || (person ? personName(person, true) : info.official ? 'Batkle' : info.author)
  const detail = brand && person ? `Uploaded by ${personName(person)}` : person ? (info.official ? 'Batkle design' : 'Batkle member') : info.official ? 'Made by the Batkle team' : ''
  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <MakerMark maker={info.maker} size={40} />
      <div className="min-w-0">
        <p className="truncate text-[14px] font-bold">{title}</p>
        {(detail || !info.official) && <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-bk-muted"><span className="truncate">{detail}</span><Privacy info={info} /></p>}
      </div>
    </div>
  )
}
