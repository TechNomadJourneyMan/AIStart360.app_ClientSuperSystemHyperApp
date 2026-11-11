/**
 * lib/dev/dev-cookies.ts — cookies that describe the identity a browser had
 * BEFORE the developer login changed it. Node / server only.
 *
 * A developer login or logout replaces the Supabase session, but three other
 * cookies outlive it and would blur what the new account may do:
 *  - the personal staff cookie keeps a former admin in the GIGA panel for up
 *    to two hours (it exists so the panel survives impersonation);
 *  - the impersonation cookie marks the browser as an admin driving somebody
 *    else's cabinet;
 *  - the step-up cookie is the proof of a second factor already passed.
 * Names and options come from the modules that own the cookies.
 */
import type { NextResponse } from 'next/server'
import { STAFF_COOKIE_NAME } from '@/lib/admin/giga-actor'
import { IMP_COOKIE_NAME, IMP_COOKIE_OPTIONS } from '@/lib/impersonation/token'
import { MFA_COOKIE_NAME, MFA_COOKIE_OPTIONS } from '@/lib/mfa/step-up'

export function clearIdentityCookies(res: NextResponse): void {
  // The staff cookie has no exported options; this is how the panel sign-out clears it.
  res.cookies.set(STAFF_COOKIE_NAME, '', { path: '/', maxAge: 0 })
  res.cookies.set(IMP_COOKIE_NAME, '', { ...IMP_COOKIE_OPTIONS, maxAge: 0 })
  res.cookies.set(MFA_COOKIE_NAME, '', { ...MFA_COOKIE_OPTIONS, maxAge: 0 })
}
