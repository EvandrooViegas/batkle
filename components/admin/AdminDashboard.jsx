'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Loader2, RefreshCw } from 'lucide-react'
import GlobalDesignLibrary from '@/components/GlobalDesignLibrary'
import UsageChart from '@/components/developers/UsageChart'
import { campaignLink } from '@/lib/analytics/attribution'
import { cn } from '@/lib/utils'
import { appField } from '@/components/app/field'
import { Notice, PageHeader, SegmentedTabs, appButton, pageInner, pageShell, panelClass } from '@/components/app/ui'

const PERIODS = [7, 30, 90]
const TABS = ['overview', 'campaigns', 'people', 'designs']
// The daily chart: one series at a time, with every series in its tooltip and table.
const DAILY = [
  { key: 'signups', label: 'Signups', one: 'signup', many: 'signups' },
  { key: 'visits', label: 'Visits', one: 'visit', many: 'visits' },
  { key: 'posts', label: 'Posts', one: 'post', many: 'posts' },
]
const th = 'px-3 py-2 text-left text-[12px] font-semibold text-bk-muted'
const td = 'px-3 py-2.5 align-middle'
const num = 'text-right tabular-nums'

const number = n => new Intl.NumberFormat().format(n || 0)
// Dollars with thousands grouped ($1,069.81); whole amounts without cents, as plan prices are written.
const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(n || 0) ? 0 : 2 }).format(n || 0)
const plural = (n, one, many = `${one}s`) => `${number(n)} ${n === 1 ? one : many}`
const signed = (now, before) => {
  if (!before) return now ? 'New this period' : 'None yet'
  const change = Math.round(((now - before) / before) * 100)
  return `${change > 0 ? '+' : ''}${change}% vs the period before`
}

function Stat({ label, value, note, hero = false }) {
  return (
    <div className={cn(panelClass, 'p-4 sm:p-5')}>
      <p className="text-[12.5px] font-semibold text-bk-muted">{label}</p>
      <p className={cn('mt-1.5 font-bold leading-none tracking-[-0.02em]', hero ? 'text-[48px]' : 'text-[28px]')}>{value}</p>
      {note && <p className="mt-2 text-[12.5px] text-bk-muted">{note}</p>}
    </div>
  )
}

function Card({ title, description, action, className = '', children }) {
  return (
    // min-w-0: in a grid, a card would otherwise grow to its table's width instead of letting the table scroll.
    <section className={cn(panelClass, 'min-w-0 p-5 sm:p-6', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-bk-display text-[18px] font-bold tracking-[-0.03em]">{title}</h2>
          {description && <p className="mt-1 text-[13px] text-bk-muted">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

/** A table in a card, as on API & usage: `columns` are { label, value(row), num? }. */
function Table({ columns, rows, empty, minWidth = 'min-w-[640px]' }) {
  if (!rows.length) return <p className="text-[13px] text-bk-muted">{empty}</p>
  return (
    <div className="-mx-3 overflow-x-auto">
      <table className={cn('w-full text-[13px]', minWidth)}>
        <thead><tr>{columns.map(c => <th key={c.label} scope="col" className={cn(th, c.num && 'text-right')}>{c.label}</th>)}</tr></thead>
        <tbody className="divide-y divide-bk-line">
          {rows.map((r, i) => <tr key={i}>{columns.map(c => <td key={c.label} className={cn(td, c.num && num, c.strong && 'font-semibold')}>{c.value(r)}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  )
}

/** A change against the period before, coloured only when there is one to compare with. */
function Change({ now, before }) {
  if (!before) return <span className="text-bk-muted">{now ? 'New' : '–'}</span>
  const change = Math.round(((now - before) / before) * 100)
  return <span className={cn('font-semibold', change > 0 ? 'text-[#17583F] dark:text-[#4CC79A]' : change < 0 ? 'text-[#8F2D20] dark:text-[#F0826F]' : 'text-bk-muted')}>{change > 0 ? '+' : ''}{change}%</span>
}

/** label · value rows in a bordered list, as the Credits card on API & usage. */
function List({ rows }) {
  return (
    <ul className="divide-y divide-bk-line rounded-xl border border-bk-line">
      {rows.map(([label, value, note]) => (
        <li key={label} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-[13px]">
          <span className="min-w-0"><span className="font-semibold">{label}</span>{note && <span className="block text-[12px] text-bk-muted">{note}</span>}</span>
          <span className="shrink-0 font-bold tabular-nums">{value}</span>
        </li>
      ))}
    </ul>
  )
}

const listHeading = 'mb-2 mt-5 text-[12px] font-bold uppercase tracking-[0.12em] text-bk-muted'

function OverviewTab({ m, days }) {
  const [metric, setMetric] = useState('signups')
  const chosen = DAILY.find(d => d.key === metric)
  const a = m.acquisition, u = m.usage, d = m.designs
  const share = n => (u.accounts ? `${Math.round((n / u.accounts) * 100)}% of accounts` : '')
  const activity = [
    ['Visits', a.visits, a.visitsBefore],
    ['Unique visitors', a.visitors],
    ['Signups', a.signups, a.signupsBefore],
    ['Finished onboarding', a.onboarded],
    ['Trials started', a.trials, a.trialsBefore],
    ['Posts made', u.posts, u.postsBefore],
    ['Credits used', u.credits, u.creditsBefore],
    ['AI images made', u.aiImages],
    ['Ads made', u.ads],
  ]
  return (
    <div className="space-y-5">
      <Card
        title={`${chosen.label} per day`}
        description={`Last ${days} days, by UTC day.`}
        action={<SegmentedTabs label="Chart" value={metric} onChange={setMetric} items={DAILY.map(s => [s.key, s.label])} />}
      >
        <UsageChart series={m.series} field={metric} title={`${chosen.label} per day`} emptyText={`No ${chosen.many} in this period.`} columns={DAILY} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="Activity" description={`Last ${days} days, next to the ${days} days before them.`}>
          <Table minWidth="min-w-[420px]" rows={activity} empty="" columns={[
            { label: 'Metric', value: r => r[0] },
            { label: 'This period', num: true, strong: true, value: r => number(r[1]) },
            { label: 'Before', num: true, value: r => (r.length > 2 ? number(r[2]) : <span className="text-bk-muted">–</span>) },
            { label: 'Change', num: true, value: r => (r.length > 2 ? <Change now={r[1]} before={r[2]} /> : <span className="text-bk-muted">–</span>) },
          ]} />
        </Card>

        <Card title="Accounts" description={`${plural(u.accounts, 'account')} in all, admins left out.`}>
          <List rows={[
            ['Free', number(m.plans.free), share(m.plans.free)],
            ['Pro', number(m.plans.pro), share(m.plans.pro)],
            ['Business', number(m.plans.business), share(m.plans.business)],
          ]} />
          <h3 className={listHeading}>Right now</h3>
          <List rows={[
            ['In a trial', number(m.revenue.trialing), m.revenue.trialing ? `${money(m.revenue.trialPipeline)} a month if they stay` : ''],
            ['Active this week', number(u.activeWeek), `${plural(u.activePeriod, 'account')} made a post in the period`],
            ['Canceled', number(m.revenue.canceled), `in the last ${days} days`],
          ]} />
          <h3 className={listHeading}>Designs and teams</h3>
          <List rows={[
            ['Batkle designs', number(d.batkle)],
            ['Member designs', number(d.memberPublic + d.memberPrivate), `${d.memberPublic} public · ${d.memberPrivate} private · ${plural(d.memberDrafts, 'draft')}`],
            ['Teams', number(d.teams), plural(d.teamMembers, 'member')],
          ]} />
        </Card>
      </div>
    </div>
  )
}

const PRESETS = [
  ['Facebook ad', { source: 'facebook', medium: 'paid-social' }],
  ['Instagram ad', { source: 'instagram', medium: 'paid-social' }],
  ['Instagram bio', { source: 'instagram', medium: 'social' }],
  ['Newsletter', { source: 'newsletter', medium: 'email' }],
]

/** Builds a tagged link to Batkle, so a campaign's visits and signups are counted under its name. */
function LinkBuilder() {
  const [tags, setTags] = useState({ source: 'facebook', medium: 'paid-social', campaign: '', content: '' })
  const [path, setPath] = useState('/'), [copied, setCopied] = useState(false), [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])
  const link = origin ? campaignLink(origin + (path.startsWith('/') ? path : `/${path}`), tags) : ''
  const field = (key, label, placeholder) => (
    <label className="block min-w-0 text-[12.5px] font-semibold">{label}
      <input value={tags[key]} onChange={e => setTags({ ...tags, [key]: e.target.value.trim().toLowerCase().replace(/\s+/g, '-') })} placeholder={placeholder} className={appField('mt-1 h-9 text-[13.5px] font-normal')} />
    </label>
  )
  return (
    <Card title="Campaign link" description="Put a tagged link in each ad, post or email: its visits and signups are counted below under its campaign.">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12.5px] text-bk-muted">For:</span>
        {PRESETS.map(([label, preset]) => {
          const on = tags.source === preset.source && tags.medium === preset.medium
          return (
            <button key={label} type="button" aria-pressed={on} onClick={() => setTags({ ...tags, ...preset })}
              className={cn('h-7 rounded-full border px-3 text-[12.5px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg', on ? 'border-bk-fg bg-bk-fg text-bk-bg' : 'border-bk-line bg-bk-surface/60 hover:border-bk-field hover:bg-bk-surface')}>
              {label}
            </button>
          )
        })}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block min-w-0 text-[12.5px] font-semibold">Page<input value={path} onChange={e => setPath(e.target.value)} className={appField('mt-1 h-9 text-[13.5px] font-normal')} /></label>
        {field('source', 'Source', 'facebook')}
        {field('medium', 'Medium', 'paid-social')}
        {field('campaign', 'Campaign', 'launch-october')}
        {field('content', 'Ad or variant', 'video-a')}
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-bk-line bg-bk-alt px-3 py-2">
        <code className="min-w-0 flex-1 truncate text-[12.5px]">{link}</code>
        <button type="button" disabled={!link} onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {} }} className={appButton('outline', 'xs', 'shrink-0')}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="mt-3 text-[12.5px] text-bk-muted">Meta marks its ad clicks on its own (fbclid), so untagged ad visits still count under facebook · paid-social.</p>
    </Card>
  )
}

const funnelColumns = first => [
  first,
  { label: 'Visits', num: true, value: r => number(r.visits) },
  { label: 'Visitors', num: true, value: r => number(r.visitors) },
  { label: 'Signups', num: true, value: r => number(r.signups) },
  { label: 'Signup rate', num: true, value: r => (r.visitors ? `${r.signupRate}%` : '–') },
  { label: 'Trials', num: true, value: r => number(r.trials) },
  { label: 'Paying', num: true, value: r => number(r.paying) },
  { label: 'Paid rate', num: true, value: r => (r.signups ? `${r.paidRate}%` : '–') },
  { label: 'MRR', num: true, strong: true, value: r => money(r.mrr) },
]

function CampaignsTab({ m, days }) {
  return (
    <div className="space-y-5">
      <LinkBuilder />
      <Card title="Channels" description={`Last ${days} days. A visit counts under the site or campaign it came from.`}>
        <Table columns={funnelColumns({ label: 'Channel', strong: true, value: r => r.channel })} rows={m.channels} empty="No visits or signups in this period yet." />
      </Card>
      <Card title="Campaigns" description="Signups count under the last campaign or site that brought them before they joined; visits under the campaign of that visit.">
        <Table
          columns={funnelColumns({ label: 'Source · medium · campaign', value: r => <span className="font-semibold">{r.source}{r.medium && <span className="font-normal text-bk-muted"> · {r.medium}</span>}{r.campaign && <span className="font-normal text-bk-muted"> · {r.campaign}</span>}</span> })}
          rows={m.campaigns}
          empty="No campaign visits or signups in this period yet. Share a tagged link to start counting."
        />
      </Card>
    </div>
  )
}

function PeopleTab({ m }) {
  return (
    <Card title="Newest accounts" description={`The ${m.recent.length} most recent of ${plural(m.usage.accounts, 'account')}, with where each first came from.`}>
      <Table rows={m.recent} empty="No accounts yet." columns={[
        { label: 'Account', value: r => <span className="block min-w-0"><span className="font-semibold">{r.name || r.email.split('@')[0]}</span><span className="block truncate text-[12px] text-bk-muted">{r.email}</span></span> },
        { label: 'Joined', value: r => <span className="whitespace-nowrap text-bk-muted">{r.createdAt ? new Date(r.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '–'}</span> },
        { label: 'Plan', value: r => <span><span className="capitalize">{r.plan}</span>{r.status === 'trialing' && <span className="text-bk-muted"> · trial</span>}{r.status === 'past_due' && <span className="text-[#8F2D20] dark:text-[#F0826F]"> · past due</span>}{!r.onboarded && <span className="text-bk-muted"> · not onboarded</span>}</span> },
        { label: 'Came from', value: r => <span>{r.channel}{r.source && <span className="block text-[12px] text-bk-muted">{[r.source, r.campaign].filter(Boolean).join(' · ')}</span>}</span> },
        { label: 'Posts', num: true, strong: true, value: r => number(r.posts) },
      ]} />
    </Card>
  )
}

/**
 * The admin analytics page: revenue, customers, use and where people come from, for the last 7, 30 or 90 days, plus
 * Batkle's own designs. Laid out as API & usage is. Admin accounts are left out of every number.
 */
export default function AdminDashboard() {
  const [days, setDays] = useState(30), [tab, setTab] = useState('overview')
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/metrics?days=${days}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'The numbers could not be loaded.')
      setData(body); setError('')
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [days])
  useEffect(() => { load() }, [load])

  // The tab follows the address (#overview, #campaigns, #people, #designs).
  useEffect(() => {
    const follow = () => { const hash = window.location.hash.slice(1); if (TABS.includes(hash)) setTab(hash) }
    follow()
    window.addEventListener('hashchange', follow)
    return () => window.removeEventListener('hashchange', follow)
  }, [])
  const choose = value => { setTab(value); window.history.replaceState(null, '', `#${value}`) }

  const m = data
  return (
    <div className={pageShell}>
      <div className={pageInner}>
        <PageHeader
          eyebrow="Batkle · Admin"
          title="Analytics"
          description="Revenue, customers and where they come from. Admin accounts are left out of every number."
          actions={<>
            <SegmentedTabs label="Period" value={days} onChange={setDays} items={PERIODS.map(p => [p, `${p} days`])} />
            <button type="button" onClick={load} disabled={loading} aria-label="Refresh" title="Refresh" className={appButton('outline', 'md', 'w-9 px-0')}>
              {loading && m ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            </button>
          </>}
        />

        {error && (
          <Notice tone="error" className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <span>{m ? `${error} These are the numbers from before.` : error}</span>
            <button type="button" onClick={load} className={appButton('outline', 'sm')}>Try again</button>
          </Notice>
        )}

        {!m ? (
          !error && (
            <div aria-label="Loading" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map(i => <div key={i} className={cn(panelClass, 'h-[118px] motion-safe:animate-pulse')} />)}
            </div>
          )
        ) : (
          <div className={cn('transition-opacity', loading && 'opacity-60')}>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat hero label="Monthly recurring revenue" value={money(m.revenue.mrr)} note={`${money(m.revenue.arr)} a year at this rate`} />
              <Stat label="Paying customers" value={number(m.revenue.paying)} note={m.revenue.trialing ? `${m.revenue.trialing} more in a trial` : 'None in a trial now'} />
              <Stat label={`Signups, ${days} days`} value={number(m.acquisition.signups)} note={signed(m.acquisition.signups, m.acquisition.signupsBefore)} />
              <Stat label="Signups now paying" value={`${m.acquisition.paidRate}%`} note={`${m.acquisition.converted} of ${plural(m.acquisition.signups, 'signup')}`} />
            </div>

            <SegmentedTabs className="mt-8 w-fit" label="Analytics sections" value={tab} onChange={choose} items={[
              ['overview', 'Overview'],
              ['campaigns', 'Campaigns', m.campaigns.length],
              ['people', 'People', m.usage.accounts],
              ['designs', 'Designs'],
            ]} />
            <div className="mt-5">
              {tab === 'overview' && <OverviewTab m={m} days={days} />}
              {tab === 'campaigns' && <CampaignsTab m={m} days={days} />}
              {tab === 'people' && <PeopleTab m={m} />}
              {tab === 'designs' && <GlobalDesignLibrary embedded />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
