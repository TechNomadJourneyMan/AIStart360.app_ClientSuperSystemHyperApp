import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { staffRoleOfUser } from '@/lib/admin/giga-actor'
import { canManageTarget, type StaffRole } from '@/lib/admin/rbac'

// Supabase-session admin guard for the legacy /api/v1/admin/* endpoints
// (the /admin page). GIGA-CRM (/api/giga-admin/*, requireGiga) is the canonical
// admin API; these routes stay for the legacy screens but follow the same rules:
//   1. a Supabase session is required;
//   2. the caller must be an APPROVED platform admin: profiles.role
//      admin/super_admin or a staff_roles admin/super_admin row — a blocked or
//      archived admin gets nothing (previously only the role was checked);
//   3. the role is read with the service role (fail closed: no anon-key fallback);
//   4. actions on another person must pass `forbidLegacyTarget` (staff rank),
//      so an admin cannot block or approve a super_admin.

const ADMIN_STAFF_ROLES = new Set<StaffRole>(['admin', 'super_admin'])

export interface AdminGuardOk {
  user: { id: string; email?: string | null }
  role: StaffRole
}
export interface AdminGuardErr {
  error: NextResponse
}
export type AdminGuardResult = AdminGuardOk | AdminGuardErr

export async function requireSupabaseAdmin(): Promise<AdminGuardResult> {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) }
  }

  let me: Awaited<ReturnType<typeof staffRoleOfUser>>
  try {
    me = await staffRoleOfUser(user.id)
  } catch (err) {
    console.error('[admin-guard] role lookup failed', err instanceof Error ? err.message : err)
    return { error: NextResponse.json({ ok: false, error: 'Не удалось проверить права' }, { status: 500 }) }
  }

  const role: StaffRole | null =
    me.profileRole === 'admin' ? (me.staffRole === 'super_admin' ? 'super_admin' : 'admin') : me.staffRole
  if (me.status !== 'approved' || !role || !ADMIN_STAFF_ROLES.has(role)) {
    return { error: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }) }
  }

  return { user: { id: user.id, email: user.email }, role }
}

/** 403 when the admin may not act on `targetUserId` (staff of equal or higher rank). */
export async function forbidLegacyTarget(guard: AdminGuardOk, targetUserId: string): Promise<NextResponse | null> {
  if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) {
    return NextResponse.json({ ok: false, error: 'Неверный идентификатор пользователя' }, { status: 400 })
  }
  if (targetUserId === guard.user.id) {
    return NextResponse.json({ ok: false, error: 'Нельзя менять статус своего аккаунта' }, { status: 403 })
  }
  try {
    const target = await staffRoleOfUser(targetUserId)
    const targetRole: StaffRole | null = target.profileRole === 'super_admin' ? 'super_admin'
      : target.profileRole === 'admin' && !target.staffRole ? 'admin'
      : target.staffRole
    if (!canManageTarget(guard.role, targetRole)) {
      return NextResponse.json({ ok: false, error: 'Недостаточно прав для действий с этим сотрудником' }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Не удалось проверить права' }, { status: 500 })
  }
  return null
}
