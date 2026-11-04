export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * POST /api/giga-admin/dev-tools/impersonation/end-all — завершить ВСЕ открытые
 * сессии «от имени» (любого сотрудника). Middleware замечает это за секунды и
 * выводит браузеры из кабинетов. Журнал пишется до действия (обязательно).
 */
export async function POST(req: NextRequest) {
  const guard = await requireGiga(req, 'devtools.use')
  if (guard.response) return guard.response
  const sb = createServiceClient()
  const now = new Date().toISOString()
  const { data: open, error } = await sb
    .from('impersonation_sessions')
    .select('id, admin_id, target_user_id')
    .is('ended_at', null)
    .gt('expires_at', now)
    .limit(500)
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить сессии' }, { status: 500 })
  const rows = (open ?? []) as Array<{ id: string; admin_id: string; target_user_id: string }>
  if (!rows.length) return NextResponse.json({ ok: true, ended: 0 })

  try {
    await recordAdminAction(guard.actor, {
      action: 'impersonation.terminated_all',
      entityType: 'impersonation', entityId: null,
      metadata: { count: rows.length, sessions: rows.map((r) => r.id), source: 'devtools' },
    }, req, { required: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Журнал действий недоступен — сессии не завершены' }, { status: 503 })
  }

  const { data: ended, error: updErr } = await sb
    .from('impersonation_sessions')
    .update({ ended_at: now, end_reason: 'terminated' })
    .in('id', rows.map((r) => r.id))
    .is('ended_at', null)
    .select('id')
  if (updErr) return NextResponse.json({ ok: false, error: 'Не удалось завершить сессии' }, { status: 500 })
  return NextResponse.json({ ok: true, ended: ended?.length ?? 0 })
}
