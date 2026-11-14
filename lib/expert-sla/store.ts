/**
 * lib/expert-sla/store.ts — чтение очереди SLA и ручное переназначение для
 * ГИГА («SLA экспертов»), кабинета эксперта («Очередь») и клиента.
 *
 * Все чтения идут service-role клиентом; видимость задаёт ВЫЗЫВАЮЩИЙ по тому же
 * правилу, что RLS миграции 145: скоуп 'all' — всё; иначе — задачи клиентов,
 * закреплённых за актором (user_assignments), и задачи, назначенные ему лично.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isSlaWorker } from './assign'
import { EXPERT_WORK_SOURCES, SOURCE_LABELS, TASK_COLUMNS, isExpertWorkSource, slaStage, slaTimerLabel, type ExpertSlaSource, type SlaStage } from './policy'

type Sb = Pick<SupabaseClient, 'from'>

export const SLA_VIEWS = ['open', 'attention', 'breached', 'queue', 'mine', 'closed'] as const
export type SlaView = (typeof SLA_VIEWS)[number]
export function isSlaView(v: unknown): v is SlaView {
  return typeof v === 'string' && (SLA_VIEWS as readonly string[]).includes(v)
}

export interface SlaTaskRow {
  id: string
  source: ExpertSlaSource
  source_id: string
  client_id: string
  company_id: string | null
  title: string
  assignee_id: string | null
  assigned_at: string | null
  assigned_via: string | null
  received_at: string
  reaction_due_at: string
  answer_due_at: string
  first_response_at: string | null
  closed_at: string | null
  close_reason: string | null
  escalated_at: string | null
  breached_at: string | null
  created_at: string
}

export interface SlaTaskView extends SlaTaskRow {
  sourceLabel: string
  stage: SlaStage
  timer: string
  client: { id: string; name: string }
  assignee: { id: string; name: string } | null
  /** Задачу можно переназначить эксперту (план Точки Б одобряет Admin — нет). */
  reassignable: boolean
}

export type SlaVisibility = { all: true } | { all?: false; actorId: string; clientIds: string[] }

export interface SlaSummary { open: number; dueSoon: number; escalated: number; breached: number; queue: number; mine: number }

/** Видит ли актор задачу (то же правило, что RLS 145 для staff / эксперта). */
export function visibleTo(v: SlaVisibility, t: Pick<SlaTaskRow, 'client_id' | 'assignee_id'>): boolean {
  if (v.all) return true
  return t.assignee_id === v.actorId || v.clientIds.includes(t.client_id)
}

/** Сводка по открытым задачам на момент `now`. */
export function summarize(rows: SlaTaskRow[], actorId: string | null, now: Date = new Date()): SlaSummary {
  const s: SlaSummary = { open: 0, dueSoon: 0, escalated: 0, breached: 0, queue: 0, mine: 0 }
  for (const r of rows) {
    if (r.closed_at) continue
    s.open++
    const st = slaStage(r, now)
    if (st === 'due_soon') s.dueSoon++
    else if (st === 'escalated') s.escalated++
    else if (st === 'breached') s.breached++
    if (!r.assignee_id && isExpertWorkSource(r.source)) s.queue++
    if (actorId && r.assignee_id === actorId) s.mine++
  }
  return s
}

/** Отбор вида очереди (поверх видимых открытых / закрытых строк). */
export function inView(view: SlaView, r: SlaTaskRow, actorId: string | null, now: Date = new Date()): boolean {
  if (view === 'closed') return !!r.closed_at
  if (r.closed_at) return false
  const st = slaStage(r, now)
  switch (view) {
    case 'open': return true
    case 'attention': return st !== 'ok'
    case 'breached': return st === 'breached'
    case 'queue': return !r.assignee_id && isExpertWorkSource(r.source)
    case 'mine': return !!actorId && r.assignee_id === actorId
  }
}

const STAGE_ORDER: Record<SlaStage, number> = { breached: 0, escalated: 1, due_soon: 2, ok: 3, closed: 4 }

/** Открытые задачи (до 2000) или последние закрытые (до 200), видимые актору. */
export async function loadSlaTasks(sb: Sb, visibility: SlaVisibility, opts: { closed?: boolean; limit?: number } = {}): Promise<SlaTaskRow[]> {
  let q = sb.from('expert_sla_tasks').select(TASK_COLUMNS)
  q = opts.closed ? q.not('closed_at', 'is', null).order('closed_at', { ascending: false }) : q.is('closed_at', null).order('answer_due_at', { ascending: true })
  if (!visibility.all) {
    const own = visibility.clientIds.slice(0, 1000)
    q = own.length ? q.or(`assignee_id.eq.${visibility.actorId},client_id.in.(${own.join(',')})`) : q.eq('assignee_id', visibility.actorId)
  }
  const { data, error } = await q.limit(Math.min(opts.limit ?? (opts.closed ? 200 : 2000), 2000))
  if (error) throw new Error(`expert_sla_tasks: ${error.message?.slice(0, 200)}`)
  return ((data ?? []) as SlaTaskRow[]).filter((r) => visibleTo(visibility, r))
}

/** Строки → вид для UI: имена клиента / исполнителя, состояние, таймер. Email в выдачу не попадает. */
export async function decorate(sb: Sb, rows: SlaTaskRow[], now: Date = new Date()): Promise<SlaTaskView[]> {
  const clientIds = Array.from(new Set(rows.map((r) => r.client_id)))
  const peopleIds = Array.from(new Set([...clientIds, ...rows.map((r) => r.assignee_id).filter((x): x is string => !!x)]))
  const [{ data: people }, { data: companies }] = peopleIds.length
    ? await Promise.all([
        sb.from('profiles').select('id, full_name, organization').in('id', peopleIds),
        sb.from('companies').select('user_id, name').in('user_id', clientIds),
      ])
    : [{ data: [] }, { data: [] }]
  const personBy = new Map(((people ?? []) as Array<{ id: string; full_name: string | null; organization: string | null }>).map((p) => [p.id, p]))
  const companyBy = new Map(((companies ?? []) as Array<{ user_id: string; name: string | null }>).map((c) => [c.user_id, c.name]))
  return rows
    .map((r) => {
      const c = personBy.get(r.client_id)
      const a = r.assignee_id ? personBy.get(r.assignee_id) : undefined
      return {
        ...r,
        sourceLabel: SOURCE_LABELS[r.source] ?? r.source,
        stage: slaStage(r, now),
        timer: slaTimerLabel(r, now),
        client: { id: r.client_id, name: companyBy.get(r.client_id)?.trim() || c?.organization?.trim() || c?.full_name?.trim() || 'Клиент' },
        assignee: r.assignee_id ? { id: r.assignee_id, name: a?.full_name?.trim() || 'Эксперт' } : null,
        reassignable: !r.closed_at && isExpertWorkSource(r.source),
      }
    })
    .sort((x, y) => STAGE_ORDER[x.stage] - STAGE_ORDER[y.stage] || x.answer_due_at.localeCompare(y.answer_due_at))
}

// ─── Reassignment ───────────────────────────────────────────────────────────

export type ReassignResult =
  | { ok: true; moved: number; previous: string | null }
  | { ok: false; status: number; error: string }

/**
 * Передать работу по клиенту другому исполнителю: он становится ответственным
 * клиента (через `assignClient` — setClientAssignment: журнал, отзыв ссылок
 * прежнего), все ОТКРЫТЫЕ экспертные задачи клиента и его открытые обращения
 * (expert_cases) переходят к нему. Один ответственный на клиента — иначе
 * эксперт получил бы задачу без доступа к данным клиента (правило 140).
 */
export async function reassignClientWork(sb: Sb, input: {
  taskId: string
  assigneeId: string
  now?: Date
  assignClient: (clientId: string, assigneeId: string) => Promise<{ ok: true } | { ok: false; status: number; error: string }>
}): Promise<ReassignResult> {
  const now = (input.now ?? new Date()).toISOString()
  const { data: found, error } = await sb.from('expert_sla_tasks').select(TASK_COLUMNS).eq('id', input.taskId).maybeSingle()
  if (error) return { ok: false, status: 503, error: 'Очередь недоступна — применена ли миграция 145?' }
  const task = found as SlaTaskRow | null
  if (!task) return { ok: false, status: 404, error: 'Задача не найдена' }
  if (task.closed_at) return { ok: false, status: 409, error: 'Задача уже закрыта' }
  if (!isExpertWorkSource(task.source)) return { ok: false, status: 400, error: 'План Точки Б одобряет Admin или Super Admin — назначать его эксперту нельзя' }
  if (!(await isSlaWorker(sb, input.assigneeId))) {
    return { ok: false, status: 400, error: 'Назначить можно эксперта, SuperExpert или администратора' }
  }

  const assigned = await input.assignClient(task.client_id, input.assigneeId)
  if (!assigned.ok) return assigned

  const { data: moved, error: mErr } = await sb.from('expert_sla_tasks')
    .update({ assignee_id: input.assigneeId, assigned_at: now, assigned_via: 'manual' })
    .eq('client_id', task.client_id).is('closed_at', null).in('source', [...EXPERT_WORK_SOURCES])
    .select('id')
  if (mErr) return { ok: false, status: 500, error: 'Не удалось переназначить задачи' }
  await sb.from('expert_cases').update({ assignee_id: input.assigneeId, assigned_to: input.assigneeId })
    .eq('user_id', task.client_id).in('status', ['new', 'in_progress'])
  return { ok: true, moved: (moved as unknown[] | null)?.length ?? 0, previous: task.assignee_id }
}

/** Исполнители для выбора в ГИГА: эксперты, SuperExpert, Admin, Super Admin (одобренные) с нагрузкой. */
export async function loadSlaWorkers(sb: Sb): Promise<Array<{ id: string; name: string; kind: 'expert' | 'super_expert' | 'admin' | 'super_admin'; openTasks: number }>> {
  const [{ data: experts }, { data: staff }] = await Promise.all([
    sb.from('profiles').select('id, full_name').eq('role', 'expert').eq('status', 'approved').limit(100),
    sb.from('staff_roles').select('user_id, role').in('role', ['super_expert', 'admin', 'super_admin']),
  ])
  const staffRows = (staff ?? []) as Array<{ user_id: string; role: 'super_expert' | 'admin' | 'super_admin' }>
  const { data: staffPeople } = staffRows.length
    ? await sb.from('profiles').select('id, full_name, status').in('id', staffRows.map((s) => s.user_id))
    : { data: [] }
  const approvedStaff = new Map(((staffPeople ?? []) as Array<{ id: string; full_name: string | null; status: string | null }>)
    .filter((p) => p.status === 'approved').map((p) => [p.id, p.full_name]))
  const people = [
    ...((experts ?? []) as Array<{ id: string; full_name: string | null }>).map((e) => ({ id: e.id, name: e.full_name?.trim() || 'Эксперт', kind: 'expert' as const })),
    ...staffRows.filter((s) => approvedStaff.has(s.user_id)).map((s) => ({ id: s.user_id, name: approvedStaff.get(s.user_id)?.trim() || 'Сотрудник', kind: s.role })),
  ]
  const unique = Array.from(new Map(people.map((p) => [p.id, p])).values())
  if (!unique.length) return []
  const { data: open } = await sb.from('expert_sla_tasks').select('assignee_id').in('assignee_id', unique.map((p) => p.id)).is('closed_at', null).limit(5000)
  const load = new Map<string, number>()
  for (const r of (open ?? []) as Array<{ assignee_id: string | null }>) if (r.assignee_id) load.set(r.assignee_id, (load.get(r.assignee_id) ?? 0) + 1)
  const order = { expert: 0, super_expert: 1, admin: 2, super_admin: 3 }
  return unique
    .map((p) => ({ ...p, openTasks: load.get(p.id) ?? 0 }))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name, 'ru'))
}
