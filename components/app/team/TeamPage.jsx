'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Loader2, UserPlus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import UpgradeNotice from '../billing/UpgradeNotice'
import { useBilling } from '../billing/useBilling'
import AppSelect from '../AppSelect'
import { appField } from '../field'
import { usePopup } from '../popup'
import { BrandTile, Notice, PageHeader, appButton, pageInner, pageShell, panelClass } from '../ui'
import { useBrandTeam, useTeams } from './useTeam'

export const ROLE_OPTIONS = [
  ['admin', 'Admin', 'Everything the owner can do except delete the brand: posts, ads, the schedule, the brand profile and its people.'],
  ['editor', 'Editor', 'Makes, edits and schedules posts and ads. Can’t change the brand profile or its people.'],
  ['viewer', 'Viewer', 'Sees the posts, schedule and gallery. Can’t change anything.'],
]
const ROLE_NAME = { owner: 'Owner', admin: 'Admin', editor: 'Editor', viewer: 'Viewer' }

const initials = text => (String(text || '?').trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('') || '?').toUpperCase()
const chip = 'shrink-0 rounded-md px-2 py-0.5 text-[11.5px] font-bold'
// The roles as the pickers list them, each with what it can do.
const ROLE_CHOICES = ROLE_OPTIONS.map(([value, label, description]) => ({ value, label, description }))

/** Where an invitation email got: on its way, delivered, or bounced because the address does not exist. */
function Delivery({ delivery }) {
  if (delivery === 'bounced') return <span className="block text-[12px] font-semibold text-[#C2412F] dark:text-[#F0826F]">Email bounced: this address doesn’t exist or can’t receive email</span>
  if (delivery === 'delivered') return <span className="block text-[12px] text-bk-muted">Invitation delivered, waiting for them to accept</span>
  if (delivery === 'sent') return <span className="flex items-center gap-1.5 text-[12px] text-bk-muted"><Loader2 aria-hidden="true" className="size-3 animate-spin" />Sending the invitation…</span>
  return <span className="block text-[12px] text-bk-muted">Waiting for them to accept</span>
}

function Person({ name, email, detail, tag, tone = 'muted', action }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-bk-chip text-[12.5px] font-bold text-bk-fg/80">{initials(name || email)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold">{name || email}</span>
        {name && <span className="block truncate text-[12.5px] text-bk-muted">{email}</span>}
        {detail}
      </span>
      {tag && <span className={cn(chip, tone === 'green' ? 'bg-[#1F7A5A]/10 text-[#17583F] dark:text-[#4CC79A]' : tone === 'ink' ? 'bg-bk-fg text-bk-bg' : tone === 'red' ? 'bg-[#C2412F]/10 text-[#8F2D20] dark:text-[#F0826F]' : 'bg-bk-chip text-bk-fg')}>{tag}</span>}
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
 * A brand's team: the people who work on it. The owner and admins invite people by email with a role, change roles
 * and remove people; everyone else sees who is in it and can leave. The invitation goes to this brand unless another
 * one is picked: any brand the account owns or is an admin of. On the right, what each role can do and whose credits
 * posts here use. Every team the account is in, and invitations to it, are on /app/teams.
 */
export default function TeamPage({ flowId, brandName }) {
  const router = useRouter()
  const popup = usePopup()
  // In a brand shared with the account this is the owner's plan, which is what inviting depends on.
  const { data: billing } = useBilling()
  const team = useBrandTeam(flowId)
  const { info, busy } = team
  // The brands an invitation can go to: the account's own and those it is an admin of, this one first.
  const { info: teams } = useTeams()
  const [email, setEmail] = useState(''), [role, setRole] = useState('editor'), [target, setTarget] = useState(flowId)
  const summary = billing?.summary
  const canInvite = Boolean(summary?.features?.customDesigns || summary?.admin)
  const mine = info?.owner?.you
  const owner = info ? (mine ? 'you' : info.owner.name || info.owner.email) : ''
  const name = info?.brand?.name || brandName
  const brands = useMemo(() => {
    const list = [
      ...(teams?.owned || []).map(t => ({ flowId: t.flowId, brand: t.brand, description: 'Your brand' })),
      ...(teams?.shared || []).filter(t => t.role === 'admin').map(t => ({ flowId: t.flowId, brand: t.brand, description: `${t.owner}’s brand · you’re an admin` })),
    ]
    const here = list.find(b => b.flowId === flowId) || { flowId, brand: { name, logo: info?.brand?.logo, logoOnDark: info?.brand?.logoOnDark }, description: mine ? 'Your brand' : 'You’re an admin' }
    return [here, ...list.filter(b => b.flowId !== flowId)].map(b => ({
      value: b.flowId, label: b.brand?.name || 'Untitled brand', description: b.flowId === flowId ? `${b.description} · this brand` : b.description,
      icon: <BrandTile name={b.brand?.name} logo={b.brand?.logo} logoOnDark={b.brand?.logoOnDark} size={22} className="rounded-md" />,
    }))
  }, [teams, flowId, name, info, mine])
  const into = brands.find(b => b.value === target) || brands[0]

  const invite = async e => {
    e.preventDefault()
    const address = email.trim()
    if (address && await team.invite(address, role, into.value === flowId ? null : { flowId: into.value, name: into.label })) setEmail('')
  }
  const leave = async () => {
    if (!(await popup.confirm({ title: `Leave ${name}?`, description: 'It leaves your brand list. The posts made in it stay with the brand.', confirmLabel: 'Leave brand' }))) return
    if (await team.leave()) { router.replace('/app/teams'); router.refresh() }
  }

  return (
    <div className={pageShell}>
      <div className={pageInner}>
        <PageHeader
          eyebrow="Workspace · Team"
          title={name}
          description={info && !mine
            ? `${owner} shared this brand with you. You are ${info.role === 'admin' ? 'an admin' : info.role === 'editor' ? 'an editor' : 'a viewer'} here, and posts made in it use ${owner}’s credits.`
            : 'The people who work on this brand. Once they accept, it is in their brand list, their role decides what they can do, and posts they make here use your credits.'}
          actions={<Link href="/app/teams" className={appButton('outline', 'sm')}>All your teams<ArrowRight className="size-4" /></Link>}
        />

        {/* What an action did is a toast (useBrandTeam); a plan limit stays here, with the upgrade. */}
        {team.error && <UpgradeNotice error={team.error} className="mt-6" />}

        {!info ? (
          team.loadError ? (
            <Notice tone="error" className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <span>{team.loadError}</span>
              <button type="button" onClick={team.load} className={appButton('outline', 'sm')}>Try again</button>
            </Notice>
          ) : (
            <div role="status" aria-label="Loading the team" className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className={cn(panelClass, 'h-[320px] motion-safe:animate-pulse')} />
              <div className={cn(panelClass, 'h-[240px] motion-safe:animate-pulse')} />
            </div>
          )
        ) : (
          <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card title="People" aside={<span title="Besides the owner" className="text-[12.5px] tabular-nums text-bk-muted">{info.members.length} of {info.max}</span>}>
              {info.canManage && (canInvite ? (
                <form onSubmit={invite} className="border-b border-bk-line px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <label htmlFor="team-invite" className="text-[13.5px] font-bold">Invite someone to</label>
                    {brands.length > 1
                      ? <AppSelect id="team-brand" label="Brand to invite to" value={into.value} onChange={setTarget} options={brands} size="sm" menuWidth={320} className="max-w-[min(100%,280px)]" />
                      : <span className="text-[13.5px] font-bold">{name}</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input id="team-invite" type="email" autoComplete="off" placeholder="name@company.com" value={email} onChange={e => setEmail(e.target.value)} className={appField('h-10 min-w-[200px] flex-1 text-[14px]')} />
                    <AppSelect id="team-role" label="Role" value={role} onChange={setRole} options={ROLE_CHOICES} align="end" menuWidth={320} className="w-[124px]" />
                    <button disabled={!!busy || !email.trim()} className={appButton('primary', 'md', 'h-10')}>
                      {busy === 'invite' ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}Invite
                    </button>
                  </div>
                  <p className="mt-1.5 text-[12px] text-bk-muted">They get an email, sign in with that address and accept. {ROLE_OPTIONS.find(([value]) => value === role)?.[2]}</p>
                </form>
              ) : (
                <div className="border-b border-bk-line px-4 py-4 sm:px-5">
                  {!summary ? <p className="text-[13.5px] text-bk-muted">Loading the plan…</p>
                    : mine ? <UpgradeNotice error={{ billing: { feature: 'teams', requiredPlan: 'pro' }, code: 'upgrade_required', message: 'Inviting people to a brand is part of Pro and Business.' }} compact />
                    : <p className="text-[13.5px] text-bk-muted">Inviting people is part of Pro and Business. Ask {owner} to upgrade to invite more.</p>}
                </div>
              ))}
              <ul aria-label={`People in ${name}`} className="divide-y divide-bk-line">
                <Person name={mine ? `${info.owner.name || 'You'} (you)` : info.owner.name} email={info.owner.email} tag="Owner" tone="ink" />
                {info.members.map(m => {
                  const label = m.name || m.email
                  const manage = info.canManage && !m.you
                  return (
                    <Person
                      key={m.id}
                      name={m.you ? `${m.name || 'You'} (you)` : m.name}
                      email={m.email}
                      detail={m.status === 'invited' && <Delivery delivery={m.delivery} />}
                      tag={m.status === 'invited' ? (m.delivery === 'bounced' ? 'Bounced' : 'Invited') : !manage && ROLE_NAME[m.role]}
                      tone={m.status === 'invited' ? (m.delivery === 'bounced' ? 'red' : 'muted') : 'green'}
                      action={manage && (
                        <span className="flex shrink-0 items-center gap-1">
                          <AppSelect id={`role-${m.id}`} label={`Role of ${label}`} value={m.role} disabled={!!busy} onChange={next => next !== m.role && team.setRole(m, next)} options={ROLE_CHOICES} size="sm" align="end" menuWidth={320} className="w-[104px]" />
                          <button type="button" disabled={!!busy} onClick={() => team.remove(m)} aria-label={m.status === 'active' ? `Remove ${label}` : `Take back the invitation to ${m.email}`} title={m.status === 'active' ? 'Remove from the brand' : 'Take back the invitation'} className={appButton('quiet', 'sm', 'size-8 shrink-0 px-0')}>
                            {busy === m.id ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                          </button>
                        </span>
                      )}
                    />
                  )
                })}
              </ul>
              {!info.members.length && <p className="border-t border-bk-line px-4 py-4 text-[13px] text-bk-muted sm:px-5">No one else yet. Invite the people you work with and pick what each one can do.</p>}
            </Card>

            <div className="space-y-6">
              <Card title="Roles">
                <dl className="space-y-3 px-4 py-4 text-[13px] sm:px-5">
                  {ROLE_OPTIONS.map(([value, label, text]) => (
                    <div key={value}>
                      <dt className="flex items-center gap-2 font-bold">{label}{info.role === value && <span className={cn(chip, 'bg-bk-butter text-bk-ink')}>You</span>}</dt>
                      <dd className="mt-0.5 leading-relaxed text-bk-muted">{text}</dd>
                    </div>
                  ))}
                  <div className="border-t border-bk-line pt-3">
                    <dt className="font-bold">Credits</dt>
                    <dd className="mt-0.5 leading-relaxed text-bk-muted">Posts and ads made in this brand use {mine ? 'your' : `${owner}’s`} credits and plan, whoever makes them.</dd>
                  </div>
                </dl>
              </Card>
              {!mine && (
                <button type="button" disabled={!!busy} onClick={leave} className="px-1 text-[13px] font-semibold text-[#C2412F] underline underline-offset-4 dark:text-[#F0826F]">
                  {busy === 'leave' && <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />}Leave {name}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
