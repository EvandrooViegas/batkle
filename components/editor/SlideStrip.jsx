'use client'

import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Copy, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { CanvasPreview } from '@/components/CanvasPreview'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { appLayer } from '@/components/app/ui'
import { cn } from '@/lib/utils'
import { Tip } from './controls'

const THUMB_HEIGHT = 76
const DRAG_TYPE = 'application/x-batkle-slide'
const menuItem = 'gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold focus:bg-bk-alt focus:text-bk-fg'

/** The carousel's slides under the canvas: open, reorder (drag or menu), duplicate, delete and add. */
export function SlideStrip({ slides, activeId, size, onOpen, onAdd, onDuplicate, onDelete, onMove }) {
  const [dragging, setDragging] = useState(null)
  const [over, setOver] = useState(null)
  const width = Math.round(THUMB_HEIGHT * size.width / size.height)
  // Stable handlers keep unchanged thumbnails from re-rendering while the open slide is edited.
  const live = useRef({})
  live.current = { slides, dragging, onMove }
  const onDragStart = useCallback(index => setDragging(index), [])
  const onDragEnd = useCallback(() => { setDragging(null); setOver(null) }, [])
  const onDropAt = useCallback(to => {
    const { slides, dragging, onMove } = live.current
    if (dragging !== null) onMove(slides[dragging].id, to > dragging ? to - 1 : to)
    setDragging(null)
    setOver(null)
  }, [])

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-bk-line bg-bk-bg px-3 py-2.5">
      <p className="hidden w-14 shrink-0 text-[11px] font-bold uppercase leading-tight tracking-[0.14em] text-bk-muted xl:block">
        Slides<span className="mt-0.5 block text-[13px] tracking-normal text-bk-fg">{slides.length}</span>
      </p>
      <ol aria-label="Slides" className="flex min-w-0 flex-1 items-center gap-2.5 overflow-x-auto px-1 py-1.5 [scrollbar-width:thin]">
        {slides.map((slide, index) => (
          <SlideThumb
            key={slide.id}
            slide={slide}
            index={index}
            total={slides.length}
            active={slide.id === activeId}
            width={width}
            size={size}
            dropBefore={over === index && dragging !== null && dragging !== index && dragging !== index - 1}
            dropAfter={over === index + 1 && index === slides.length - 1 && dragging !== null && dragging !== index}
            onOpen={onOpen}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            onMove={onMove}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOverIndex={setOver}
            onDropAt={onDropAt}
          />
        ))}
        <li className="shrink-0">
          <Tip label="Add a slide after this one" side="top">
            <button
              type="button"
              onClick={onAdd}
              aria-label="Add slide"
              className="flex items-center justify-center rounded-md border border-dashed border-bk-field text-bk-muted transition-colors hover:border-bk-fg hover:text-bk-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg"
              style={{ width, height: THUMB_HEIGHT }}
            >
              <Plus className="size-5" />
            </button>
          </Tip>
        </li>
      </ol>
    </div>
  )
}

const SlideThumb = memo(function SlideThumb({ slide, index, total, active, width, size, dropBefore, dropAfter, onOpen, onDuplicate, onDelete, onMove, onDragStart, onDragEnd, onDragOverIndex, onDropAt }) {
  const name = slide.name || `Slide ${index + 1}`
  const preview = useMemo(
    () => ({ type: 'single', width: size.width, height: size.height, colorMode: size.colorMode, nodes: slide.nodes || [], classes: slide.classes || {}, background: slide.background }),
    [slide, size],
  )
  return (
    <li
      className="group relative shrink-0"
      draggable
      onDragStart={e => { e.dataTransfer.setData(DRAG_TYPE, slide.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(index) }}
      onDragEnd={onDragEnd}
      onDragOver={e => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
        e.preventDefault()
        const box = e.currentTarget.getBoundingClientRect()
        onDragOverIndex(e.clientX > box.left + box.width / 2 ? index + 1 : index)
      }}
      onDrop={e => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
        e.preventDefault()
        const box = e.currentTarget.getBoundingClientRect()
        onDropAt(e.clientX > box.left + box.width / 2 ? index + 1 : index)
      }}
    >
      {dropBefore && <span aria-hidden="true" className="absolute -left-[7px] inset-y-1 w-[3px] rounded-full bg-bk-fg" />}
      {dropAfter && <span aria-hidden="true" className="absolute -right-[7px] inset-y-1 w-[3px] rounded-full bg-bk-fg" />}
      <button
        type="button"
        onClick={() => onOpen(slide.id)}
        aria-label={`Slide ${index + 1}: ${name}`}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'relative block overflow-hidden rounded-md transition-[box-shadow,transform] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bk-fg',
          active ? 'ring-2 ring-bk-fg ring-offset-2 ring-offset-bk-bg' : 'ring-1 ring-bk-line hover:-translate-y-0.5 hover:ring-bk-fg/40',
        )}
        style={{ width, height: THUMB_HEIGHT }}
      >
        <CanvasPreview canvas={preview} />
      </button>
      <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-bk-ink/80 px-1 text-[10px] font-bold leading-[16px] text-bk-cream tabular-nums">{index + 1}</span>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={`Slide ${index + 1} options`}
          className={cn(
            'absolute right-1 top-1 flex size-6 items-center justify-center rounded-md bg-bk-surface/95 text-bk-fg shadow-sm transition-opacity focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bk-fg data-[state=open]:opacity-100',
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className={cn(appLayer, 'w-48 rounded-xl border-bk-line bg-bk-surface p-1.5 shadow-bk-pop')}>
          <DropdownMenuItem className={menuItem} disabled={index === 0} onSelect={() => onMove(slide.id, index - 1)}><ArrowLeft />Move left</DropdownMenuItem>
          <DropdownMenuItem className={menuItem} disabled={index === total - 1} onSelect={() => onMove(slide.id, index + 1)}><ArrowRight />Move right</DropdownMenuItem>
          <DropdownMenuItem className={menuItem} onSelect={() => onDuplicate(slide.id)}><Copy />Duplicate</DropdownMenuItem>
          <DropdownMenuSeparator className="bg-bk-line" />
          <DropdownMenuItem
            className={cn(menuItem, 'text-[#C2412F] focus:bg-[#C2412F]/10 focus:text-[#C2412F] dark:text-[#F0826F] dark:focus:text-[#F0826F]')}
            disabled={total <= 1}
            onSelect={() => onDelete(slide.id)}
          >
            <Trash2 />Delete slide
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
})
