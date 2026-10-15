import AuthShell from '@/components/auth/AuthShell'
import SsoCallback from '@/components/auth/SsoCallback'

export const metadata = { title: 'Signing in · Batkle' }

/** Where Google sends people back to; Clerk finishes the sign-in or sign-up here. */
export default function SsoCallbackPage() {
  return (
    <AuthShell>
      <SsoCallback />
    </AuthShell>
  )
}
