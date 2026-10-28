'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { useClerk, useUser } from '@clerk/nextjs'
import { Bell, CalendarDays, Check, ChevronsUpDown, Code2, CreditCard, Gauge, Image as ImageIcon, LayoutGrid, LayoutTemplate, LogOut, Megaphone, Menu, Moon, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, Sun, Tag, Trash2, UserRound, Users, X } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { BatkleLogo } from '@/components/landing/brand'
import { clerkAppearance } from '@/components/auth/clerkAppearance'
import SmoothScroll from '@/components/landing/SmoothScroll'
import { cn } from '@/lib/utils'
import { BrandTile, SIDEBAR_COOKIE, appButton, appLayer, brandLogo, raisedClass } from './ui'
import { usePopup } from './popup'
import CreditsMeter, { CreditsPill } from './billing/CreditsMeter'
import { UpgradeButton } from './billing/UpgradeNotice'
import PlanBadge, { PlanMark, planLabel } from './billing/PlanBadge'
import { BillingBrandContext, useBilling } from './billing/useBilling'
import { NotificationBell, NotificationPopover, NotificationSheet, useActivity } from './notifications/NotificationCenter'

const OWNER_ACCESS = { role: 'owner', owner: '', canEdit: true, canManage: true }
const ShellContext = createContext({ setCount: () => {}, access: OWNER_ACCESS })

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
/**
 * What the account may do in the open brand (lib/teams.ts roles): `canEdit` (an editor or more: posts, ads, the
 * schedule, gallery images) and `canManage` (an admin or the owner: the brand profile, its designs and its people),
 * with `role` and the `owner`'s name for a brand shared with it. Outside a brand, the owner's full access.
 */
export const useBrandAccess = () => useContext(ShellContext).access || OWNER_ACCESS

// Thin, quiet outline icons throughout the sidebar and its menus.
const STROKE = 1.6
const thinIcons = '[&_svg]:[stroke-width:1.6]'

// The studio navigation, in sections: what you make (posts and stories, ads), when it goes out, the brand, the workspace.
function navSections(brandId) {
  return [
    {
      key: 'create', label: 'Create', items: [
        { key: 'creation', label: 'Posts & stories', href: `/app/${brandId}/creation`, count: 'creation', Icon: LayoutGrid },
        { key: 'ads', label: 'Ads', href: `/app/${brandId}/ads`, Icon: Megaphone },
      ],
    },
    {
      key: 'plan', label: 'Plan', items: [
        { key: 'schedule', label: 'Schedule', href: `/app/${brandId}/schedule`, count: 'schedule', Icon: CalendarDays },
        { key: 'gallery', label: 'Gallery', href: `/app/${brandId}/gallery`, count: 'gallery', Icon: ImageIcon },
      ],
    },
    {
      key: 'brand', label: 'Brand', items: [
        { key: 'brand-information', label: 'Brand profile', href: `/app/${brandId}/brand-information`, Icon: Tag },
        { key: 'design-library', label: 'Design Library', href: `/app/${brandId}/design-library`, Icon: LayoutTemplate },
      ],
    },
    {
      key: 'workspace', label: 'Workspace', items: [
        { key: 'team', label: 'Team', href: `/app/${brandId}/team`, Icon: UserRound },
      ],
    },
  ]
}
// Pages a brand switch keeps you on.
const BRAND_PAGES = ['creation', 'ads', 'schedule', 'gallery', 'brand-information', 'design-library', 'team']

const tooltipClass = cn(appLayer, 'rounded-md border-0 bg-bk-ink px-2.5 py-1.5 text-[12px] font-semibold text-bk-cream shadow-bk-pop')
// A raised white card on the sidebar's tone: the brand, the search, the page you are on and the account.
const raised = raisedClass
// A raised card that can be opened: a soft ring on hover, a firmer one while open.
const openable = 'ring-1 ring-transparent transition-shadow hover:ring-bk-line data-[state=open]:ring-bk-field'
const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg'

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

const ROLE_NAMES = { owner: 'Owner', admin: 'Admin', editor: 'Editor', viewer: 'Viewer' }

/** A brand in the list: its logo and name, with the owner and your role for one shared with you. */
function BrandItem({ flow, current, onSelect }) {
  const name = flow.brandContext?.name || flow.name || 'Untitled brand'
  const logo = brandLogo(flow.brandContext)
  return (
    <DropdownMenuItem onSelect={onSelect} className={menuItemClass}>
      <BrandTile name={name} logo={logo.src} logoOnDark={logo.onDark} size={24} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{name}</span>
        {flow.shared && <span className="block truncate text-[11px] font-normal text-bk-muted">{flow.shared.owner} · {ROLE_NAMES[flow.shared.role]}</span>}
      </span>
      {current && <Check className="text-bk-fg" aria-label="Current brand" />}
    </DropdownMenuItem>
  )
}

/**
 * The brand card: the whole card opens the brand list: the account's own brands, then those shared with it, then
 * adding a brand and (for its owner) deleting this one.
 */
function BrandSwitcher({ flows, brand, activeSlug, onDelete, compact }) {
  const router = useRouter()
  const slug = BRAND_PAGES.includes(activeSlug) ? activeSlug : 'creation'
  const own = flows.filter(f => !f.shared), shared = flows.filter(f => f.shared)
  const item = flow => <BrandItem key={flow.id} flow={flow} current={flow.id === brand.id} onSelect={() => flow.id !== brand.id && router.push(`/app/${flow.id}/${slug}`)} />
  const label = 'px-2 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-bk-muted'

  return (
    // Non-modal so opening the delete dialog from a menu item never leaves the page unclickable.
    <DropdownMenu modal={false}>
      {compact ? (
        <RailTip show label={`${brand.name} · Switch brand`}>
          <DropdownMenuTrigger className={cn('rounded-lg', focusRing)} aria-label={`${brand.name}: switch brand`}>
            <BrandTile name={brand.name} logo={brand.logo} logoOnDark={brand.logoOnDark} size={36} />
          </DropdownMenuTrigger>
        </RailTip>
      ) : (
        <DropdownMenuTrigger aria-label={`${brand.name}: switch brand`} className={cn(raised, 'flex w-full items-center gap-2.5 rounded-xl p-2 pr-2.5 text-left', openable, focusRing)}>
          <BrandTile name={brand.name} logo={brand.logo} logoOnDark={brand.logoOnDark} size={34} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-bold leading-tight">{brand.name}</span>
            <span className="mt-0.5 block truncate text-[11.5px] text-bk-muted">{brand.role === 'owner' ? `Brand · ${brand.language}` : `Shared · ${ROLE_NAMES[brand.role]}`}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-bk-muted" strokeWidth={STROKE} aria-hidden="true" />
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent align="start" side={compact ? 'right' : 'bottom'} sideOffset={6} className={cn(appLayer, thinIcons, 'max-h-[min(560px,calc(100vh-96px))] w-64 overflow-y-auto rounded-xl border-bk-line bg-bk-surface p-1.5 shadow-bk-pop', !compact && 'w-[var(--radix-dropdown-menu-trigger-width)] min-w-[224px]')}>
        <DropdownMenuLabel className={label}>{shared.length ? 'Your brands' : 'Brands'}</DropdownMenuLabel>
        {own.map(item)}
        {!own.length && <p className="px-2 pb-1.5 text-[12.5px] text-bk-muted">None yet.</p>}
        {shared.length > 0 && (
          <>
            <DropdownMenuSeparator className="bg-bk-line" />
            <DropdownMenuLabel className={label}>Shared with you</DropdownMenuLabel>
            {shared.map(item)}
          </>
        )}
        <DropdownMenuSeparator className="bg-bk-line" />
        <DropdownMenuItem onSelect={() => router.push('/app/new')} className={menuItemClass}><Plus /> Add brand</DropdownMenuItem>
        {brand.role === 'owner' && (
          <DropdownMenuItem onSelect={onDelete} className="gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-[#C2412F] focus:bg-[#C2412F]/10 focus:text-[#C2412F] dark:text-[#F0826F] dark:focus:text-[#F0826F]">
            <Trash2 /> Delete {brand.name}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The search box: opens the search palette (also Ctrl/⌘ K). */
function SearchButton({ collapsed, onSearch }) {
  const [mac, setMac] = useState(false)
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), [])
  const keys = mac ? '⌘K' : 'Ctrl K'
  if (collapsed) return (
    <RailTip show label={`Search · ${keys}`}>
      <button type="button" onClick={onSearch} aria-label="Search" className={cn('flex size-10 items-center justify-center rounded-lg text-bk-muted transition-colors hover:bg-bk-surface/70 hover:text-bk-fg', focusRing)}>
        <Search className="size-[17px]" strokeWidth={STROKE} aria-hidden="true" />
      </button>
    </RailTip>
  )
  return (
    <button type="button" onClick={onSearch} aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'} className={cn(raised, 'flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-[13.5px] text-bk-muted ring-1 ring-transparent transition-[color,box-shadow] hover:text-bk-fg hover:ring-bk-line', focusRing)}>
      <Search className="size-4 shrink-0" strokeWidth={STROKE} aria-hidden="true" />
      <span className="flex-1 text-left">Search</span>
      <kbd className="rounded-md border border-bk-line bg-bk-alt px-1.5 py-px font-bk-body text-[11px] font-semibold text-bk-muted">{keys}</kbd>
    </button>
  )
}

/** One page in the navigation: icon and label (with its count); the icon alone on the collapsed rail. */
function NavLink({ item, active, count, collapsed, onNavigate }) {
  const { label, href, Icon } = item
  return (
    <RailTip show={collapsed} label={typeof count === 'number' ? `${label} · ${count}` : label}>
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? label : undefined}
        className={cn(
          'group relative flex h-9 items-center rounded-lg text-[14px] transition-[background-color,color,box-shadow]',
          collapsed ? 'w-10 justify-center' : 'gap-2.5 px-2.5',
          active ? cn(raised, 'font-semibold text-bk-fg') : 'text-bk-fg/70 hover:bg-bk-surface/70 hover:text-bk-fg',
          focusRing,
        )}
      >
        <Icon strokeWidth={STROKE} aria-hidden="true" className={cn('size-[17px] shrink-0 transition-colors', active ? 'text-bk-fg' : 'text-bk-muted group-hover:text-bk-fg')} />
        {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
        {typeof count === 'number' && (collapsed
          ? count > 0 && <span className="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-bk-fg/80 px-1 text-center text-[9.5px] font-bold leading-4 tabular-nums text-bk-bg">{count > 99 ? '99+' : count}</span>
          : <span className={cn('text-[12px] tabular-nums', active ? 'font-semibold text-bk-fg/70' : 'text-bk-muted')}>{count}</span>)}
      </Link>
    </RailTip>
  )
}

/** The studio navigation: a headed list per section; on the collapsed rail, the icons with a rule between sections. */
function StudioNav({ brandId, counts, activeSlug, collapsed, onNavigate }) {
  return (
    <nav aria-label="Studio" className={cn('w-full', collapsed ? 'mt-2 flex flex-col items-center' : 'mt-1')}>
      {navSections(brandId).map((section, index) => (
        <div key={section.key} className={cn(collapsed ? cn('flex flex-col items-center', index && 'mt-2 border-t border-bk-line pt-2') : 'mt-5')}>
          {!collapsed && <p className="mb-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-bk-muted/80">{section.label}</p>}
          <ul className="space-y-0.5">
            {section.items.map(item => (
              <li key={item.key}>
                <NavLink item={item} active={item.key === activeSlug} count={item.count ? counts[item.count] : null} collapsed={collapsed} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/**
 * Search (Ctrl/⌘ K): every page of the open brand, the account's pages, the other brands to switch to, adding a brand
 * and the colour theme, filtered as you type.
 */
function SearchPalette({ open, onOpenChange, flows, brand, activeSlug, credits, account, onNotifications }) {
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  const slug = BRAND_PAGES.includes(activeSlug) ? activeSlug : 'creation'
  const run = action => { onOpenChange(false); action() }
  const item = 'gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium text-bk-fg data-[selected=true]:bg-bk-alt data-[selected=true]:text-bk-fg [&_svg]:text-bk-muted'
  const group = 'px-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.16em] [&_[cmdk-group-heading]]:text-bk-muted'
  const others = flows.filter(f => f.id !== brand.id)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="top-[18%] max-w-[560px] translate-y-0 gap-0 overflow-hidden p-0 data-[state=closed]:slide-out-to-top-[16%] data-[state=open]:slide-in-from-top-[16%]">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <Command className={cn('bg-transparent text-bk-fg [&_[cmdk-input-wrapper]]:border-bk-line [&_[cmdk-input-wrapper]]:px-4', thinIcons)}>
          <CommandInput placeholder="Search pages, brands and settings…" className="h-12 text-[14.5px] text-bk-fg placeholder:text-bk-muted" />
          <CommandList className="max-h-[min(420px,60vh)] pb-1.5">
            <CommandEmpty className="py-8 text-center text-[13.5px] text-bk-muted">Nothing matches.</CommandEmpty>
            {navSections(brand.id).map(section => (
              <CommandGroup key={section.key} heading={section.label} className={group}>
                {section.items.map(({ key, label, href, Icon }) => (
                  <CommandItem key={key} value={`${section.label} ${label}`} onSelect={() => run(() => router.push(href))} className={item}>
                    <Icon /> <span className="flex-1">{label}</span>{key === activeSlug && <span className="text-[11.5px] text-bk-muted">You are here</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            <CommandGroup heading="Account" className={group}>
              <CommandItem value="Notifications activity" onSelect={() => run(onNotifications)} className={item}><Bell /> Notifications</CommandItem>
              <CommandItem value="Account settings profile email password" onSelect={() => run(account.openSettings)} className={item}><Settings /> Account settings</CommandItem>
              <CommandItem value="Plan and billing credits subscription upgrade" onSelect={() => run(() => router.push('/app/settings'))} className={item}><CreditCard /> Plan &amp; billing</CommandItem>
              <CommandItem value="Teams invitations shared brands people" onSelect={() => run(() => router.push('/app/teams'))} className={item}><Users /> Teams &amp; invitations</CommandItem>
              <CommandItem value="API and usage developers keys" onSelect={() => run(() => router.push('/developers/dashboard'))} className={item}><Code2 /> API &amp; usage</CommandItem>
              {credits.summary?.admin && <CommandItem value="Admin dashboard analytics" onSelect={() => run(() => router.push('/admin'))} className={item}><Gauge /> Admin dashboard</CommandItem>}
              <CommandItem value="Theme dark light mode" onSelect={() => run(() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'))} className={item}>{resolvedTheme === 'dark' ? <Sun /> : <Moon />} {resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}</CommandItem>
            </CommandGroup>
            <CommandGroup heading="Brands" className={group}>
              {others.map(flow => {
                const name = flow.brandContext?.name || flow.name || 'Untitled brand'
                const logo = brandLogo(flow.brandContext)
                return (
                  <CommandItem key={flow.id} value={`Switch brand ${name}`} onSelect={() => run(() => router.push(`/app/${flow.id}/${slug}`))} className={item}>
                    <BrandTile name={name} logo={logo.src} logoOnDark={logo.onDark} size={20} /> <span className="flex-1 truncate">{name}</span><span className="text-[11.5px] text-bk-muted">Switch</span>
                  </CommandItem>
                )
              })}
              <CommandItem value="Add a new brand" onSelect={() => run(() => router.push('/app/new'))} className={item}><Plus /> Add brand</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The account menu, opened from the avatar at the top right: the account's own plan and credits, account settings,
 * plan and billing, every team it is part of with the invitations waiting for it, API & usage, the admin dashboard for
 * admins, the colour theme and signing out.
 */
function AccountMenu({ account, credits, size = 34 }) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted && resolvedTheme === 'dark'
  const plan = credits.summary ? `${planLabel(credits.summary)} plan` : ''
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger aria-label={`Account menu${plan ? ` · ${plan}` : ''}`} title={account.name} className="relative shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bk-fg">
        <Avatar account={account} size={size} ringOffset="ring-offset-bk-alt" />
        <PlanMark summary={credits.summary} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" sideOffset={10} collisionPadding={12} className={cn(menuClass, thinIcons, 'w-[272px]')}>
        <DropdownMenuLabel className="px-2 pb-1.5 pt-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 truncate text-[13px] font-bold">{account.name}</span>
            <PlanBadge summary={credits.summary} />
          </span>
          <span className="block truncate text-[11.5px] font-normal text-bk-muted">{account.email}</span>
        </DropdownMenuLabel>
        <div className="px-1 pb-1.5 pt-0.5"><CreditsMeter summary={credits.summary} loading={credits.loading} /></div>
        <DropdownMenuSeparator className="bg-bk-line" />
        <DropdownMenuItem onSelect={account.openSettings} className={menuItemClass}><Settings /> Account settings</DropdownMenuItem>
        <DropdownMenuItem asChild className={menuItemClass}><Link href="/app/settings"><CreditCard /> Plan &amp; billing</Link></DropdownMenuItem>
        <DropdownMenuItem asChild className={menuItemClass}><Link href="/app/teams"><Users /> Teams &amp; invitations</Link></DropdownMenuItem>
        <DropdownMenuItem asChild className={menuItemClass}><Link href="/developers/dashboard"><Code2 /> API &amp; usage</Link></DropdownMenuItem>
        {credits.summary?.admin && <DropdownMenuItem asChild className={menuItemClass}><Link href="/admin"><Gauge /> Admin dashboard</Link></DropdownMenuItem>}
        <DropdownMenuSeparator className="bg-bk-line" />
        <DropdownMenuItem onSelect={e => { e.preventDefault(); setTheme(dark ? 'light' : 'dark') }} className={menuItemClass}>
          {dark ? <Sun /> : <Moon />}<span className="flex-1">{dark ? 'Light mode' : 'Dark mode'}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={account.signOut} className={menuItemClass}><LogOut /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SidebarContent({ flows, brand, counts, activeSlug, collapsed = false, onToggle, onNavigate, onDelete, onSearch }) {
  const toggleLabel = collapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'
  const toggle = onToggle && (
    <RailTip show={collapsed} label={toggleLabel}>
      {/* The rail has its own tooltip, so the native title is only for the expanded sidebar. */}
      <button type="button" onClick={onToggle} aria-label={toggleLabel} title={collapsed ? undefined : toggleLabel} aria-controls="app-sidebar" aria-expanded={!collapsed} className={cn(raised, 'flex size-8 items-center justify-center rounded-lg text-bk-muted transition-colors hover:text-bk-fg', focusRing)}>
        {collapsed ? <PanelLeftOpen className="size-4" strokeWidth={STROKE} /> : <PanelLeftClose className="size-4" strokeWidth={STROKE} />}
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
            ) : <BatkleLogo size={26} />}
          </Link>
        </RailTip>
        {toggle}
      </div>

      <div className={cn('mt-4', collapsed ? 'flex flex-col items-center gap-2' : 'space-y-2.5')}>
        <BrandSwitcher flows={flows} brand={brand} activeSlug={activeSlug} onDelete={onDelete} compact={collapsed} />
        {onSearch && <SearchButton collapsed={collapsed} onSearch={onSearch} />}
      </div>

      {collapsed && <div className="mx-auto mt-2 h-px w-8 bg-bk-line" />}
      <StudioNav brandId={brand.id} counts={counts} activeSlug={activeSlug} collapsed={collapsed} onNavigate={onNavigate} />
    </div>
  )
}

/** The bell alone, with no surface of its own: it sits on the top bar beside the credits and the avatar. */
const bellClass = 'size-9 rounded-full hover:bg-bk-surface/70'

/**
 * The top right of the studio on a large screen: in a brand shared with the account, whose it is and the account's
 * role on the left; the credits that posts here use, the notifications and the account menu on the right.
 */
function TopBar({ brand, brandCredits, account, credits, activity, activityOpen, onActivityOpenChange }) {
  return (
    <div className="hidden items-center gap-3 px-8 pt-4 lg:flex">
      {brand.role !== 'owner' && (
        <p className="flex min-w-0 items-center gap-2 text-[12.5px] text-bk-muted">
          <Users className="size-4 shrink-0" strokeWidth={STROKE} aria-hidden="true" />
          <span className="truncate">Shared by <strong className="font-semibold text-bk-fg/85">{brand.owner}</strong></span>
          <span className="shrink-0 rounded-md bg-bk-chip px-2 py-0.5 text-[11.5px] font-bold text-bk-fg">{ROLE_NAMES[brand.role]}</span>
        </p>
      )}
      <div className="ml-auto flex items-center gap-2">
        {/* On Free, the next plan is always in reach. Not inside a brand shared with the account: its limits are the
            owner's plan, which the account can't upgrade. */}
        {brand.role === 'owner' && <UpgradeButton summary={credits.summary} />}
        <CreditsPill summary={brandCredits.summary} loading={brandCredits.loading} />
        <NotificationPopover open={activityOpen} onOpenChange={onActivityOpenChange} activity={activity} triggerClassName={bellClass} side="bottom" />
        <span className="ml-1.5 inline-flex"><AccountMenu account={account} credits={credits} /></span>
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
  const [searchOpen, setSearchOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false), [activitySheet, setActivitySheet] = useState(false)
  const activity = useActivity()
  const popup = usePopup()
  const account = useAccount(serverAccount)
  // The account's own plan and credits (the account menu), and in a brand shared with it the owner's, which posts made
  // here use (the top bar's credits; every page inside reads them too, through BillingBrandContext). Loaded once, and
  // again whenever something on the page spends or adds credits.
  const sharedId = brand.role === 'owner' ? null : brand.id
  const billing = useBilling({ follow: true, brandId: null })
  const brandBilling = useBilling({ follow: true, brandId: sharedId, enabled: Boolean(sharedId) })
  const credits = useMemo(() => ({ summary: billing.data?.summary || null, loading: !billing.data && !billing.error }), [billing.data, billing.error])
  const brandCredits = useMemo(() => (sharedId ? { summary: brandBilling.data?.summary || null, loading: !brandBilling.data && !brandBilling.error } : credits), [sharedId, brandBilling.data, brandBilling.error, credits])

  const setCount = useCallback((key, value) => setCounts(prev => (prev[key] === value ? prev : { ...prev, [key]: value })), [])
  const access = useMemo(() => (brand.role === 'owner' ? OWNER_ACCESS : { role: brand.role, owner: brand.owner, canEdit: brand.role !== 'viewer', canManage: brand.role === 'admin' }), [brand.role, brand.owner])
  const context = useMemo(() => ({ setCount, access }), [setCount, access])

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

  // Ctrl/Cmd+K opens the search from anywhere in the studio.
  useEffect(() => {
    const onKey = e => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k' || e.altKey || e.shiftKey) return
      e.preventDefault()
      setSearchOpen(open => !open)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  // From search: the pop-up below the bell on a large screen, the panel on a phone. It waits for the search dialog to
  // close, or the focus going back to the page would close the pop-up straight away.
  const openNotifications = () => setTimeout(() => (window.matchMedia('(min-width: 1024px)').matches ? setActivityOpen(true) : setActivitySheet(true)), 250)
  const sidebarProps = { flows, brand, counts, activeSlug, onDelete: deleteBrand, onSearch: () => setSearchOpen(true) }

  return (
    <ShellContext.Provider value={context}>
      <BillingBrandContext.Provider value={sharedId}>
      <TooltipProvider delayDuration={150}>
        <div className={cn(appLayer, 'min-h-screen bg-bk-alt lg:flex')}>
          <a href="#app-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-bk-butter focus:px-4 focus:py-2 focus:font-bold focus:text-bk-ink">
            Skip to content
          </a>

          <aside
            id="app-sidebar"
            aria-label="Sidebar"
            className={cn(
              'hidden shrink-0 overflow-x-hidden border-r border-bk-line bg-bk-alt transition-[width] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] lg:sticky lg:top-0 lg:block lg:h-screen lg:overflow-y-auto',
              collapsed ? 'lg:w-[68px]' : 'lg:w-[252px]',
            )}
          >
            <SidebarContent {...sidebarProps} collapsed={collapsed} onToggle={toggleSidebar} />
          </aside>

          <header className="sticky top-0 z-40 flex h-12 items-center justify-between gap-3 border-b border-bk-line bg-bk-bg/95 px-4 lg:hidden">
            <Link href="/" aria-label="Batkle home" className="shrink-0"><BatkleLogo size={24} /></Link>
            <div className="flex min-w-0 items-center gap-2">
              <BrandTile name={brand.name} logo={brand.logo} logoOnDark={brand.logoOnDark} size={24} />
              <span className="truncate text-[13px] font-bold">{brand.name}</span>
              <NotificationBell unread={activity.unread} onClick={() => setActivitySheet(true)} className="ml-1 size-8" />
              <AccountMenu account={account} credits={credits} size={28} />
              <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" className={appButton('outline', 'xs', 'ml-1 size-8 shrink-0 px-0')}>
                <Menu className="size-[18px]" />
              </button>
            </div>
          </header>

          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            {/* The default close button uses the old blue focus ring; ours matches the app. */}
            <SheetContent side="left" className={cn(appLayer, 'w-[280px] max-w-[86vw] border-bk-line bg-bk-alt p-0 sm:max-w-[300px] [&>button:first-child]:hidden')}>
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <SheetClose className={appButton('outline', 'xs', 'absolute right-3 top-4 z-10 size-8 px-0')} aria-label="Close menu">
                <X className="size-4" />
              </SheetClose>
              <SidebarContent {...sidebarProps} onNavigate={() => setMenuOpen(false)} onSearch={() => { setMenuOpen(false); setSearchOpen(true) }} />
            </SheetContent>
          </Sheet>

          <main id="app-main" className="min-w-0 flex-1">
            <TopBar brand={brand} brandCredits={brandCredits} account={account} credits={credits} activity={activity} activityOpen={activityOpen} onActivityOpenChange={setActivityOpen} />
            {children}
          </main>
          <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} flows={flows} brand={brand} activeSlug={activeSlug} credits={credits} account={account} onNotifications={openNotifications} />
          <NotificationSheet open={activitySheet} onOpenChange={setActivitySheet} activity={activity} />
        </div>
      </TooltipProvider>
      </BillingBrandContext.Provider>

      <SmoothScroll />
    </ShellContext.Provider>
  )
}
