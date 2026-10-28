import { cache } from 'react'
import { connectToMongo } from '@/lib/services/db/mongo'

/**
 * Posts of a brand still on their way out (approved or scheduled, not yet marked posted), for the sidebar count —
 * for use in React Server Components only, once the brand is known to be open to the account. `ownerId` is the
 * brand's owner, whose account the schedule is on (also for a brand shared with the account).
 */
export const getScheduleCount = cache(async (flowId: string, ownerId: string): Promise<number | null> => {
  try {
    if (!ownerId) return null
    const db = await connectToMongo()
    return await db.collection('scheduledPosts').countDocuments({ ownerId, flowId, status: { $in: ['approved', 'scheduled'] } })
  } catch {
    return null
  }
})
