export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { IMP_COOKIE_NAME, readImpersonation } from '@/lib/impersonation/token'
import { impersonationForAuthSession } from '@/lib/impersonation/server'
import { stepUpSessionKeyFromCookies } from '@/lib/mfa/session-binding'
import { recordAdminAction } from '@/lib/admin/audit'
import { trackEvent } from '@/lib/events/track'
import { isStaffRole } from '@/lib/admin/rbac'

// POST /api/v1/impersonation/exit — «Выйти из режима пользователя».
// Closes the DB session, signs the browser out of the user's account and sends
// the admin back to the user's card in GIGA-CRM.
//
// R-008: only the impersonation session is revoked (signOut scope 'local' —
// the GoTrue session of this browser), never every session of the client
// (the default 'global' threw the client out on all their devices). Without
// the cookie the session is found through its server-side binding.
export async function POST(req: NextRequest) {
  const jar = cookies()
  const v = await readImpersonation(jar.get(IMP_COOKIE_NAME)?.value)
  // Read before the sign-out clears the session cookies.
  const sessionKey = stepUpSessionKeyFromCookies(jar.getAll())

  let who: { sid: string; aid: string; alabel: string; arole: unknown; uid: string; reason: string } | null = v.claims
    ? { sid: v.claims.sid, aid: v.claims.aid, alabel: v.claims.alabel, arole: v.claims.arole, uid: v.claims.uid, reason: v.ok ? 'exit' : 'exit_after_expiry' }
    : null
  if (!who) {
    const row = await impersonationForAuthSession(sessionKey).catch(() => null)
    if (row) who = { sid: row.id, aid: row.admin_id, alabel: row.admin_email ?? row.admin_id, arole: row.admin_role, uid: row.target_user_id, reason: 'exit_without_cookie' }
  }

  const userClient = createServerClient()
  await userClient.auth.signOut({ scope: 'local' }).catch(() => {})
  jar.delete(IMP_COOKIE_NAME)
  if (!who) return NextResponse.json({ ok: true, redirect: '/admin-giga-panel' })

  const sb = createServiceClient()
  const { data: updated } = await sb
    .from('impersonation_sessions')
    .update({ ended_at: new Date().toISOString(), end_reason: who.reason })
    .eq('id', who.sid)
    .is('ended_at', null)
    .select('id')
  if (updated && updated.length) {
    await recordAdminAction(
      { id: who.aid, kind: 'session', email: who.alabel, role: isStaffRole(who.arole) ? who.arole : undefined },
      { action: 'impersonation.ended', entityType: 'impersonation', entityId: who.sid, targetUserId: who.uid, impersonationSessionId: who.sid, metadata: { reason: who.reason } },
      req,
    )
    void trackEvent({ userId: who.uid, name: 'IMPERSONATION_ENDED', entityType: 'impersonation', entityId: who.sid, source: 'admin', impersonationSessionId: who.sid })
  }
  return NextResponse.json({ ok: true, redirect: `/admin-giga-panel/users/${who.uid}` })
}
