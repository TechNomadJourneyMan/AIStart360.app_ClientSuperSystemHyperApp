export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/types'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/api-identity'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { getWebAuthnConfig } from '@/lib/webauthn/config'
import { listCredentials } from '@/lib/webauthn/store'
import { WEBAUTHN_CHALLENGE_COOKIE, WEBAUTHN_CHALLENGE_COOKIE_OPTIONS, signChallenge } from '@/lib/webauthn/challenge'

// POST /api/v1/security/webauthn/register/options
// Begin passkey enrollment for the authenticated user.
export async function POST(request: Request) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  if (await isRateLimitedKey(user.id, 'webauthn-reg-options', { max: 10, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много попыток. Попробуйте позже.' }, { status: 429 })
  }

  const { rpID, rpName } = getWebAuthnConfig(request)
  const existing = await listCredentials(user.id)

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: user.id,
    userName: user.email ?? user.id,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({
      id: isoBase64URL.toBuffer(c.id),
      type: 'public-key',
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  })

  const jar = await cookies()
  jar.set(WEBAUTHN_CHALLENGE_COOKIE, signChallenge(user.id, 'reg', options.challenge), WEBAUTHN_CHALLENGE_COOKIE_OPTIONS)

  return NextResponse.json({ ok: true, options })
}
