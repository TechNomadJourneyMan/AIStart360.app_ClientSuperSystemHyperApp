export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga, staffRoleOfUser } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { canManageTarget } from '@/lib/admin/rbac'
import { recordAdminAction } from '@/lib/admin/audit'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { guardClientAccess } from '@/lib/admin/client-scope'

// POST /api/giga-admin/users/:id/archive { action: 'archive' | 'restore', reason }
// «Удаление» пользователя = архивация: вход закрыт (статус + бан GoTrue), данные
// сохраняются и восстанавливаются. Физического удаления из панели нет намеренно.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bodySchema = z.object({ action: z.enum(['archive', 'restore']), reason: z.string().trim().min(3, 'Укажите причину').max(300) })

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'users.archive')
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный запрос' }, { status: 400 })
  if (params.id === guard.actor.id) return NextResponse.json({ ok: false, error: 'Нельзя архивировать себя' }, { status: 400 })
  if (await isRateLimitedKey(guard.actor.id, 'user-archive', { max: 20, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много операций. Попробуйте позже.' }, { status: 429 })
  }

  const target = await staffRoleOfUser(params.id)
  if (!target.profileRole) return NextResponse.json({ ok: false, error: 'Пользователь не найден' }, { status: 404 })
  if (!canManageTarget(guard.actor.role, target.staffRole) || target.staffRole === 'super_admin') {
    return NextResponse.json({ ok: false, error: 'Недостаточно прав для этого пользователя' }, { status: 403 })
  }
  const { action, reason } = parsed.data
  const nextStatus = action === 'archive' ? 'archived' : 'approved'
  if (action === 'restore' && target.status !== 'archived') {
    return NextResponse.json({ ok: false, error: 'Пользователь не в архиве' }, { status: 409 })
  }

  await recordAdminAction(guard.actor, {
    action: action === 'archive' ? 'user.archived' : 'user.restored',
    entityType: 'user', entityId: params.id, targetUserId: params.id,
    oldValue: { status: target.status }, newValue: { status: nextStatus }, metadata: { reason },
  }, req, { required: true })

  const sb = createServiceClient()
  const { data: updated, error } = await sb.from('profiles').update({ status: nextStatus, updated_at: new Date().toISOString() }).eq('id', params.id).select('id')
  if (error || !updated?.length) return NextResponse.json({ ok: false, error: 'Не удалось изменить статус' }, { status: 500 })
  const ban = await sb.auth.admin.updateUserById(params.id, { ban_duration: action === 'archive' ? '87600h' : 'none' })
  if (ban.error) console.error('[archive] ban update failed:', ban.error.message)
  if (action === 'archive') {
    await sb.from('impersonation_sessions').update({ ended_at: new Date().toISOString(), end_reason: 'user_archived' }).eq('target_user_id', params.id).is('ended_at', null)
  }
  return NextResponse.json({ ok: true, status: nextStatus })
}
