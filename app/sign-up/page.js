import AuthShell from '@/components/auth/AuthShell'
import SignUpForm from '@/components/auth/SignUpForm'

export const metadata = { title: 'Create your account · Batkle' }

/** /sign-up: Batkle's own sign-up form (Clerk underneath). New accounts go through onboarding next. */
export default async function SignUpPage({ searchParams }) {
  const params = await searchParams
  const redirectUrl = typeof params?.redirect_url === 'string' ? params.redirect_url : ''
  const resume = params?.step === 'verify' || params?.step === 'continue' ? params.step : ''
  return (
    <AuthShell>
      <SignUpForm redirectUrl={redirectUrl} resume={resume} />
    </AuthShell>
  )
}
