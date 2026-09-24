export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { forbidTarget, requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * PUT /api/giga-admin/staff/:userId/scope { scope: 'all' | 'assigned' }
 *
 * Тумблер «Видит всех клиентов / только назначенных» в модуле «Эксперты».
 * Колонку staff_roles.client_scope добавляет миграция 086, соблюдают её
 * API списков клиентов. Менять может только тот, кто управляет экспертами,
 * и только у сотрудника ниже себя по рангу.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bodySchema = z.object({ scope: z.enum(['all', 'assigned']) })

export async function PUT(req: NextRequest, { params }: { params: { userId: string } }) {
  const guard = await requireGiga(req, 'experts.manage')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.userId)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Неверная видимость' }, { status: 400 })
  if (params.userId === guard.actor.id) {
    return NextResponse.json({ ok: false, error: 'Нельзя менять видимость самому себе' }, { status: 400 })
  }
  const denied = await forbidTarget(guard.actor, params.userId)
  if (denied) return denied

  const sb = createServiceClient()
  const { data: row, error: readErr } = await sb
    .from('staff_roles')
    .select('user_id, role, client_scope')
    .eq('user_id', params.userId)
    .maybeSingle()
  if (readErr) {
    return NextResponse.json({ ok: false, error: 'Видимость клиентов недоступна — не применена миграция 086' }, { status: 503 })
  }
  if (!row) return NextResponse.json({ ok: false, error: 'Это не сотрудник' }, { status: 404 })

  const before = (row as { client_scope?: string | null }).client_scope ?? 'all'
  const scope = parsed.data.scope
  if (before === scope) return NextResponse.json({ ok: true, scope })

  const { data: updated, error } = await sb
    .from('staff_roles')
    .update({ client_scope: scope, updated_at: new Date().toISOString() })
    .eq('user_id', params.userId)
    .select('user_id')
  if (error || !updated?.length) return NextResponse.json({ ok: false, error: 'Не удалось изменить видимость' }, { status: 500 })

  await recordAdminAction(guard.actor, {
    action: 'staff.scope_changed',
    entityType: 'staff',
    entityId: params.userId,
    targetUserId: params.userId,
    oldValue: { client_scope: before },
    newValue: { client_scope: scope },
  }, req)

  return NextResponse.json({ ok: true, scope })
}
