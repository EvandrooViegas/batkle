import { ADMIN_CREDITS, adminEmails, isAdminEmail, isAdminUser } from '@/lib/billing/account'

/**
 * Batkle's admin accounts: whoever signs in with a verified email listed in ADMIN_EMAILS (comma-separated). An admin
 * has every feature on Business terms with credits to spare (lib/billing/account.ts, where the check lives so billing
 * needs no import), runs the Design Library (Batkle's own designs and every member's) and opens /admin.
 */
export { ADMIN_CREDITS, adminEmails, isAdminEmail, isAdminUser }

/** For admin-only routes: anyone else gets a 404, so the routes do not show they exist. */
export async function requireAdmin(db: any, userId: string | null | undefined) {
  if (!(await isAdminUser(db, userId))) throw Object.assign(new Error('Not found'), { status: 404 })
}
