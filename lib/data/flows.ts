import { cache } from 'react'
import { connectToMongo } from '@/lib/services/db/mongo'
import { ensureMinimumBrandDesigns } from '@/lib/designs/minimumBrandDesigns'

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
  createdAt?: Date
  updatedAt?: Date
  [key: string]: unknown
}

/** When a brand was last used: last opened, else last changed, else created. */
export function lastUsedAt(flow: any): number {
  const time = flow?.lastOpenedAt || flow?.updatedAt || flow?.createdAt
  return time ? new Date(time).getTime() || 0 : 0
}

/**
 * Fetch all flows directly from MongoDB, most recently used first — for use in React Server Components only.
 * The first flow is the brand /app opens by default.
 */
export const getFlows = cache(async (): Promise<Flow[]> => {
  const db = await connectToMongo()
  const flows = await db.collection('flows').find({}, { projection: { _id: 0, id: 1, name: 1, lastOpenedAt: 1, updatedAt: 1, createdAt: 1, 'brandContext.name': 1, 'brandContext.logo': 1, 'brandContext.logoVariants.originalTransparent': 1, 'brandContext.logoVariants.inkLightness': 1 } }).toArray()
  // Only what the client shows is passed on: no _id and no timestamps.
  return flows
    .sort((a: any, b: any) => lastUsedAt(b) - lastUsedAt(a))
    .map(({ _id, lastOpenedAt, updatedAt, createdAt, ...f }: any) => f) as Flow[]
})

/**
 * Number of gallery images saved for a brand — for use in React Server Components only.
 */
export const getGalleryCount = cache(async (flowId: string): Promise<number | null> => {
  try {
    const db = await connectToMongo()
    return await db.collection('assets').countDocuments({ brand_id: `brand_${flowId}` })
  } catch {
    return null
  }
})

/**
 * Fetch a single flow by its UUID — for use in React Server Components only.
 */
export const getFlow = cache(async (id: string): Promise<Flow | null> => {
  const db = await connectToMongo()
  const flow = await db.collection('flows').findOne({ id })
  if (!flow) return null
  const { _id, ...f } = await ensureMinimumBrandDesigns(db,flow) as any
  return f as Flow
})
