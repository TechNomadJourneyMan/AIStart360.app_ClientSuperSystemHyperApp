export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/api-identity'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { isEncryptionConfigured, encryptSecret } from '@/lib/crypto/secrets'
import { generateSecret, otpauthURL } from '@/lib/mfa/totp'
import { upsertUserSecurity } from '@/lib/mfa/store'
import { guardFactorChange } from '@/lib/mfa/factor-guard'

// POST /api/v1/security/2fa/setup
// Begin TOTP enrollment: mint a secret (kept PENDING until /verify confirms the
// user can produce a valid code), return the otpauth URI + QR for the app.
// R-003: with a factor already in place (TOTP or a passkey) this re-binds the
// second factor — only with the step-up of this session.
export async function POST(request: Request) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  if (await isRateLimitedKey(user.id, 'mfa-setup', { max: 5, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много попыток. Попробуйте позже.' }, { status: 429 })
  }
  if (!isEncryptionConfigured()) {
    return NextResponse.json({ ok: false, error: 'encryption_not_configured' }, { status: 503 })
  }

  const guard = await guardFactorChange(request, user, 'totp.setup')
  if (!guard.ok) return guard.response

  const secret = generateSecret()
  await upsertUserSecurity(user.id, { totp_pending_enc: encryptSecret(secret) })

  const uri = otpauthURL(secret, user.email ?? user.id)
  const qr = await QRCode.toString(uri, { type: 'svg', margin: 1, width: 220 })

  // `secret` is returned for manual entry — over HTTPS, to the authenticated
  // owner enrolling their own factor. Standard for TOTP setup screens.
  return NextResponse.json({ ok: true, otpauth_uri: uri, qr_svg: qr, secret })
}
