export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { IMP_COOKIE_NAME, readImpersonation } from '@/lib/impersonation/token'
import { recordAdminAction } from '@/lib/admin/audit'
import { trackEvent } from '@/lib/events/track'
import { isStaffRole } from '@/lib/admin/rbac'

// POST /api/v1/impersonation/exit — «Выйти из режима пользователя».
// Closes the DB session, signs the browser out of the user's account and sends
// the admin back to the user's card in GIGA-CRM.
export async function POST(_req: NextRequest) {
  const jar = cookies()
  const v = await readImpersonation(jar.get(IMP_COOKIE_NAME)?.value)
  const claims = v.claims
  const userClient = createServerClient()
  await userClient.auth.signOut().catch(() => {})
  jar.delete(IMP_COOKIE_NAME)
  if (!claims) return NextResponse.json({ ok: true, redirect: '/admin-giga-panel' })

  const sb = createServiceClient()
  const { data: updated } = await sb
    .from('impersonation_sessions')
    .update({ ended_at: new Date().toISOString(), end_reason: v.ok ? 'exit' : 'exit_after_expiry' })
    .eq('id', claims.sid)
    .is('ended_at', null)
    .select('id')
  if (updated && updated.length) {
    await recordAdminAction(
      { id: claims.aid, kind: claims.aid.startsWith('giga:') ? 'break_glass' : 'session', email: claims.alabel, role: isStaffRole(claims.arole) ? claims.arole : undefined },
      { action: 'impersonation.ended', entityType: 'impersonation', entityId: claims.sid, targetUserId: claims.uid, impersonationSessionId: claims.sid },
      _req,
    )
    void trackEvent({ userId: claims.uid, name: 'IMPERSONATION_ENDED', entityType: 'impersonation', entityId: claims.sid, source: 'admin', impersonationSessionId: claims.sid })
  }
  return NextResponse.json({ ok: true, redirect: `/admin-giga-panel/users/${claims.uid}` })
}
