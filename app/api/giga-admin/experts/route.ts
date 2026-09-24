export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { canManageTarget, isStaffRole } from '@/lib/admin/rbac'

/**
 * GET /api/giga-admin/experts — модуль «Эксперты»: сотрудники с ролью
 * SuperExpert и их нагрузка.
 *
 * По каждому: сколько клиентов закреплено (user_assignments), сколько открытых
 * эскалаций на нём (expert_cases), сколько просроченных задач (staff_tasks) и
 * когда он последний раз что-то делал (профиль + журнал действий).
 */

interface StaffRow { user_id: string; role: string; client_scope?: string | null; granted_at?: string | null }
interface Person { id: string; full_name: string | null; email: string | null; status: string | null; last_seen_at: string | null }

function countBy<T>(rows: T[], key: (r: T) => string | null | undefined): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = key(r)
    if (k) m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'experts.manage')
  if (guard.response) return guard.response
  const sb = createServiceClient()

  let scopeAvailable = true
  const withScope = await sb.from('staff_roles').select('user_id, role, client_scope, granted_at').eq('role', 'super_expert')
  let rows = withScope.data as StaffRow[] | null
  let error = withScope.error
  if (error) {
    scopeAvailable = false
    const legacy = await sb.from('staff_roles').select('user_id, role, granted_at').eq('role', 'super_expert')
    rows = legacy.data as StaffRow[] | null
    error = legacy.error
  }
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить экспертов' }, { status: 500 })

  const staff = rows ?? []
  const ids = staff.map((r) => r.user_id)
  if (!ids.length) return NextResponse.json({ ok: true, data: [], scopeAvailable })

  const nowIso = new Date().toISOString()
  const [people, assignments, cases, tasks, audit] = await Promise.all([
    sb.from('profiles').select('id, full_name, email, status, last_seen_at').in('id', ids),
    sb.from('user_assignments').select('assignee_id').in('assignee_id', ids),
    sb.from('expert_cases').select('assignee_id, sla_due_at').in('assignee_id', ids).in('status', ['new', 'in_progress']),
    sb.from('staff_tasks').select('assignee_id').in('assignee_id', ids).eq('status', 'open').lt('due_at', nowIso),
    sb.from('admin_audit_log').select('actor_id, created_at').in('actor_id', ids).order('created_at', { ascending: false }).limit(1000),
  ])

  const personBy = new Map(((people.data ?? []) as Person[]).map((p) => [p.id, p]))
  const clients = countBy((assignments.data ?? []) as Array<{ assignee_id: string | null }>, (r) => r.assignee_id)
  const openCases = countBy((cases.data ?? []) as Array<{ assignee_id: string | null }>, (r) => r.assignee_id)
  const overdueCases = countBy(
    ((cases.data ?? []) as Array<{ assignee_id: string | null; sla_due_at: string | null }>).filter((c) => c.sla_due_at && c.sla_due_at < nowIso),
    (r) => r.assignee_id,
  )
  const overdueTasks = countBy((tasks.data ?? []) as Array<{ assignee_id: string | null }>, (r) => r.assignee_id)
  const lastAction = new Map<string, string>()
  for (const a of (audit.data ?? []) as Array<{ actor_id: string; created_at: string }>) {
    if (!lastAction.has(a.actor_id)) lastAction.set(a.actor_id, a.created_at)
  }

  const data = staff
    .map((r) => {
      const p = personBy.get(r.user_id)
      const seen = p?.last_seen_at ?? null
      const acted = lastAction.get(r.user_id) ?? null
      const last = [seen, acted].filter((x): x is string => !!x).sort().pop() ?? null
      return {
        id: r.user_id,
        name: p?.full_name || p?.email || r.user_id,
        email: p?.email ?? null,
        status: p?.status ?? null,
        role: isStaffRole(r.role) ? r.role : 'super_expert',
        clientScope: r.client_scope === 'assigned' ? 'assigned' : 'all',
        grantedAt: r.granted_at ?? null,
        load: {
          clients: clients.get(r.user_id) ?? 0,
          openCases: openCases.get(r.user_id) ?? 0,
          overdueCases: overdueCases.get(r.user_id) ?? 0,
          overdueTasks: overdueTasks.get(r.user_id) ?? 0,
        },
        lastActivityAt: last,
        manageable: canManageTarget(guard.actor.role, 'super_expert') && r.user_id !== guard.actor.id,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))

  return NextResponse.json({ ok: true, data, scopeAvailable })
}
