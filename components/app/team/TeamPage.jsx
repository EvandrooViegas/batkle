'use client'

import { useState } from 'react'
import { Loader2, UserPlus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import UpgradeNotice from '../billing/UpgradeNotice'
import { useBilling } from '../billing/useBilling'
import { appField } from '../field'
import { usePopup } from '../popup'
import { Notice, PageHeader, appButton, pageInner, pageShell, panelClass } from '../ui'
import { useTeam } from './useTeam'

const initials = text => (String(text || '?').trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('') || '?').toUpperCase()
const chip = 'shrink-0 rounded-md px-2 py-0.5 text-[11.5px] font-bold'

function Person({ name, email, tag, tone = 'muted', action }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-bk-chip text-[12.5px] font-bold text-bk-fg/80">{initials(name || email)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold">{name || email}</span>
        {name && <span className="block truncate text-[12.5px] text-bk-muted">{email}</span>}
      </span>
      <span className={cn(chip, tone === 'green' ? 'bg-[#1F7A5A]/10 text-[#17583F] dark:text-[#4CC79A]' : tone === 'ink' ? 'bg-bk-fg text-bk-bg' : 'bg-bk-chip text-bk-fg')}>{tag}</span>
      {action}
    </li>
  )
}

function Card({ title, aside, children, className = '' }) {
  return (
    <section className={cn(panelClass, 'min-w-0', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-bk-line px-4 py-3.5 sm:px-5">
        <h2 className="font-bk-display text-[16px] font-bold tracking-[-0.02em]">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/**
 * The team: the people who share the private designs you and they publish. Invite by email and see who is in it on the
 * left; its name, the teams you are in yourself and deleting it on the right; invitations waiting for you on top.
 * Inviting is part of Pro and Business.
 */
export default function TeamPage({ account }) {
  const popup = usePopup()
  const { data: billing } = useBilling()
  const team = useTeam()
  const { info, busy } = team
  const [email, setEmail] = useState(''), [name, setName] = useState(null)
  const plan = billing?.summary?.plan
  const canInvite = plan === 'pro' || plan === 'business' || billing?.summary?.admin
  const own = info?.team
  const errorText = team.error && !team.error.billing ? team.error.message : ''

  const invite = async e => {
    e.preventDefault()
    const address = email.trim()
    if (address && await team.invite(address)) setEmail('')
  }

  return (
    <div className={pageShell}>
      <div className={pageInner}>
        <PageHeader
          eyebrow="Workspace · Team"
          title={own?.name || 'Team'}
          description="People in your team can use the private designs you and they publish. Brands, posts and plans stay each person’s own."
        />

        <p role="status" aria-live="polite" className="sr-only">{team.status}</p>
        {team.error?.billing && <UpgradeNotice error={team.error} className="mt-6" />}
        {errorText && <Notice tone="error" className="mt-6">{errorText}</Notice>}
        {team.status && <Notice tone="success" className="mt-6">{team.status}</Notice>}

        {!info ? (
          team.loadError ? (
            <Notice tone="error" className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <span>{team.loadError}</span>
              <button type="button" onClick={team.load} className={appButton('outline', 'sm')}>Try again</button>
            </Notice>
          ) : (
            <div role="status" aria-label="Loading your team" className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className={cn(panelClass, 'h-[320px] motion-safe:animate-pulse')} />
              <div className={cn(panelClass, 'h-[200px] motion-safe:animate-pulse')} />
            </div>
          )
        ) : (
          <>
            {info.invitations.length > 0 && (
              <ul aria-label="Invitations for you" className="mt-6 space-y-2">
                {info.invitations.map(inv => (
                  <li key={inv.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#E2A100] bg-[#FFD84D]/10 px-4 py-3 sm:px-5">
                    <p className="min-w-0 flex-1 text-[14px]"><strong>{inv.team.owner}</strong> invited you to <strong>{inv.team.name}</strong>.</p>
                    <button type="button" disabled={!!busy} onClick={() => team.accept(inv)} className={appButton('primary', 'sm')}>{busy === inv.id && <Loader2 className="size-3.5 animate-spin" />}Accept</button>
                    <button type="button" disabled={!!busy} onClick={() => team.decline(inv)} className={appButton('outline', 'sm')}>Decline</button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <Card title="People" aside={own && <span title="Besides you" className="text-[12.5px] tabular-nums text-bk-muted">{own.members.length} of {own.max} invited</span>}>
                {canInvite ? (
                  <form onSubmit={invite} className="border-b border-bk-line px-4 py-4 sm:px-5">
                    <label htmlFor="team-invite" className="block text-[13.5px] font-bold">{own ? 'Invite someone' : 'Start your team'}</label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input id="team-invite" type="email" autoComplete="off" placeholder="name@company.com" value={email} onChange={e => setEmail(e.target.value)} className={appField('h-10 min-w-[200px] flex-1 text-[14px]')} />
                      <button disabled={!!busy || !email.trim()} className={appButton('primary', 'md', 'h-10')}>
                        {busy === 'invite' ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}{own ? 'Invite' : 'Start a team'}
                      </button>
                    </div>
                    <p className="mt-1.5 text-[12px] text-bk-muted">They get an email, then sign in with that address and accept on this page.</p>
                  </form>
                ) : (
                  <div className="border-b border-bk-line px-4 py-4 sm:px-5">
                    {plan ? <UpgradeNotice error={{ billing: { feature: 'teams', requiredPlan: 'pro' }, code: 'upgrade_required', message: 'Teams are part of Pro and Business.' }} compact /> : <p className="text-[13.5px] text-bk-muted">Loading your plan…</p>}
                  </div>
                )}
                <ul aria-label="People in your team" className="divide-y divide-bk-line">
                  <Person name={account?.name ? `${account.name} (you)` : 'You'} email={account?.email || ''} tag="Owner" tone="ink" />
                  {(own?.members || []).map(m => (
                    <Person key={m.id} name={m.name} email={m.email} tag={m.status === 'active' ? 'Member' : 'Invited'} tone={m.status === 'active' ? 'green' : 'muted'}
                      action={(
                        <button type="button" disabled={!!busy} onClick={() => team.remove(m)} aria-label={m.status === 'active' ? `Remove ${m.email}` : `Take back the invitation to ${m.email}`} title={m.status === 'active' ? 'Remove from the team' : 'Take back the invitation'} className={appButton('quiet', 'sm', 'size-8 shrink-0 px-0')}>
                          {busy === m.id ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                        </button>
                      )} />
                  ))}
                </ul>
                {!own?.members.length && <p className="border-t border-bk-line px-4 py-4 text-[13px] text-bk-muted sm:px-5">No one else yet. Once someone accepts, you each see the private designs the other publishes.</p>}
              </Card>

              <div className="space-y-6">
                {own && (
                  <Card title="Team name">
                    <form className="px-4 py-4 sm:px-5" onSubmit={async e => { e.preventDefault(); if (name?.trim() && name.trim() !== own.name && await team.rename(name.trim())) setName(null) }}>
                      <label htmlFor="team-name" className="sr-only">Team name</label>
                      <input id="team-name" value={name ?? own.name} onChange={e => setName(e.target.value)} maxLength={60} className={appField('h-10 text-[14.5px] font-semibold')} />
                      {name !== null && name.trim() !== own.name && <button disabled={!!busy || !name.trim()} className={appButton('outline', 'sm', 'mt-2')}>Save name</button>}
                    </form>
                  </Card>
                )}
                <Card title="Teams you’re in">
                  {info.memberships.length ? (
                    <ul className="divide-y divide-bk-line">
                      {info.memberships.map(m => (
                        <li key={m.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                          <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold">{m.name}</span><span className="block truncate text-[12.5px] text-bk-muted">{m.owner}’s team</span></span>
                          <button type="button" disabled={!!busy} className={appButton('outline', 'sm')} onClick={async () => {
                            if (await popup.confirm({ title: `Leave ${m.name}?`, description: 'You stop seeing the team’s private designs. Brands that use them keep the versions they have.', confirmLabel: 'Leave team' })) team.leave(m)
                          }}>Leave</button>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="px-4 py-4 text-[13px] text-bk-muted sm:px-5">You are not in anyone else’s team. Invitations to you appear at the top of this page.</p>}
                </Card>
                {own && (
                  <button type="button" disabled={!!busy} className="px-1 text-[13px] font-semibold text-[#C2412F] underline underline-offset-4 dark:text-[#F0826F]" onClick={async () => {
                    if (await popup.confirm({ title: `Delete ${own.name}?`, description: 'Everyone leaves the team and stops seeing its private designs. Your designs stay yours.', tone: 'danger', confirmLabel: 'Delete team' })) team.deleteTeam()
                  }}>Delete team</button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
