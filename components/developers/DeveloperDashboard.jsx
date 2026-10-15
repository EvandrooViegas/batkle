'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, BookOpen, Check, CircleCheck, Copy, KeyRound, Loader2, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { usePopup } from '@/components/app/popup'
import { EmptyState, Notice, PageHeader, SegmentedTabs, appButton, pageInner, panelClass } from '@/components/app/ui'
import { appField } from '@/components/app/field'
import { CREDIT_COSTS } from '@/lib/developer/pricing'
import { cn } from '@/lib/utils'
import RenderLog, { useCopy } from './RenderLog'
import UsageChart from './UsageChart'

const number = n => new Intl.NumberFormat().format(n || 0)
const when = date => (date ? new Date(date).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never')
const TABS = ['usage', 'keys', 'renders']
// MAX_ACTIVE_KEYS in lib/developer/store.ts.
const MAX_KEYS = 10

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

function Endpoint({ name }) {
  const [method, path] = String(name || '').split(' ')
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[12px]">
      <span className={cn('rounded px-1.5 py-px text-[10.5px] font-bold', method === 'GET' ? 'bg-bk-chip text-bk-fg/80' : 'bg-bk-butter text-bk-ink')}>{method}</span>
      <span className="truncate">{path}</span>
    </span>
  )
}

const STATUS_TEXT = { 200: 'OK', 201: 'Created', 400: 'Bad request', 401: 'Unauthorized', 402: 'No credits', 404: 'Not found', 405: 'Wrong method', 413: 'Too large', 422: 'Image unavailable', 429: 'Rate limited', 500: 'Error', 503: 'Unavailable' }

function Status({ code }) {
  const ok = code < 400
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-bold', ok ? 'bg-[#1F7A5A]/10 text-[#17583F] dark:text-[#4CC79A]' : 'bg-[#C2412F]/10 text-[#8F2D20] dark:text-[#F0826F]')}>
      {ok ? <CircleCheck className="size-3.5" aria-hidden="true" /> : <AlertTriangle className="size-3.5" aria-hidden="true" />}
      {code} {STATUS_TEXT[code] || (ok ? 'OK' : 'Error')}
    </span>
  )
}

const th = 'px-3 py-2 text-left text-[12px] font-semibold text-bk-muted'
const td = 'px-3 py-2.5 align-middle'

function UsageTab({ data, onCreateKey }) {
  const hasKeys = data.keys.some(k => !k.revokedAt)
  return (
    <div className="space-y-5">
      {!hasKeys && (
        <Notice tone="info" className="flex flex-wrap items-center justify-between gap-3">
          <span>Create an API key to start using the API. Your starter credits are already on the account.</span>
          <button type="button" onClick={onCreateKey} className={appButton('primary', 'sm')}><KeyRound className="size-4" />Create a key</button>
        </Notice>
      )}
      <Card title="Credits used per day" description={`Last ${data.days} days, in ${data.timeZone.replace(/_/g, ' ')} time.`}>
        <UsageChart series={data.series} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="By endpoint" description={`Last ${data.days} days.`}>
          {data.endpoints.length === 0 ? <p className="text-[13px] text-bk-muted">No requests yet.</p> : (
            <div className="-mx-3 overflow-x-auto">
              <table className="w-full min-w-[420px] text-[13px]">
                <thead><tr><th className={th}>Endpoint</th><th className={cn(th, 'text-right')}>Requests</th><th className={cn(th, 'text-right')}>Failed</th><th className={cn(th, 'text-right')}>Credits</th></tr></thead>
                <tbody className="divide-y divide-bk-line">
                  {data.endpoints.map(e => (
                    <tr key={e.endpoint}>
                      <td className={td}><Endpoint name={e.endpoint} /></td>
                      <td className={cn(td, 'text-right tabular-nums')}>{number(e.requests)}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{number(e.errors)}</td>
                      <td className={cn(td, 'text-right font-semibold tabular-nums')}>{number(e.credits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <CreditsCard data={data} />
      </div>

      <Card title="Latest requests" description="The last 50 requests from all your keys. Failed requests cost nothing.">
        {data.recent.length === 0 ? <p className="text-[13px] text-bk-muted">No requests yet. They appear here as soon as you call the API.</p> : (
          <div className="-mx-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead><tr><th className={th}>Time</th><th className={th}>Endpoint</th><th className={th}>Key</th><th className={th}>Result</th><th className={cn(th, 'text-right')}>Credits</th><th className={cn(th, 'text-right')}>Time taken</th></tr></thead>
              <tbody className="divide-y divide-bk-line">
                {data.recent.map(r => (
                  <tr key={r.id} className="align-top">
                    <td className={cn(td, 'whitespace-nowrap text-bk-muted')}>{when(r.createdAt)}</td>
                    <td className={cn(td, 'max-w-[320px]')}>
                      <Endpoint name={r.endpoint} />
                      {r.meta?.size && <p className="mt-0.5 truncate text-[12px] text-bk-muted">{r.meta.carousel ? `Carousel · ${r.meta.images} image${r.meta.images === 1 ? '' : 's'}` : 'Single post'} · {r.meta.size}</p>}
                    </td>
                    <td className={cn(td, 'max-w-[160px] truncate')}>{r.keyName}</td>
                    <td className={td}><Status code={r.status} /></td>
                    <td className={cn(td, 'text-right font-semibold tabular-nums')}>{number(r.credits)}</td>
                    <td className={cn(td, 'whitespace-nowrap text-right tabular-nums text-bk-muted')}>{r.durationMs >= 1000 ? `${(r.durationMs / 1000).toFixed(1)} s` : `${r.durationMs} ms`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function CreditsCard({ data }) {
  const costs = [
    ['A single post', `${CREDIT_COSTS.image} credit`, 'one image'],
    ['A carousel', `${CREDIT_COSTS.image} credit per slide`, 'or one credit for a single slide you ask for'],
  ]
  return (
    <Card title="Credits" description="Every image the API renders costs one credit. Failed requests are refunded.">
      <ul className="divide-y divide-bk-line rounded-xl border border-bk-line">
        {costs.map(([label, cost, note]) => (
          <li key={label} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-[13px]">
            <span><span className="font-semibold">{label}</span><span className="block text-[12px] text-bk-muted">{note}</span></span>
            <span className="shrink-0 font-bold tabular-nums">{cost}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[13px] leading-relaxed text-bk-muted">Buying credit packs is not open yet. To add credits to your account in the meantime, contact the Batkle team.</p>
      {data.grants.length > 0 && (
        <>
          <h3 className="mt-5 text-[12px] font-bold uppercase tracking-[0.12em] text-bk-muted">Credits added</h3>
          <ul className="mt-2 space-y-1.5 text-[13px]">
            {data.grants.map(g => (
              <li key={g.id} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">{g.note}<span className="ml-2 text-[12px] text-bk-muted">{new Date(g.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span></span>
                <span className="shrink-0 font-bold tabular-nums text-[#17583F] dark:text-[#4CC79A]">+{number(g.credits)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

function NewKey({ created, onDone }) {
  const [copied, copy] = useCopy()
  return (
    <div role="status" className="rounded-xl border border-[#1F7A5A]/30 bg-[#1F7A5A]/[0.06] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[14px] font-bold">Your new key “{created.record.name}”</p>
          <p className="mt-0.5 text-[13px] text-bk-fg/80">Copy it now and keep it on your server. For your security it is never shown again.</p>
        </div>
        <button type="button" onClick={onDone} aria-label="Hide the key" className={appButton('quiet', 'xs', 'size-8 px-0')}><X className="size-4" /></button>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-bk-line bg-bk-surface px-3 py-2 font-mono text-[13px]">{created.key}</code>
        <button type="button" onClick={() => copy(created.key)} className={appButton('ink', 'md', 'h-10')}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? 'Copied' : 'Copy key'}</button>
      </div>
    </div>
  )
}

function KeysTab({ data, reload, focusCreate }) {
  const popup = usePopup()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(null)
  const active = data.keys.filter(k => !k.revokedAt)

  useEffect(() => { if (focusCreate) document.getElementById('bk-key-name')?.focus() }, [focusCreate])

  const create = async e => {
    e.preventDefault()
    setCreating(true)
    try {
      const res = await fetch('/api/developer/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'The key could not be created')
      setCreated(json)
      setName('')
      reload()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setCreating(false)
    }
  }

  const revoke = async key => {
    const revoked = await popup.confirm({
      title: `Revoke “${key.name}”?`,
      description: 'Requests made with this key fail from now on. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Revoke key',
      busyLabel: 'Revoking…',
      action: async () => {
        const res = await fetch(`/api/developer/keys/${key.id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'The key could not be revoked. Please try again.')
      },
    })
    if (!revoked) return
    toast.success('Key revoked')
    reload()
  }

  return (
    <div className="space-y-5">
      <Card title="API keys" description={`Send a key with every request as "Authorization: Bearer …". You can have ${MAX_KEYS} active keys.`}>
        <form onSubmit={create} className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="bk-key-name" className="sr-only">Key name</label>
          <input id="bk-key-name" value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="Name, such as Production server" className={appField('text-[14px] sm:flex-1')} />
          <button type="submit" disabled={creating || active.length >= MAX_KEYS} className={appButton('primary', 'md', 'h-11')}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}Create key
          </button>
        </form>
        {created && <div className="mt-4"><NewKey created={created} onDone={() => setCreated(null)} /></div>}

        {data.keys.length === 0 ? (
          <EmptyState icon={KeyRound} title="No keys yet" className="mt-5">Name your first key after where it will run, then create it.</EmptyState>
        ) : (
          // relative: the screen-reader-only header is absolutely positioned and would otherwise widen the page.
          <div className="relative -mx-3 mt-5 overflow-x-auto">
            <table className="w-full min-w-[680px] text-[13px]">
              <thead><tr><th className={th}>Name</th><th className={th}>Key</th><th className={th}>Created</th><th className={th}>Last used</th><th className={cn(th, 'text-right')}>Credits, {data.days} days</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
              <tbody className="divide-y divide-bk-line">
                {data.keys.map(k => (
                  <tr key={k.id} className={cn(k.revokedAt && 'text-bk-muted')}>
                    <td className={cn(td, 'max-w-[200px] truncate font-semibold')}>{k.name}</td>
                    <td className={cn(td, 'font-mono text-[12px]')}>{k.masked}</td>
                    <td className={cn(td, 'whitespace-nowrap')}>{when(k.createdAt)}</td>
                    <td className={cn(td, 'whitespace-nowrap')}>{when(k.lastUsedAt)}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{number(k.credits)}</td>
                    <td className={cn(td, 'text-right')}>
                      {k.revokedAt
                        ? <span className="whitespace-nowrap text-[12px]">Revoked {new Date(k.revokedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                        : <button type="button" onClick={() => revoke(k)} className={appButton('outline', 'xs', 'text-[#C2412F] hover:border-[#C2412F]/60 dark:text-[#F0826F]')}>Revoke</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

/** The signed-in account's API keys, credits, usage and renders. */
export default function DeveloperDashboard({ account }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState(null)
  const [focusCreate, setFocusCreate] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      const res = await fetch(`/api/developer?tz=${encodeURIComponent(timeZone)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error()
      setData(await res.json())
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // The tab follows the address (#usage, #keys, #renders); a new account starts on its keys.
  useEffect(() => {
    if (tab || !data) return
    const hash = window.location.hash.slice(1)
    setTab(TABS.includes(hash) ? hash : data.keys.some(k => !k.revokedAt) ? 'usage' : 'keys')
  }, [data, tab])

  // A link to another section of this page (such as …/dashboard#renders) switches the tab too.
  useEffect(() => {
    const follow = () => { const hash = window.location.hash.slice(1); if (TABS.includes(hash)) setTab(hash) }
    window.addEventListener('hashchange', follow)
    return () => window.removeEventListener('hashchange', follow)
  }, [])

  const choose = value => {
    setTab(value)
    window.history.replaceState(null, '', `#${value}`)
  }

  const activeKeys = data?.keys.filter(k => !k.revokedAt).length || 0

  return (
    <div className="px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pt-8">
      <div className={cn(pageInner, 'max-w-[1160px]')}>
        <PageHeader
          eyebrow="Developers"
          title="API & usage"
          description={`API keys, credits and usage for ${account.email || account.name}.`}
          actions={<>
            <Link href="/developers" className={appButton('outline', 'md')}><BookOpen className="size-4" />API docs</Link>
            <button type="button" onClick={load} disabled={loading} aria-label="Refresh" title="Refresh" className={appButton('outline', 'md', 'w-9 px-0')}>
              {loading && data ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            </button>
          </>}
        />

        {error && !data ? (
          <Notice tone="error" className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <span>Your usage could not be loaded.</span>
            <button type="button" onClick={load} className={appButton('outline', 'sm')}>Try again</button>
          </Notice>
        ) : !data ? (
          <div aria-label="Loading" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map(i => <div key={i} className={cn(panelClass, 'h-[118px] motion-safe:animate-pulse')} />)}
          </div>
        ) : (
          <div className={cn('transition-opacity', loading && 'opacity-60')}>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat hero label="Credits left" value={number(data.balance)} note={data.balance < 20 ? 'Running low: ask the Batkle team for more.' : 'One per image; failed requests are refunded.'} />
              <Stat label={`Credits used, ${data.days} days`} value={number(data.totals.credits)} />
              <Stat label={`Requests, ${data.days} days`} value={number(data.totals.requests)} note={data.totals.errors ? `${number(data.totals.errors)} failed` : 'None failed'} />
              <Stat label="Active keys" value={number(activeKeys)} note={`${data.keys.length - activeKeys} revoked`} />
            </div>

            <SegmentedTabs className="mt-8 w-fit" label="Dashboard sections" value={tab} onChange={choose} items={[['usage', 'Usage'], ['keys', 'API keys', activeKeys], ['renders', 'Renders']]} />
            <div className="mt-5">
              {tab === 'usage' && <UsageTab data={data} onCreateKey={() => { choose('keys'); setFocusCreate(true) }} />}
              {tab === 'keys' && <KeysTab data={data} reload={load} focusCreate={focusCreate} />}
              {tab === 'renders' && <RenderLog />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
