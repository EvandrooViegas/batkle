import { DesignLibraryError, hydrateBrandFamilies, usableFamilyIds } from './store'
import { upgradeToUseError, type Viewer } from './access'
import { loadViewer } from './viewer'
import { familyImagery, familyGrammar } from './study'
import { planSlides, composeSlide, imageFrame, imageChoiceOf } from './compose'
import { validatePost } from './validate'
import type { GlobalDesignFamily } from './types'

/**
 * `content` can be the idea (before copy exists) or the copy; selection is stable for the same text.
 * With `imagery`, designs that show images are preferred (the user attached photos to the post).
 */
export async function chooseBrandFamily(db: any, brand: any, content: any, designId?: string, options: { imagery?: boolean; viewer?: Viewer; userId?: string } = {}) {
  // Explicit legacy selections keep older posts and saved designs editable.
  if (designId && !designId.startsWith('global-')) return null
  const selectedFamilies = await hydrateBrandFamilies(db, brand)
  // With the account known, only designs it may use: a member's design on a Free plan (kept from a trial) is skipped,
  // and asked for by name it offers the upgrade.
  const viewer = options.viewer || (options.userId ? await loadViewer(db, options.userId) : null)
  const allowed = viewer ? await usableFamilyIds(db, viewer, selectedFamilies.map(f => f.family.id)) : null
  const hydrated = allowed ? selectedFamilies.filter(f => allowed.has(f.family.id)) : selectedFamilies
  if (designId && allowed && selectedFamilies.some(f => f.design.id === designId) && !hydrated.some(f => f.design.id === designId)) throw upgradeToUseError()
  const pictured = options.imagery && !designId ? hydrated.filter(f => familyImagery(f.family).mode !== 'none') : []
  const families = pictured.length ? pictured : hydrated
  // Brands that have not opted into the Global Design Library continue to use their saved legacy/starter designs.
  // One selected study is enough: it composes varied layouts by itself.
  if (!families.length) return null
  // `lastCover` is the composition the brand's last post in that design opened with, so the next can open differently.
  const recent = await recentBrandPosts(db, brand?.id, 8)
  const withCover = <T extends { design: any }>(f: T) => ({ ...f, lastCover: recent.find(p => p.designId === f.design.id)?.cover })
  if (designId) {
    const requested = families.find(f => f.design.id === designId)
    if (!requested) throw new DesignLibraryError('This design is not in the brand’s library.', 404)
    return withCover(requested)
  }
  // The brand's designs take turns: one used by its last posts waits until the others have had a post, so
  // consecutive posts never come out in the same design.
  const used = recent.slice(0, families.length - 1).map(p => p.designId)
  const fresh = families.filter(f => !used.includes(f.design.id))
  // Imagery belongs to the design study, so brand image preferences play no part here.
  const text = JSON.stringify(content).toLowerCase()
  const ranked = (fresh.length ? fresh : families).map(f => ({ ...f, score: f.family.tags.reduce((n, tag) => n + (text.includes(tag.toLowerCase()) ? 2 : 0), 0) }))
  ranked.sort((a, b) => b.score - a.score)
  // Among equally fitting designs, the same copy picks the same one.
  const top = ranked.filter(f => f.score === ranked[0].score)
  const hash = [...text].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 0)
  const { score, ...picked } = top[hash % top.length]
  return withCover(picked)
}

/** The brand's latest Global Design posts, newest first: the design of each and the composition it opened with. */
export async function recentBrandPosts(db: any, brandId: string | undefined, limit: number): Promise<{ designId?: string; cover?: string }[]> {
  if (!brandId) return []
  try {
    const posts = await db.collection('canvases')
      .find({ flowId: brandId, 'designSelection.source': 'global' }, { projection: { _id: 0, 'designSelection.id': 1, 'designInput.resolvedPlan.layoutPlan.slots.composition': 1 } })
      .sort({ createdAt: -1 }).limit(limit).toArray()
    return posts.map((p: any) => ({ designId: p.designSelection?.id, cover: p.designInput?.resolvedPlan?.layoutPlan?.slots?.[0]?.composition }))
  } catch (error) {
    // History only adds variety; a post is never refused for want of it.
    console.warn('[designs] recent posts unavailable:', (error as Error).message)
    return []
  }
}

const slidesOf = (copy: any) => Array.isArray(copy.slides) && copy.slides.length ? copy.slides : [copy]

/**
 * Deterministic: the study grammar decides each slide's composition and whether it carries imagery. No model call.
 * A text slide whose copy leaves a large empty band also gets an AI cutout there, when the plan gave it a subject.
 */
export function globalLayoutPlan(family: GlobalDesignFamily, designId: string, copy: any, brand: any = {}) {
  const slides = slidesOf(copy)
  const imagery = familyImagery(family), grammar = familyGrammar(family), choice = imageChoiceOf(copy)
  const plans = planSlides(family, copy).map((plan, index) => {
    const slide = slides[index], subject = slide?.design?.image?.subject
    // "No images" never adds one; "With images" adds cutouts even to a typography-only study.
    if (plan.withImage || choice === 'off' || (imagery.mode === 'none' && choice !== 'on') || plan.composition === 'backdrop-type' || !subject) return plan
    try {
      const content = { ...slide, cta: slide.cta || '' }
      const free = composeSlide(family, brand, content, plan, index, slides.length, { preview: true }).free
      return free ? { ...plan, withImage: true, cutout: true, fill: true, fillBox: free.box, fillSide: free.side } as any : plan
    } catch { return plan }
  })
  const behaviour = [imagery.usage, imagery.cropBehavior, imagery.subjectPlacement, imagery.textRelationship].filter(Boolean).join(' ')
  const slots = slides.map((slide: any, index: number) => {
    const plan: any = plans[index], frame = plan.fill ? plan.fillBox : imageFrame(family, plan)
    const mode = !frame ? 'none' : plan.cutout ? 'cutout' : frame.width * frame.height >= family.width * family.height * .8 ? 'background' : 'contained'
    const role = `Imagery ${grammar.imagery.dominance === 'dominates' ? 'dominates the composition' : grammar.imagery.dominance === 'supports' ? 'supports the typography' : 'shares the composition with typography'}.`
    const grounded = !!frame && frame.y + frame.height >= family.height - 1 && plan.imagePos !== 'top'
    const brief = !frame ? '' : plan.fill
      ? `Transparent PNG cutout that complements the copy of a ${family.width}×${family.height} slide: one isolated subject with no background, standing in the empty ${plan.fillSide === 'top' ? 'area above the headline' : 'area below the copy, on the bottom edge of the design'} (about ${frame.width}×${frame.height}). ${plan.fillSide === 'bottom' ? 'The subject may be cut off by the bottom edge of the image, but its top, left and right contours stay complete. ' : ''}No text, frame, backdrop or scenery.`
      : mode === 'cutout'
      ? `Transparent PNG cutout for a ${family.width}×${family.height} composition: one isolated subject with no background, placed in a ${frame.width}×${frame.height} area (${Math.round(frame.width / frame.height * 100) / 100}:1) ${grounded ? 'standing on the bottom edge of the design' : 'beside the copy'}. ${grounded ? 'The subject may be cut off by the bottom edge of the image (a person from the waist up, a hand or object rising from below), but its top, left and right contours stay complete. ' : ''}${role} ${behaviour} No text, frame, backdrop or scenery.`
      : `Photograph for a ${family.width}×${family.height} composition, filling a ${frame.width}×${frame.height} area (${Math.round(frame.width / frame.height * 100) / 100}:1). ${role} ${behaviour} Keep the areas behind text quiet; do not put typography in the image.`
    return {
      slot_id: slides.length > 1 ? `slide_${index + 1}` : 'single_main', composition: plan.composition, plan, imageMode: mode,
      needs_visual: !!frame, background: mode === 'background', frame,
      treatment: mode === 'cutout' ? 'isolated_subject' : 'environmental',
      // AI images exist only as transparent cutouts: a photo slot with no fitting gallery or stock photo may use one instead.
      cutoutFallback: mode === 'background' || mode === 'contained',
      planned: frame ? slide.design?.image || null : null,
      brief: brief.slice(0, 1400),
      spec: { composition: plan.composition, background: { type: mode === 'background' ? 'image' : 'solid', color: 'bg' }, elements: frame ? [{ type: 'image', ...frame }] : [] },
    }
  })
  return { version: 4, source: 'global', familyId: family.id, familyVersion: family.version, designId, width: family.width, height: family.height, format: slides.length > 1 || copy.format === 'carousel' ? 'carousel' : 'single', imageMode: imagery.mode, imageDisposition: slots.some((s: any) => s.needs_visual) ? 'background' : 'none', slots }
}

/** Compose → validate. Copy that cannot fit its composition is tried in a calmer composition of the same study before failing. */
export function renderGlobalPost(family: GlobalDesignFamily, brand: any, copy: any, resolvedPlan: any, design: any, id: () => string, name?: string) {
  const layout = globalLayoutPlan(family, design.id, copy, brand)
  const slides = slidesOf(copy)
  const grammar = familyGrammar(family)
  const notes: string[] = []
  const pages = slides.map((slide: any, index: number) => {
    const slot = layout.slots[index]
    const resolved = resolvedPlan.slots?.find((s: any) => s.slot_id === slot.slot_id) || resolvedPlan.slots?.[index]
    const asset = resolved?.resolvedAsset
    // A photo slot the resolver filled with a generated cutout is composed as a cutout.
    const wantsCutout = slot.imageMode === 'cutout' || (slot.needs_visual && resolved?.treatment === 'isolated_subject')
    // An image whose subject could not be cut out (prepareSubjectAssets says so in the slot warning) is opaque: a studio
    // shot from a provider without transparency, or a busy photo. Placed like a cutout it reads as a grey box, so it is
    // framed as a photo card instead; an optional fill cutout is simply left out.
    const opaque = wantsCutout && !!asset?.url && !asset.subject?.url && /Subject isolation failed/.test(resolved?.warning || '')
    const cutout = wantsCutout && !opaque
    // A cutout needs a transparent image: an AI PNG, or a photo whose subject was cut out. A photo that could not be
    // cut out is never placed as if it were one.
    const usable = !cutout || !!asset?.subject?.url || asset?.source === 'ai_generated'
    const image = slot.needs_visual && usable && !(opaque && slot.plan.fill) ? (cutout && asset?.subject?.url) || asset?.url || '' : ''
    const imageSize = cutout && asset ? (asset.subject?.url ? asset.subject : asset.width && asset.height ? asset : undefined) : undefined
    // A slide shows only its own CTA; the post-level CTA belongs to the caption, not to every last slide.
    const content = { ...slide, cta: slide.cta || '' }
    // No image could be found or generated: the slide keeps the study's typography instead of failing the whole post.
    const textOnly = (['statement', 'closing', 'backdrop-type', 'stacked'] as const).find(c => (grammar.compositions as string[]).includes(c)) || 'statement'
    // A fill cutout is optional: without its image the slide is simply the text layout it already was.
    const fill = !!slot.plan.fill
    if (slot.needs_visual && !image && !fill) notes.push(`${slides.length > 1 ? `Slide ${index + 1}: ` : ''}no fitting image was available${resolved?.warning ? ` (${resolved.warning})` : ''}, so it was composed without imagery.`)
    const noFill = { ...slot.plan, withImage: false, cutout: false, fill: false }
    if (opaque && image) notes.push(`${slides.length > 1 ? `Slide ${index + 1}: ` : ''}the image could not be cut out, so it is shown framed.`)
    const base = slot.needs_visual && !image ? (fill ? noFill : { ...slot.plan, withImage: false, cutout: false, composition: textOnly }) : { ...slot.plan, cutout, ...(opaque ? { photo: 'card' } : {}) }
    // Fallbacks keep the slide's imagery decision, so the study's image behaviour is never swapped:
    // optional ornaments (logo badge, callout card) give way first, then a calmer composition.
    const plain = { ...base, badge: false, callout: false }
    // A layout variant (lead number, band, grid, photo card) gives way before the composition does.
    const classic = { ...plain, variant: 'classic', listStyle: 'rows', photo: 'bleed' }
    const varied = (base.variant && base.variant !== 'classic') || (base.listStyle && base.listStyle !== 'rows') || (base.photo && base.photo !== 'bleed')
    // Copy that still does not fit beside its image (long words in a large uppercase headline) gets the whole slide in
    // the study's text layout. A cutout then stands in the band the copy leaves free, smaller than planned or not at
    // all; a photograph needs its frame, so it gives way. The copy itself is never cut.
    const roomy: any = { ...classic, composition: textOnly, anchor: base.imagePos === 'top' ? 'bottom' : 'top', fill: false }
    const room = slot.needs_visual && image && !fill ? [cutout ? { ...roomy, withImage: true, cutout: true, fill: true } : { ...roomy, withImage: false, cutout: false }] : []
    const attempts = base.fill
      ? [base, noFill, { ...noFill, badge: false, callout: false, variant: 'classic', listStyle: 'rows', composition: 'statement', anchor: 'center' }]
      : [base, ...(base.badge || base.callout ? [plain] : []), ...(varied ? [classic] : []), { ...classic, composition: base.withImage ? 'image-led' : 'statement', anchor: 'center' }, ...room]
    let lastError: any
    for (const plan of attempts) {
      try {
        const { free, ...page } = composeSlide(family, brand, content, plan, index, slides.length, { image, imageSize })
        if (room.includes(plan)) {
          const placed = page.nodes.some((n: any) => n.type === 'image' && n.src === image)
          notes.push(`${slides.length > 1 ? `Slide ${index + 1}: ` : ''}the copy needed more room than the layout left beside the image, so ${placed ? 'the image was made smaller' : 'it was composed without its image'}.`)
        }
        return { ...page, nodes: page.nodes.map(n => ({ ...n, id: id() })), id: id(), name: `${index + 1}. ${page.composition}`, order: index, type: index === 0 ? 'top_peer' : index === slides.length - 1 ? 'bottom_peer' : 'content', globalComposition: page.composition }
      } catch (error: any) { if (error.status !== 422) throw error; lastError = error }
    }
    throw Object.assign(new Error(`${slides.length > 1 ? `Slide ${index + 1}: ` : ''}${lastError.message}`), { status: 422 })
  })
  const now = new Date()
  const canvas: any = {
    id: id(), flowId: brand.id, name: name || `${brand.name || 'Post'} — ${slides[0]?.headline || ''}`.slice(0, 120),
    type: layout.format, width: family.width, height: family.height, background: pages[0].background,
    nodes: layout.format === 'single' ? pages[0].nodes : [], groups: [], classes: pages[0].classes,
    ...(layout.format === 'carousel' ? { pages } : {}),
    designSelection: { id: design.id, name: family.name, tags: family.tags, source: 'global', globalFamilyId: family.id, globalVersion: family.version },
    designInput: { brandContext: brand, copy, resolvedPlan: { ...resolvedPlan, designId: design.id, layoutPlan: layout } },
    createdAt: now, updatedAt: now,
  }
  const validation = validatePost(canvas)
  if (!validation.passed) throw Object.assign(new Error(validation.errors.join('; ')), { status: 422 })
  canvas.validation = notes.length ? { ...validation, warnings: [...(validation.warnings || []), ...notes] } : validation
  return canvas
}
