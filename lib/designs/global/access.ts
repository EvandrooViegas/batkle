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

/** The brand a design was made in, as its byline shows it. */
export interface MakerBrand { name: string; logo: string | null; logoOnDark: boolean }
/** Who made a design: the brand it was made in and the person who uploaded it. Ids never leave the server. */
export interface Maker { brand: MakerBrand | null; person: { name: string; photo: string | null; you: boolean } | null }

/** What a page shows about a design's origin and what the viewer can do with it. */
export interface LibraryInfo {
  official: boolean
  author: string
  /** Null for a design saved before bylines were kept, such as Batkle's bundled ones. */
  maker: Maker | null
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

/** The byline saved with a record (`author`): its brand's name and logo, and the person's name and photo. */
export function makerOf(record: any, userId?: string | null): Maker | null {
  const author = record?.author, brand = author?.brand
  const you = !!userId && (author?.id || record?.ownerId) === userId
  const person = author?.name ? { name: String(author.name).slice(0, 80), photo: typeof author.photo === 'string' ? author.photo : null, you } : null
  const made = brand?.name ? { name: String(brand.name).slice(0, 80), logo: typeof brand.logo === 'string' ? brand.logo : null, logoOnDark: !!brand.logoOnDark } : null
  return person || made ? { brand: made, person } : null
}

export function libraryInfo(record: any, viewer: Viewer): LibraryInfo {
  const official = isOfficial(record), visibility = visibilityOf(record)
  const mine = !official && record.ownerId === viewer.userId
  const usable = canUse(record, viewer)
  return {
    official,
    author: official ? BATKLE_AUTHOR : String(record?.author?.name || 'A Batkle member'),
    maker: makerOf(record, viewer.userId),
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
