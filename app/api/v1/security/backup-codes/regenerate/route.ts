export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/api-identity'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { decryptSecret } from '@/lib/crypto/secrets'
import { verifyTOTP } from '@/lib/mfa/totp'
import { generateBackupCodes, hashBackupCodes } from '@/lib/mfa/backup-codes'
import { getUserSecurity, upsertUserSecurity } from '@/lib/mfa/store'
import { logActivity } from '@/lib/activity/log'

const SCHEMA = z.object({ code: z.string().trim().min(6).max(10) })

// POST /api/v1/security/backup-codes/regenerate
// Issue a fresh set of backup codes (invalidating the old ones). Requires a
// current TOTP code — not a backup code — to prove possession of the device.
export async function POST(request: Request) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  if (await isRateLimitedKey(user.id, 'mfa-backup-regen', { max: 5, windowMs: 5 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много попыток. Попробуйте позже.' }, { status: 429 })
  }

  const parsed = SCHEMA.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid_code' }, { status: 422 })

  const row = await getUserSecurity(user.id)
  if (!row?.totp_enabled || !row.totp_secret_enc) {
    return NextResponse.json({ ok: false, error: 'not_enabled' }, { status: 400 })
  }

  let valid = false
  try {
    valid = verifyTOTP(parsed.data.code, decryptSecret(row.totp_secret_enc))
  } catch {
    return NextResponse.json({ ok: false, error: 'encryption_error' }, { status: 500 })
  }
  if (!valid) return NextResponse.json({ ok: false, error: 'invalid_code' }, { status: 422 })

  const codes = generateBackupCodes()
  await upsertUserSecurity(user.id, { backup_codes: await hashBackupCodes(codes) })

  await logActivity({
    userId: user.id,
    action: 'security.backup_codes_regenerated',
    category: 'security',
    severity: 'warning',
    description: 'Резервные коды перевыпущены',
    req: request,
  })

  return NextResponse.json({ ok: true, backup_codes: codes })
}
