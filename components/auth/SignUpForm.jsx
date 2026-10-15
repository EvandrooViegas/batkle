'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSignUp } from '@clerk/nextjs'
import { Notice } from '@/components/app/ui'
import { safeRedirect } from '@/lib/authRedirect'
import {
  AuthFooter, AuthHeading, CodeField, Field, GoogleButton, OrDivider, PASSWORD_MIN, PasswordField, SubmitButton, TextButton,
  authError, authLinkClass, hasCode, useCooldown, validEmail,
} from './authUi'

// Returned by an action that leaves the page, so its button stays busy until the next page opens.
const DONE = 'done'
const STEP_FIELDS = { start: ['email', 'password'], verify: ['code'] }

/**
 * Create an account with Google, or with email and password confirmed by a 6-digit code. Onboarding follows: the
 * app sends a new account there before anything else. `resume` is set when Google sign-up comes back needing
 * more: `verify` (confirm the email) or `continue` (details Google didn't share).
 */
export default function SignUpForm({ redirectUrl = '', resume = '' }) {
  const router = useRouter()
  const { isLoaded, signUp, setActive } = useSignUp()
  const [step, setStep] = useState('start') // start | verify
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(null)
  const [cooldown, startCooldown] = useCooldown()
  const resumed = useRef(false)

  const target = () => safeRedirect(redirectUrl)
  const signInHref = `/sign-in${redirectUrl ? `?redirect_url=${encodeURIComponent(redirectUrl)}` : ''}`

  const fail = error => {
    if (hasCode(error, 'session_exists')) return router.push(target())
    const { field, message } = authError(error)
    setErrors({ [STEP_FIELDS[step].includes(field) ? field : 'form']: message })
  }

  const run = async (kind, action) => {
    if (!isLoaded || busy) return
    setBusy(kind)
    let done = false
    try { done = (await action()) === DONE } catch (error) { fail(error) }
    if (!done) setBusy(null)
  }

  const finish = async attempt => {
    if (attempt.status === 'complete') {
      await setActive({ session: attempt.createdSessionId, navigate: async () => { router.push(target()) } })
      return DONE
    }
    // Fields the Clerk dashboard requires but this form doesn't collect show up here (or nothing, when Clerk's bot
    // protection held the sign-up).
    console.warn('[sign-up] Clerk did not complete the sign-up:', attempt.status, { missing: attempt.missingFields, unverified: attempt.unverifiedFields })
    setErrors({ form: 'Batkle couldn’t finish creating your account. Please try again, or continue with Google.' })
  }

  // Google sign-up that needs more comes back here with ?step=verify or ?step=continue.
  useEffect(() => {
    if (!isLoaded || !resume || resumed.current) return
    resumed.current = true
    const pendingEmail = signUp.status === 'missing_requirements' && signUp.unverifiedFields?.includes('email_address') && signUp.emailAddress
    if (resume === 'verify' && pendingEmail) {
      setEmail(signUp.emailAddress)
      run('form', async () => {
        await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
        startCooldown()
        setStep('verify')
      })
    } else {
      setErrors({ form: 'Google didn’t share everything Batkle needs to create your account. Create it with your email instead.' })
    }
  }, [isLoaded, resume]) // eslint-disable-line react-hooks/exhaustive-deps

  const continueWithGoogle = () => run('google', async () => {
    setErrors({})
    await signUp.authenticateWithRedirect({ strategy: 'oauth_google', redirectUrl: '/sso-callback', redirectUrlComplete: target() })
    return DONE
  })

  const submitStart = e => {
    e.preventDefault()
    const found = {}
    if (!email.trim()) found.email = 'Enter your email.'
    else if (!validEmail(email.trim())) found.email = 'Enter a valid email address.'
    if (password.length < PASSWORD_MIN) found.password = `Use at least ${PASSWORD_MIN} characters.`
    setErrors(found)
    if (Object.keys(found).length) return
    run('form', async () => {
      const created = await signUp.create({ emailAddress: email.trim(), password })
      if (created.status === 'complete') return finish(created)
      await created.prepareEmailAddressVerification({ strategy: 'email_code' })
      startCooldown()
      setCode('')
      setStep('verify')
    })
  }

  const submitCode = e => {
    e.preventDefault()
    if (code.length < 6) return setErrors({ code: 'Enter the 6-digit code.' })
    run('form', async () => finish(await signUp.attemptEmailAddressVerification({ code })))
  }

  const resend = () => run('resend', async () => {
    await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
    setErrors({})
    startCooldown()
  })

  const changeEmail = () => { setErrors({}); setCode(''); setStep('start') }
  const formError = errors.form && <Notice tone="error">{errors.form}</Notice>

  if (step === 'verify') {
    return (
      <div key="verify">
        <AuthHeading eyebrow="Check your email" title="Enter your code">
          We sent a 6-digit code to <strong className="font-semibold text-bk-fg">{email.trim()}</strong>.
        </AuthHeading>
        <form noValidate onSubmit={submitCode} className="mt-7 space-y-4">
          <CodeField id="sign-up-code" autoFocus value={code} onChange={value => { setCode(value); setErrors({}) }} error={errors.code} />
          {formError}
          <SubmitButton busy={busy === 'form'} busyLabel="Checking…" disabled={!isLoaded}>Verify email</SubmitButton>
        </form>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <TextButton onClick={resend} disabled={cooldown > 0 || Boolean(busy)}>{cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}</TextButton>
          <TextButton onClick={changeEmail} disabled={Boolean(busy)}>Use a different email</TextButton>
        </div>
      </div>
    )
  }

  return (
    <div key="start">
      <AuthHeading eyebrow="Create your account" title="Start with your website">
        Make an account, tell us a little about you, then Batkle builds your first brand from your website.
      </AuthHeading>
      <GoogleButton className="mt-7" onClick={continueWithGoogle} busy={busy === 'google'} disabled={!isLoaded || Boolean(busy)} />
      <OrDivider />
      <form noValidate onSubmit={submitStart} className="space-y-4">
        <Field id="sign-up-email" label="Email" type="email" autoComplete="email" inputMode="email" spellCheck={false} autoFocus placeholder="you@company.com" value={email} onChange={e => { setEmail(e.target.value); setErrors(current => ({ ...current, email: undefined, form: undefined })) }} error={errors.email} />
        <PasswordField id="sign-up-password" autoComplete="new-password" value={password} onChange={e => { setPassword(e.target.value); setErrors(current => ({ ...current, password: undefined, form: undefined })) }} error={errors.password} hint={`At least ${PASSWORD_MIN} characters.`} />
        {/* Clerk's bot protection draws its check here when it needs one. */}
        <div id="clerk-captcha" data-cl-theme="auto" data-cl-size="flexible" />
        {formError}
        <SubmitButton busy={busy === 'form'} busyLabel="Creating account…" disabled={!isLoaded}>Create account</SubmitButton>
      </form>
      <AuthFooter>Already have an account? <Link href={signInHref} className={authLinkClass}>Sign in</Link></AuthFooter>
    </div>
  )
}
