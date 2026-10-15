'use client'
import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useAuth } from '@clerk/nextjs'
import { Menu, Moon, Sun, X } from 'lucide-react'
import { BatkleLogo, Container, buttonClass, cn } from './brand'

// Full paths, so the section links also work from the other pages that share this header (such as /developers).
export const NAV_LINKS = [
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#demo', label: 'Demo' },
  { href: '/#features', label: 'Features' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/#faq', label: 'FAQ' },
  { href: '/developers', label: 'Developers' },
]

const iconButton =
  'inline-flex size-11 items-center justify-center rounded-[10px] border border-bk-field bg-bk-surface text-bk-fg transition-[border-color,transform] duration-200 hover:border-bk-fg/60 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg'

const iconSwap = 'size-[18px] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:spin-in-90 motion-safe:zoom-in-50 motion-safe:duration-500'

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const isDark = mounted && resolvedTheme === 'dark'

  // Grow the new theme out of the button with a View Transition; plain switch where unsupported.
  const toggle = (e) => {
    const next = isDark ? 'light' : 'dark'
    const html = document.documentElement
    if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTheme(next)
      return
    }
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect()
    const x = left + width / 2
    const y = top + height / 2
    html.style.setProperty('--bk-vt-x', `${x}px`)
    html.style.setProperty('--bk-vt-y', `${y}px`)
    html.style.setProperty('--bk-vt-r', `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`)
    html.classList.add('bk-theme-vt')
    const transition = document.startViewTransition(() => {
      flushSync(() => setTheme(next))
      // Apply the class now so the new snapshot already has the new theme.
      html.classList.toggle('dark', next === 'dark')
      html.style.colorScheme = next
    })
    transition.finished.finally(() => html.classList.remove('bk-theme-vt'))
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={iconButton}
    >
      {isDark ? <Sun key="sun" className={iconSwap} /> : <Moon key="moon" className={mounted ? iconSwap : 'size-[18px]'} />}
    </button>
  )
}

export default function LandingHeader() {
  const [open, setOpen] = useState(false)
  // Until Clerk has loaded, show what a visitor sees; most people here are not signed in yet.
  const { isSignedIn } = useAuth()
  const startLabel = isSignedIn ? 'Open app' : 'Add your brand'
  const pathname = usePathname()
  const current = (href) => (href === pathname ? 'page' : undefined)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    const onResize = () => window.innerWidth >= 1024 && setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  return (
    <header className="sticky top-0 z-50 border-b border-bk-line bg-bk-bg/95 md:bg-bk-bg/85 md:backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between gap-6 sm:h-[72px]">
        <Link href="/" aria-label="Batkle home" className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bk-fg">
          <BatkleLogo size={36} />
        </Link>

        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-0.5 xl:gap-3">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={current(l.href)}
                  className="relative rounded-md px-2 py-2 text-[15px] font-medium text-bk-fg/85 transition-colors after:absolute after:inset-x-2 after:bottom-0.5 after:h-[3px] after:origin-left after:scale-x-0 after:rounded-full after:bg-bk-butter after:transition-transform after:duration-300 hover:text-bk-fg hover:after:scale-x-100 aria-[current=page]:font-semibold aria-[current=page]:text-bk-fg aria-[current=page]:after:scale-x-100 xl:px-2.5 xl:after:inset-x-2.5"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2.5">
          <ThemeToggle />
          {!isSignedIn && (
            <Link
              href="/sign-in"
              className="hidden rounded-md px-2.5 py-2 text-[15px] font-semibold text-bk-fg/85 transition-colors hover:text-bk-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-bk-fg sm:inline-block"
            >
              Sign in
            </Link>
          )}
          <Link href="/app" className={buttonClass('primary', 'sm', 'hidden sm:inline-flex')}>
            {startLabel}
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="bk-mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className={cn(iconButton, 'lg:hidden')}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </Container>

      <div
        id="bk-mobile-nav"
        hidden={!open}
        className="border-t border-bk-line bg-bk-bg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2 motion-safe:duration-200 lg:hidden"
      >
        <Container className="py-3">
          <ul>
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  onClick={() => setOpen(false)}
                  aria-current={current(l.href)}
                  className="block border-b border-bk-line py-3.5 text-[17px] font-semibold text-bk-fg aria-[current=page]:underline aria-[current=page]:decoration-bk-butter aria-[current=page]:decoration-[3px] aria-[current=page]:underline-offset-8"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/app" className={buttonClass('primary', 'md', 'mb-2 mt-4 w-full sm:hidden')}>
            {startLabel}
          </Link>
          {!isSignedIn && (
            <Link href="/sign-in" className={buttonClass('outline', 'md', 'mb-2 w-full sm:hidden')}>
              Sign in
            </Link>
          )}
        </Container>
      </div>
    </header>
  )
}
