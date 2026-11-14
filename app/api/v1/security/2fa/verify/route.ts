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
import { generateBackupCodes, hashBackupCodes } from '@/lib/mfa/backup-codes'
import { getUserSecurity, upsertUserSecurity, setMfaMetadataFlag } from '@/lib/mfa/store'
import { currentStepUpSessionKey } from '@/lib/mfa/step-up'
import { STEP_UP_RECORD_FAILED_MESSAGE, issueStepUp } from '@/lib/mfa/step-up-session'
import { guardFactorChange } from '@/lib/mfa/factor-guard'
import { logActivity } from '@/lib/activity/log'
import { createNotification } from '@/lib/notifications/create'

const SCHEMA = z.object({ code: z.string().trim().min(6).max(10) })

// POST /api/v1/security/2fa/verify
// Confirm the pending TOTP secret, enable 2FA, issue one-time backup codes, and
// — for the account's FIRST factor only — set the step-up cookie so the current
// session isn't immediately gated. R-003: with a factor already in place this
// re-binds TOTP and needs the step-up of this session.
export async function POST(request: Request) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  if (await isRateLimitedKey(user.id, 'mfa-verify', { max: 10, windowMs: 5 * 60_000 }) || await isRateLimitedKey(user.id, 'mfa-otp-day', MFA_OTP_DAILY)) {
    return NextResponse.json({ ok: false, error: 'Слишком много попыток. Попробуйте позже.' }, { status: 429 })
  }

  const parsed = SCHEMA.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid_code' }, { status: 422 })

  const guard = await guardFactorChange(request, user, 'totp.verify')
  if (!guard.ok) return guard.response

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

  // Both writes or neither: the factor in user_security and the gate flag in
  // the JWT metadata (middleware gates on the flag). The DB row goes first —
  // a flag without an enabled secret would gate a user who cannot verify — and
  // is restored to the pending state when the flag write fails (the store
  // throws on any error), so the user never ends up with totp_enabled=true
  // and no gate.
  try {
    await upsertUserSecurity(user.id, {
      totp_enabled: true,
      totp_secret_enc: row.totp_pending_enc,
      totp_pending_enc: null,
      backup_codes: hashes,
    })
  } catch (err) {
    console.error('[2fa/verify] enable failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось включить 2FA. Попробуйте ещё раз.' }, { status: 500 })
  }
  try {
    await setMfaMetadataFlag(user.id, true)
  } catch (err) {
    console.error('[2fa/verify] flag write failed, rolling back', err instanceof Error ? err.message : err)
    try {
      await upsertUserSecurity(user.id, {
        totp_enabled: row.totp_enabled,
        totp_secret_enc: row.totp_secret_enc,
        totp_pending_enc: row.totp_pending_enc,
        backup_codes: row.backup_codes,
      })
    } catch (rollbackErr) {
      console.error('[2fa/verify] rollback failed', rollbackErr instanceof Error ? rollbackErr.message : rollbackErr)
    }
    return NextResponse.json({ ok: false, error: 'Не удалось включить 2FA. Попробуйте ещё раз.' }, { status: 500 })
  }

  // SR-01 (143): the step-up is recorded for the database before the cookie.
  // 2FA itself is already on; without the record the user simply confirms the
  // new factor once more on /2fa (middleware sends them there).
  let stepUpNotice: string | undefined
  if (guard.firstFactor) {
    const sessionKey = currentStepUpSessionKey()
    if (sessionKey) {
      try {
        await issueStepUp(await cookies(), user.id, sessionKey, 'first_factor_totp')
      } catch (err) {
        console.error('[2fa/verify] step-up record failed', err instanceof Error ? err.message : err)
        stepUpNotice = `${STEP_UP_RECORD_FAILED_MESSAGE} 2FA включена — при следующем переходе подтвердите вход кодом.`
      }
    }
  }

  const rebound = row.totp_enabled
  await logActivity({
    userId: user.id,
    action: rebound ? 'security.2fa_rebound' : 'security.2fa_enabled',
    category: 'security',
    severity: 'critical',
    description: rebound ? 'Приложение-аутентификатор перепривязано' : 'Двухфакторная аутентификация включена',
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
  return NextResponse.json({ ok: true, backup_codes: codes, ...(stepUpNotice ? { step_up: false, notice: stepUpNotice } : {}) })
}
