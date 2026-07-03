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
import { getUserSecurity, upsertUserSecurity, setMfaMetadataFlag } from '@/lib/mfa/store'
import { MFA_COOKIE_NAME } from '@/lib/mfa/step-up'
import { logActivity } from '@/lib/activity/log'
import { createNotification } from '@/lib/notifications/create'

const SCHEMA = z.object({ code: z.string().trim().min(6).max(12) })

// POST /api/v1/security/2fa/disable
// Turn off 2FA. Requires a current TOTP code or a valid backup code.
export async function POST(request: Request) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  if (await isRateLimitedKey(user.id, 'mfa-disable', { max: 10, windowMs: 5 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много попыток. Попробуйте позже.' }, { status: 429 })
  }

  const parsed = SCHEMA.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid_code' }, { status: 422 })

  const row = await getUserSecurity(user.id)
  if (!row?.totp_enabled) return NextResponse.json({ ok: false, error: 'not_enabled' }, { status: 400 })

  let ok = false
  if (row.totp_secret_enc) {
    try {
      ok = verifyTOTP(parsed.data.code, decryptSecret(row.totp_secret_enc))
    } catch {
      /* fall through to backup-code check */
    }
  }
  if (!ok) ok = (await findBackupCodeIndex(parsed.data.code, row.backup_codes)) >= 0
  if (!ok) return NextResponse.json({ ok: false, error: 'invalid_code' }, { status: 422 })

  await upsertUserSecurity(user.id, {
    totp_enabled: false,
    totp_secret_enc: null,
    totp_pending_enc: null,
    backup_codes: [],
  })
  await setMfaMetadataFlag(user.id, false)

  const jar = await cookies()
  jar.set(MFA_COOKIE_NAME, '', { path: '/', maxAge: 0 })

  await logActivity({
    userId: user.id,
    action: 'security.2fa_disabled',
    category: 'security',
    severity: 'critical',
    description: 'Двухфакторная аутентификация отключена',
    req: request,
  })
  await createNotification({
    userId: user.id,
    title: 'Двухфакторная аутентификация отключена',
    body: 'Если это были не вы — немедленно смените пароль и включите 2FA снова.',
    category: 'security',
    priority: 'high',
    link: '/settings',
  }).catch(() => {})

  return NextResponse.json({ ok: true })
}
