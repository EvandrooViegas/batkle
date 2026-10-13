'use client'

import { createContext, useContext, useId, useState } from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { ChevronDown, Pipette } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { appLayer } from '@/components/app/ui'
import { cn } from '@/lib/utils'
import { CHECKER, isValidHex } from './kit'

/* Compact Batkle form controls for the editor's panels. */

export const fieldClass =
  'h-8 w-full min-w-0 rounded-lg border border-bk-field bg-bk-surface px-2.5 text-[13px] text-bk-fg placeholder:text-bk-muted/70 transition-colors hover:border-bk-fg/40 focus:border-bk-fg focus:outline-none disabled:opacity-50'

export const tooltipClass = cn(appLayer, 'rounded-md border-0 bg-bk-ink px-2.5 py-1.5 text-[12px] font-semibold text-bk-cream shadow-bk-pop')

/** A hover label for icon-only buttons. */
export function Tip({ label, side = 'bottom', children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={8} className={tooltipClass}>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Icon-only button with a tooltip. */
export function IconButton({ label, onClick, disabled, active, tone, side, className, children, ...props }) {
  return (
    <Tip label={label} side={side}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-bk-fg transition-colors hover:bg-bk-alt disabled:pointer-events-none disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg [&_svg]:size-4',
          active && 'bg-bk-fg text-bk-bg hover:bg-bk-fg',
          tone === 'danger' && 'text-[#C2412F] hover:bg-[#C2412F]/10 dark:text-[#F0826F]',
          className,
        )}
        {...props}
      >
        {children}
      </button>
    </Tip>
  )
}

/** A titled block of a side panel. */
export function Section({ title, action, children, className }) {
  return (
    <section className={cn('border-t border-bk-line px-4 py-4 first:border-t-0', className)}>
      {(title || action) && (
        <div className="mb-3 flex min-h-6 items-center justify-between gap-2">
          {title && <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-bk-muted">{title}</h3>}
          {action}
        </div>
      )}
      <div className="space-y-3">{children}</div>
    </section>
  )
}

/** A section that starts closed, for settings most posts never need. */
export function Disclosure({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <section className="border-t border-bk-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-bk-muted transition-colors hover:text-bk-fg focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bk-fg"
      >
        {title}
        <ChevronDown className={cn('size-4 transition-transform duration-200', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && <div id={id} className="space-y-3 px-4 pb-4">{children}</div>}
    </section>
  )
}

export function Field({ label, hint, htmlFor, className, children }) {
  return (
    <div className={cn('min-w-0', className)}>
      {label && <label htmlFor={htmlFor} className="mb-1 block text-[12px] font-semibold text-bk-muted">{label}</label>}
      {children}
      {hint && <p className="mt-1 text-[11.5px] leading-snug text-bk-muted">{hint}</p>}
    </div>
  )
}

/** Number input with a short label inside, e.g. "X" or "W". */
export function NumberField({ label, title, value, onChange, min, max, step = 1, suffix, placeholder, className }) {
  const id = useId()
  return (
    <div
      title={title}
      className={cn('flex h-8 min-w-0 items-center rounded-lg border border-bk-field bg-bk-surface text-[13px] transition-colors hover:border-bk-fg/40 focus-within:border-bk-fg', className)}
    >
      {label && <label htmlFor={id} className="shrink-0 pl-2.5 text-[11.5px] font-semibold text-bk-muted">{label}</label>}
      <input
        id={id}
        type="number"
        inputMode="decimal"
        aria-label={title || label}
        value={value ?? ''}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        className={cn(
          'h-full w-full min-w-0 bg-transparent tabular-nums text-bk-fg placeholder:text-bk-muted/70 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          label ? 'pl-1.5' : 'pl-2.5',
          suffix ? 'pr-1' : 'pr-2.5',
        )}
      />
      {suffix && <span className="shrink-0 pr-2.5 text-[11.5px] text-bk-muted">{suffix}</span>}
    </div>
  )
}

export function TextField({ className, ...props }) {
  return <input type="text" {...props} className={cn(fieldClass, className)} />
}

export function SelectField({ value, onChange, options, className, style, ...props }) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={style}
        className={cn(fieldClass, 'appearance-none pr-8')}
        {...props}
      >
        {options.map(o => (typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value} style={o.style}>{o.label}</option>))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-bk-muted" aria-hidden="true" />
    </div>
  )
}

/** A row of mutually exclusive choices. */
export function Segmented({ value, onChange, options, label, className, size = 'sm' }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex rounded-lg border border-bk-field bg-bk-surface p-0.5', className)}>
      {options.map(o => {
        const active = o.value === value
        const Icon = o.icon
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={Icon && !o.text ? o.label : undefined}
            title={o.title || (Icon && !o.text ? o.label : undefined)}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bk-fg',
              size === 'sm' ? 'h-7 px-2 text-[12.5px]' : 'h-8 px-2.5 text-[13px]',
              active ? 'bg-bk-fg text-bk-bg' : 'text-bk-fg hover:bg-bk-alt',
            )}
          >
            {Icon && <Icon className="size-3.5 shrink-0" aria-hidden="true" />}
            {(!Icon || o.text) && <span className="truncate">{o.text || o.label}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function RangeField({ label, value, onChange, min = 0, max = 100, step = 1, suffix = '' }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[12px]">
        <span className="font-semibold text-bk-muted">{label}</span>
        <span className="tabular-nums text-bk-fg/80">{value}{suffix}</span>
      </div>
      <SliderPrimitive.Root
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={v => onChange(v[0])}
        aria-label={label}
        className="relative flex h-4 w-full touch-none select-none items-center"
      >
        <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-bk-line">
          <SliderPrimitive.Range className="absolute h-full bg-bk-fg" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block size-3.5 rounded-full border-2 border-bk-fg bg-bk-surface shadow-sm transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg" />
      </SliderPrimitive.Root>
    </div>
  )
}

export function Toggle({ label, checked, onChange, hint }) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-semibold">{label}</label>
        {hint && <p className="text-[11.5px] text-bk-muted">{hint}</p>}
      </div>
      <SwitchPrimitive.Root
        id={id}
        checked={!!checked}
        onCheckedChange={onChange}
        className="inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-bk-field p-0.5 transition-colors data-[state=checked]:bg-bk-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg"
      >
        <SwitchPrimitive.Thumb className="block size-4 rounded-full bg-bk-surface shadow transition-transform data-[state=checked]:translate-x-4" />
      </SwitchPrimitive.Root>
    </div>
  )
}

/** Colours offered next to every colour field: the brand's, and those already used in the post. */
export const SwatchContext = createContext({ brand: [], used: [] })

function SwatchGrid({ title, colors, value, onPick }) {
  if (!colors.length) return null
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-bk-muted">{title}</p>
      <div className="grid grid-cols-8 gap-1">
        {colors.map(color => {
          const active = typeof value === 'string' && value.toLowerCase() === color
          return (
            <button
              key={color}
              type="button"
              title={color}
              aria-label={`Use ${color}`}
              aria-pressed={active}
              onPointerDown={e => e.preventDefault()}
              onClick={() => onPick(color)}
              className={cn('aspect-square rounded-md border border-black/10 transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bk-fg dark:border-white/15', active && 'ring-2 ring-bk-fg ring-offset-1 ring-offset-bk-surface')}
              style={{ backgroundColor: color }}
            />
          )
        })}
      </div>
    </div>
  )
}

/** Colour swatch that opens brand and post colours plus the system picker, a text value and a transparent option. */
export function ColorField({ value, onChange, allowTransparent = true, label = 'Colour' }) {
  const swatches = useContext(SwatchContext)
  const transparent = value === 'transparent'
  const hex = isValidHex(value) ? value : '#000000'
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label}: choose`}
            title="Choose a colour"
            className="relative size-8 shrink-0 overflow-hidden rounded-lg border border-bk-field transition-shadow hover:ring-2 hover:ring-bk-fg/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg data-[state=open]:ring-2 data-[state=open]:ring-bk-fg"
            style={{ background: CHECKER }}
          >
            <span className="absolute inset-0" style={{ backgroundColor: transparent ? 'transparent' : value || 'transparent' }} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          data-editor-popover=""
          onOpenAutoFocus={e => e.preventDefault()}
          onCloseAutoFocus={e => e.preventDefault()}
          className={cn(appLayer, 'w-[236px] space-y-3 rounded-xl border-bk-line bg-bk-surface p-3 shadow-bk-pop')}
        >
          <label className="relative flex h-8 cursor-pointer items-center gap-2 overflow-hidden rounded-lg border border-bk-field px-2 text-[12.5px] font-semibold transition-colors hover:border-bk-fg/50">
            <span className="size-4 shrink-0 rounded border border-black/10" style={{ backgroundColor: hex }} />
            Custom colour
            <Pipette className="ml-auto size-3.5 text-bk-muted" aria-hidden="true" />
            <input type="color" aria-label={`${label}: custom`} value={hex} onChange={e => onChange(e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
          </label>
          <SwatchGrid title="Brand colours" colors={swatches.brand} value={value} onPick={onChange} />
          <SwatchGrid title="In this post" colors={swatches.used} value={value} onPick={onChange} />
          {!swatches.brand.length && !swatches.used.length && <p className="text-[12px] text-bk-muted">Colours you use in this post appear here.</p>}
        </PopoverContent>
      </Popover>
      <input
        type="text"
        aria-label={label}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder="#000000"
        spellCheck={false}
        className={cn(fieldClass, 'font-mono text-[12px]')}
      />
      {allowTransparent && (
        <button
          type="button"
          onClick={() => onChange('transparent')}
          aria-label="No colour (transparent)"
          aria-pressed={transparent}
          title="Transparent"
          className={cn('size-8 shrink-0 rounded-lg border border-bk-field transition-opacity', transparent ? 'ring-2 ring-bk-fg ring-offset-1 ring-offset-bk-bg' : 'opacity-60 hover:opacity-100')}
          style={{ background: CHECKER }}
        />
      )}
    </div>
  )
}
