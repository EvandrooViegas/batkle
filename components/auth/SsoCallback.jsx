'use client'

import { AuthenticateWithRedirectCallback } from '@clerk/nextjs'
import { Loader2 } from 'lucide-react'

/**
 * Finishes Google sign-in and sign-up. Clerk sends anyone who still needs a step back to Batkle's own forms:
 * a second factor to /sign-in, an unconfirmed email or missing details to /sign-up.
 */
export default function SsoCallback() {
  return (
    <div role="status" className="flex flex-col items-center text-center">
      <Loader2 aria-hidden="true" className="size-6 animate-spin text-bk-muted" />
      <p className="mt-4 font-bk-display text-[24px] font-bold tracking-[-0.03em]">Signing you in…</p>
      <p className="mt-1.5 text-[14px] text-bk-muted">This only takes a moment.</p>
      <AuthenticateWithRedirectCallback
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
        firstFactorUrl="/sign-in"
        secondFactorUrl="/sign-in?step=verify"
        verifyEmailAddressUrl="/sign-up?step=verify"
        continueSignUpUrl="/sign-up?step=continue"
      />
      {/* Clerk's bot protection can check a new Google sign-up here. */}
      <div id="clerk-captcha" className="mt-6" />
    </div>
  )
}
