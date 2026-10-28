// What the Creation page shows for each idea, derived from its saved results and the build running now.

export const STAGE_ORDER = ['content', 'visuals', 'build']

/**
 * @param {object} input
 * @param {string|null} input.stage    stage running now ('content' | 'visuals' | 'build'), if any
 * @param {object|null} input.failure  { stage, message } from a build that failed in this session
 * @param {object} input.copy, input.plan, input.resolve, input.design  saved per-idea results
 */
export function ideaStatus({ stage = null, failure = null, copy: copyState, plan: planState, resolve: resolveState, design: designState } = {}) {
  const copy = copyState?.copy ?? null
  const plan = planState?.plan ?? null
  const resolved = resolveState?.resolved ?? null
  const canvas = designState?.canvas ?? null
  // Errors saved by an earlier session still count, so a reload does not hide a failed build.
  const saved = planState?.error ? ['content', planState.error]
    : copyState?.error ? ['content', copyState.error]
    : resolveState?.error ? ['visuals', resolveState.error]
    : designState?.error ? ['build', designState.error]
    : null
  const failedStage = stage ? null : failure?.stage || saved?.[0] || null
  const error = stage ? null : failure?.message || saved?.[1] || null
  const noVisuals = resolveState?.skipped === true || (plan ? !plan.slots?.some(s => s.needs_visual) : false)
  // A built post implies the earlier stages ran; older saved posts keep only the canvas.
  const built = !!canvas && !stage
  const done = { content: !!plan || built, visuals: !!resolved || built, build: built }
  const active = stage ? STAGE_ORDER.indexOf(stage) : -1

  const steps = STAGE_ORDER.map((key, index) => {
    if (stage === key) return { key, state: 'active' }
    // While building, nothing after the running stage is finished yet, even if an older post exists.
    if (active >= 0 && index > active) return { key, state: 'pending' }
    if (failedStage === key) return { key, state: 'error' }
    if (key === 'visuals' && noVisuals && done.content) return { key, state: 'skipped' }
    return { key, state: done[key] ? 'done' : 'pending' }
  })

  const phase = stage ? 'building' : failedStage ? 'failed' : canvas ? 'ready' : 'idea'
  const slides = canvas ? (canvas.type === 'carousel' ? canvas.pages?.length || 0 : 1) : 0
  return { phase, stage, failedStage, error, steps, copy, canvas, slides }
}

/** Ideas matching a toolbar filter. `statusOf(id)` returns ideaStatus for an idea. */
export function filterIdeas(ideas, filter, statusOf) {
  switch (filter) {
    case 'building': return ideas.filter(i => statusOf(i.id).phase === 'building')
    case 'ready': return ideas.filter(i => statusOf(i.id).phase === 'ready')
    // Carousels and single posts are feed posts; stories have their own filter.
    case 'carousel': return ideas.filter(i => i.format === 'carousel' && i.surface !== 'story')
    case 'single': return ideas.filter(i => i.format !== 'carousel' && i.surface !== 'story')
    case 'story': return ideas.filter(i => i.surface === 'story')
    default: return ideas
  }
}

/** Copy to keep when retrying: a failure after the content stage rebuilds without writing again. */
export function retryCopy(status) {
  return status.failedStage && status.failedStage !== 'content' ? status.copy : null
}
