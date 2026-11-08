import Link from 'next/link'
import LandingHeader from '@/components/landing/LandingHeader'
import { Footer } from '@/components/landing/LandingPage'
import { Container, Eyebrow, displayClass } from '@/components/landing/brand'
import { batkleFonts } from '@/lib/batkleFonts'
import { LEGAL_PAGES, SELLER } from '@/lib/legal'
import { cn } from '@/lib/utils'
import '@/components/landing/landing.css'

export const legalLink = 'font-semibold text-bk-fg underline decoration-bk-line underline-offset-4 transition-colors hover:decoration-bk-fg'

/** A paragraph, list and link styled for the legal pages. */
export const P = ({ children }) => <p>{children}</p>
export const List = ({ children }) => <ul className="list-disc space-y-2 pl-5 marker:text-bk-muted">{children}</ul>
export const A = ({ href, children }) => (href.startsWith('/')
  ? <Link href={href} className={legalLink}>{children}</Link>
  : <a href={href} className={legalLink} target={href.startsWith('mailto:') ? undefined : '_blank'} rel="noreferrer">{children}</a>)
export const Email = () => <A href={`mailto:${SELLER.email}`}>{SELLER.email}</A>

/** The seller's details, as the pages and EU law want them shown. */
export function SellerDetails() {
  return (
    <List>
      <li>Batkle is run by {SELLER.name}, an individual based in {SELLER.country}.</li>
      {SELLER.address && <li>Address: {SELLER.address}</li>}
      {SELLER.taxId && <li>Tax number (NIF): {SELLER.taxId}</li>}
      <li>Email: <Email /></li>
    </List>
  )
}

/**
 * The frame of the Terms, Privacy and Refund pages: the site's header and footer, the page's title and date, tabs to
 * the other legal pages, a list of its sections, and the sections ({ id, title, body }).
 */
export default function LegalPage({ path, title, intro, updated, sections }) {
  return (
    <div className={cn('bk-root min-h-screen bg-bk-bg font-bk-body text-bk-fg antialiased', batkleFonts)}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-bk-butter focus:px-4 focus:py-2 focus:font-bold focus:text-bk-ink">
        Skip to content
      </a>
      <LandingHeader />
      <main id="main">
        <Container className="pb-24 pt-12 sm:pt-16">
          <div className="mx-auto max-w-[760px]">
            <nav aria-label="Legal pages" className="flex flex-wrap gap-2">
              {LEGAL_PAGES.map(page => (
                <Link key={page.href} href={page.href} aria-current={page.href === path ? 'page' : undefined}
                  className={cn('rounded-full px-4 py-1.5 text-[14px] font-semibold transition-colors',
                    page.href === path ? 'bg-bk-fg text-bk-bg' : 'bg-bk-alt text-bk-fg/80 hover:text-bk-fg')}>
                  {page.label}
                </Link>
              ))}
            </nav>
            <Eyebrow className="mt-10">Legal</Eyebrow>
            <h1 className={cn(displayClass, 'mt-3 text-[clamp(38px,6vw,60px)] leading-[1.02]')}>{title}</h1>
            <p className="mt-5 text-[17px] leading-relaxed text-bk-muted">{intro}</p>
            <p className="mt-3 text-[14px] text-bk-muted">Last updated {updated}</p>

            <nav aria-label="On this page" className="mt-10 border-y border-bk-line py-6">
              <ol className="grid gap-x-8 gap-y-2 text-[15px] sm:grid-cols-2">
                {sections.map((section, i) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`} className="text-bk-fg/85 hover:text-bk-fg hover:underline hover:underline-offset-4">{i + 1}. {section.title}</a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="mt-4">
              {sections.map((section, i) => (
                <section key={section.id} id={section.id} className="scroll-mt-24 pt-10">
                  <h2 className="font-bk-display text-[22px] font-bold tracking-[-0.02em]">{i + 1}. {section.title}</h2>
                  <div className="mt-4 space-y-4 text-[16px] leading-[1.7] text-bk-fg/90">{section.body}</div>
                </section>
              ))}
            </div>
          </div>
        </Container>
      </main>
      <Footer />
    </div>
  )
}
