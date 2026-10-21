import { cn } from '@/lib/utils'
import { batkleFonts } from '@/lib/batkleFonts'

/** Cookie holding the sidebar state; read by the server layout so a collapsed sidebar never flashes open. */
export const SIDEBAR_COOKIE = 'bk_sidebar'

/**
 * Classes for a Batkle app root. Dialogs, menus and sheets render in a portal outside the page,
 * so they need these too to keep the app's colours and fonts.
 */
export const appLayer = cn('bk-root bk-app font-bk-body text-bk-fg antialiased', batkleFonts)

const buttonBase =
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-bold transition-[background-color,border-color,color,opacity,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:[outline-style:solid] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg'

const buttonVariants = {
  primary: 'bg-bk-butter text-bk-ink hover:bg-[#FFCD24]',
  outline: 'border border-bk-field bg-bk-surface text-bk-fg hover:border-bk-fg/50',
  ink: 'bg-bk-fg text-bk-bg hover:opacity-90',
  onDark: 'border border-white/25 text-bk-cream hover:border-white/60 focus-visible:outline-bk-cream',
  quiet: 'text-bk-fg hover:bg-bk-alt',
}

// Compact app density: comfortable on a 13" laptop, still at least 32 px tall for touch.
const buttonSizes = {
  xs: 'h-8 px-2.5 text-[12.5px]',
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-4 text-[13.5px]',
}

export function appButton(variant = 'outline', size = 'md', className = '') {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)
}

export function Eyebrow({ className = '', children }) {
  return <p className={cn('text-[11px] font-bold uppercase tracking-[0.14em] text-bk-muted', className)}>{children}</p>
}

export const displayClass = 'font-bk-display font-bold tracking-[-0.04em]'

/** Page padding and width inside the app shell, shared by every brand page. */
export const pageShell = 'px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pt-8'
export const pageInner = 'mx-auto max-w-[1160px]'

/** A white card on the app background. */
export const panelClass = 'rounded-2xl border border-bk-line bg-bk-surface'

/** Title block of a brand page: eyebrow, heading, optional lead and actions on the right. */
export function PageHeader({ eyebrow, title, description, actions, className = '' }) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-4', className)}>
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className={cn(displayClass, 'mt-1.5 text-[clamp(26px,2.6vw,34px)] leading-[1.05]')}>{title}</h1>
        {description && <p className="mt-2 max-w-[640px] text-[14px] leading-relaxed text-bk-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/** Segmented tabs: `items` are [value, label] or [value, label, count]. */
export function SegmentedTabs({ items, value, onChange, label, className = '' }) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex max-w-full overflow-x-auto rounded-xl border border-bk-field bg-bk-surface p-1 [scrollbar-width:none]', className)}>
      {items.map(([key, text, count]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={cn(
            'flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition-colors focus-visible:[outline-style:solid] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg',
            value === key ? 'bg-bk-fg font-bold text-bk-bg' : 'text-bk-fg hover:bg-bk-alt',
          )}
        >
          {text}
          {count !== undefined && <span className={cn('tabular-nums', value === key ? 'text-bk-bg/70' : 'text-bk-muted')}>{count}</span>}
        </button>
      ))}
    </div>
  )
}

/** A short status line: info, warning or error. */
export function Notice({ tone = 'info', className = '', children }) {
  const tones = {
    info: 'border-bk-line bg-bk-surface text-bk-fg/85',
    warning: 'border-[#F2A900]/40 bg-[#F2A900]/[0.08] text-bk-fg',
    error: 'border-[#C2412F]/30 bg-[#C2412F]/[0.06] text-[#8F2D20] dark:text-[#F0826F]',
    success: 'border-[#1F7A5A]/25 bg-[#1F7A5A]/[0.07] text-[#17583F] dark:text-[#4CC79A]',
  }
  return <div role={tone === 'error' ? 'alert' : 'status'} className={cn('rounded-xl border px-3.5 py-2.5 text-[13px] leading-relaxed', tones[tone], className)}>{children}</div>
}

/** Empty state for a list or grid. */
export function EmptyState({ icon: Icon, title, children, action, className = '' }) {
  return (
    <div className={cn('rounded-2xl border border-dashed border-bk-field px-6 py-12 text-center', className)}>
      {Icon && <Icon className="mx-auto size-6 text-bk-muted" aria-hidden="true" />}
      <p className="mt-2.5 font-bk-display text-[17px] font-bold tracking-[-0.02em]">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-[420px] text-[13.5px] text-bk-muted">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

/**
 * The logo to show for a brand and whether it needs a dark tile. A white or very light logo
 * (measured when its variants were made) would vanish on white, so it sits on ink instead.
 */
export function brandLogo(brandContext) {
  const variants = brandContext?.logoVariants
  return { src: variants?.originalTransparent || brandContext?.logo || null, onDark: (variants?.inkLightness ?? 0) > 0.72 }
}

// The logo tile needs the browser (it falls back to the initial when a logo can't load), so it lives in its own file.
export { default as BrandTile } from './BrandTile'
