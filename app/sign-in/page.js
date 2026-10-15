import AuthShell from '@/components/auth/AuthShell'
import SignInForm from '@/components/auth/SignInForm'

export const metadata = { title: 'Sign in · Batkle' }

/** /sign-in: Batkle's own sign-in form (Clerk underneath). `?redirect_url=` is where to go afterwards. */
export default async function SignInPage({ searchParams }) {
  const params = await searchParams
  const redirectUrl = typeof params?.redirect_url === 'string' ? params.redirect_url : ''
  return (
    <AuthShell>
      <SignInForm redirectUrl={redirectUrl} resume={params?.step === 'verify'} />
    </AuthShell>
  )
}
