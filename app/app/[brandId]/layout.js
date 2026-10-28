import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { getFlows, getFlow, getGalleryCount } from '@/lib/data/flows'
import { requireOnboardedAccount } from '@/lib/auth'
import { getScheduleCount } from '@/lib/data/schedule'
import { contentLanguage } from '@/lib/services/contentLanguage'
import AppShell from '@/components/app/AppShell'
import { SIDEBAR_COOKIE, brandLogo } from '@/components/app/ui'

/**
 * Shared by every /app/[brandId]/* page: the sidebar with the brand switcher and studio navigation.
 * Only the fields the shell shows are sent to the client, never the whole saved flow.
 */
export default async function AppBrandLayout({ children, params }) {
  const { brandId } = await params
  const account = await requireOnboardedAccount(`/app/${encodeURIComponent(brandId)}/creation`)
  const [flows, flow, galleryCount] = await Promise.all([getFlows(), getFlow(brandId), getGalleryCount(brandId)])
  if (!flow) notFound()
  const scheduleCount = await getScheduleCount(brandId, flow.access.ownerId)

  const brandContext = flow.brandContext || {}
  const logo = brandLogo(brandContext)
  const brand = {
    id: flow.id,
    name: brandContext.name || flow.name || 'Untitled brand',
    logo: logo.src,
    logoOnDark: logo.onDark,
    language: contentLanguage(brandContext).code.toUpperCase(),
    // 'owner', or the account's role in a brand shared with it, and the owner's name.
    role: flow.access.role,
    owner: flow.access.owner,
  }
  // Posts & stories counts every idea, posts and stories alike.
  const counts = { creation: flow.creationState?.ideas?.length || 0, schedule: scheduleCount, gallery: galleryCount }
  // Most recently used first; the open brand is the one in use right now, so it leads.
  const ordered = [...flows.filter(f => f.id === flow.id), ...flows.filter(f => f.id !== flow.id)]
  // The saved sidebar state, so a collapsed sidebar does not flash open on reload.
  const collapsed = cookies().get(SIDEBAR_COOKIE)?.value === 'collapsed'

  return (
    <AppShell flows={ordered} brand={brand} counts={counts} account={{ name: account.name, email: account.email }} initialCollapsed={collapsed}>
      {children}
    </AppShell>
  )
}
