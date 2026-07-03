export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/api-identity'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { decryptSecret } from '@/lib/crypto/secrets'
import { verifyTOTP } from '@/lib/mfa/totp'
import { findBackupCodeIndex } from '@/lib/mfa/backup-codes'
import { getUserSecurity, upsertUserSecurity } from '@/lib/mfa/store'
import { MFA_COOKIE_NAME, MFA_COOKIE_OPTIONS, signStepUp } from '@/lib/mfa/step-up'
import { logActivity } from '@/lib/activity/log'

const SCHEMA = z.object({ code: z.string().trim().min(6).max(12) })

// POST /api/v1/security/2fa/challenge
// Login step-up: verify a TOTP code (or a one-time backup code) for an already
// password-authenticated session, then set the step-up cookie. Strictly
// throttled — this is the brute-force surface for the second factor.
export async function POST(request: Request) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  if (await isRateLimitedKey(user.id, 'mfa-challenge', { max: 10, windowMs: 5 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много попыток. Попробуйте позже.' }, { status: 429 })
  }

  const parsed = SCHEMA.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid_code' }, { status: 422 })

  const row = await getUserSecurity(user.id)
  // Accept a TOTP code (if enrolled) OR a backup code (which also covers
  // passkey-only users recovering on a device without their passkey).
  const hasTotp = !!row?.totp_enabled && !!row?.totp_secret_enc
  const hasBackup = (row?.backup_codes?.length ?? 0) > 0
  if (!row || (!hasTotp && !hasBackup)) {
    return NextResponse.json({ ok: false, error: 'not_enrolled' }, { status: 400 })
  }

  let ok = false
  if (hasTotp && row.totp_secret_enc) {
    try {
      ok = verifyTOTP(parsed.data.code, decryptSecret(row.totp_secret_enc))
    } catch {
      /* fall through to backup-code check */
    }
  }

  let usedBackup = false
  if (!ok) {
    const idx = await findBackupCodeIndex(parsed.data.code, row.backup_codes)
    if (idx >= 0) {
      ok = true
      usedBackup = true
      const remaining = row.backup_codes.filter((_, i) => i !== idx)
      await upsertUserSecurity(user.id, { backup_codes: remaining })
    }
  }

  if (!ok) {
    await logActivity({
      userId: user.id,
      action: 'security.2fa_failed',
      category: 'security',
      severity: 'warning',
      status: 'failure',
      description: 'Неверный код второго фактора',
      req: request,
    })
    return NextResponse.json({ ok: false, error: 'invalid_code' }, { status: 422 })
  }

  const jar = await cookies()
  jar.set(MFA_COOKIE_NAME, signStepUp(user.id), MFA_COOKIE_OPTIONS)

  await logActivity({
    userId: user.id,
    action: 'security.2fa_passed',
    category: 'security',
    severity: 'info',
    description: usedBackup ? 'Вход подтверждён резервным кодом' : 'Вход подтверждён вторым фактором',
    req: request,
  })

  return NextResponse.json({ ok: true, used_backup: usedBackup })
}
