/**
 * Конец impersonation в ЭТОМ браузере: общая логика «Выйти из режима
 * пользователя» (POST /api/v1/impersonation/exit) и любого «Выйти» во время
 * impersonation (SR-06: /api/v1/auth/sign-out, DELETE /api/giga-admin/auth).
 *
 * R-008 / SR-06: отзывается только сессия impersonation (signOut scope
 * 'local' — сессия GoTrue этого браузера), никогда не все сессии клиента
 * (scope по умолчанию 'global' выкидывал клиента со всех устройств). Без
 * cookie сессия находится через серверную привязку.
 */
import type { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { stepUpSessionKeyFromCookies } from '@/lib/mfa/session-binding'
import { recordAdminAction } from '@/lib/admin/audit'
import { trackEvent } from '@/lib/events/track'
import { isStaffRole } from '@/lib/admin/rbac'
import { IMP_COOKIE_NAME, readImpersonation } from './token'
import { impersonationForAuthSession } from './server'

export interface ImpersonationExit {
  /** Нашлась ли impersonation (по cookie или по привязке сессии). */
  found: boolean
  /** Клиент, чей кабинет открывали (для возврата в его карточку). */
  targetUserId: string | null
}

export async function endImpersonationInThisBrowser(req: NextRequest, reasonPrefix = 'exit'): Promise<ImpersonationExit> {
  const jar = cookies()
  const v = await readImpersonation(jar.get(IMP_COOKIE_NAME)?.value)
  // Read before the sign-out clears the session cookies.
  const sessionKey = stepUpSessionKeyFromCookies(jar.getAll())

  let who: { sid: string; aid: string; alabel: string; arole: unknown; uid: string; reason: string } | null = v.claims
    ? { sid: v.claims.sid, aid: v.claims.aid, alabel: v.claims.alabel, arole: v.claims.arole, uid: v.claims.uid, reason: v.ok ? reasonPrefix : `${reasonPrefix}_after_expiry` }
    : null
  if (!who) {
    const row = await impersonationForAuthSession(sessionKey).catch(() => null)
    if (row) who = { sid: row.id, aid: row.admin_id, alabel: row.admin_email ?? row.admin_id, arole: row.admin_role, uid: row.target_user_id, reason: `${reasonPrefix}_without_cookie` }
  }

  const userClient = createServerClient()
  await userClient.auth.signOut({ scope: 'local' }).catch(() => {})
  jar.delete(IMP_COOKIE_NAME)
  if (!who) return { found: false, targetUserId: null }

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
  return { found: true, targetUserId: who.uid }
}
