'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import { ArrowLeft, Moon, Sun } from 'lucide-react'
import { BatkleLogo } from '@/components/landing/brand'
import { cn } from '@/lib/utils'
import { appButton, appLayer } from './ui'

function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted && resolvedTheme === 'dark'
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode'
  return (
    <button type="button" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={label} title={label} className={appButton('outline', 'sm', 'size-8 px-0')}>
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  )
}

/** A Batkle page outside a brand's sidebar: the logo, an optional way back, the theme toggle and the page. */
export default function StandaloneShell({ back = { href: '/app', label: 'Back to the app' }, actions, children }) {
  return (
    <div className={cn(appLayer, 'flex min-h-dvh flex-col bg-bk-alt')}>
      <header className="sticky top-0 z-30 border-b border-bk-line bg-bk-alt/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1240px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" aria-label="Batkle home" className="shrink-0 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bk-fg">
              <BatkleLogo size={26} />
            </Link>
            {back && (
              <Link href={back.href} className={appButton('quiet', 'sm', 'hidden text-bk-muted hover:text-bk-fg sm:inline-flex')}>
                <ArrowLeft className="size-4" />{back.label}
              </Link>
            )}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <ThemeButton />
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">{children}</main>
    </div>
  )
}
