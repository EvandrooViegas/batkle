'use client'

import { useState } from 'react'
import { Bookmark, ChevronRight, ChevronUp, Globe, Heart, MessageCircle, MoreHorizontal, Send, Share2, ThumbsUp, X } from 'lucide-react'
import { AD_TEXT_LIMITS, STORY_SAFE } from '@/lib/ads/meta'
import { cn } from '@/lib/utils'
import { PostThumb } from '../creation/PostThumb'

/**
 * How the ad looks where people will see it: a Facebook feed post, an Instagram feed post or a Story, drawn after
 * Meta's own layout (fixed light colours, as on a phone) around the real creative. The text is cut where Meta cuts it.
 */

const metaFont = { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' }

function Avatar({ brand, size = 40, ring = false }) {
  const initial = (brand.name || 'B').trim()[0]?.toUpperCase() || 'B'
  return (
    <span className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white', ring && 'p-[2px] ring-2 ring-[#d62976]')} style={{ width: size, height: size }}>
      {brand.logo
        ? <img src={brand.logo} alt="" className="size-full rounded-full border border-black/10 bg-white object-contain p-[3px]" />
        : <span className="flex size-full items-center justify-center rounded-full bg-[#14131A] text-[13px] font-bold text-white">{initial}</span>}
    </span>
  )
}

/** The text Meta shows before "See more", and the toggle to read the rest. */
function Clipped({ value, limit, more, className = '' }) {
  const [open, setOpen] = useState(false)
  const firstLine = value.split('\n')[0]
  const cut = !open && (value.length > limit || value.includes('\n'))
  const shown = cut ? (firstLine.length > limit ? `${firstLine.slice(0, limit).replace(/\s+\S*$/, '')}` : firstLine) : value
  return (
    <p className={cn('whitespace-pre-line', className)}>
      {shown}
      {cut && <>… <button type="button" onClick={() => setOpen(true)} className="font-semibold text-[#65676B] hover:underline">{more}</button></>}
    </p>
  )
}

const domainOf = url => { try { return new URL(url).hostname.replace(/^www\./, '').toUpperCase() } catch { return '' } }

function FacebookFeed({ brand, canvas, primary, headline, description, cta, link }) {
  return (
    <article className="w-full max-w-[440px] overflow-hidden rounded-xl bg-white text-[#050505] shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_28px_-12px_rgba(0,0,0,0.25)]" style={metaFont} aria-label="Facebook feed preview">
      <header className="flex items-center gap-2 px-3 pt-3">
        <Avatar brand={brand} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[15px] font-semibold">{brand.name}</p>
          <p className="flex items-center gap-1 text-[13px] text-[#65676B]">Sponsored · <Globe className="size-3" aria-hidden="true" /></p>
        </div>
        <MoreHorizontal className="size-5 text-[#65676B]" aria-hidden="true" /><X className="size-5 text-[#65676B]" aria-hidden="true" />
      </header>
      <Clipped key={primary} value={primary} limit={AD_TEXT_LIMITS.primaryText} more="See more" className="px-3 pb-3 pt-2 text-[15px] leading-[1.35]" />
      {canvas ? <PostThumb canvas={canvas} className="rounded-none" /> : <div className="aspect-[4/5] bg-[#F0F2F5]" />}
      <div className="flex items-center gap-3 bg-[#F0F2F5] px-3 py-2.5">
        <div className="min-w-0 flex-1 leading-tight">
          {link && <p className="truncate text-[12px] uppercase text-[#65676B]">{link}</p>}
          <p className="line-clamp-1 text-[16px] font-semibold">{headline}</p>
          {description && <p className="line-clamp-1 text-[14px] text-[#65676B]">{description}</p>}
        </div>
        <span className="shrink-0 rounded-md bg-[#E4E6EB] px-3 py-2 text-[15px] font-semibold">{cta}</span>
      </div>
      <footer className="flex justify-around border-t border-[#CED0D4] px-2 py-1.5 text-[15px] font-semibold text-[#65676B]">
        {[[ThumbsUp, 'Like'], [MessageCircle, 'Comment'], [Share2, 'Share']].map(([Icon, label]) => <span key={label} className="flex items-center gap-1.5 py-1"><Icon className="size-[18px]" aria-hidden="true" />{label}</span>)}
      </footer>
    </article>
  )
}

function InstagramFeed({ brand, canvas, primary, cta }) {
  const handle = (brand.name || 'brand').toLowerCase().replace(/[^a-z0-9]+/g, '')
  return (
    <article className="w-full max-w-[400px] overflow-hidden rounded-xl bg-white text-[#000] shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_28px_-12px_rgba(0,0,0,0.25)]" style={metaFont} aria-label="Instagram feed preview">
      <header className="flex items-center gap-2.5 px-3 py-2.5">
        <Avatar brand={brand} size={32} ring />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[14px] font-semibold">{handle}</p>
          <p className="text-[12px]">Sponsored</p>
        </div>
        <MoreHorizontal className="size-5" aria-hidden="true" />
      </header>
      {canvas ? <PostThumb canvas={canvas} className="rounded-none" /> : <div className="aspect-[4/5] bg-[#EFEFEF]" />}
      <div className="flex items-center justify-between border-b border-[#DBDBDB] px-3 py-2.5 text-[14px] font-semibold text-[#0095F6]">{cta}<ChevronRight className="size-4" aria-hidden="true" /></div>
      <div className="flex items-center gap-4 px-3 pt-2.5">
        <Heart className="size-6" aria-hidden="true" /><MessageCircle className="size-6" aria-hidden="true" /><Send className="size-6" aria-hidden="true" />
        <Bookmark className="ml-auto size-6" aria-hidden="true" />
      </div>
      <div className="px-3 pb-3 pt-2 text-[14px] leading-[1.35]">
        <Clipped key={primary} value={`${handle} ${primary}`} limit={AD_TEXT_LIMITS.primaryText} more="more" />
      </div>
    </article>
  )
}

function Story({ brand, canvas, cta, safe }) {
  const height = canvas?.height || 1920
  return (
    <article className="relative w-full max-w-[300px] overflow-hidden rounded-[28px] bg-black shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)] ring-[6px] ring-[#1c1c1e]" style={metaFont} aria-label="Story preview">
      {canvas ? <PostThumb canvas={canvas} className="rounded-none" /> : <div className="aspect-[9/16] bg-[#2a2a2a]" />}
      {/* Where Meta draws over the image: words and logos stay out of these bands. */}
      {safe && <>
        <div className="pointer-events-none absolute inset-x-0 top-0 border-b border-dashed border-white/70 bg-white/10" style={{ height: `${(STORY_SAFE.top / height) * 100}%` }} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-dashed border-white/70 bg-white/10" style={{ height: `${(STORY_SAFE.bottom / height) * 100}%` }} />
      </>}
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/45 to-transparent px-3 pb-6 pt-2.5">
        <div className="flex gap-1">{[0, 1, 2].map(i => <span key={i} className={cn('h-[2px] flex-1 rounded-full', i === 0 ? 'bg-white' : 'bg-white/40')} />)}</div>
        <div className="mt-2.5 flex items-center gap-2 text-white">
          <Avatar brand={brand} size={28} />
          <p className="text-[13px] font-semibold">{brand.name}</p>
          <p className="text-[12px] text-white/80">Sponsored</p>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center bg-gradient-to-t from-black/40 to-transparent pb-4 pt-8 text-white">
        <ChevronUp className="size-4" aria-hidden="true" />
        <span className="mt-1 rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-black">{cta}</span>
      </div>
    </article>
  )
}

/** The preview for one placement: Stories for 9:16, else the Facebook or Instagram feed. */
export default function AdPreview({ placement, network = 'facebook', brand, canvas, primary = '', headline = '', description = '', cta = 'Learn More', link = '', safe = false }) {
  if (placement === 'story') return <Story brand={brand} canvas={canvas} cta={cta} safe={safe} />
  if (network === 'instagram' && placement !== 'landscape') return <InstagramFeed brand={brand} canvas={canvas} primary={primary} cta={cta} />
  return <FacebookFeed brand={brand} canvas={canvas} primary={primary} headline={headline} description={description} cta={cta} link={domainOf(link)} />
}
