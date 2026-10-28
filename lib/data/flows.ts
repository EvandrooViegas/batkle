import { cache } from 'react'
import { connectToMongo } from '@/lib/services/db/mongo'
import { ensureMinimumBrandDesigns } from '@/lib/designs/minimumBrandDesigns'
import { currentUserId } from '@/lib/auth'
import { brandRole, sharedBrands, type BrandRole, type MemberRole } from '@/lib/teams'
import { GALLERY_CUTOUT_FILTER } from '@/lib/services/generatedAssetLibrary'

export interface FlowBrandContext {
  name?: string
  about?: string
  logo?: string
  language?: string
  colors?: string[]
  fonts?: string[]
  headingFont?: string
  bodyFont?: string
  designTokens?: Partial<Record<'primary' | 'secondary' | 'accent' | 'background' | 'textPrimary' | 'textSecondary', string>>
  designLibraryVersion?: number
  designs?: Array<import('@/lib/designs/global/types').BrandGlobalDesign | { id: string; source?: string; baseId?: string; [key: string]: unknown }>
  imageDisposition?: 'cutout' | 'background' | 'framed' | 'none'
  services?: string[]
  projects?: { name: string; description: string; sourceUrl: string }[]
  targetAudience?: string
  tone?: string
  suggestedCtas?: string[]
  differentiators?: string[]
  contentTopics?: string[]
  website?: string
  profileLanguage?: 'en'
  researchSources?: { url: string; title: string; category: string }[]
}

export interface Flow {
  id: string
  name: string
  brandContext?: FlowBrandContext
  /** Set while the brand onboarding is unfinished: the step to continue at. */
  onboarding?: { step: 'review' | 'design'; manual?: boolean; after?: 'profile' }
  /** On a brand shared with the account (lib/teams.ts): its role in it and the owner's name. */
  shared?: { role: MemberRole; owner: string }
  createdAt?: Date
  updatedAt?: Date
  [key: string]: unknown
}

/** The account's part in a brand it opened: owner, or a role in a brand shared with it, and whose account it is on. */
export interface BrandAccess {
  role: BrandRole
  ownerId: string
  owner: string
}

/** When a brand was last used: last opened, else last changed, else created. */
export function lastUsedAt(flow: any): number {
  const time = flow?.lastOpenedAt || flow?.updatedAt || flow?.createdAt
  return time ? new Date(time).getTime() || 0 : 0
}

const LIST_FIELDS = { _id: 0, id: 1, name: 1, lastOpenedAt: 1, updatedAt: 1, createdAt: 1, 'brandContext.name': 1, 'brandContext.logo': 1, 'brandContext.logoVariants.originalTransparent': 1, 'brandContext.logoVariants.inkLightness': 1, 'onboarding.step': 1 }

/**
 * Fetch the signed-in account's flows directly from MongoDB, most recently used first — for use in React Server
 * Components only. Brands shared with the account come too, marked `shared`, ordered by when this person last
 * opened them. The first flow is the brand /app opens by default.
 */
export const getFlows = cache(async (): Promise<Flow[]> => {
  const ownerId = await currentUserId()
  if (!ownerId) return []
  const db = await connectToMongo()
  const [own, shared] = await Promise.all([
    db.collection('flows').find({ ownerId }, { projection: LIST_FIELDS }).toArray(),
    sharedBrands(db, ownerId, LIST_FIELDS),
  ])
  // Only what the client shows is passed on: no _id and no timestamps. A shared brand's onboarding is the owner's.
  return [...own, ...shared.filter(finishedOnboarding)]
    .sort((a: any, b: any) => lastUsedAt(b) - lastUsedAt(a))
    .map(({ _id, lastOpenedAt, updatedAt, createdAt, ...f }: any) => f) as Flow[]
})

/** True once a brand has finished onboarding (every brand made before the marker existed counts as finished). */
export function finishedOnboarding(flow: any): boolean {
  return !flow?.onboarding?.step
}

/**
 * The signed-in account's most recent brand with an unfinished onboarding, and what the onboarding needs to
 * continue it: the step and the brand profile. Null when every brand finished.
 */
export const getUnfinishedBrand = cache(async () => {
  const ownerId = await currentUserId()
  if (!ownerId) return null
  const db = await connectToMongo()
  const [flow] = await db.collection('flows')
    .find({ ownerId, 'onboarding.step': { $exists: true } }, { projection: { _id: 0, id: 1, onboarding: 1, brandContext: 1 } })
    .sort({ 'onboarding.updatedAt': -1 })
    .limit(1)
    .toArray()
  if (!flow) return null
  return {
    flowId: flow.id as string,
    step: flow.onboarding.step as 'review' | 'design',
    manual: Boolean(flow.onboarding.manual),
    after: (flow.onboarding.after === 'profile' ? 'profile' : 'ready') as 'profile' | 'ready',
    brand: (flow.brandContext || {}) as FlowBrandContext,
  }
})

/**
 * Number of cutouts in a brand's gallery — for use in React Server Components only.
 */
export const getGalleryCount = cache(async (flowId: string): Promise<number | null> => {
  try {
    const db = await connectToMongo()
    return await db.collection('assets').countDocuments({ brand_id: `brand_${flowId}`, ...GALLERY_CUTOUT_FILTER })
  } catch {
    return null
  }
})

/**
 * Fetch a single flow by its UUID — for use in React Server Components only. The account's own brand, or one shared
 * with it, with `access` (its role, and whose account the brand is on); another account's brand reads as missing.
 */
export const getFlow = cache(async (id: string): Promise<(Flow & { access: BrandAccess }) | null> => {
  const userId = await currentUserId()
  if (!userId) return null
  const db = await connectToMongo()
  const part = await brandRole(db, userId, id)
  if (!part) return null
  const flow = await db.collection('flows').findOne({ id, ownerId: part.ownerId })
  if (!flow) return null
  const ownerName = async () => {
    const owner = await db.collection('users').findOne({ id: part.ownerId }, { projection: { _id: 0, name: 1, email: 1 } })
    return owner?.name || String(owner?.email || '').split('@')[0] || 'Its owner'
  }
  const { _id, ownerId: _owner, ...f } = await ensureMinimumBrandDesigns(db,flow) as any
  return { ...f, access: { role: part.role, ownerId: part.ownerId, owner: part.role === 'owner' ? '' : await ownerName() } } as Flow & { access: BrandAccess }
})
