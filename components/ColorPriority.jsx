'use client'
import { ArrowDown, ArrowUp } from 'lucide-react'

/** A colour's role (primary, secondary, accent) with buttons to move it up or down the palette. */
export default function ColorPriority({ index, count, onMove }) {
  const role = index === 0 ? 'Primary' : index === 1 ? 'Secondary' : 'Accent ' + (index - 1)
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <span className="w-[72px] text-center text-[11px] font-bold uppercase tracking-[0.12em] opacity-75">{role}</span>
      <button type="button" aria-label={'Increase importance of colour ' + (index + 1)} title="Move up" disabled={index === 0} onClick={() => onMove(index, index - 1)} className="rounded-md p-1.5 hover:bg-black/10 disabled:opacity-25"><ArrowUp className="size-3.5" /></button>
      <button type="button" aria-label={'Decrease importance of colour ' + (index + 1)} title="Move down" disabled={index === count - 1} onClick={() => onMove(index, index + 1)} className="rounded-md p-1.5 hover:bg-black/10 disabled:opacity-25"><ArrowDown className="size-3.5" /></button>
    </div>
  )
}

export function reorderColors(colors, from, to) {
  if (from < 0 || to < 0 || from >= colors.length || to >= colors.length) return colors
  const result = [...colors]
  const [color] = result.splice(from, 1)
  result.splice(to, 0, color)
  return result
}
