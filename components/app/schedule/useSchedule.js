'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { startingCaption } from '@/lib/client/schedule'
import { apiError } from '@/lib/client/billing'
import { useAppShell } from '../AppShell'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

// A plan limit keeps its code on the error (apiError), so the dialog can offer the upgrade instead.
async function readJson(response, fallback) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw apiError(data, response.status, fallback)
  return data
}

/**
 * A brand's approved and scheduled posts (see /api/schedule) and the actions on them. Keeps the sidebar's
 * Schedule count (posts not yet marked posted) in step.
 */
export function useSchedule(flowId) {
  const { setCount } = useAppShell()
  const [entries, setEntries] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    setLoadError('')
    try {
      setEntries(await readJson(await fetch(`/api/schedule?flowId=${encodeURIComponent(flowId)}`, { cache: 'no-store' }), 'The schedule could not be loaded.'))
    } catch (error) {
      setLoadError(error.message)
    } finally {
      setLoaded(true)
    }
  }, [flowId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (loaded && !loadError) setCount('schedule', entries.filter(e => e.status !== 'posted').length)
  }, [entries, loaded, loadError, setCount])

  const put = entry => setEntries(list => [...list.filter(e => e.id !== entry.id), entry])

  /** Approves an idea's current post; resolves to the entry, or null when it failed (a toast says why). */
  const approve = useCallback(async ({ idea, canvas, copy }) => {
    try {
      const entry = await readJson(await fetch('/api/schedule', {
        method: 'POST', headers: JSON_HEADERS,
        body: JSON.stringify({ flowId, ideaId: idea.id, canvasId: canvas.id, topic: idea.topic, caption: startingCaption(copy) }),
      }), 'The post could not be approved. Please try again.')
      put(entry)
      return entry
    } catch (error) {
      toast.error(error.message)
      return null
    }
  }, [flowId])

  /** Saves changes to an entry; throws with a message for people when they can't be saved. */
  const update = useCallback(async (id, changes) => {
    const entry = await readJson(await fetch(`/api/schedule/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(changes) }), 'Your changes could not be saved. Please try again.')
    put(entry)
    return entry
  }, [])

  const remove = useCallback(async id => {
    await readJson(await fetch(`/api/schedule/${id}`, { method: 'DELETE' }), 'The post could not be removed. Please try again.')
    setEntries(list => list.filter(e => e.id !== id))
  }, [])

  const byIdea = useMemo(() => new Map(entries.map(e => [e.ideaId, e])), [entries])

  return { entries, loaded, loadError, byIdea, approve, update, remove, reload: load }
}
