export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/api-identity'
import { listCredentials, deleteCredential, countCredentials } from '@/lib/webauthn/store'
import { setMfaWebauthnFlag } from '@/lib/mfa/store'
import { logActivity } from '@/lib/activity/log'

// GET /api/v1/security/webauthn/credentials — the caller's passkeys (no secrets).
export async function GET() {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const creds = await listCredentials(user.id)
  return NextResponse.json({
    ok: true,
    credentials: creds.map((c) => ({
      id: c.id,
      label: c.label,
      device_type: c.device_type,
      backed_up: c.backed_up,
      created_at: c.created_at,
      last_used_at: c.last_used_at,
    })),
  })
}

// DELETE /api/v1/security/webauthn/credentials — remove one passkey.
const DELETE_SCHEMA = z.object({ id: z.string().min(1) })

export async function DELETE(request: Request) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const parsed = DELETE_SCHEMA.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })

  const removed = await deleteCredential(user.id, parsed.data.id)
  if (!removed) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  // If that was the last passkey, clear the enforcement flag.
  if ((await countCredentials(user.id)) === 0) {
    await setMfaWebauthnFlag(user.id, false)
  }

  await logActivity({
    userId: user.id,
    action: 'security.passkey_removed',
    category: 'security',
    severity: 'warning',
    description: 'Удалён ключ доступа (passkey)',
    req: request,
  })

  return NextResponse.json({ ok: true })
}
