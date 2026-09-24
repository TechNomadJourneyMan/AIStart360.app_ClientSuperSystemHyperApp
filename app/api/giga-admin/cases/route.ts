export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { hasPermission } from '@/lib/admin/rbac'
import { createServiceClient } from '@/lib/supabase-service'
import { maskEmail } from '@/lib/admin/mask'
import { actorClientScope } from '@/lib/admin/actor-scope'
import { isCasePriority, isCaseStatus, slaState } from '@/lib/admin/escalations'

/**
 * GET /api/giga-admin/cases?status=open|all|<status>&priority=&assignee=me|none|<uuid>&sla=overdue&page=
 *
 * Очередь эскалаций: обращения клиентов к эксперту (expert_cases) со сроком
 * реакции. Сотрудник со скоупом «только назначенные» видит кейсы своих
 * клиентов и кейсы, назначенные лично ему.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE = 50

interface CaseRow {
  id: string; user_id: string; status: string; priority: string; trigger_type: string; title: string
  summary: string | null; user_message: string | null; assignee_id: string | null
  sla_due_at: string | null; first_response_at: string | null; created_at: string; updated_at: string
}

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'users.view')
  if (guard.response) return guard.response
  const actor = guard.actor
  const sp = req.nextUrl.searchParams
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const status = sp.get('status') ?? 'open'
  const priority = sp.get('priority') ?? ''
  const assignee = sp.get('assignee') ?? ''
  const sla = sp.get('sla') ?? ''
  if ((status !== 'open' && status !== 'all' && !isCaseStatus(status)) || (priority && !isCasePriority(priority))
    || (assignee && assignee !== 'me' && assignee !== 'none' && !UUID_RE.test(assignee)) || (sla && sla !== 'overdue')) {
    return NextResponse.json({ ok: false, error: 'Неверный фильтр' }, { status: 400 })
  }

  const scope = await actorClientScope(actor)
  const sb = createServiceClient()
  let q = sb
    .from('expert_cases')
    .select('id, user_id, status, priority, trigger_type, title, summary, user_message, assignee_id, sla_due_at, first_response_at, created_at, updated_at', { count: 'exact' })
  if (status === 'open') q = q.in('status', ['new', 'in_progress'])
  else if (status !== 'all') q = q.eq('status', status)
  if (priority) q = q.eq('priority', priority)
  if (assignee === 'me') q = q.eq('assignee_id', actor.id)
  else if (assignee === 'none') q = q.is('assignee_id', null)
  else if (assignee) q = q.eq('assignee_id', assignee)
  if (sla === 'overdue') q = q.in('status', ['new', 'in_progress']).is('first_response_at', null).lt('sla_due_at', new Date().toISOString())
  if (scope.scope === 'assigned') {
    const own = scope.clientIds.slice(0, 1000)
    q = own.length
      ? q.or(`assignee_id.eq.${actor.id},user_id.in.(${own.join(',')})`)
      : q.eq('assignee_id', actor.id)
  }

  const { data, count, error } = await q
    .order('sla_due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1)
  if (error) {
    console.warn('[giga-admin/cases]', error.message)
    return NextResponse.json({ ok: false, error: 'Очередь недоступна — применена ли миграция 088?' }, { status: 503 })
  }

  const rows = (data ?? []) as CaseRow[]
  const peopleIds = Array.from(new Set(rows.flatMap((r) => [r.user_id, r.assignee_id]).filter((x): x is string => !!x)))
  const clientIds = Array.from(new Set(rows.map((r) => r.user_id)))
  const [{ data: people }, { data: companies }] = peopleIds.length
    ? await Promise.all([
        sb.from('profiles').select('id, full_name, email, organization').in('id', peopleIds),
        sb.from('companies').select('user_id, name').in('user_id', clientIds),
      ])
    : [{ data: [] }, { data: [] }]
  const personBy = new Map(((people ?? []) as Array<{ id: string; full_name: string | null; email: string | null; organization: string | null }>).map((p) => [p.id, p]))
  const companyBy = new Map(((companies ?? []) as Array<{ user_id: string; name: string | null }>).map((c) => [c.user_id, c.name]))
  const sensitive = hasPermission(actor.role, 'users.sensitive')
  const now = new Date()

  return NextResponse.json({
    ok: true,
    data: rows.map((r) => {
      const c = personBy.get(r.user_id)
      const a = r.assignee_id ? personBy.get(r.assignee_id) : undefined
      return {
        ...r,
        user_message: sensitive ? r.user_message : null,
        sla: slaState(r, now),
        client: {
          id: r.user_id,
          name: companyBy.get(r.user_id) || c?.organization || c?.full_name || (sensitive ? c?.email : maskEmail(c?.email ?? null)) || r.user_id,
          email: sensitive ? c?.email ?? null : maskEmail(c?.email ?? null),
        },
        assignee: r.assignee_id ? { id: r.assignee_id, name: a?.full_name || a?.email || r.assignee_id } : null,
      }
    }),
    total: count ?? rows.length,
    page,
    pageSize: PAGE,
    scope: scope.scope,
  })
}
