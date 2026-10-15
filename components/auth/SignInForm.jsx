'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSignIn } from '@clerk/nextjs'
import { Notice } from '@/components/app/ui'
import { safeRedirect } from '@/lib/authRedirect'
import {
  AuthFooter, AuthHeading, CodeField, Field, GoogleButton, OrDivider, PASSWORD_MIN, PasswordField, SubmitButton, TextButton,
  authError, authLinkClass, hasCode, useCooldown, validEmail,
} from './authUi'

const strong = 'font-semibold text-bk-fg'
// Returned by an action that leaves the page, so its button stays busy until the next page opens.
const DONE = 'done'
// The fields each step shows; an error for any other field is shown for the whole form.
const STEP_FIELDS = { start: ['email', 'password'], 'second-factor': ['code'], 'reset-request': ['email'], reset: ['code', 'password'] }

/**
 * Sign in with Google, or with email and password. Also covers a forgotten password (a code by email, then a new
 * password) and the extra step Clerk can ask for: a code confirming a new device, or two-step verification.
 * `resume` continues a second step started elsewhere (Google sign-in sends people back here for it).
 */
export default function SignInForm({ redirectUrl = '', resume = false }) {
  const router = useRouter()
  const { isLoaded, signIn, setActive } = useSignIn()
  const [step, setStep] = useState('start') // start | second-factor | reset-request | reset
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [secondFactor, setSecondFactor] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(null)
  const [cooldown, startCooldown] = useCooldown()
  const resumed = useRef(false)

  const target = () => safeRedirect(redirectUrl)
  const signUpHref = `/sign-up${redirectUrl ? `?redirect_url=${encodeURIComponent(redirectUrl)}` : ''}`

  const go = next => { setErrors({}); setCode(''); setStep(next) }
  const fail = error => {
    // Already signed in (another tab finished first): just continue.
    if (hasCode(error, 'session_exists')) return router.push(target())
    const { field, message } = authError(error)
    setErrors({ [STEP_FIELDS[step].includes(field) ? field : 'form']: message })
  }

  const startSecondFactor = async attempt => {
    const factors = attempt.supportedSecondFactors || []
    const factor = ['email_code', 'totp', 'phone_code'].map(s => factors.find(f => f.strategy === s)).find(Boolean)
    if (!factor) {
      setErrors({ form: 'This account uses a sign-in step Batkle can’t show here. Sign in with Google, or reset your password.' })
      return
    }
    if (factor.strategy === 'email_code') await attempt.prepareSecondFactor({ strategy: 'email_code', emailAddressId: factor.emailAddressId })
    if (factor.strategy === 'phone_code') await attempt.prepareSecondFactor({ strategy: 'phone_code', phoneNumberId: factor.phoneNumberId })
    if (factor.strategy !== 'totp') startCooldown()
    setSecondFactor({ ...factor, newDevice: attempt.clientTrustState === 'new' })
    go('second-factor')
  }

  /** Opens the app once Clerk says the sign-in is complete; otherwise asks for whatever it still needs. */
  const finish = async attempt => {
    if (attempt.status === 'complete') {
      await setActive({ session: attempt.createdSessionId, navigate: async () => { router.push(target()) } })
      return DONE
    }
    if (attempt.status === 'needs_second_factor') return startSecondFactor(attempt)
    setErrors({ form: 'Batkle couldn’t finish signing you in. Please try again.' })
  }

  // Google sign-in that needs a second step comes back here with ?step=verify.
  useEffect(() => {
    if (!isLoaded || !resume || resumed.current) return
    resumed.current = true
    if (signIn.status === 'needs_second_factor') startSecondFactor(signIn).catch(fail)
  }, [isLoaded, resume]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (kind, action) => {
    if (!isLoaded || busy) return
    setBusy(kind)
    let done = false
    try { done = (await action()) === DONE } catch (error) { fail(error) }
    if (!done) setBusy(null)
  }

  const continueWithGoogle = () => run('google', async () => {
    setErrors({})
    await signIn.authenticateWithRedirect({ strategy: 'oauth_google', redirectUrl: '/sso-callback', redirectUrlComplete: target() })
    return DONE
  })

  const submitPassword = e => {
    e.preventDefault()
    const found = {}
    if (!email.trim()) found.email = 'Enter your email.'
    else if (!validEmail(email.trim())) found.email = 'Enter a valid email address.'
    if (!password) found.password = 'Enter your password.'
    setErrors(found)
    if (Object.keys(found).length) return
    run('form', async () => finish(await signIn.create({ strategy: 'password', identifier: email.trim(), password })))
  }

  const submitSecondFactor = e => {
    e.preventDefault()
    if (code.length < 6) return setErrors({ code: 'Enter the 6-digit code.' })
    run('form', async () => finish(await signIn.attemptSecondFactor({ strategy: secondFactor.strategy, code })))
  }

  const resendSecondFactor = () => run('resend', async () => {
    const params = secondFactor.strategy === 'email_code'
      ? { strategy: 'email_code', emailAddressId: secondFactor.emailAddressId }
      : { strategy: 'phone_code', phoneNumberId: secondFactor.phoneNumberId }
    await signIn.prepareSecondFactor(params)
    setErrors({})
    startCooldown()
  })

  const sendResetCode = () => run('form', async () => {
    await signIn.create({ strategy: 'reset_password_email_code', identifier: email.trim() })
    startCooldown()
    go('reset')
  })

  const submitResetRequest = e => {
    e.preventDefault()
    if (!validEmail(email.trim())) return setErrors({ email: email.trim() ? 'Enter a valid email address.' : 'Enter your email.' })
    sendResetCode()
  }

  const submitReset = e => {
    e.preventDefault()
    const found = {}
    if (code.length < 6) found.code = 'Enter the 6-digit code.'
    if (password.length < PASSWORD_MIN) found.password = `Use at least ${PASSWORD_MIN} characters.`
    setErrors(found)
    if (Object.keys(found).length) return
    run('form', async () => finish(await signIn.attemptFirstFactor({ strategy: 'reset_password_email_code', code, password })))
  }

  const resendReset = () => run('resend', async () => {
    await signIn.create({ strategy: 'reset_password_email_code', identifier: email.trim() })
    setErrors({})
    startCooldown()
  })

  const startOver = () => { setPassword(''); setSecondFactor(null); go('start') }
  const resendLabel = cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'
  const formError = errors.form && <Notice tone="error">{errors.form}</Notice>

  if (step === 'second-factor') {
    const totp = secondFactor.strategy === 'totp'
    return (
      <div key="second-factor">
        <AuthHeading eyebrow="One more step" title={secondFactor.newDevice ? 'Confirm it’s you' : 'Two-step verification'}>
          {totp ? 'Enter the 6-digit code from your authenticator app.' : (
            <>We sent a 6-digit code to <strong className={strong}>{secondFactor.safeIdentifier}</strong>{secondFactor.newDevice ? ' because you’re signing in on a new device.' : '.'}</>
          )}
        </AuthHeading>
        <form noValidate onSubmit={submitSecondFactor} className="mt-7 space-y-4">
          <CodeField id="sign-in-code" autoFocus value={code} onChange={value => { setCode(value); setErrors({}) }} error={errors.code} />
          {formError}
          <SubmitButton busy={busy === 'form'} busyLabel="Checking…" disabled={!isLoaded}>Continue</SubmitButton>
        </form>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {!totp && <TextButton onClick={resendSecondFactor} disabled={cooldown > 0 || Boolean(busy)}>{resendLabel}</TextButton>}
          <TextButton onClick={startOver}>Start over</TextButton>
        </div>
      </div>
    )
  }

  if (step === 'reset-request') {
    return (
      <div key="reset-request">
        <AuthHeading eyebrow="Forgot password" title="Reset your password">
          Enter the email you sign in with and we’ll send you a code to choose a new password.
        </AuthHeading>
        <form noValidate onSubmit={submitResetRequest} className="mt-7 space-y-4">
          <Field id="reset-email" label="Email" type="email" autoComplete="email" inputMode="email" spellCheck={false} autoFocus placeholder="you@company.com" value={email} onChange={e => { setEmail(e.target.value); setErrors({}) }} error={errors.email} />
          {formError}
          <SubmitButton busy={busy === 'form'} busyLabel="Sending…" disabled={!isLoaded}>Send code</SubmitButton>
        </form>
        <AuthFooter><TextButton onClick={startOver} className="text-[14px]">Back to sign in</TextButton></AuthFooter>
      </div>
    )
  }

  if (step === 'reset') {
    return (
      <div key="reset">
        <AuthHeading eyebrow="Forgot password" title="Choose a new password">
          We sent a 6-digit code to <strong className={strong}>{email.trim()}</strong>. Enter it with your new password.
        </AuthHeading>
        <form noValidate onSubmit={submitReset} className="mt-7 space-y-4">
          <CodeField id="reset-code" autoFocus value={code} onChange={value => { setCode(value); setErrors(current => ({ ...current, code: undefined, form: undefined })) }} error={errors.code} />
          <PasswordField id="reset-password" label="New password" autoComplete="new-password" value={password} onChange={e => { setPassword(e.target.value); setErrors(current => ({ ...current, password: undefined, form: undefined })) }} error={errors.password} hint={`At least ${PASSWORD_MIN} characters.`} />
          {formError}
          <SubmitButton busy={busy === 'form'} busyLabel="Saving…" disabled={!isLoaded}>Save and sign in</SubmitButton>
        </form>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <TextButton onClick={resendReset} disabled={cooldown > 0 || Boolean(busy)}>{resendLabel}</TextButton>
          <TextButton onClick={startOver}>Back to sign in</TextButton>
        </div>
      </div>
    )
  }

  return (
    <div key="start">
      <AuthHeading eyebrow="Welcome back" title="Sign in to Batkle">Pick up right where you left off.</AuthHeading>
      <GoogleButton className="mt-7" onClick={continueWithGoogle} busy={busy === 'google'} disabled={!isLoaded || Boolean(busy)} />
      <OrDivider />
      <form noValidate onSubmit={submitPassword} className="space-y-4">
        <Field id="sign-in-email" label="Email" type="email" autoComplete="email" inputMode="email" spellCheck={false} autoFocus placeholder="you@company.com" value={email} onChange={e => { setEmail(e.target.value); setErrors(current => ({ ...current, email: undefined, form: undefined })) }} error={errors.email} />
        <PasswordField
          id="sign-in-password"
          autoComplete="current-password"
          value={password}
          onChange={e => { setPassword(e.target.value); setErrors(current => ({ ...current, password: undefined, form: undefined })) }}
          error={errors.password}
          action={<TextButton onClick={() => { setPassword(''); go('reset-request') }}>Forgot password?</TextButton>}
        />
        {formError}
        <SubmitButton busy={busy === 'form'} busyLabel="Signing in…" disabled={!isLoaded}>Sign in</SubmitButton>
      </form>
      <AuthFooter>New to Batkle? <Link href={signUpHref} className={authLinkClass}>Create an account</Link></AuthFooter>
    </div>
  )
}
