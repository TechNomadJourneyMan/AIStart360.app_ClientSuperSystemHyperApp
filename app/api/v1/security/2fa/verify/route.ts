export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/api-identity'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { decryptSecret } from '@/lib/crypto/secrets'
import { verifyTOTP } from '@/lib/mfa/totp'
import { generateBackupCodes, hashBackupCodes } from '@/lib/mfa/backup-codes'
import { getUserSecurity, upsertUserSecurity, setMfaMetadataFlag } from '@/lib/mfa/store'
import { MFA_COOKIE_NAME, MFA_COOKIE_OPTIONS, signStepUp } from '@/lib/mfa/step-up'
import { logActivity } from '@/lib/activity/log'
import { createNotification } from '@/lib/notifications/create'

const SCHEMA = z.object({ code: z.string().trim().min(6).max(10) })

// POST /api/v1/security/2fa/verify
// Confirm the pending TOTP secret, enable 2FA, issue one-time backup codes, and
// set the step-up cookie so the current session isn't immediately gated.
export async function POST(request: Request) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  if (await isRateLimitedKey(user.id, 'mfa-verify', { max: 10, windowMs: 5 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много попыток. Попробуйте позже.' }, { status: 429 })
  }

  const parsed = SCHEMA.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid_code' }, { status: 422 })

  const row = await getUserSecurity(user.id)
  if (!row?.totp_pending_enc) {
    return NextResponse.json({ ok: false, error: 'no_pending_setup' }, { status: 400 })
  }

  let secret: string
  try {
    secret = decryptSecret(row.totp_pending_enc)
  } catch {
    return NextResponse.json({ ok: false, error: 'encryption_error' }, { status: 500 })
  }
  if (!verifyTOTP(parsed.data.code, secret)) {
    return NextResponse.json({ ok: false, error: 'invalid_code' }, { status: 422 })
  }

  const codes = generateBackupCodes()
  const hashes = await hashBackupCodes(codes)

  await upsertUserSecurity(user.id, {
    totp_enabled: true,
    totp_secret_enc: row.totp_pending_enc,
    totp_pending_enc: null,
    backup_codes: hashes,
  })
  await setMfaMetadataFlag(user.id, true)

  const jar = await cookies()
  jar.set(MFA_COOKIE_NAME, signStepUp(user.id), MFA_COOKIE_OPTIONS)

  await logActivity({
    userId: user.id,
    action: 'security.2fa_enabled',
    category: 'security',
    severity: 'critical',
    description: 'Двухфакторная аутентификация включена',
    req: request,
  })
  await createNotification({
    userId: user.id,
    title: 'Двухфакторная аутентификация включена',
    body: 'Теперь при входе потребуется код из приложения-аутентификатора. Сохраните резервные коды в надёжном месте.',
    category: 'security',
    priority: 'high',
    link: '/settings',
  }).catch(() => {})

  // Backup codes are returned ONCE here — the client must show and let the user save them.
  return NextResponse.json({ ok: true, backup_codes: codes })
}
