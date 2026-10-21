import { notFound } from 'next/navigation'
import { requireOnboardedAccount } from '@/lib/auth'
import { connectToMongo } from '@/lib/services/db/mongo'
import { isAdminUser } from '@/lib/admin'
import StandaloneShell from '@/components/app/StandaloneShell'
import AdminDashboard from '@/components/admin/AdminDashboard'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Batkle' }

/** The admin dashboard, for admin accounts (ADMIN_EMAILS) only: anyone else sees a missing page. */
export default async function AdminPage() {
  const account = await requireOnboardedAccount('/admin')
  if (!(await isAdminUser(await connectToMongo(), account.userId))) notFound()
  return <StandaloneShell back={{ href: '/app', label: 'Back to the app' }}><AdminDashboard /></StandaloneShell>
}
