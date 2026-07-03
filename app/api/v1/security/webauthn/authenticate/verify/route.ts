export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from '@simplewebauthn/types'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/api-identity'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { getWebAuthnConfig } from '@/lib/webauthn/config'
import { getCredentialForUser, updateCredentialCounter } from '@/lib/webauthn/store'
import { WEBAUTHN_CHALLENGE_COOKIE, readChallenge } from '@/lib/webauthn/challenge'
import { MFA_COOKIE_NAME, MFA_COOKIE_OPTIONS, signStepUp } from '@/lib/mfa/step-up'
import { logActivity } from '@/lib/activity/log'

// POST /api/v1/security/webauthn/authenticate/verify
// Body: { response: AuthenticationResponseJSON }
// Verifies a passkey assertion and sets the MFA step-up cookie (satisfies the gate).
export async function POST(request: Request) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  if (await isRateLimitedKey(user.id, 'webauthn-auth-verify', { max: 10, windowMs: 5 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много попыток. Попробуйте позже.' }, { status: 429 })
  }

  const body = (await request.json().catch(() => null)) as { response?: AuthenticationResponseJSON } | null
  if (!body?.response?.id) return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })

  const jar = await cookies()
  const expectedChallenge = readChallenge(jar.get(WEBAUTHN_CHALLENGE_COOKIE)?.value, user.id, 'auth')
  if (!expectedChallenge) return NextResponse.json({ ok: false, error: 'challenge_expired' }, { status: 400 })

  const cred = await getCredentialForUser(user.id, body.response.id)
  if (!cred) {
    jar.set(WEBAUTHN_CHALLENGE_COOKIE, '', { path: '/', maxAge: 0 })
    return NextResponse.json({ ok: false, error: 'unknown_credential' }, { status: 400 })
  }

  const { rpID, origin } = getWebAuthnConfig(request)

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator: {
        credentialID: isoBase64URL.toBuffer(cred.id),
        credentialPublicKey: isoBase64URL.toBuffer(cred.public_key),
        counter: cred.counter,
        transports: cred.transports as AuthenticatorTransportFuture[],
      },
      requireUserVerification: false,
    })
  } catch {
    jar.set(WEBAUTHN_CHALLENGE_COOKIE, '', { path: '/', maxAge: 0 })
    return NextResponse.json({ ok: false, error: 'verification_failed' }, { status: 422 })
  }
  jar.set(WEBAUTHN_CHALLENGE_COOKIE, '', { path: '/', maxAge: 0 })

  if (!verification.verified) {
    await logActivity({
      userId: user.id, action: 'security.2fa_failed', category: 'security',
      severity: 'warning', status: 'failure', description: 'Неудачная проверка ключа доступа', req: request,
    })
    return NextResponse.json({ ok: false, error: 'not_verified' }, { status: 422 })
  }

  await updateCredentialCounter(cred.id, verification.authenticationInfo.newCounter)
  jar.set(MFA_COOKIE_NAME, signStepUp(user.id), MFA_COOKIE_OPTIONS)

  await logActivity({
    userId: user.id, action: 'security.2fa_passed', category: 'security',
    severity: 'info', description: `Вход подтверждён ключом доступа: ${cred.label ?? 'passkey'}`, req: request,
  })

  return NextResponse.json({ ok: true })
}
