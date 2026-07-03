export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import type { RegistrationResponseJSON } from '@simplewebauthn/types'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/api-identity'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { getWebAuthnConfig, deviceLabelFromRequest } from '@/lib/webauthn/config'
import { insertCredential } from '@/lib/webauthn/store'
import { WEBAUTHN_CHALLENGE_COOKIE, readChallenge } from '@/lib/webauthn/challenge'
import { getUserSecurity, upsertUserSecurity, setMfaWebauthnFlag } from '@/lib/mfa/store'
import { generateBackupCodes, hashBackupCodes } from '@/lib/mfa/backup-codes'
import { MFA_COOKIE_NAME, MFA_COOKIE_OPTIONS, signStepUp } from '@/lib/mfa/step-up'
import { logActivity } from '@/lib/activity/log'

// POST /api/v1/security/webauthn/register/verify
// Body: { response: RegistrationResponseJSON, label?: string }
export async function POST(request: Request) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  if (await isRateLimitedKey(user.id, 'webauthn-reg-verify', { max: 10, windowMs: 5 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много попыток. Попробуйте позже.' }, { status: 429 })
  }

  const body = (await request.json().catch(() => null)) as { response?: RegistrationResponseJSON; label?: string } | null
  if (!body?.response) return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })

  const jar = await cookies()
  const expectedChallenge = readChallenge(jar.get(WEBAUTHN_CHALLENGE_COOKIE)?.value, user.id, 'reg')
  if (!expectedChallenge) return NextResponse.json({ ok: false, error: 'challenge_expired' }, { status: 400 })

  const { rpID, origin } = getWebAuthnConfig(request)

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    })
  } catch {
    jar.set(WEBAUTHN_CHALLENGE_COOKIE, '', { path: '/', maxAge: 0 })
    return NextResponse.json({ ok: false, error: 'verification_failed' }, { status: 400 })
  }
  jar.set(WEBAUTHN_CHALLENGE_COOKIE, '', { path: '/', maxAge: 0 })

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ ok: false, error: 'not_verified' }, { status: 400 })
  }

  const info = verification.registrationInfo
  const credId = isoBase64URL.fromBuffer(info.credentialID)
  const label = typeof body.label === 'string' && body.label.trim()
    ? body.label.trim().slice(0, 60)
    : deviceLabelFromRequest(request)

  await insertCredential({
    id: credId,
    user_id: user.id,
    public_key: isoBase64URL.fromBuffer(info.credentialPublicKey),
    counter: info.counter,
    transports: (body.response.response?.transports ?? []) as string[],
    device_type: info.credentialDeviceType,
    backed_up: info.credentialBackedUp,
    label,
  })
  await setMfaWebauthnFlag(user.id, true)

  // Recovery: if this passkey is the user's FIRST factor (no TOTP, no codes yet),
  // issue backup codes so losing the device can't lock them out permanently.
  let backup_codes: string[] | undefined
  const sec = await getUserSecurity(user.id)
  if (!sec?.totp_enabled && (!sec?.backup_codes || sec.backup_codes.length === 0)) {
    const codes = generateBackupCodes()
    await upsertUserSecurity(user.id, { backup_codes: await hashBackupCodes(codes) })
    backup_codes = codes
  }

  // Trust the enrolling device for this session.
  jar.set(MFA_COOKIE_NAME, signStepUp(user.id), MFA_COOKIE_OPTIONS)

  await logActivity({
    userId: user.id,
    action: 'security.passkey_added',
    category: 'security',
    severity: 'critical',
    description: `Добавлен ключ доступа (passkey): ${label}`,
    req: request,
  })

  return NextResponse.json({ ok: true, credential: { id: credId, label }, backup_codes })
}
