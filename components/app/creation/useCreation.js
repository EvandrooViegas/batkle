'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { runPostGeneration } from '@/lib/client/postGeneration'
import { ideaStatus, retryCopy } from '@/lib/client/ideaStatus'

// Same shape as the saved flow.creationState, so existing ideas and posts load unchanged.
const EMPTY = { ideas: [], copyResults: {}, planResults: {}, resolveResults: {}, designResults: {} }
const RESULT_KINDS = ['copyResults', 'planResults', 'resolveResults', 'designResults']
const without = (obj, key) => { const { [key]: _removed, ...rest } = obj; return rest }

/**
 * State and actions for the Creation page: ideas, their post builds, and saving to the brand.
 * Saves are serialized and always send the latest state, so a slow save never overwrites a newer one.
 */
export function useCreation({ flowId, brandContext: suppliedBrand }) {
  const [savedBrand, setSavedBrand] = useState(null)
  const brandContext = useMemo(() => ({ ...(savedBrand || suppliedBrand), id: flowId || suppliedBrand?.id }), [savedBrand, suppliedBrand, flowId])
  const brandId = flowId ? `brand_${flowId}` : null

  const [data, setData] = useState(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [running, setRunning] = useState({})   // ideaId → stage running now
  const [failures, setFailures] = useState({}) // ideaId → { stage, message } from this session
  const [focusId, setFocusId] = useState(null) // the idea the user acted on last; shown in the featured card
  const [busy, setBusy] = useState(null)       // 'create' | 'suggest' while an idea is being written

  const dataRef = useRef(data)
  dataRef.current = data
  // Operator notices (such as an empty AI image account) are shown only to the signed-in Design Library admin.
  const operator = useRef(false)
  useEffect(() => {
    fetch('/api/global-designs/session').then(r => (r.ok ? r.json() : null)).then(s => { operator.current = !!s?.admin }).catch(() => {})
  }, [])
  const locks = useRef(new Set())
  const lastSaved = useRef(EMPTY)
  const saveQueue = useRef({ active: false, next: null })

  // Load fresh from the API rather than the page payload: the router cache can hold an older copy.
  useEffect(() => {
    if (!flowId) { setLoaded(true); return }
    let cancelled = false
    fetch(`/api/flows/${flowId}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(flow => {
        if (cancelled) return
        if (flow?.brandContext) setSavedBrand(flow.brandContext)
        const saved = flow?.creationState
        if (saved?.ideas?.length) {
          const next = { ideas: saved.ideas, ...Object.fromEntries(RESULT_KINDS.map(k => [k, saved[k] || {}])) }
          lastSaved.current = next
          setData(next)
        }
      })
      // Never save over ideas that failed to load.
      .catch(() => !cancelled && setLoadError(true))
      .finally(() => !cancelled && setLoaded(true))
    return () => { cancelled = true }
  }, [flowId])

  useEffect(() => {
    if (!loaded || loadError || !flowId || data === lastSaved.current) return
    lastSaved.current = data
    const queue = saveQueue.current
    queue.next = data
    if (queue.active) return
    queue.active = true
    ;(async () => {
      while (queue.next) {
        const creationState = queue.next
        queue.next = null
        try {
          const res = await fetch(`/api/flows/${flowId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creationState }) })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
        } catch (error) {
          console.warn('Failed to save creation state', error)
        }
      }
      queue.active = false
    })()
  }, [data, loaded, loadError, flowId])

  // Results for an idea deleted while it was building are dropped.
  const patch = useCallback((kind, id, value) => setData(d => !d.ideas.some(i => i.id === id) ? d : {
    ...d,
    [kind]: { ...d[kind], [id]: typeof value === 'function' ? value(d[kind][id]) : value },
  }), [])

  const statusOf = useCallback(id => ideaStatus({
    stage: running[id] || null,
    failure: failures[id] || null,
    copy: data.copyResults[id],
    plan: data.planResults[id],
    resolve: data.resolveResults[id],
    design: data.designResults[id],
  }), [running, failures, data])

  /** Runs PLAN → VISUALS → BUILD for one idea. Resolves true on success; throws on failure. */
  const build = useCallback(async (idea, { keepCopy = null } = {}) => {
    if (locks.current.has(idea.id)) return false
    locks.current.add(idea.id)
    setFocusId(idea.id)
    setFailures(f => without(f, idea.id))
    const reset = { loading: false, error: null }
    setData(d => ({
      ...d,
      copyResults: keepCopy ? d.copyResults : { ...d.copyResults, [idea.id]: { ...reset, copy: null } },
      planResults: { ...d.planResults, [idea.id]: { ...reset, plan: null } },
      resolveResults: { ...d.resolveResults, [idea.id]: { ...reset, resolved: null } },
      // The previous post stays visible until the new one is built.
      designResults: { ...d.designResults, [idea.id]: { canvas: null, ...d.designResults[idea.id], ...reset } },
    }))
    let current = 'content'
    try {
      await runPostGeneration({
        idea, brandContext, brandId, keepCopy,
        onStage: stage => { current = stage; setRunning(r => ({ ...r, [idea.id]: stage })) },
        onCopy: v => patch('copyResults', idea.id, v),
        onPlan: v => patch('planResults', idea.id, v),
        onResolve: v => patch('resolveResults', idea.id, v),
        // A failed rebuild keeps the last good post.
        onDesign: v => patch('designResults', idea.id, prev => (v.canvas ? v : { ...prev, ...v, canvas: prev?.canvas ?? null })),
        onWarning: message => toast.warning(message, { duration: 12000 }),
        onOperatorNotice: message => operator.current && toast.warning(message, { description: 'Only you see this, as the Design Library admin.', duration: 12000 }),
      })
      return true
    } catch (error) {
      setFailures(f => ({ ...f, [idea.id]: { stage: current, message: error.message } }))
      throw error
    } finally {
      locks.current.delete(idea.id)
      setRunning(r => without(r, idea.id))
    }
  }, [brandContext, brandId, patch])

  const startBuild = useCallback((idea, options) => {
    build(idea, options).then(ok => ok && toast.success('Post ready to edit')).catch(error => toast.error(error.message || 'Post could not be created'))
  }, [build])

  const retry = useCallback(idea => startBuild(idea, { keepCopy: retryCopy(statusOf(idea.id)) }), [startBuild, statusOf])
  const rebuildDesign = useCallback(idea => startBuild(idea, { keepCopy: data.copyResults[idea.id]?.copy || null }), [startBuild, data.copyResults])
  const newVersion = useCallback(idea => startBuild(idea), [startBuild])

  /**
   * Writes a new idea from the user's text (or a suggestion when it is empty) and attached photos (asset ids);
   * with andBuild, also creates the post. The post settings (slides, language, images, design) are kept on the
   * idea, so rebuilds follow them; 'auto' leaves each one to Batkle.
   */
  const createIdea = useCallback(async ({ request = '', format = 'auto', images = [], imageChoice = 'auto', slides = 'auto', designId = 'auto', language = null, andBuild = false }) => {
    if (busy) return null
    setBusy(andBuild ? 'create' : 'suggest')
    try {
      const recent = dataRef.current.ideas.slice(0, 30)
      const res = await fetch('/api/generate-content-ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandContext, flowId, userIdea: request, format, images,
          ...(slides !== 'auto' ? { slides } : {}),
          ...(language ? { language } : {}),
          existingTopics: recent.map(i => i.topic),
          // Slide counts let the next carousel run a different length: the plan, else the built post.
          existingIdeas: recent.map(i => ({ topic: i.topic, pillar: i.pillar, format: i.format, angle: i.angle, slides: i.outline?.length || (i.format === 'carousel' ? statusOf(i.id).slides : 0) || undefined })),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to create the idea')
      const written = json.ideas?.[0]
      if (!written) throw new Error('No idea returned')
      const idea = {
        ...written,
        ...(imageChoice === 'on' || imageChoice === 'off' ? { imageChoice } : {}),
        ...(designId && designId !== 'auto' ? { designId } : {}),
      }
      setData(d => ({ ...d, ideas: [idea, ...d.ideas] }))
      setFocusId(idea.id)
      if (andBuild) startBuild(idea)
      else toast.success('New idea added')
      return idea
    } catch (error) {
      toast.error(error.message || 'Something went wrong')
      return null
    } finally {
      setBusy(null)
    }
  }, [busy, brandContext, flowId, startBuild, statusOf])

  /** Builds several posts one after another, so a batch never multiplies concurrent AI requests. */
  const buildMany = useCallback(async ids => {
    const ideas = dataRef.current.ideas.filter(i => ids.has(i.id))
    if (!ideas.length) return
    toast.info(`Creating ${ideas.length} post${ideas.length > 1 ? 's' : ''}…`)
    let failed = 0
    for (const idea of ideas) {
      try { await build(idea) } catch { failed++ }
    }
    if (failed) toast.error(`${failed} of ${ideas.length} posts could not be created`)
    else toast.success(`${ideas.length} post${ideas.length > 1 ? 's' : ''} ready to edit`)
  }, [build])

  const deleteIdeas = useCallback(ids => {
    const keep = ([id]) => !ids.has(id)
    setData(d => ({
      ideas: d.ideas.filter(i => !ids.has(i.id)),
      ...Object.fromEntries(RESULT_KINDS.map(k => [k, Object.fromEntries(Object.entries(d[k]).filter(keep))])),
    }))
    setFailures(f => Object.fromEntries(Object.entries(f).filter(keep)))
    toast.success(`${ids.size} idea${ids.size > 1 ? 's' : ''} deleted`)
  }, [])

  const deleteAll = useCallback(() => {
    setData({ ...EMPTY })
    setFailures({})
    setFocusId(null)
    toast.success('Ideas cleared')
  }, [])

  // The featured card follows what the user did last, then any running build, then the newest finished post,
  // then the newest idea.
  const featuredId = useMemo(() => {
    if (focusId && data.ideas.some(i => i.id === focusId)) return focusId
    const runningId = Object.keys(running)[0]
    if (runningId) return runningId
    return data.ideas.find(i => data.designResults[i.id]?.canvas)?.id ?? data.ideas[0]?.id ?? null
  }, [focusId, running, data.ideas, data.designResults])

  return {
    brandContext, loaded, loadError, busy,
    ideas: data.ideas, copyResults: data.copyResults,
    statusOf, featuredId, isRunning: id => !!running[id], anyRunning: Object.keys(running).length > 0,
    createIdea, startBuild, retry, rebuildDesign, newVersion, buildMany, deleteIdeas, deleteAll,
  }
}
