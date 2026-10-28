'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePopup } from '../popup'
import { BrandTile, Notice, PageHeader, appButton, panelClass } from '../ui'
import { useTeams } from './useTeam'

const ROLE_NAME = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' }
const article = role => (role === 'admin' ? 'an admin' : role === 'editor' ? 'an editor' : 'a viewer')
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A brand in a list: its logo and name, a line about it, and what can be done with it. */
function BrandRow({ brand, detail, className = '', children }) {
  return (
    <li className={cn('flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5', className)}>
      <BrandTile name={brand.name} logo={brand.logo} logoOnDark={brand.logoOnDark} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-bold">{brand.name}</span>
        <span className="block truncate text-[12.5px] text-bk-muted">{detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">{children}</span>
    </li>
  )
}

function Section({ id, title, count, children }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="flex items-baseline gap-2 font-bk-display text-[20px] font-bold tracking-[-0.02em]">
        {title}{count > 0 && <span className="font-bk-body text-[13px] font-semibold tabular-nums text-bk-muted">{count}</span>}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

const empty = 'rounded-2xl border border-dashed border-bk-field px-5 py-6 text-[13.5px] text-bk-muted'

/**
 * Every team the account is part of: invitations waiting for it (answered here), the brands shared with it with the
 * owner and its role, and its own brands with how many people each has and a way to their Team page.
 */
export default function TeamsOverview() {
  const router = useRouter()
  const popup = usePopup()
  const teams = useTeams()
  const { info, busy } = teams

  const accept = async inv => { if (await teams.accept(inv)) router.refresh() }
  const leave = async item => {
    if (await popup.confirm({ title: `Leave ${item.brand.name}?`, description: 'It leaves your brand list. The posts made in it stay with the brand.', confirmLabel: 'Leave brand' })) {
      if (await teams.leave(item)) router.refresh()
    }
  }

  return (
    <>
      <PageHeader eyebrow="Account" title="Teams & invitations" description="Invitations waiting for you, the brands other people share with you, and who works on your own brands." />
      <p role="status" aria-live="polite" className="sr-only">{teams.status}</p>
      {teams.error && <Notice tone="error" className="mt-6">{teams.error.message}</Notice>}
      {teams.status && <Notice tone="success" className="mt-6">{teams.status}</Notice>}

      {!info ? (
        teams.loadError ? (
          <Notice tone="error" className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <span>{teams.loadError}</span>
            <button type="button" onClick={teams.load} className={appButton('outline', 'sm')}>Try again</button>
          </Notice>
        ) : (
          <div role="status" aria-label="Loading your teams" className="mt-8 space-y-4">
            <div className={cn(panelClass, 'h-[120px] motion-safe:animate-pulse')} />
            <div className={cn(panelClass, 'h-[180px] motion-safe:animate-pulse')} />
          </div>
        )
      ) : (
        <div className="mt-8 space-y-10">
          <Section id="invitations" title="Invitations" count={info.invitations.length}>
            {info.invitations.length ? (
              <ul aria-label="Invitations for you" className="space-y-2">
                {info.invitations.map(inv => (
                  <BrandRow key={inv.id} brand={inv.brand} detail={`${inv.invitedBy} invited you as ${article(inv.role)} · ${inv.owner}’s brand`} className="rounded-2xl border border-[#E2A100] bg-[#FFD84D]/10">
                    <button type="button" disabled={!!busy} onClick={() => accept(inv)} className={appButton('primary', 'sm')}>{busy === inv.id && <Loader2 className="size-3.5 animate-spin" />}Accept</button>
                    <button type="button" disabled={!!busy} onClick={() => teams.decline(inv)} className={appButton('outline', 'sm')}>Decline</button>
                  </BrandRow>
                ))}
              </ul>
            ) : <p className={empty}>No invitations right now. When someone invites you to a brand, it shows up here and in your notifications.</p>}
          </Section>

          <Section id="shared" title="Shared with you" count={info.shared.length}>
            {info.shared.length ? (
              <ul aria-label="Brands shared with you" className={cn(panelClass, 'divide-y divide-bk-line')}>
                {info.shared.map(item => (
                  <BrandRow key={item.flowId} brand={item.brand} detail={`${item.owner}’s brand · ${ROLE_NAME[item.role]}`}>
                    <Link href={`/app/${item.flowId}/creation`} className={appButton('outline', 'sm')}>Open</Link>
                    <Link href={`/app/${item.flowId}/team`} className={appButton('quiet', 'sm', 'hidden sm:inline-flex')}>Team</Link>
                    <button type="button" disabled={!!busy} onClick={() => leave(item)} className={appButton('quiet', 'sm', 'text-[#C2412F] hover:text-[#C2412F] dark:text-[#F0826F]')}>{busy === item.flowId && <Loader2 className="size-3.5 animate-spin" />}Leave</button>
                  </BrandRow>
                ))}
              </ul>
            ) : <p className={empty}>No one has shared a brand with you yet.</p>}
          </Section>

          <Section id="yours" title="Your brands" count={info.owned.length}>
            {info.owned.length ? (
              <ul aria-label="Your brands" className={cn(panelClass, 'divide-y divide-bk-line')}>
                {info.owned.map(item => (
                  <BrandRow key={item.flowId} brand={item.brand} detail={item.people || item.invited ? [item.people && `${plural(item.people, 'person', 'people')} besides you`, item.invited && `${item.invited} invited`].filter(Boolean).join(' · ') : 'Only you'}>
                    <Link href={`/app/${item.flowId}/team`} className={appButton('outline', 'sm')}>{item.people || item.invited ? 'Manage team' : 'Invite people'}</Link>
                  </BrandRow>
                ))}
              </ul>
            ) : <p className={empty}>You have no brands of your own yet. <Link href="/app/new" className="font-semibold text-bk-fg underline underline-offset-4">Add one</Link></p>}
          </Section>
        </div>
      )}
    </>
  )
}
