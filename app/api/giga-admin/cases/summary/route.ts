export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { actorClientScope } from '@/lib/admin/actor-scope'

/**
 * GET /api/giga-admin/cases/summary → { open, overdue, mine }
 *
 * Счётчики для бейджа «Эскалации» в меню. С учётом видимости сотрудника
 * (скоуп «только назначенные»). Ошибка базы — нули, а не красный экран:
 * бейдж не должен ломать меню.
 */
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'users.view')
  if (guard.response) return guard.response
  const actor = guard.actor

  try {
    const scope = await actorClientScope(actor)
    const { data, error } = await createServiceClient()
      .from('expert_cases')
      .select('user_id, assignee_id, sla_due_at, first_response_at')
      .in('status', ['new', 'in_progress'])
      .limit(5000)
    if (error) return NextResponse.json({ ok: true, open: 0, overdue: 0, mine: 0, unavailable: true })

    const own = new Set(scope.clientIds)
    const now = new Date().toISOString()
    const rows = ((data ?? []) as Array<{ user_id: string; assignee_id: string | null; sla_due_at: string | null; first_response_at: string | null }>)
      .filter((r) => scope.scope === 'all' || r.assignee_id === actor.id || own.has(r.user_id))
    return NextResponse.json({
      ok: true,
      open: rows.length,
      overdue: rows.filter((r) => !r.first_response_at && !!r.sla_due_at && r.sla_due_at < now).length,
      mine: rows.filter((r) => r.assignee_id === actor.id).length,
    })
  } catch {
    return NextResponse.json({ ok: true, open: 0, overdue: 0, mine: 0, unavailable: true })
  }
}
