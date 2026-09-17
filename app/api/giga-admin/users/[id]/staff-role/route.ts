export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga, staffRoleOfUser } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { grantableRoles, STAFF_ROLES } from '@/lib/admin/rbac'
import { recordAdminAction } from '@/lib/admin/audit'

// PUT /api/giga-admin/users/:id/staff-role { role: StaffRole | null, reason }
// Grants / changes / revokes a GIGA-CRM staff role. Super Admin only.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bodySchema = z.object({
  role: z.enum(STAFF_ROLES).nullable(),
  reason: z.string().trim().min(3, 'Укажите причину').max(300),
})

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'roles.manage')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный запрос' }, { status: 400 })
  const { role, reason } = parsed.data
  if (params.id === guard.actor.id) return NextResponse.json({ ok: false, error: 'Свою роль менять нельзя' }, { status: 400 })

  const target = await staffRoleOfUser(params.id)
  if (!target.profileRole) return NextResponse.json({ ok: false, error: 'Пользователь не найден' }, { status: 404 })
  if (target.status !== 'approved') return NextResponse.json({ ok: false, error: 'Роль можно выдать только одобренному аккаунту' }, { status: 409 })
  if (target.profileRole === 'super_admin' && role !== 'super_admin') {
    return NextResponse.json({ ok: false, error: 'Super Admin задан в профиле — снимите роль в профиле отдельно' }, { status: 409 })
  }
  if (role && !grantableRoles(guard.actor.role).includes(role)) {
    return NextResponse.json({ ok: false, error: 'Эту роль выдать нельзя' }, { status: 403 })
  }

  await recordAdminAction(guard.actor, {
    action: role ? 'staff.role_granted' : 'staff.role_revoked',
    entityType: 'staff_role', entityId: params.id, targetUserId: params.id,
    oldValue: { role: target.staffRole }, newValue: { role }, metadata: { reason },
  }, req, { required: true })

  const sb = createServiceClient()
  const res = role
    ? await sb.from('staff_roles').upsert({ user_id: params.id, role, granted_by: guard.actor.id, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    : await sb.from('staff_roles').delete().eq('user_id', params.id)
  if (res.error) return NextResponse.json({ ok: false, error: 'Не удалось сохранить роль' }, { status: 500 })
  return NextResponse.json({ ok: true, role })
}
