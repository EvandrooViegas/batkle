import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { corsify } from '@/lib/services/middleware'
import { billingError, billingErrorBody, chargeCredits, creditPeriod, creditsLeft, effectivePlan, loadBilling, refundCharge } from '@/lib/billing/account'
import { loadGenerationBrandContext } from '@/lib/services/generationBrandContext'
import { chooseBrandFamily } from '@/lib/designs/global/generation'
import { DesignLibraryError } from '@/lib/designs/global/store'
import { studyForPlanning, familyGrammar, familyImagery, familyPhotoLed } from '@/lib/designs/global/study'
import type { GlobalDesignFamily } from '@/lib/designs/global/types'
import { listItems, type ImageChoice } from '@/lib/designs/global/compose'
import { loadPostImages, postImageIds, uploadPlanningBlock, assignUploads, ideaForCopy, type PostImage } from '@/lib/services/postImages'
import { writeCopy, copyErrorResponse } from './copywritingHandler'
import { planAssets } from './assetPlannerHandler'

const COMPOSITION_GUIDE: Record<string, string> = {
  statement: 'one dominant headline with brief supporting copy, typography-led',
  stacked: 'headline and supporting copy stacked; with imagery the photo takes the opposite band (top or bottom)',
  split: 'copy in one column, photograph in the other',
  'image-led': 'photograph dominates; compact copy over or beside it',
  'backdrop-type': 'oversized low-opacity word behind smaller foreground copy',
  list: 'headline plus 2-6 short enumerated items (write the items as numbered body lines)',
  closing: 'the last slide only: the payoff headline, one short line and the call to action as its sign-off',
}

/** A transparent PNG already in the brand gallery that the plan may reuse; `ref` is the short id shown to the model. */
export interface GalleryCutout { ref: string; id: string; description: string }

const CUTOUT_SUBJECT = 'ONE isolated subject with no background (a person, hands, a product or an object doing or showing something concrete for this slide), complete silhouette, no scene, no backdrop, no text'

/** What the person chose for this post's images; anything else means the design decides. */
export function imageChoiceFor(idea: any): ImageChoice {
  return idea?.imageChoice === 'on' || idea?.imageChoice === 'off' ? idea.imageChoice : 'auto'
}

/** Planning instructions appended to the copy request. Only the saved study is sent, never reference images or coordinates. */
export function designPlanningPrompt(family: GlobalDesignFamily, gallery: GalleryCutout[] = [], uploads: PostImage[] = [], choice: ImageChoice = 'auto') {
  const study = studyForPlanning(family)
  // Images are AI-generated transparent cutouts; about one in five may become a stock photo of the same subject.
  // Studies built on a full-canvas photograph keep photographs, described as scenes.
  const photoLed = familyPhotoLed(family)
  const image = photoLed
    ? `{"subject": "one concrete, realistic scene for a full-bleed photograph behind the copy, with quiet space where the text sits", "queries": ["2-4 word English stock search", "alternative wording, same scene"]}`
    : `{"subject": "${CUTOUT_SUBJECT}", "queries": ["2-4 word English stock search for the same subject", "alternative wording"]${gallery.length ? ', "reuse": "gallery ref or omit"' : ''}}`
  const uploadImage = uploads.length ? ` or {"upload": "<user photo ref>"}` : ''
  const imageRule = photoLed
    ? 'This study is built on full-bleed photographs behind the copy: describe each image as a photographic scene.'
    : 'Images are AI-generated transparent cutouts (PNGs with no background standing on the design surface); describe each as one isolated subject. A few may become stock photographs of the same subject, so also give stock queries.'
  const galleryBlock = gallery.length && choice !== 'off' ? `
BRAND GALLERY CUTOUTS (transparent PNGs already made for this brand): ${gallery.map(g => `${g.ref} = "${g.description}"`).join('; ')}.
Prefer new subjects made for this post. Set "reuse" to a ref only when that cutout shows exactly the subject a slide needs, at most once per post; otherwise omit "reuse".` : ''
  // The person's image choice overrides the study's own image frequency.
  const imageryRule = choice === 'off'
    ? `IMAGES ARE OFF for this post: set "image" to null on every slide${uploads.length ? ' except a slide that shows a user photo' : ''}, and never choose image-led or split.`
    : choice === 'on'
      ? `IMAGES REQUESTED for this post: give every slide except list slides an image subject; the layout shows it where the composition carries imagery or, on typography-only layouts, in the space the copy leaves free. ${imageRule}`
      : `"image" must be null when imagery mode is "none"; image-led and split always need an image. Give every other slide an image subject too: the layout shows it where the composition carries imagery or where the copy leaves empty space, and ignores it otherwise. ${imageRule}`
  return `DESIGN PLAN (required in the same JSON). This post follows the saved design study below: a visual language, not a template. Brand colors, fonts, logo, sizes and coordinates are applied automatically later; never choose them.
DESIGN STUDY: ${JSON.stringify(study)}
COMPOSITIONS this study allows: ${study.compositions.map(c => `"${c}" = ${COMPOSITION_GUIDE[c]}`).join('; ')}.
Add "design" to every carousel slide (for a single post, add a top-level "design"):
"design": {"composition": "<one of ${study.compositions.join(', ')}>", "emphasis": ["the one word from the headline that carries its tension or its concrete detail, exactly as written (two at most; never a filler word or the brand name)"], "image": null or ${image}${uploadImage}}
Rules: choose the composition that serves each slide's content, and vary compositions across a carousel while respecting the recurring rules; never give every slide the same composition unless the study demands it.${study.compositions.includes('closing') ? ' The last carousel slide uses "closing", and no other slide does.' : ''} ${imageryRule} Image subjects are written in English. Never put words, logos or brand marks in image subjects. Avoid the anti-patterns.${galleryBlock}${uploadPlanningBlock(uploads)}`
}

/** A short subject label for a saved cutout. Descriptions that are generation instructions, not subjects, give ''. */
export function cutoutLabel(description: any): string {
  const text = String(description || '').replace(/\s+/g, ' ').trim()
  if (!text || /^(choose|create|generate|carrossel|carousel)\b/i.test(text)) return ''
  return text.replace(/^object-only:\s*/i, '').split(/,\s*(?:no|without)\s/i)[0].replace(/"/g, "'").slice(0, 110).trim()
}

/** The brand's reusable transparent cutouts, most recently used first, one per subject. Never fails planning. */
export async function galleryCutouts(db: any, flowId: string | undefined): Promise<GalleryCutout[]> {
  if (!flowId || !db) return []
  try {
    const assets = await db.collection('assets').find({ brand_id: `brand_${flowId}`, source: 'ai_generated', status: 'ready', treatment: 'isolated_subject' }, { projection: { _id: 0, id: 1, description: 1, subject_description: 1 } })
      .sort({ last_used_at: -1, created_at: -1 }).limit(40).toArray()
    const seen = new Set<string>(), listed: { id: string; description: string }[] = []
    for (const asset of assets) {
      const description = cutoutLabel(asset.subject_description || asset.description)
      if (!asset.id || !description || seen.has(description.toLowerCase())) continue
      seen.add(description.toLowerCase()); listed.push({ id: asset.id, description })
    }
    return listed.slice(0, 24).map((a, i) => ({ ref: `g${i + 1}`, ...a }))
  } catch { return [] }
}


/**
 * Deterministically keeps only plan values that the study supports. Invalid choices fall back to rule-based composition.
 * The user's photos are then placed: each on exactly one slide (see assignUploads).
 */
export function sanitizeDesignPlan(family: GlobalDesignFamily, copy: any, gallery: GalleryCutout[] = [], uploads: PostImage[] = [], choice: ImageChoice = 'auto') {
  const allowed = new Set(familyGrammar(family).compositions as string[])
  const imageryOn = familyImagery(family).mode !== 'none'
  const reused = new Set<string>()
  const clean = (slide: any) => {
    const raw = slide?.design && typeof slide.design === 'object' ? slide.design : {}
    const composition = allowed.has(raw.composition) ? raw.composition : undefined
    const headline = String(slide?.headline || '').toLowerCase().split(/\s+/)
    const emphasis = (Array.isArray(raw.emphasis) ? raw.emphasis : []).map((w: any) => String(w).trim()).filter((w: string) => w && headline.includes(w.toLowerCase())).slice(0, 2)
    // Text compositions keep their subject: it fills the empty space the copy leaves, when there is any.
    // "With images" keeps subjects even on typography-only studies; "No images" drops them.
    const wantsImage = choice === 'off' ? false : imageryOn || choice === 'on'
    // A reuse names a listed gallery cutout (short ref, or its id when re-planning saved copy). New images are
    // preferred, so a post reuses at most one.
    const pick = raw.image?.reuse && wantsImage ? gallery.find(g => g.ref === raw.image.reuse || g.id === raw.image.reuse) : undefined
    const reuse = pick && !reused.size ? pick : undefined
    if (reuse) reused.add(reuse.id)
    const subject = typeof raw.image?.subject === 'string' && raw.image.subject.trim() ? raw.image.subject.trim() : reuse?.description || ''
    // A user photo ref is kept as given here; assignUploads validates it and enforces one slide per photo.
    // The user's own photos show even when images are switched off.
    const upload = typeof raw.image?.upload === 'string' && raw.image.upload ? raw.image.upload : undefined
    const image = raw.image && (upload || (wantsImage && subject))
      ? { subject: subject.slice(0, 500), queries: (Array.isArray(raw.image.queries) ? raw.image.queries : []).filter((q: any) => typeof q === 'string' && q.trim()).map((q: string) => q.trim().slice(0, 80)).slice(0, 3), ...(reuse && !upload ? { reuse: reuse.id } : {}), ...(upload ? { upload } : {}) }
      : null
    const { design, ...rest } = slide
    return { ...rest, ...(emphasis.length ? { emphasis } : {}), design: { ...(composition ? { composition } : {}), image } }
  }
  const place = (slides: any[]) => uploads.length || slides.some(s => s.design?.image?.upload)
    ? assignUploads(slides, uploads, familyGrammar(family).compositions as string[], s => listItems(s).length >= 3).slides
    : slides
  if (Array.isArray(copy.slides) && copy.slides.length) return { ...copy, slides: place(copy.slides.map(clean)) }
  return place([clean(copy)])[0]
}

/** Uploaded photos that no slot of the asset plan shows. */
export function unplacedUploads(plan: any, uploads: PostImage[]) {
  const shown = new Set((plan?.slots || []).filter((s: any) => s.user_upload && s.selected?.asset_id).map((s: any) => s.selected.asset_id))
  return uploads.filter(u => !shown.has(u.id))
}

/**
 * The fewest slides this post can have, known before anything is written: the kept copy's slides, or the number of
 * slides chosen for the idea. Otherwise 1, since the copywriter picks the length.
 */
export function minimumSlides(idea: any, copy?: any): number {
  if (copy) return Array.isArray(copy.slides) && copy.slides.length ? copy.slides.length : 1
  const chosen = Number(idea?.slideCount)
  return idea?.format !== 'single' && Number.isInteger(chosen) && chosen > 1 ? chosen : 1
}

/** What a post costs: one credit per slide, since every slide gets its own image. The plan has one slot per slide. */
export function postCredits(plan: any): number {
  return Math.max(1, Array.isArray(plan?.slots) ? plan.slots.length : 0)
}

const plural = (n: number) => (n === 1 ? '' : 's')

/** Refuses with the same insufficient_credits error chargeCredits gives when fewer than `credits` are left. */
async function requireCredits(db: any, userId: string, credits: number) {
  const account = await loadBilling(db, userId)
  const left = creditsLeft(account).total
  if (left >= credits) return
  const plan = effectivePlan(account)
  throw billingError(402, 'insufficient_credits',
    left
      ? `This needs ${credits} credit${plural(credits)} and you have ${left} left. Buy extra credits or upgrade your plan to keep creating.`
      : `You've used all your credits${plan.id === 'free' ? ' for this month' : ''}. Buy extra credits or upgrade your plan to keep creating.`,
    { needed: credits, available: left, plan: plan.id, renewsAt: creditPeriod(new Date(account.creditAnchor)).end })
}

/**
 * PLAN: one model call returns copy + composition plan; asset needs are derived in code.
 * Existing copy can be re-planned with zero model calls.
 *
 * With `userId` (every request from the app), the post is paid for here, one credit per slide, re-plans of kept copy
 * too since they make new images. An account without enough credits is refused before the model call. The charge's
 * `chargeRef` goes back to the client, which sends it to /resolve-assets and /design-canvas: they refuse to make
 * images or the post without it, and give the credits back when they fail.
 */
export async function handlePlanPost(db: any, body: any, userId?: string) {
  let charge: any = null
  try {
    const { idea } = body
    if (!idea) return corsify(NextResponse.json({ error: 'idea (content brief) is required' }, { status: 400 }))
    const brandContext = await loadGenerationBrandContext(db, body)
    if (!brandContext) return corsify(NextResponse.json({ error: 'Brand not found' }, { status: 400 }))
    if (userId) await requireCredits(db, userId, minimumSlides(idea, body.copy))
    // Photos attached to the idea, re-read from the brand's records (never trusted from the request).
    const uploads = await loadPostImages(db, brandContext.id, postImageIds((idea.images || []).map((i: any) => i?.id)), idea.id)
    const choice = imageChoiceFor(idea)
    // A design picked in the composer is kept on the idea, so every rebuild uses it.
    const { designId: pickedDesign, ...ideaFields } = idea
    let designId = body.designId || (typeof pickedDesign === 'string' && pickedDesign ? pickedDesign : undefined)
    // "With images" prefers a design that shows imagery, as attached photos do.
    const imagery = uploads.length > 0 || choice === 'on'
    let selection
    try {
      selection = await chooseBrandFamily(db, brandContext, body.copy || idea, designId, { imagery })
    } catch (error) {
      // The picked design was removed from the brand since: the post falls back to Auto.
      if (!(error instanceof DesignLibraryError) || body.designId || !designId) throw error
      designId = undefined
      selection = await chooseBrandFamily(db, brandContext, body.copy || idea, undefined, { imagery })
    }
    if (uploads.length && selection && familyImagery(selection.family).mode === 'none') {
      return corsify(NextResponse.json({ error: designId
        ? 'The design you picked uses typography only, so it cannot show your photos. Pick a design with images in the post settings, or Auto.'
        : 'The designs selected for this brand use typography only, so they cannot show your photos. Add a design with images in Brand profile → Post design.' }, { status: 422 }))
    }
    // Saved transparent cutouts are offered whenever the post may use imagery, since most images are cutouts.
    const gallery = selection && choice !== 'off' && (familyImagery(selection.family).mode !== 'none' || choice === 'on') ? await galleryCutouts(db, brandContext.id) : []
    const brief = ideaForCopy(ideaFields, uploads)
    let copy = body.copy
    if (!copy) {
      if (selection) {
        const allowed = new Set(familyGrammar(selection.family).compositions as string[])
        const design = { prompt: designPlanningPrompt(selection.family, gallery, uploads, choice), validate: (parsed: any) => {
          const slides = parsed.format === 'carousel' ? parsed.slides : [parsed]
          if (!slides.some((s: any) => allowed.has(s?.design?.composition))) throw Error('Missing "design" plan with a valid composition')
        } }
        copy = sanitizeDesignPlan(selection.family, (await writeCopy(brandContext, brief, design)).copy, gallery, uploads, choice)
      } else copy = (await writeCopy(brandContext, brief)).copy
    } else if (selection) copy = sanitizeDesignPlan(selection.family, copy, gallery, uploads, choice)
    // The choice travels with the copy, so planning, image search and the final build all follow it.
    const { imageChoice: _previous, ...rest } = copy
    copy = choice === 'auto' ? rest : { ...rest, imageChoice: choice }
    const plan = await planAssets(db, { brandContext, copy, idea, uploads, brand_id: `brand_${brandContext.id}`, designId: selection?.design.id || designId })
    const unplaced = unplacedUploads(plan, uploads)
    // A plan's idea ID repeats on every rebuild, so each charge gets its own reference.
    let paid = {}
    if (userId) {
      const chargeRef = `post_${randomUUID()}`
      charge = await chargeCredits(db, userId, postCredits(plan), { reason: 'post', ref: chargeRef })
      paid = { chargeRef, credits: { charged: charge.credits, left: creditsLeft(await loadBilling(db, userId)).total } }
    }
    return corsify(NextResponse.json({ copy, plan, needsVisuals: plan.slots.some((s: any) => s.needs_visual), imageMode: plan.layoutPlan?.imageMode || null, unplacedImages: unplaced.length, ...paid }))
  } catch (error: any) {
    // Credits taken for a plan that never reached the client are given back.
    if (charge) await refundCharge(db, userId!, charge.id).catch(() => {})
    const billing = error?.billing ? billingErrorBody(error) : null
    if (billing) return corsify(NextResponse.json(billing, { status: error.status }))
    return copyErrorResponse(error, 'Post planning failed')
  }
}
