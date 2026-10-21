/**
 * Who may see and use each design in the library.
 *
 * Batkle's own designs (records with no ownerId) are for everyone, on every plan. Designs people publish are public
 * (everyone sees them) or private (the publisher and the people who share a team with them). Using a design someone
 * published takes a paid plan: Free accounts see public ones and are offered the upgrade. Drafts are the author's.
 *
 * Pure functions over a record and a viewer, so pages, the brand selection and generation all apply the same rules.
 */

export type Visibility = 'public' | 'private'
export const VISIBILITIES: Visibility[] = ['public', 'private']

export interface Viewer {
  userId: string | null
  /** The effective plan: 'free', 'pro' or 'business'. */
  plan: string
  /** The Design Library admin: sees and edits everything, and publishes Batkle's own designs. */
  admin: boolean
  /** Everyone who shares a team with the viewer, the viewer included. */
  teammates: string[]
}

/** What a page shows about a design's origin and what the viewer can do with it. */
export interface LibraryInfo {
  official: boolean
  author: string
  visibility: Visibility
  mine: boolean
  /** Private and shared through a team the viewer is in. */
  team: boolean
  usable: boolean
  /** Shown, but using it needs a paid plan. */
  upgrade: boolean
}

export const ANONYMOUS: Viewer = { userId: null, plan: 'free', admin: false, teammates: [] }
export const BATKLE_AUTHOR = 'Batkle'

export const isOfficial = (record: any) => !record?.ownerId
export const visibilityOf = (record: any): Visibility => (isOfficial(record) ? 'public' : record?.visibility === 'public' ? 'public' : 'private')

export function canSee(record: any, viewer: Viewer): boolean {
  if (!record || record.deletedAt) return false
  if (viewer.admin) return true
  if (record.ownerId && record.ownerId === viewer.userId) return true
  if (record.status !== 'published') return false
  if (visibilityOf(record) === 'public') return true
  return viewer.teammates.includes(record.ownerId)
}

export function canUse(record: any, viewer: Viewer): boolean {
  if (!canSee(record, viewer)) return false
  return isOfficial(record) || viewer.admin || viewer.plan !== 'free'
}

/**
 * A design a brand already uses. Its pinned version outlives unpublishing and deletion, as Batkle's own always have;
 * a member's design stays usable while the account has a paid plan and, for a private one, is still in the team.
 */
export function canKeepUsing(record: any, viewer: Viewer): boolean {
  if (!record || isOfficial(record) || viewer.admin) return true
  if (viewer.plan === 'free') return false
  if (record.ownerId === viewer.userId) return true
  return visibilityOf(record) === 'public' || viewer.teammates.includes(record.ownerId)
}

/** The author edits their own designs; the admin edits every design. */
export function canEdit(record: any, viewer: Viewer): boolean {
  return viewer.admin || (!!record?.ownerId && record.ownerId === viewer.userId)
}

export function libraryInfo(record: any, viewer: Viewer): LibraryInfo {
  const official = isOfficial(record), visibility = visibilityOf(record)
  const mine = !official && record.ownerId === viewer.userId
  const usable = canUse(record, viewer)
  return {
    official,
    author: official ? BATKLE_AUTHOR : String(record?.author?.name || 'A Batkle member'),
    visibility,
    mine,
    team: !official && !mine && visibility === 'private' && viewer.teammates.includes(record.ownerId),
    usable,
    upgrade: !usable && canSee(record, viewer),
  }
}

/** The refusal for a Free account using a design someone published; shaped like a billing error (upgrade_required). */
export function upgradeToUseError() {
  return Object.assign(new Error('Designs made by Batkle members are part of Pro and Business. Upgrade to use them; Batkle’s own designs stay free.'), {
    status: 402, code: 'upgrade_required', billing: true, details: { feature: 'communityDesigns', requiredPlan: 'pro' },
  })
}
