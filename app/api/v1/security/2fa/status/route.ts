export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/api-identity'
import { isEncryptionConfigured } from '@/lib/crypto/secrets'
import { getUserSecurity } from '@/lib/mfa/store'
import { countCredentials } from '@/lib/webauthn/store'

// GET /api/v1/security/2fa/status — the caller's own MFA state (TOTP + passkeys).
export async function GET() {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const [row, passkeys] = await Promise.all([getUserSecurity(user.id), countCredentials(user.id)])
  return NextResponse.json({
    ok: true,
    enabled: !!row?.totp_enabled,
    pending: !!row?.totp_pending_enc,
    backup_codes_remaining: row?.backup_codes?.length ?? 0,
    encryption_configured: isEncryptionConfigured(),
    passkeys_count: passkeys,
    webauthn_enabled: passkeys > 0,
  })
}
