export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'
import { getGigaActor, STAFF_COOKIE_NAME } from '@/lib/admin/giga-actor'

/**
 * The shared-password «break-glass» login (POST) was removed: the GIGA panel
 * is entered only through a personal account at /login (+ 2FA). Only the
 * logout remains here.
 */

/** Cookie of the retired break-glass entry — still cleared on logout so stale browsers are cleaned up. */
const LEGACY_GIGA_COOKIE_NAME = 'aistart360_giga'

function clientIp(req: NextRequest): string {
  const value = (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  ).trim()
  return value.length > 0 && value.length <= 64 ? value : 'unknown'
}

/**
 * DELETE /api/giga-admin/auth — GIGA logout: clears the personal staff cookie
 * issued during impersonation (and the retired break-glass cookie). The
 * Supabase session itself is signed out by the caller through the normal
 * auth flow.
 */
export async function DELETE(req: NextRequest) {
  const actor = await getGigaActor(req).catch(() => null)
  const response = NextResponse.json({ ok: true })
  response.cookies.set(STAFF_COOKIE_NAME, '', { path: '/', maxAge: 0 })
  response.cookies.set(LEGACY_GIGA_COOKIE_NAME, '', { path: '/', maxAge: 0 })
  if (actor) {
    await logAudit({
      entityType: 'system',
      entityId: 'giga_panel',
      action: 'admin.logout',
      performedBy: actor.id,
      diff: { after: { method: 'staff_cookie_cleared' }, actorKind: actor.kind },
      ipAddress: clientIp(req),
    })
  }
  return response
}
