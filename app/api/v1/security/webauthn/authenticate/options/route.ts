export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/types'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/api-identity'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { getWebAuthnConfig } from '@/lib/webauthn/config'
import { listCredentials } from '@/lib/webauthn/store'
import { WEBAUTHN_CHALLENGE_COOKIE, WEBAUTHN_CHALLENGE_COOKIE_OPTIONS, signChallenge } from '@/lib/webauthn/challenge'

// POST /api/v1/security/webauthn/authenticate/options
// Begin a passkey step-up for the already password-authenticated session.
export async function POST(request: Request) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  if (await isRateLimitedKey(user.id, 'webauthn-auth-options', { max: 15, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много попыток. Попробуйте позже.' }, { status: 429 })
  }

  const creds = await listCredentials(user.id)
  if (creds.length === 0) return NextResponse.json({ ok: false, error: 'no_passkeys' }, { status: 400 })

  const { rpID } = getWebAuthnConfig(request)
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    allowCredentials: creds.map((c) => ({
      id: isoBase64URL.toBuffer(c.id),
      type: 'public-key',
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
  })

  const jar = await cookies()
  jar.set(WEBAUTHN_CHALLENGE_COOKIE, signChallenge(user.id, 'auth', options.challenge), WEBAUTHN_CHALLENGE_COOKIE_OPTIONS)

  return NextResponse.json({ ok: true, options })
}
