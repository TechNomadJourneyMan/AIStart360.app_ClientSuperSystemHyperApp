export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { hasPermission } from '@/lib/admin/rbac'
import { createServiceClient } from '@/lib/supabase-service'
import { dueRange, isDueFilter } from '@/lib/admin/tasks-due'

/**
 * GET /api/giga-admin/tasks?assignee=me|<uuid>&status=open|done&due=overdue|today|week|none&tz=<minutes>
 *
 * «Мои задачи»: задачи персонала по всем клиентам сразу — с чего начать день.
 * Чужие задачи (assignee = чужой id) видит только тот, кто управляет
 * экспертами (experts.manage): сотруднику чужой список ни к чему.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIMIT = 500

interface TaskRow {
  id: string; user_id: string | null; title: string; due_at: string | null; status: string
  assignee_id: string | null; created_by: string; created_at: string; done_at: string | null
}
interface Person { id: string; full_name: string | null; email: string | null; organization?: string | null }

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
  if (guard.response) return guard.response
  const actor = guard.actor
  const sp = req.nextUrl.searchParams

  const rawAssignee = sp.get('assignee') ?? 'me'
  const assignee = rawAssignee === 'me' ? actor.id : rawAssignee
  if (!UUID_RE.test(assignee)) {
    return NextResponse.json({ ok: false, error: 'Неверный исполнитель' }, { status: 400 })
  }
  if (assignee !== actor.id && !hasPermission(actor.role, 'experts.manage')) {
    return NextResponse.json({ ok: false, error: 'Недостаточно прав для чужих задач' }, { status: 403 })
  }

  const status = sp.get('status') ?? 'open'
  if (status !== 'open' && status !== 'done') {
    return NextResponse.json({ ok: false, error: 'Неверный статус' }, { status: 400 })
  }
  const dueRaw = sp.get('due')
  const due = dueRaw && isDueFilter(dueRaw) ? dueRaw : null
  if (dueRaw && !due) {
    return NextResponse.json({ ok: false, error: 'Неверный срок' }, { status: 400 })
  }
  const tz = Math.max(-840, Math.min(840, Number(sp.get('tz')) || 0))

  const sb = createServiceClient()
  let q = sb
    .from('staff_tasks')
    .select('id, user_id, title, due_at, status, assignee_id, created_by, created_at, done_at')
    .eq('assignee_id', assignee)
    .eq('status', status)
  if (due) {
    const range = dueRange(due, new Date(), tz)
    if (range === 'none') q = q.is('due_at', null)
    else {
      if (range.from) q = q.gte('due_at', range.from)
      if (range.to) q = q.lt('due_at', range.to)
    }
  }
  q = status === 'done'
    ? q.order('done_at', { ascending: false, nullsFirst: false })
    : q.order('due_at', { ascending: true, nullsFirst: false })
  const { data, error } = await q.limit(LIMIT)
  if (error) {
    console.warn('[giga-admin/tasks]', error.message)
    return NextResponse.json({ ok: true, data: [], unavailable: true })
  }

  const tasks = (data ?? []) as TaskRow[]
  const clientIds = Array.from(new Set(tasks.map((t) => t.user_id).filter((x): x is string => !!x)))
  const [{ data: clients }, { data: companies }] = clientIds.length
    ? await Promise.all([
        sb.from('profiles').select('id, full_name, email, organization').in('id', clientIds),
        sb.from('companies').select('user_id, name').in('user_id', clientIds),
      ])
    : [{ data: [] as Person[] }, { data: [] as Array<{ user_id: string; name: string | null }> }]
  const clientById = new Map(((clients ?? []) as Person[]).map((p) => [p.id, p]))
  const companyByUser = new Map(((companies ?? []) as Array<{ user_id: string; name: string | null }>).map((c) => [c.user_id, c.name]))

  return NextResponse.json({
    ok: true,
    data: tasks.map((t) => {
      const p = t.user_id ? clientById.get(t.user_id) : undefined
      return {
        ...t,
        client: t.user_id
          ? {
              id: t.user_id,
              name: companyByUser.get(t.user_id) || p?.organization || p?.full_name || p?.email || t.user_id,
              email: p?.email ?? null,
              fullName: p?.full_name ?? null,
            }
          : null,
      }
    }),
    truncated: tasks.length >= LIMIT,
  })
}
