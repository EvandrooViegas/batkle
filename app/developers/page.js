import { headers } from 'next/headers'
import LandingHeader from '@/components/landing/LandingHeader'
import SmoothScroll from '@/components/landing/SmoothScroll'
import { Footer } from '@/components/landing/LandingPage'
import DeveloperDocs from '@/components/developers/DeveloperDocs'
import { batkleFonts } from '@/lib/batkleFonts'
import { starterCredits } from '@/lib/developer/pricing'
import { cn } from '@/lib/utils'
import '@/components/landing/landing.css'

export const metadata = {
  title: 'Developers · Batkle API',
  description: 'Describe a post or a carousel as JSON (text, images, shapes and gradients) and get the finished images back from one API call.',
  icons: { icon: '/logo/batkle-icon-color.png' },
}

/** The address the examples use: the configured base URL, else the one this page was opened on. */
function siteOrigin() {
  const configured = process.env.NEXT_PUBLIC_BASE_URL?.trim()
  if (configured) return (configured.startsWith('http') ? configured : `https://${configured}`).replace(/\/$/, '')
  const list = headers()
  const host = list.get('x-forwarded-host') || list.get('host') || 'localhost:3000'
  const proto = list.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

/** The developer docs, a tab of the public site. */
export default function DevelopersPage() {
  return (
    <div className={cn('bk-root min-h-screen bg-bk-bg font-bk-body text-bk-fg antialiased', batkleFonts)}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-bk-butter focus:px-4 focus:py-2 focus:font-bold focus:text-bk-ink">
        Skip to content
      </a>
      <SmoothScroll />
      <LandingHeader />
      <main id="main">
        <DeveloperDocs origin={siteOrigin()} starterCredits={starterCredits()} />
      </main>
      <Footer />
    </div>
  )
}
