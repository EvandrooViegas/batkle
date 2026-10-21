import { effectivePlanId, loadBilling } from '@/lib/billing/account'
import { teammateIds } from '@/lib/teams'
import { ANONYMOUS, type Viewer } from './access'

/**
 * The signed-in account as the Design Library rules see it: its plan, its teams and whether it is the admin (an admin
 * account, or `admin` for the Design Library key session).
 */
export async function loadViewer(db: any, userId: string | null | undefined, admin = false): Promise<Viewer> {
  if (!userId) return { ...ANONYMOUS, admin }
  const [account, teammates] = await Promise.all([loadBilling(db, userId), teammateIds(db, userId)])
  return { userId, plan: effectivePlanId(account), admin: admin || Boolean(account.admin), teammates }
}
