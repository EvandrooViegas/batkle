// Client side of post generation: PLAN → (VISUALS) → BUILD, one request per real stage.
import { apiError } from './billing'

/** POSTs JSON; a failed response throws an Error that keeps a plan limit's `code` and `billing` (see apiError). */
export async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw apiError(data, res.status)
  return data
}

/** Tells the credits meter (AppShell) to read the balance again. */
export function creditsChanged() {
  if (typeof window !== 'undefined' && typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent('bk:credits-changed'))
}

/** The VISUALS result for a design study that uses no imagery: every slide without an image, nothing searched. */
export function skippedVisuals(plan) {
  return { designId: plan.designId, layoutPlan: plan.layoutPlan, post_id: plan.post_id, format: plan.format, slots: plan.slots.map(s => ({ slot_id: s.slot_id, slot_label: s.slot_label, needs_visual: false, visual_purpose: '', source: 'none', resolvedAsset: null, warning: null })) }
}

/**
 * PLAN makes the post's single model call (copy + composition plan); VISUALS runs only when the selected
 * design study needs imagery; BUILD creates and validates the editable canvas.
 * With keepCopy, the existing copy is re-planned without a model call.
 * PLAN takes the post's credits (one per slide) and answers with `chargeRef`, which the next two stages need; when
 * either fails, the server gives the credits back. A plan limit fails with the error's `code` set.
 */
export async function runPostGeneration({ idea, brandContext, brandId, keepCopy, onStage, onCopy, onPlan, onResolve, onDesign, onWarning = () => {}, onOperatorNotice = () => {} }) {
  onStage('content')
  let planned
  try {
    planned = await postJson('/api/plan-post', { brandContext, flowId: brandContext?.id, idea, ...(keepCopy ? { copy: keepCopy } : {}) })
    onCopy({ loading: false, error: null, copy: planned.copy })
    onPlan({ loading: false, error: null, plan: planned.plan, layoutPlan: planned.plan.layoutPlan })
  } catch (err) {
    onPlan({ loading: false, error: err.message, plan: null })
    // Out of credits: the meter shows where the account stands.
    if (err.code) creditsChanged()
    throw err
  }
  if (planned.credits) creditsChanged()
  const { chargeRef } = planned
  if (planned.unplacedImages) {
    onWarning(`${planned.unplacedImages} of your photos had no slide to go on, so ${planned.unplacedImages === 1 ? 'it was' : 'they were'} left out. Try Carousel or fewer photos.`)
  }

  let resolved
  if (planned.needsVisuals) {
    onStage('visuals')
    try { resolved = await postJson('/api/resolve-assets', { plan: planned.plan, brand_id: brandId, chargeRef }) }
    catch (err) { onResolve({ loading: false, error: err.message, resolved: null }); creditsChanged(); throw err }
  } else {
    // The studied design uses no imagery: no search or generation is requested.
    resolved = skippedVisuals(planned.plan)
  }
  onResolve({ loading: false, error: null, resolved, skipped: !planned.needsVisuals })
  // An empty OpenAI account blocks every AI image. Only whoever runs Batkle can fix that, so it is an operator
  // notice: people using Batkle are not told, since their post is still made with the fallback images.
  if (resolved.slots?.some(s => /no credits left/i.test(s.warning || ''))) {
    onOperatorNotice('The OpenAI account has no credits left (add credits at platform.openai.com → Billing). Images were generated with fal or Pollinations, or taken from stock, instead.')
  }

  onStage('build')
  try {
    const canvas = await postJson('/api/design-canvas', { brandContext, copy: planned.copy, resolvedPlan: resolved, canvasName: `${brandContext?.name ?? ''} — ${idea.topic}`.trim(), chargeRef })
    onDesign({ loading: false, error: null, canvas })
    return canvas
  } catch (err) { onDesign({ loading: false, error: err.message, canvas: null }); throw err }
  finally { creditsChanged() }
}
