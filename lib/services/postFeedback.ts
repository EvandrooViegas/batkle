/**
 * The owner's ratings of the posts Batkle made: a like or a dislike on each version of a post, with what it was about
 * (the hook, the text, the topic or the design) and an optional note. Each rating keeps a snapshot of the post, so
 * what Batkle learns survives the idea being deleted. They shape what comes next: the idea writer makes more of what
 * was liked and steers away from what was disliked, the copywriter writes in the spirit of liked text, and a design
 * whose look was disliked sits out Batkle's own pick while the brand has other designs. No model call is spent on it.
 * The pure helpers here are tested without the database.
 */

export const FEEDBACK_REASONS = ['hook', 'text', 'topic', 'design'] as const
export type FeedbackReason = typeof FEEDBACK_REASONS[number]
// The most recent ratings kept for a brand; prompts read only the newest few.
export const MAX_FEEDBACK = 40
export const NOTE_LIMIT = 240

export interface PostFeedback {
  /** The version rated: its canvas, or the idea before it has one. */
  key: string
  ideaId: string
  rating: 'like' | 'dislike'
  reasons: FeedbackReason[]
  note: string
  at: string
  surface: 'post' | 'story'
  format: 'single' | 'carousel'
  topic: string
  hook: string
  hookShape?: string
  pillar?: string
  headline: string
  caption: string
  designId?: string
}

const clean = (value: any, limit: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '')
const idOf = (value: any) => { const id = clean(value, 80); return /^[\w:-]+$/.test(id) ? id : '' }

/** The version a rating is for: the post's canvas, or its idea before it was built. */
export const feedbackKey = (post: any) => idOf(post?.canvasId) || idOf(post?.ideaId)

/** A rating as it may be saved, from `{ rating, reasons, note, post }`; null when it is not one. */
export function readFeedback(body: any, now = new Date()): PostFeedback | null {
  const post = body?.post || {}
  const ideaId = idOf(post.ideaId)
  if (!ideaId || (body?.rating !== 'like' && body?.rating !== 'dislike')) return null
  const reasons = FEEDBACK_REASONS.filter(reason => Array.isArray(body.reasons) && body.reasons.includes(reason))
  const hookShape = clean(post.hookShape, 20), pillar = clean(post.pillar, 60), designId = idOf(post.designId)
  return {
    key: feedbackKey(post), ideaId, rating: body.rating, reasons, note: clean(body.note, NOTE_LIMIT), at: now.toISOString(),
    surface: post.surface === 'story' ? 'story' : 'post', format: post.format === 'carousel' ? 'carousel' : 'single',
    topic: clean(post.topic, 200), hook: clean(post.hook, 200), headline: clean(post.headline, 200), caption: clean(post.caption, 400),
    ...(hookShape ? { hookShape } : {}), ...(pillar ? { pillar } : {}), ...(designId ? { designId } : {}),
  }
}

const ratings = (entries: any): PostFeedback[] => (Array.isArray(entries) ? entries : []).filter(e => e && (e.rating === 'like' || e.rating === 'dislike') && typeof e.key === 'string')
  .map(e => ({ ...e, reasons: Array.isArray(e.reasons) ? e.reasons : [], note: e.note || '' }))

const listed = (words: string[]) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0] || '')
const REASON_WORDS: Record<FeedbackReason, string> = { hook: 'the hook', text: 'the text', topic: 'the topic', design: 'the design' }
const verdict = (entry: PostFeedback, about?: FeedbackReason[]) => {
  const reasons = entry.reasons.filter(r => !about || about.includes(r))
  const what = reasons.length ? listed(reasons.map(r => REASON_WORDS[r])) : 'the post overall'
  return ` — ${entry.rating === 'like' ? 'liked' : 'disliked'} ${what}${entry.note ? `; the owner said: "${entry.note}"` : ''}`
}

/**
 * The owner's ratings for a prompt: for the idea writer (`ideas`: topics, ways in, formats) or the copywriter
 * (`copy`: the words of posts rated for their text, or liked as a whole). Empty without ratings.
 */
export function feedbackBlock(entries: any, kind: 'ideas' | 'copy'): string {
  const all = ratings(entries)
  if (kind === 'ideas') {
    const line = (e: PostFeedback) => `- a ${e.format}${e.surface === 'story' ? ' story' : ''}${e.hookShape ? ` opening as a ${e.hookShape}` : ''}: "${e.hook}" (topic: "${e.topic}")${verdict(e)}`
    const liked = all.filter(e => e.rating === 'like').slice(0, 4), disliked = all.filter(e => e.rating === 'dislike').slice(0, 4)
    if (!liked.length && !disliked.length) return ''
    return `WHAT THE OWNER THOUGHT OF RECENT POSTS (their own ratings):
${liked.length ? `Liked:\n${liked.map(line).join('\n')}\n` : ''}${disliked.length ? `Disliked:\n${disliked.map(line).join('\n')}\n` : ''}Make more posts like the liked ones: similar kinds of subject, ways in and formats, never the same topic or hook again. Steer away from what the disliked ones did: a disliked hook means open another way, a disliked topic means choose other subjects, a post disliked overall means change the angle. A request the owner typed for this post still comes first.`
  }
  const words = (e: PostFeedback) => [e.headline && `headline "${e.headline}"`, e.caption && `caption beginning "${e.caption.slice(0, 180)}"`].filter(Boolean).join(', ')
  const liked = all.filter(e => e.rating === 'like' && (!e.reasons.length || e.reasons.includes('text')) && words(e)).slice(0, 3)
  const disliked = all.filter(e => e.rating === 'dislike' && (e.reasons.includes('text') || (e.note && !e.reasons.length)) && words(e)).slice(0, 3)
  if (!liked.length && !disliked.length) return ''
  const line = (e: PostFeedback) => `- ${words(e)}${verdict(e, ['text'])}`
  return `WHAT THE OWNER THOUGHT OF RECENT POSTS' WORDS (their own ratings):
${liked.length ? `Liked:\n${liked.map(line).join('\n')}\n` : ''}${disliked.length ? `Disliked:\n${disliked.map(line).join('\n')}\n` : ''}Write this post in the spirit of the liked ones (their length, tone and directness), never reusing their sentences, and avoid what the owner disliked. Every other rule here still applies.`
}

/**
 * The brand without the designs whose look the owner disliked, for Batkle's own pick of a design. The newest rating
 * of a design decides (a like after a dislike brings it back), and the brand is left as it is when that would leave
 * it no design. A design picked in the post settings is never filtered: that choice is the owner's.
 */
export function withoutDislikedDesigns(brand: any, entries: any): any {
  const decided = new Map<string, boolean>()
  for (const entry of ratings(entries)) {
    if (!entry.designId || decided.has(entry.designId)) continue
    if (entry.rating === 'like' && (!entry.reasons.length || entry.reasons.includes('design'))) decided.set(entry.designId, true)
    else if (entry.rating === 'dislike' && entry.reasons.includes('design')) decided.set(entry.designId, false)
  }
  const designs: any[] = Array.isArray(brand?.designs) ? brand.designs : []
  const kept = designs.filter(design => decided.get(design.id) !== false)
  return kept.length < designs.length && kept.some(design => design.source === 'global') ? { ...brand, designs: kept } : brand
}

/** The brand's ratings, newest first; none when they can't be read, so a post is never lost over them. */
export async function loadPostFeedback(db: any, flowId: unknown): Promise<PostFeedback[]> {
  if (typeof flowId !== 'string' || !flowId || !db) return []
  try { return ratings((await db.collection('flows').findOne({ id: flowId }, { projection: { _id: 0, postFeedback: 1 } }))?.postFeedback) } catch { return [] }
}

/**
 * Saves a rating, or takes it away (`rating: null`). One rating per version of a post: rating it again replaces the
 * last one. Answers the brand's ratings, newest first.
 */
export async function savePostFeedback(db: any, flowId: string, body: any): Promise<PostFeedback[]> {
  const flow = await db.collection('flows').findOne({ id: flowId }, { projection: { _id: 0, postFeedback: 1 } })
  if (!flow) throw Object.assign(new Error('Brand not found'), { status: 404 })
  const key = feedbackKey(body?.post)
  if (!key) throw Object.assign(new Error('The post to rate is missing'), { status: 400 })
  let list = ratings(flow.postFeedback).filter(entry => entry.key !== key)
  if (body?.rating !== null) {
    const entry = readFeedback(body)
    if (!entry) throw Object.assign(new Error('Rate the post with a like or a dislike'), { status: 400 })
    list = [entry, ...list].slice(0, MAX_FEEDBACK)
  }
  await db.collection('flows').updateOne({ id: flowId }, { $set: { postFeedback: list } })
  return list
}
