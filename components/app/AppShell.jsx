'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { useClerk, useUser } from '@clerk/nextjs'
import { CalendarClock, Check, ChevronDown, ChevronsUpDown, Code2, CreditCard, Fingerprint, Gauge, Images, LayoutTemplate, LogOut, Megaphone, Menu, Moon, PanelLeftClose, PanelLeftOpen, Plus, Settings, Smartphone, Sun, Trash2, Users, Wand2, X } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { BatkleLogo } from '@/components/landing/brand'
import { clerkAppearance } from '@/components/auth/clerkAppearance'
import SmoothScroll from '@/components/landing/SmoothScroll'
import { cn } from '@/lib/utils'
import { BrandTile, Eyebrow, SIDEBAR_COOKIE, appButton, appLayer, brandLogo } from './ui'
import { usePopup } from './popup'
import CreditsMeter, { creditsLabel } from './billing/CreditsMeter'
import PlanBadge, { PlanMark, planLabel } from './billing/PlanBadge'
import { useBilling } from './billing/useBilling'

const ShellContext = createContext({ setCount: () => {} })

function initialsOf(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/**
 * The signed-in person: Clerk's live profile once it has loaded (it changes in account settings), the server's
 * copy before that. Also opens account settings in Batkle's colours, and signs out.
 */
function useAccount(fallback) {
  const { user } = useUser()
  const clerk = useClerk()
  const { resolvedTheme } = useTheme()
  const name = user?.fullName || fallback?.name || 'Your account'
  return {
    name,
    email: user?.primaryEmailAddress?.emailAddress || fallback?.email || '',
    imageUrl: user?.hasImage ? user.imageUrl : null,
    initials: initialsOf(name),
    openSettings: () => clerk.openUserProfile({ appearance: clerkAppearance(resolvedTheme === 'dark') }),
    signOut: () => clerk.signOut({ redirectUrl: '/' }),
  }
}

/** The account photo, or initials on ink with the butter ring. */
function Avatar({ account, size, ringOffset }) {
  return (
    <span
      aria-hidden="true"
      className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-bk-ink font-bold text-bk-cream ring-2 ring-bk-butter ring-offset-2', ringOffset)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {account.imageUrl ? <img src={account.imageUrl} alt="" className="size-full object-cover" /> : account.initials}
    </span>
  )
}

const menuClass = cn(appLayer, 'w-60 rounded-xl border-bk-line bg-bk-surface p-1.5 shadow-bk-pop')
const menuItemClass = 'gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold focus:bg-bk-alt focus:text-bk-fg'
/** Lets a page update its sidebar count (for example, Creation's idea count) without a reload. */
export const useAppShell = () => useContext(ShellContext)

// The studio navigation: Create (posts, stories, ads) leads; then planning, the brand, and the workspace.
function navGroups(brandId) {
  return [
    {
      key: 'create', label: 'Create', Icon: Wand2, parent: true, items: [
        { key: 'creation', label: 'Posts', href: `/app/${brandId}/creation`, count: 'creation', Icon: Wand2 },
        { key: 'stories', label: 'Stories', href: `/app/${brandId}/stories`, count: 'stories', Icon: Smartphone },
        { key: 'ads', label: 'Ads', href: `/app/${brandId}/ads`, Icon: Megaphone },
      ],
    },
    {
      key: 'plan', label: 'Plan', items: [
        { key: 'schedule', label: 'Schedule', href: `/app/${brandId}/schedule`, count: 'schedule', Icon: CalendarClock },
        { key: 'gallery', label: 'Gallery', href: `/app/${brandId}/gallery`, count: 'gallery', Icon: Images },
      ],
    },
    {
      key: 'brand', label: 'Brand', items: [
        { key: 'brand-information', label: 'Brand profile', href: `/app/${brandId}/brand-information`, Icon: Fingerprint },
        { key: 'design-library', label: 'Design Library', href: `/app/${brandId}/design-library`, Icon: LayoutTemplate },
      ],
    },
    {
      key: 'workspace', label: 'Workspace', items: [
        { key: 'team', label: 'Team', href: `/app/${brandId}/team`, Icon: Users },
      ],
    },
  ]
}
// Pages a brand switch keeps you on.
const BRAND_PAGES = ['creation', 'stories', 'ads', 'schedule', 'gallery', 'brand-information', 'design-library', 'team']

const tooltipClass = cn(appLayer, 'rounded-md border-0 bg-bk-ink px-2.5 py-1.5 text-[12px] font-semibold text-bk-cream shadow-bk-pop')

/** A label beside the collapsed rail; plain children when the sidebar is expanded. */
function RailTip({ show, label, children }) {
  if (!show) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className={tooltipClass}>{label}</TooltipContent>
    </Tooltip>
  )
}

function BrandSwitcher({ flows, brand, activeSlug, onDelete, compact }) {
  const router = useRouter()
  const slug = BRAND_PAGES.includes(activeSlug) ? activeSlug : 'creation'

  return (
    // Non-modal so opening the delete dialog from a menu item never leaves the page unclickable.
    <DropdownMenu modal={false}>
      {compact ? (
        <RailTip show label={`${brand.name} · Switch brand`}>
          <DropdownMenuTrigger className="rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg" aria-label={`${brand.name}: switch brand`}>
            <BrandTile name={brand.name} logo={brand.logo} logoOnDark={brand.logoOnDark} size={36} />
          </DropdownMenuTrigger>
        </RailTip>
      ) : (
        <DropdownMenuTrigger className={appButton('outline', 'xs', 'h-7 px-2')} aria-label="Switch brand">
          Switch
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent align={compact ? 'start' : 'end'} side={compact ? 'right' : 'bottom'} className={cn(appLayer, 'w-64 rounded-xl border-bk-line bg-bk-surface p-1.5 shadow-bk-pop')}>
        <DropdownMenuLabel className="px-2 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-bk-muted">Brands</DropdownMenuLabel>
        {flows.map(flow => {
          const name = flow.brandContext?.name || flow.name || 'Untitled brand'
          const current = flow.id === brand.id
          const logo = brandLogo(flow.brandContext)
          return (
            <DropdownMenuItem
              key={flow.id}
              onSelect={() => !current && router.push(`/app/${flow.id}/${slug}`)}
              className="gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold focus:bg-bk-alt focus:text-bk-fg"
            >
              <BrandTile name={name} logo={logo.src} logoOnDark={logo.onDark} size={24} />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {current && <Check className="text-bk-fg" aria-label="Current brand" />}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator className="bg-bk-line" />
        <DropdownMenuItem onSelect={() => router.push('/app/new')} className="gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold focus:bg-bk-alt focus:text-bk-fg">
          <Plus /> Add brand
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDelete} className="gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-[#C2412F] focus:bg-[#C2412F]/10 focus:text-[#C2412F] dark:text-[#F0826F] dark:focus:text-[#F0826F]">
          <Trash2 /> Delete {brand.name}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** One page in the navigation: a label (with its count) in the sidebar, an icon on the collapsed rail. */
function NavLink({ item, active, count, collapsed, nested, onNavigate }) {
  const { label, href, Icon } = item
  return (
    <RailTip show={collapsed} label={typeof count === 'number' ? `${label} · ${count}` : label}>
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? label : undefined}
        className={cn(
          'relative flex h-9 items-center rounded-lg text-[14px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg',
          collapsed ? 'w-10 justify-center' : cn('gap-2.5', nested ? 'pl-3 pr-3' : 'px-3'),
          active ? 'bg-bk-butter font-bold text-bk-ink' : 'text-bk-fg/75 hover:bg-bk-alt hover:text-bk-fg',
        )}
      >
        {collapsed ? <Icon className="size-[17px] shrink-0" aria-hidden="true" /> : <span className="min-w-0 flex-1 truncate">{label}</span>}
        {typeof count === 'number' && (collapsed ? (
          count > 0 && <span className={cn('absolute -right-1 -top-1 min-w-[16px] rounded-full px-1 text-center text-[9.5px] font-bold leading-4 tabular-nums', active ? 'bg-bk-ink text-white' : 'bg-bk-fg/80 text-bk-bg')}>{count > 99 ? '99+' : count}</span>
        ) : (
          <span className={cn('tabular-nums', active ? 'rounded-full bg-bk-ink px-1.5 py-px text-[11px] font-bold text-white' : 'text-[12px] text-bk-muted')}>{count}</span>
        ))}
      </Link>
    </RailTip>
  )
}

/**
 * The studio navigation. Create is a parent with its three kinds of content under it (folded open by default, and
 * always open on the page you are on); the other groups are headed lists. The collapsed rail shows every page as an icon.
 */
function StudioNav({ brandId, counts, activeSlug, collapsed, onNavigate }) {
  const groups = navGroups(brandId)
  const [createOpen, setCreateOpen] = useState(true)
  return (
    <nav aria-label="Studio" className={cn('w-full', collapsed ? 'mt-3' : 'mt-5')}>
      {groups.map((group, index) => {
        const inGroup = group.items.some(i => i.key === activeSlug)
        const links = (nested = false) => (
          <ul className={cn('space-y-0.5', nested && !collapsed && 'ml-[19px] border-l border-bk-line pl-2')}>
            {group.items.map(item => (
              <li key={item.key}>
                <NavLink item={item} active={item.key === activeSlug} count={item.count ? counts[item.count] : null} collapsed={collapsed} nested={nested} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        )
        if (collapsed) return (
          <div key={group.key} className={cn('flex flex-col items-center', index && 'mt-2 border-t border-bk-line pt-2')}>{links()}</div>
        )
        if (group.parent) {
          const open = createOpen || inGroup
          return (
            <div key={group.key}>
              <button type="button" onClick={() => setCreateOpen(!open)} aria-expanded={open} aria-controls={`nav-${group.key}`}
                className="flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-[14px] font-bold text-bk-fg transition-colors hover:bg-bk-alt focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg">
                <group.Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="flex-1 text-left">{group.label}</span>
                <ChevronDown className={cn('size-4 text-bk-muted transition-transform', open && 'rotate-180')} aria-hidden="true" />
              </button>
              {open && <div id={`nav-${group.key}`} className="mt-0.5">{links(true)}</div>}
            </div>
          )
        }
        return (
          <div key={group.key} className="mt-5">
            <Eyebrow className="mb-1.5 px-3">{group.label}</Eyebrow>
            {links()}
          </div>
        )
      })}
    </nav>
  )
}

/**
 * The account menu: account settings, plan and billing, the team, API & usage, the admin dashboard for admins, the
 * colour theme and signing out. Opens from the account button at the foot of the sidebar (and of the rail).
 */
function AccountMenu({ account, credits, collapsed, brandId, onNavigate }) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted && resolvedTheme === 'dark'
  const plan = credits.summary ? `${planLabel(credits.summary)} plan` : ''
  const go = () => onNavigate?.()
  const trigger = collapsed ? (
    <RailTip show label={`${account.name}${plan ? ` · ${plan}` : ''} · Account`}>
      <DropdownMenuTrigger aria-label={`Account${plan ? ` · ${plan}` : ''}`} className="relative rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bk-fg">
        <Avatar account={account} size={36} ringOffset="ring-offset-bk-bg" />
        <PlanMark summary={credits.summary} />
      </DropdownMenuTrigger>
    </RailTip>
  ) : (
    <DropdownMenuTrigger aria-label="Account menu" className="flex w-full items-center gap-2.5 rounded-xl border border-bk-line bg-bk-surface p-2.5 text-left transition-colors hover:border-bk-field data-[state=open]:border-bk-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg">
      <Avatar account={account} size={32} ringOffset="ring-offset-bk-surface" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold leading-tight">{account.name}</span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5"><PlanBadge summary={credits.summary} /></span>
      </span>
      <ChevronsUpDown className="size-4 shrink-0 text-bk-muted" aria-hidden="true" />
    </DropdownMenuTrigger>
  )
  return (
    <DropdownMenu modal={false}>
      {trigger}
      <DropdownMenuContent align={collapsed ? 'end' : 'start'} side={collapsed ? 'right' : 'top'} sideOffset={8} className={cn(menuClass, !collapsed && 'w-[var(--radix-dropdown-menu-trigger-width)] min-w-[224px]')}>
        <DropdownMenuLabel className="px-2 pb-1.5 pt-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 truncate text-[13px] font-bold">{account.name}</span>
            <PlanBadge summary={credits.summary} />
          </span>
          <span className="block truncate text-[11.5px] font-normal text-bk-muted">{account.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-bk-line" />
        <DropdownMenuItem onSelect={() => { go(); account.openSettings() }} className={menuItemClass}><Settings /> Account settings</DropdownMenuItem>
        <DropdownMenuItem asChild className={menuItemClass}><Link href="/app/settings" onClick={go}><CreditCard /> Plan &amp; billing</Link></DropdownMenuItem>
        <DropdownMenuItem asChild className={menuItemClass}><Link href={`/app/${brandId}/team`} onClick={go}><Users /> Team</Link></DropdownMenuItem>
        <DropdownMenuItem asChild className={menuItemClass}><Link href="/developers/dashboard" onClick={go}><Code2 /> API &amp; usage</Link></DropdownMenuItem>
        {credits.summary?.admin && <DropdownMenuItem asChild className={menuItemClass}><Link href="/admin" onClick={go}><Gauge /> Admin dashboard</Link></DropdownMenuItem>}
        <DropdownMenuSeparator className="bg-bk-line" />
        <DropdownMenuItem onSelect={e => { e.preventDefault(); setTheme(dark ? 'light' : 'dark') }} className={menuItemClass}>
          {dark ? <Sun /> : <Moon />}<span className="flex-1">{dark ? 'Light mode' : 'Dark mode'}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={account.signOut} className={menuItemClass}><LogOut /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SidebarContent({ flows, brand, counts, account, credits, activeSlug, collapsed = false, onToggle, onNavigate, onDelete }) {
  const toggleLabel = collapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'
  const toggle = onToggle && (
    <RailTip show={collapsed} label={toggleLabel}>
      {/* The rail has its own tooltip, so the native title is only for the expanded sidebar. */}
      <button type="button" onClick={onToggle} aria-label={toggleLabel} title={collapsed ? undefined : toggleLabel} aria-controls="app-sidebar" aria-expanded={!collapsed} className={appButton('quiet', 'xs', 'size-8 px-0 text-bk-muted hover:text-bk-fg')}>
        {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
      </button>
    </RailTip>
  )

  return (
    <div className={cn('flex h-full flex-col pb-4 pt-4', collapsed ? 'items-center px-3' : 'px-3.5')}>
      <div className={cn('flex items-center', collapsed ? 'flex-col gap-3' : 'justify-between gap-2 pl-1')}>
        <RailTip show={collapsed} label="Batkle home">
          <Link href="/" onClick={onNavigate} aria-label="Batkle home" className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bk-fg">
            {collapsed ? (
              <>
                <img src="/logo/batkle-icon-color.png" alt="" width={30} height={30} className="block size-[30px] dark:hidden" />
                <img src="/logo/batkle-icon-color-reversed.png" alt="" width={30} height={30} className="hidden size-[30px] dark:block" />
              </>
            ) : <BatkleLogo size={28} />}
          </Link>
        </RailTip>
        {toggle}
      </div>

      {collapsed ? (
        <div className="mt-4">
          <BrandSwitcher flows={flows} brand={brand} activeSlug={activeSlug} onDelete={onDelete} compact />
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-bk-line bg-bk-surface p-2.5">
          <BrandTile name={brand.name} logo={brand.logo} logoOnDark={brand.logoOnDark} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-bold leading-tight">{brand.name}</p>
            <p className="mt-0.5 text-[11.5px] text-bk-muted">Brand · {brand.language}</p>
          </div>
          <BrandSwitcher flows={flows} brand={brand} activeSlug={activeSlug} onDelete={onDelete} />
        </div>
      )}

      {collapsed && <div className="mx-auto mt-4 h-px w-8 bg-bk-line" />}
      <StudioNav brandId={brand.id} counts={counts} activeSlug={activeSlug} collapsed={collapsed} onNavigate={onNavigate} />

      <div className={cn('mt-auto w-full pt-5', collapsed && 'flex flex-col items-center gap-2')}>
        {collapsed ? (
          credits.summary && (
            <RailTip show label={creditsLabel(credits.summary)}>
              {/* The tooltip needs an element it can hold; the link inside takes the focus and the click. */}
              <span className="inline-flex"><CreditsMeter summary={credits.summary} compact onNavigate={onNavigate} /></span>
            </RailTip>
          )
        ) : (
          <CreditsMeter summary={credits.summary} loading={credits.loading} onNavigate={onNavigate} className="mb-2.5" />
        )}
        <AccountMenu account={account} credits={credits} collapsed={collapsed} brandId={brand.id} onNavigate={onNavigate} />
      </div>
    </div>
  )
}

export default function AppShell({ flows, brand, counts: initialCounts, account: serverAccount, initialCollapsed = false, children }) {
  const router = useRouter()
  const pathname = usePathname()
  const activeSlug = pathname.split('/')[3] || 'creation'
  const [counts, setCounts] = useState(initialCounts)
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [menuOpen, setMenuOpen] = useState(false)
  const popup = usePopup()
  const account = useAccount(serverAccount)
  // The sidebar's credits meter: loaded once, and again whenever something on the page spends or adds credits.
  const billing = useBilling({ follow: true })
  const credits = useMemo(() => ({ summary: billing.data?.summary || null, loading: !billing.data && !billing.error }), [billing.data, billing.error])

  const setCount = useCallback((key, value) => setCounts(prev => (prev[key] === value ? prev : { ...prev, [key]: value })), [])
  const context = useMemo(() => ({ setCount }), [setCount])

  // Remember this brand as the last one used: it leads the brand list and /app opens it by default.
  useEffect(() => {
    fetch(`/api/flows/${brand.id}/opened`, { method: 'POST', keepalive: true }).catch(() => {})
  }, [brand.id])

  const toggleSidebar = useCallback(() => setCollapsed(value => {
    const next = !value
    document.cookie = `${SIDEBAR_COOKIE}=${next ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`
    return next
  }), [])

  // Ctrl/Cmd+B toggles the sidebar, except while typing.
  useEffect(() => {
    const onKey = e => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'b' || e.altKey || e.shiftKey) return
      if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      toggleSidebar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSidebar])

  // Removes the brand record only; posts already created keep their embedded brand and stay in Studio.
  const deleteBrand = async () => {
    setMenuOpen(false)
    const deleted = await popup.confirm({
      title: `Delete “${brand.name}”?`,
      description: 'This permanently removes the brand profile, its research, content ideas and design settings. Posts already created stay in Studio. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete brand',
      busyLabel: 'Deleting…',
      action: async () => {
        const res = await fetch(`/api/flows/${brand.id}`, { method: 'DELETE' })
        if (!res.ok && res.status !== 404) throw new Error((await res.json().catch(() => ({}))).error || 'The brand could not be deleted. Please try again.')
      },
    })
    if (!deleted) return
    const remaining = flows.filter(f => f.id !== brand.id)
    toast.success(`${brand.name} deleted`)
    router.replace(remaining.length ? `/app/${remaining[0].id}/creation` : '/app')
    router.refresh()
  }

  const sidebarProps = { flows, brand, counts, account, credits, activeSlug, onDelete: deleteBrand }

  return (
    <ShellContext.Provider value={context}>
      <TooltipProvider delayDuration={150}>
        <div className={cn(appLayer, 'min-h-screen bg-bk-alt lg:flex')}>
          <a href="#app-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-bk-butter focus:px-4 focus:py-2 focus:font-bold focus:text-bk-ink">
            Skip to content
          </a>

          <aside
            id="app-sidebar"
            aria-label="Sidebar"
            className={cn(
              'hidden shrink-0 overflow-x-hidden border-r border-bk-line bg-bk-bg transition-[width] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] lg:sticky lg:top-0 lg:block lg:h-screen lg:overflow-y-auto',
              collapsed ? 'lg:w-[68px]' : 'lg:w-[252px]',
            )}
          >
            <SidebarContent {...sidebarProps} collapsed={collapsed} onToggle={toggleSidebar} />
          </aside>

          <header className="sticky top-0 z-40 flex h-12 items-center justify-between gap-3 border-b border-bk-line bg-bk-bg/95 px-4 lg:hidden">
            <Link href="/" aria-label="Batkle home"><BatkleLogo size={24} /></Link>
            <div className="flex min-w-0 items-center gap-2">
              <BrandTile name={brand.name} logo={brand.logo} logoOnDark={brand.logoOnDark} size={24} />
              <span className="truncate text-[13px] font-bold">{brand.name}</span>
              <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" className={appButton('outline', 'xs', 'ml-1 size-8 px-0')}>
                <Menu className="size-[18px]" />
              </button>
            </div>
          </header>

          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            {/* The default close button uses the old blue focus ring; ours matches the app. */}
            <SheetContent side="left" className={cn(appLayer, 'w-[280px] max-w-[86vw] border-bk-line bg-bk-bg p-0 sm:max-w-[300px] [&>button:first-child]:hidden')}>
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <SheetClose className={appButton('outline', 'xs', 'absolute right-3 top-4 z-10 size-8 px-0')} aria-label="Close menu">
                <X className="size-4" />
              </SheetClose>
              <SidebarContent {...sidebarProps} onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>

          <main id="app-main" className="min-w-0 flex-1">{children}</main>
        </div>
      </TooltipProvider>

      <SmoothScroll />
    </ShellContext.Provider>
  )
}
