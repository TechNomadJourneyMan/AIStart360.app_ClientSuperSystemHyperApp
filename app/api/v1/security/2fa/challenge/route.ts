export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/api-identity'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { MFA_OTP_DAILY } from '@/lib/rate-limit/policies'
import { decryptSecret } from '@/lib/crypto/secrets'
import { verifyTOTP } from '@/lib/mfa/totp'
import { findBackupCodeIndex } from '@/lib/mfa/backup-codes'
import { getUserSecurity, upsertUserSecurity } from '@/lib/mfa/store'
import { MFA_COOKIE_NAME, MFA_COOKIE_OPTIONS, currentStepUpSessionKey, signStepUp } from '@/lib/mfa/step-up'
import { forgetStepUpSession, recordStepUpSession, stepUpFailure } from '@/lib/mfa/step-up-session'
import { countCredentials } from '@/lib/webauthn/store'
import { logActivity } from '@/lib/activity/log'
import { refuseDuringImpersonation } from '@/lib/impersonation/guard'

const SCHEMA = z.object({ code: z.string().trim().min(6).max(12) })

// POST /api/v1/security/2fa/challenge
// Login step-up: verify a TOTP code (or a one-time backup code) for an already
// password-authenticated session, then set the step-up cookie. Strictly
// throttled — this is the brute-force surface for the second factor.
export async function POST(request: Request) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  // SR-07: never «от имени клиента» (lib/impersonation/guard.ts).
  const impersonated = await refuseDuringImpersonation(request, user, 'mfa.challenge')
  if (impersonated) return impersonated

  if (await isRateLimitedKey(user.id, 'mfa-challenge', { max: 10, windowMs: 5 * 60_000 }) || await isRateLimitedKey(user.id, 'mfa-otp-day', MFA_OTP_DAILY)) {
    return NextResponse.json({ ok: false, error: 'Слишком много попыток. Попробуйте позже.' }, { status: 429 })
  }

  const parsed = SCHEMA.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid_code' }, { status: 422 })

  // R-132: the proof is bound to this Supabase session (a new sign-in is a new
  // session and needs the second factor again). Checked before a backup code
  // is consumed.
  const sessionKey = currentStepUpSessionKey()
  if (!sessionKey) {
    return NextResponse.json({ ok: false, error: 'Сессия не найдена. Войдите заново.' }, { status: 401 })
  }

  const row = await getUserSecurity(user.id)
  // Accept a TOTP code (if enrolled) OR a backup code (which also covers
  // passkey-only users recovering on a device without their passkey).
  const hasTotp = !!row?.totp_enabled && !!row?.totp_secret_enc
  const hasBackup = (row?.backup_codes?.length ?? 0) > 0
  if (!row || (!hasTotp && !hasBackup)) {
    // Distinguish "no factors at all" from "only passkey, no backup codes issued".
    // The second case can happen for users who enrolled a passkey before
    // auto-issue-backup-codes was added — they must use the passkey button, or
    // an admin must reset MFA (/api/giga-admin/users/:id/2fa-reset).
    const passkeys = await countCredentials(user.id).catch(() => 0)
    return NextResponse.json({
      ok: false,
      error: passkeys > 0 ? 'no_backup_codes' : 'not_enrolled',
    }, { status: 400 })
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
  let backupIdx = -1
  if (!ok) {
    backupIdx = await findBackupCodeIndex(parsed.data.code, row.backup_codes)
    if (backupIdx >= 0) {
      ok = true
      usedBackup = true
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

  // SR-01 (143): the database learns of the step-up first — staff RLS rights
  // need this record. No record → no cookie, and a backup code is not spent.
  try {
    await recordStepUpSession(user.id, sessionKey, usedBackup ? 'backup_code' : 'totp')
  } catch (err) {
    console.error('[2fa/challenge] step-up record failed', err instanceof Error ? err.message : err)
    const { status, error } = stepUpFailure(err)
    return NextResponse.json({ ok: false, error }, { status })
  }
  if (usedBackup) {
    try {
      await upsertUserSecurity(user.id, { backup_codes: row.backup_codes.filter((_, i) => i !== backupIdx) })
    } catch (err) {
      // The code must not stay usable after it let somebody in: undo the record.
      await forgetStepUpSession(sessionKey)
      throw err
    }
  }

  const jar = await cookies()
  jar.set(MFA_COOKIE_NAME, signStepUp(user.id, sessionKey), MFA_COOKIE_OPTIONS)

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
