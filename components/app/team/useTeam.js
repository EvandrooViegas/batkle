'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { apiError, isBillingCode } from '@/lib/client/billing'

async function call(path = '', { method = 'GET', body } = {}) {
  const res = await fetch('/api/teams' + path, { method, cache: 'no-store', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw apiError(data, res.status, 'Your team could not be loaded. Please try again.')
  return data
}

/**
 * Busy key and outcome around actions that each answer with the data as it is now. What happened is a toast; only a
 * plan limit stays on the page (`error`), where it offers the upgrade.
 */
function useActions(setInfo) {
  const [busy, setBusy] = useState(''), [error, setError] = useState(null)
  // `done` is the confirmation after it worked: text, or a function of the answer (which may show its own toast).
  const run = async (key, task, done) => {
    setBusy(key); setError(null)
    try {
      const next = await task()
      if (next) setInfo(next)
      const text = typeof done === 'function' ? done(next) : done
      if (text) toast.success(text)
      return next || true
    } catch (e) {
      if (isBillingCode(e?.code)) setError(e)
      else toast.error(e?.message || 'Something went wrong. Please try again.')
      return false
    } finally { setBusy('') }
  }
  return { busy, error, run }
}

// While an invitation email is this young and still on its way, the page asks again whether it arrived or bounced.
const WATCH_MS = 2 * 60_000
const WATCH_EVERY = 4000

const BOUNCED = 'This address doesn’t exist or can’t receive email, so the invitation bounced. Check it, remove the invitation and invite again.'

/**
 * One brand's people (/api/teams/brands/:flowId): the owner, everyone in it or invited with their role, and the
 * account's own role; and the actions on them. An invitation's toast follows its email: "Sending…" until the mail
 * provider says it was delivered or bounced. Nobody can tell a mailbox exists before mail is sent to it.
 */
export function useBrandTeam(flowId) {
  const [info, setInfo] = useState(null), [loadError, setLoadError] = useState('')
  const actions = useActions(setInfo)
  const base = `/brands/${encodeURIComponent(flowId)}`

  const load = useCallback(async () => {
    setLoadError('')
    try { setInfo(await call(base)) } catch (e) { setLoadError(e.message) }
  }, [base])
  useEffect(() => { load() }, [load])

  // Invitations whose toast is waiting on their email (member id → address), and what each email was at the last look.
  const pending = useRef(new Map())
  const seen = useRef(new Map())
  const settle = useCallback((id, email, delivery) => {
    pending.current.delete(id)
    if (delivery === 'bounced') toast.error(`${email} can’t receive the invitation`, { id, description: BOUNCED, duration: 15000 })
    else if (delivery === 'delivered') toast.success(`Invitation delivered to ${email}`, { id, description: 'They accept it after signing in to Batkle with that email.' })
    else toast.success(`Invitation sent to ${email}`, { id, description: 'It isn’t confirmed as delivered yet. If it bounces, the team list says so.' })
  }, [])
  useEffect(() => {
    for (const m of info?.members || []) {
      const before = seen.current.get(m.id)
      seen.current.set(m.id, m.delivery)
      if (m.delivery !== 'delivered' && m.delivery !== 'bounced') continue
      // An email that arrived or bounced since the invitation was made, its toast still waiting; or one bounced since
      // the last look on this page.
      if (pending.current.has(m.id) || (before === 'sent' && m.delivery === 'bounced')) settle(m.id, m.email, m.delivery)
    }
  }, [info, settle])

  // Ask again while a fresh invitation email is on its way.
  useEffect(() => {
    const waiting = (info?.members || []).some(m => m.delivery === 'sent' && Date.now() - new Date(m.invitedAt).getTime() < WATCH_MS)
    if (!waiting) return
    const timer = setTimeout(() => { call(base).then(setInfo, () => {}) }, WATCH_EVERY)
    return () => clearTimeout(timer)
  }, [info, base])

  const { run } = actions
  return {
    info, loadError, load, busy: actions.busy, error: actions.error,
    // `to` invites into another brand the account manages ({ flowId, name }): this page's list stays as it is, and
    // its email is followed on that brand's team page.
    invite: (email, role, to = null) => {
      const other = to && to.flowId !== flowId ? to : null
      const address = String(email).trim().toLowerCase()
      let emailed = false
      return run('invite', async () => {
        const next = await call(other ? `/brands/${encodeURIComponent(other.flowId)}/invite` : `${base}/invite`, { method: 'POST', body: { email, role } })
        emailed = Boolean(next?.emailed)
        return other ? null : next
      }, next => {
        if (!emailed) {
          toast.success(`${email} is invited${other ? ` to ${other.name}` : ''}`, { description: 'Ask them to sign in with that email and accept it under Teams & invitations.' })
          return
        }
        if (other) {
          toast.success(`Invitation to ${other.name} sent to ${email}`, { description: `They show in ${other.name}’s team, not this one.` })
          return
        }
        const member = next?.members?.find(m => m.email === address)
        if (!member || member.delivery === 'delivered' || member.delivery === 'bounced') { if (member) settle(member.id, email, member.delivery); else toast.success(`Invitation sent to ${email}`); return }
        // Followed until the mail provider answers (the list is asked again meanwhile); after that it says "sent".
        pending.current.set(member.id, email)
        seen.current.set(member.id, member.delivery)
        toast.loading(`Sending the invitation to ${email}…`, { id: member.id, description: 'Batkle checks that it arrives.' })
        setTimeout(() => { if (pending.current.has(member.id)) settle(member.id, email, 'sent') }, WATCH_MS + WATCH_EVERY)
      })
    },
    setRole: (member, role) => run(member.id, () => call(`${base}/members/${member.id}`, { method: 'PATCH', body: { role } }), `${member.name || member.email} is now ${role === 'admin' ? 'an admin' : role === 'editor' ? 'an editor' : 'a viewer'}.`),
    remove: member => run(member.id, () => call(`${base}/members/${member.id}`, { method: 'DELETE' }), member.status === 'active' ? `${member.name || member.email} no longer has this brand.` : 'Invitation taken back.'),
    leave: () => run('leave', () => call(`${base}/membership`, { method: 'DELETE' }).then(() => null)),
  }
}

/**
 * Every team the account is part of (/api/teams): invitations to its email, brands shared with it, its own brands'
 * teams; and answering invitations and leaving brands.
 */
export function useTeams() {
  const [info, setInfo] = useState(null), [loadError, setLoadError] = useState('')
  const actions = useActions(setInfo)
  const load = useCallback(async () => {
    setLoadError('')
    try { setInfo(await call()) } catch (e) { setLoadError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])
  const { run } = actions
  return {
    info, loadError, load, busy: actions.busy, error: actions.error,
    accept: inv => run(inv.id, () => call(`/invitations/${inv.id}/accept`, { method: 'POST', body: {} }), `You joined ${inv.brand.name}. It is in your brand list now.`),
    decline: inv => run(inv.id, () => call(`/invitations/${inv.id}`, { method: 'DELETE' }), 'Invitation declined.'),
    leave: brand => run(brand.flowId, () => call(`/brands/${brand.flowId}/membership`, { method: 'DELETE' }), `You left ${brand.brand.name}.`),
  }
}
