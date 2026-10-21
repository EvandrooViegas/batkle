'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiError } from '@/lib/client/billing'

async function call(path = '', { method = 'GET', body } = {}) {
  const res = await fetch('/api/teams' + path, { method, cache: 'no-store', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw apiError(data, res.status, 'Your team could not be loaded. Please try again.')
  return data
}

/**
 * The account's team (/api/teams): its own team with the people in it, the teams it belongs to and the invitations
 * waiting for its email; and the actions on them. Each action answers with the team as it is now.
 */
export function useTeam() {
  const [info, setInfo] = useState(null), [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(''), [error, setError] = useState(null), [status, setStatus] = useState('')

  const load = useCallback(async () => {
    setLoadError('')
    try { setInfo(await call()) } catch (e) { setLoadError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  // `done` is the confirmation shown after it worked: text, or a function of the answer.
  const run = async (key, task, done) => {
    setBusy(key); setError(null); setStatus('')
    try { const next = await task(); if (next) setInfo(next); if (done) setStatus(typeof done === 'function' ? done(next) : done); return true }
    catch (e) { setError(e); return false }
    finally { setBusy('') }
  }

  return {
    info, loadError, load, busy, error, status,
    invite: address => run('invite', () => call('/invite', { method: 'POST', body: { email: address } }), next => (next?.emailed ? `Invitation sent to ${address}.` : `${address} is invited. Ask them to sign in with that email and open Team to accept.`)),
    rename: name => run('rename', () => call('', { method: 'PATCH', body: { name } }), 'Team renamed.'),
    remove: member => run(member.id, () => call(`/members/${member.id}`, { method: 'DELETE' }), member.status === 'active' ? `${member.email} is no longer in the team.` : 'Invitation taken back.'),
    accept: inv => run(inv.id, () => call(`/invitations/${inv.id}/accept`, { method: 'POST', body: {} }), `You joined ${inv.team.name}.`),
    decline: inv => run(inv.id, () => call(`/invitations/${inv.id}`, { method: 'DELETE' }), 'Invitation declined.'),
    leave: membership => run(membership.id, () => call(`/memberships/${membership.id}`, { method: 'DELETE' }), `You left ${membership.name}.`),
    deleteTeam: () => run('delete', () => call('', { method: 'DELETE' }), 'Team deleted.'),
  }
}
