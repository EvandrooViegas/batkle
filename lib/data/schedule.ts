import { cache } from 'react'
import { connectToMongo } from '@/lib/services/db/mongo'
import { currentUserId } from '@/lib/auth'

/**
 * Posts of a brand still on their way out (approved or scheduled, not yet marked posted), for the sidebar count —
 * for use in React Server Components only.
 */
export const getScheduleCount = cache(async (flowId: string): Promise<number | null> => {
  try {
    const ownerId = await currentUserId()
    if (!ownerId) return null
    const db = await connectToMongo()
    return await db.collection('scheduledPosts').countDocuments({ ownerId, flowId, status: { $in: ['approved', 'scheduled'] } })
  } catch {
    return null
  }
})
