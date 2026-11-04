'use client'

import { useEffect, useRef, useState } from 'react'
import { Bookmark, ChevronLeft, ChevronRight, ChevronUp, Globe, Heart, MessageCircle, MoreHorizontal, Send, Share2, ThumbsUp, X } from 'lucide-react'
import { AD_TEXT_LIMITS, STORY_SAFE } from '@/lib/ads/meta'
import { cn } from '@/lib/utils'
import { PostThumb } from '../creation/PostThumb'

/**
 * How the ad looks where people will see it: a Facebook feed post, an Instagram feed post or a Story, drawn after
 * Meta's own layout (fixed light colours, as on a phone) around the real creative. The text is cut where Meta cuts it.
 * A carousel shows its cards as Meta does: side by side with a headline under each on Facebook, one at a time with dots
 * on Instagram, one frame each in Stories. `card` is the card in view, and `onCard` moves to another.
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

/** A round arrow over a carousel, as Meta draws them on a computer. */
function Arrow({ side, onClick, label }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <button type="button" onClick={onClick} aria-label={label} className={cn('absolute top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-[#050505] shadow-[0_1px_4px_rgba(0,0,0,0.3)] transition-transform hover:scale-105', side === 'left' ? 'left-2' : 'right-2')}>
      <Icon className="size-5" aria-hidden="true" />
    </button>
  )
}

/** Arrows to the card before and after the one in view, where there is one. */
function CardArrows({ count, card, onCard }) {
  return <>
    {card > 0 && <Arrow side="left" label="Previous card" onClick={() => onCard(card - 1)} />}
    {card < count - 1 && <Arrow side="right" label="Next card" onClick={() => onCard(card + 1)} />}
  </>
}

/** Facebook's carousel: cards side by side, each with its headline, description and button; the card in view first. */
function FacebookCards({ canvas, cards, card, onCard, cta }) {
  const strip = useRef(null)
  useEffect(() => {
    const el = strip.current?.children[card]
    if (el) strip.current.scrollTo({ left: el.offsetLeft - 12, behavior: 'smooth' })
  }, [card])
  return (
    <div className="relative">
      <ul ref={strip} className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {cards.map((c, i) => (
          <li key={i} className="w-[72%] shrink-0 snap-start overflow-hidden rounded-lg border border-[#CED0D4]">
            <button type="button" onClick={() => onCard(i)} aria-label={`Card ${i + 1}`} className="block w-full"><PostThumb canvas={canvas} page={i} className="rounded-none" /></button>
            <div className="flex items-center gap-2 px-2.5 py-2">
              <div className="min-w-0 flex-1 leading-tight">
                <p className="line-clamp-2 text-[14px] font-semibold">{c.headline}</p>
                {c.description && <p className="line-clamp-1 text-[12.5px] text-[#65676B]">{c.description}</p>}
              </div>
              <span className="shrink-0 rounded-md bg-[#E4E6EB] px-2.5 py-1.5 text-[13px] font-semibold">{cta}</span>
            </div>
          </li>
        ))}
      </ul>
      <CardArrows count={cards.length} card={card} onCard={onCard} />
    </div>
  )
}

/** Dots under an Instagram carousel, the card in view in blue. */
function Dots({ count, card }) {
  return <span aria-hidden="true" className="absolute left-1/2 flex -translate-x-1/2 gap-1">{Array.from({ length: count }, (_, i) => <span key={i} className={cn('size-1.5 rounded-full', i === card ? 'bg-[#0095F6]' : 'bg-[#C7C7C7]')} />)}</span>
}

const domainOf = url => { try { return new URL(url).hostname.replace(/^www\./, '').toUpperCase() } catch { return '' } }

function FacebookFeed({ brand, canvas, primary, headline, description, cta, link, cards, card, onCard }) {
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
      {cards ? <FacebookCards canvas={canvas} cards={cards} card={card} onCard={onCard} cta={cta} /> : <>
        {canvas ? <PostThumb canvas={canvas} className="rounded-none" /> : <div className="aspect-[4/5] bg-[#F0F2F5]" />}
        <div className="flex items-center gap-3 bg-[#F0F2F5] px-3 py-2.5">
          <div className="min-w-0 flex-1 leading-tight">
            {link && <p className="truncate text-[12px] uppercase text-[#65676B]">{link}</p>}
            <p className="line-clamp-1 text-[16px] font-semibold">{headline}</p>
            {description && <p className="line-clamp-1 text-[14px] text-[#65676B]">{description}</p>}
          </div>
          <span className="shrink-0 rounded-md bg-[#E4E6EB] px-3 py-2 text-[15px] font-semibold">{cta}</span>
        </div>
      </>}
      <footer className="flex justify-around border-t border-[#CED0D4] px-2 py-1.5 text-[15px] font-semibold text-[#65676B]">
        {[[ThumbsUp, 'Like'], [MessageCircle, 'Comment'], [Share2, 'Share']].map(([Icon, label]) => <span key={label} className="flex items-center gap-1.5 py-1"><Icon className="size-[18px]" aria-hidden="true" />{label}</span>)}
      </footer>
    </article>
  )
}

function InstagramFeed({ brand, canvas, primary, cta, cards, card, onCard }) {
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
      <div className="relative">
        {canvas ? <PostThumb canvas={canvas} page={cards ? card : 0} className="rounded-none" /> : <div className="aspect-[4/5] bg-[#EFEFEF]" />}
        {cards && <CardArrows count={cards.length} card={card} onCard={onCard} />}
        {cards && <span className="absolute right-3 top-3 rounded-full bg-black/70 px-2 py-0.5 text-[12px] font-semibold text-white">{card + 1}/{cards.length}</span>}
      </div>
      <div className="flex items-center justify-between border-b border-[#DBDBDB] px-3 py-2.5 text-[14px] font-semibold text-[#0095F6]">{cta}<ChevronRight className="size-4" aria-hidden="true" /></div>
      <div className="relative flex items-center gap-4 px-3 pt-2.5">
        <Heart className="size-6" aria-hidden="true" /><MessageCircle className="size-6" aria-hidden="true" /><Send className="size-6" aria-hidden="true" />
        {cards && <Dots count={cards.length} card={card} />}
        <Bookmark className="ml-auto size-6" aria-hidden="true" />
      </div>
      <div className="px-3 pb-3 pt-2 text-[14px] leading-[1.35]">
        <Clipped key={primary} value={`${handle} ${primary}`} limit={AD_TEXT_LIMITS.primaryText} more="more" />
      </div>
    </article>
  )
}

function Story({ brand, canvas, cta, safe, cards, card, onCard }) {
  const height = canvas?.height || 1920
  return (
    <article className="relative w-full max-w-[300px] overflow-hidden rounded-[28px] bg-black shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)] ring-[6px] ring-[#1c1c1e]" style={metaFont} aria-label="Story preview">
      {canvas ? <PostThumb canvas={canvas} page={cards ? card : 0} className="rounded-none" /> : <div className="aspect-[9/16] bg-[#2a2a2a]" />}
      {cards && <CardArrows count={cards.length} card={card} onCard={onCard} />}
      {/* Where Meta draws over the image: words and logos stay out of these bands. */}
      {safe && <>
        <div className="pointer-events-none absolute inset-x-0 top-0 border-b border-dashed border-white/70 bg-white/10" style={{ height: `${(STORY_SAFE.top / height) * 100}%` }} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-dashed border-white/70 bg-white/10" style={{ height: `${(STORY_SAFE.bottom / height) * 100}%` }} />
      </>}
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/45 to-transparent px-3 pb-6 pt-2.5">
        <div className="flex gap-1">{Array.from({ length: cards ? cards.length : 3 }, (_, i) => <span key={i} className={cn('h-[2px] flex-1 rounded-full', i <= (cards ? card : 0) ? 'bg-white' : 'bg-white/40')} />)}</div>
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

/**
 * The preview for one placement: Stories for 9:16, else the Facebook or Instagram feed. `cards` (a carousel's headlines
 * and descriptions) shows the canvas's pages as cards.
 */
export default function AdPreview({ placement, network = 'facebook', brand, canvas, primary = '', headline = '', description = '', cta = 'Learn More', link = '', safe = false, cards = null, card = 0, onCard = () => {} }) {
  const carousel = cards?.length > 1 ? { cards, card: Math.min(card, cards.length - 1), onCard } : { cards: null, card: 0, onCard }
  if (placement === 'story') return <Story brand={brand} canvas={canvas} cta={cta} safe={safe} {...carousel} />
  if (network === 'instagram' && placement !== 'landscape') return <InstagramFeed brand={brand} canvas={canvas} primary={primary} cta={cta} {...carousel} />
  return <FacebookFeed brand={brand} canvas={canvas} primary={primary} headline={headline} description={description} cta={cta} link={domainOf(link)} {...carousel} />
}
