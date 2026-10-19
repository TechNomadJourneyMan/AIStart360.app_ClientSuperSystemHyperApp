/**
 * Strategy → action plan (Point B Ф5, task 3): the rows written into action_items when a version is
 * published (taskRowOf, syncPlanTasks), the live statuses read back (loadTaskStatuses), and the
 * publication through the real approve route (a failed sync must not undo the approval).
 * In-memory DB; the notifications are spies.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { loadTaskStatuses, syncPlanTasks, taskRowOf } from '@/lib/point-b/strategy/tasks'
import type { PlanStrategy, StrategyNode } from '@/lib/point-b/strategy/types'
import { pbDb } from './_pbdb'

const REVENUE = 'biz.finansy.vyruchka_god'
const CLIENT = 'cccccccc-0000-4000-8000-000000000001'
const OTHER_CLIENT = 'cccccccc-0000-4000-8000-000000000002'
const EXPERT = 'eeeeeeee-0000-4000-8000-000000000001'
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const COMPANY = 'company-1'
const VERSION = '0a0a0a0a-0000-4000-8000-000000000001'
const VERSION_2 = '0a0a0a0a-0000-4000-8000-000000000002'

const s = vi.hoisted(() => ({
  h: null as ReturnType<typeof import('./_pbdb').pbDb> | null,
  actor: { id: 'x', role: 'admin' as StaffRole },
  audits: [] as Array<{ action: string; entityId?: string | null; metadata?: Record<string, unknown>; targetUserId?: string | null }>,
  notify: { approved: vi.fn(async (..._a: unknown[]) => undefined), submitted: vi.fn(async (..._a: unknown[]) => undefined) },
  breakActionItems: false,
}))

/** The same DB; with `breakActionItems` the table answers «column does not exist» (migration 128 not applied). */
const dbProxy = () => ({
  from: (t: string) => {
    if (s.breakActionItems && t === 'action_items') {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'insert', 'update', 'eq', 'neq', 'in', 'order', 'limit']) q[m] = () => q
      q.maybeSingle = async () => ({ data: null, error: { code: '42703' } })
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: '42703' } }).then(res)
      return q
    }
    return s.h!.sb.from(t)
  },
})

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => dbProxy() }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: () => undefined }))
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_actor: unknown, entry: { action: string; entityId?: string | null; metadata?: Record<string, unknown>; targetUserId?: string | null }) => { s.audits.push(entry); return true },
}))
vi.mock('@/lib/point-b/plan/notify', () => ({
  notifyPlanSubmitted: (...a: unknown[]) => (s.notify.submitted as (...x: unknown[]) => Promise<void>)(...a),
  notifyPlanApproved: (...a: unknown[]) => (s.notify.approved as (...x: unknown[]) => Promise<void>)(...a),
  notifyGoalCorrection: async () => undefined,
  notifyGoalNeedsReview: async () => undefined,
  notifyGoalResponded: async () => undefined,
}))
vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  const inner = makeRequireGiga(() => ({ id: s.actor.id, kind: 'session', role: s.actor.role }))
  return {
    requireGiga: async (req: unknown, p: Parameters<typeof inner>[1]) => {
      const g = await inner(req, p)
      return g.actor ? { actor: { ...g.actor, clientScope: 'all' } } : g
    },
    forbidTarget: async () => null,
    staffMfaGate: async () => 'ok',
  }
})

const approveRoute = await import('@/app/api/giga-admin/users/[id]/point-b/plan/versions/[versionId]/approve/route')
const legacyApprove = await import('@/app/api/giga-admin/users/[id]/review/point-b/approve/route')

let n = 0
const key = (p: string) => `${p}-${String(++n).padStart(8, '0')}`
const node = (kind: StrategyNode['kind'], parentKey: string | null, over: Partial<StrategyNode> = {}): StrategyNode => ({
  key: key(kind.slice(0, 3)), kind, parentKey, title: `Узел ${n}`, description: null, ownerLabel: null, dueDate: null,
  impact: kind === 'task' ? null : 3, effort: kind === 'task' ? null : 3, metricId: null, block: null, kpi: null,
  dependsOn: [], delayRisk: null, order: 0, ...over,
})

/** strategy → initiative (impact 4) → 3 tasks. */
function plan(): { strategy: PlanStrategy; s: StrategyNode; i: StrategyNode; t: StrategyNode[] } {
  const st = node('strategy', null, { title: 'Рост' })
  const i = node('initiative', st.key, { title: 'Реклама', impact: 4 })
  const t = [
    node('task', i.key, { title: 'Запустить кампанию', description: 'Яндекс и Meta', ownerLabel: 'Маркетолог', dueDate: '2026-11-15', block: 'marketing', kpi: { name: 'Заказы', target: 120, unit: 'шт' } }),
    node('task', i.key, { title: 'Настроить аналитику' }),
    node('task', i.key, { title: 'Отчёт', dueDate: '2026-12-01' }),
  ]
  return { strategy: { items: [st, i, ...t], milestones: [] }, s: st, i, t }
}

const rows = () => s.h!.db.action_items
const input = (strategy: PlanStrategy, over: Record<string, unknown> = {}) => ({ userId: CLIENT, versionId: VERSION, strategy, ...over })

beforeEach(() => {
  s.h = pbDb()
  s.audits.length = 0
  s.notify.approved.mockClear()
  s.breakActionItems = false
  s.actor = { id: ADMIN, role: 'admin' }
})

describe('taskRowOf', () => {
  it('taskRowOf maps title, owner, due date, KPI text, priority from the parent impact, source point_b and the key', () => {
    const p = plan()
    const row = taskRowOf(p.t[0], { userId: CLIENT, versionId: VERSION, initiativeTitle: 'Реклама', initiativeImpact: 4 })
    expect(row).toEqual({
      user_id: CLIENT,
      title: 'Запустить кампанию',
      description: 'Яндекс и Meta\n\nИнициатива: Реклама',
      status: 'open',
      owner: 'Маркетолог',
      due_date: '2026-11-15',
      expected_effect: 'KPI: Заказы → 120 шт',
      linked_block: 'marketing',
      priority: 2, // 6 − 4
      source: 'point_b',
      pb_task_key: p.t[0].key,
      pb_version_id: VERSION,
    })
  })

  it('defaults: priority 3 without an impact, no KPI/description → null, KPI without a target or unit', () => {
    const p = plan()
    const bare = taskRowOf(p.t[1], { userId: CLIENT, versionId: VERSION, initiativeTitle: null })
    expect(bare).toMatchObject({ description: null, owner: null, due_date: null, expected_effect: null, linked_block: null, priority: 3 })
    expect(taskRowOf(p.t[1], { userId: CLIENT, versionId: VERSION, initiativeTitle: 'Реклама' }).description).toBe('Инициатива: Реклама')
    const noTarget = { ...p.t[1], kpi: { name: 'NPS', target: null, unit: null } }
    expect(taskRowOf(noTarget, { userId: CLIENT, versionId: VERSION, initiativeTitle: null }).expected_effect).toBe('KPI: NPS')
    const noUnit = { ...p.t[1], kpi: { name: 'Маржа', target: 0.3, unit: null } }
    expect(taskRowOf(noUnit, { userId: CLIENT, versionId: VERSION, initiativeTitle: null }).expected_effect).toBe('KPI: Маржа → 0.3')
    // the priority stays within 1..5
    for (const [impact, want] of [[1, 5], [5, 1], [null, 3]] as const) {
      expect(taskRowOf(p.t[1], { userId: CLIENT, versionId: VERSION, initiativeTitle: null, initiativeImpact: impact }).priority).toBe(want)
    }
  })
})

describe('syncPlanTasks', () => {
  it('syncPlanTasks creates missing tasks and is idempotent on a second run', async () => {
    const p = plan()
    const first = await syncPlanTasks(s.h!.sb, input(p.strategy))
    expect(first).toEqual({ created: 3, updated: 0, skipped: 0 })
    expect(rows()).toHaveLength(3)
    expect(rows().every((r) => r.source === 'point_b' && r.user_id === CLIENT && r.status === 'open' && r.pb_version_id === VERSION)).toBe(true)
    expect(rows().find((r) => r.pb_task_key === p.t[0].key)).toMatchObject({ title: 'Запустить кампанию', priority: 2, owner: 'Маркетолог', due_date: '2026-11-15' })

    const second = await syncPlanTasks(s.h!.sb, input(p.strategy))
    expect(second).toEqual({ created: 0, updated: 0, skipped: 3 })
    expect(rows()).toHaveLength(3)
  })

  it('two parallel publications never duplicate a task (the unique index decides)', async () => {
    const p = plan()
    const [a, b] = await Promise.all([syncPlanTasks(s.h!.sb, input(p.strategy)), syncPlanTasks(s.h!.sb, input(p.strategy))])
    expect(rows()).toHaveLength(3)
    expect(new Set(rows().map((r) => r.pb_task_key)).size).toBe(3)
    expect(a.created + b.created).toBe(3)
  })

  it('an existing open task is updated, a done one is left untouched', async () => {
    const p = plan()
    await syncPlanTasks(s.h!.sb, input(p.strategy))
    // the client works on the plan: one task done (and renamed by hand), one in progress with a comment
    const [r0, r1] = [rows().find((r) => r.pb_task_key === p.t[0].key)!, rows().find((r) => r.pb_task_key === p.t[1].key)!]
    Object.assign(r0, { status: 'done', completed_at: '2026-10-20T00:00:00Z', title: 'Моё название' })
    Object.assign(r1, { status: 'in_progress', user_comment: 'делаю' })

    // the next version: new titles, deadline, owner; the initiative is now less important
    p.t[0].title = 'Новое название 0'
    p.t[1].title = 'Новое название 1'
    p.t[1].dueDate = '2026-12-31'
    p.t[1].ownerLabel = 'Директор'
    p.i.impact = 1
    const out = await syncPlanTasks(s.h!.sb, input(p.strategy, { versionId: VERSION_2 }))
    expect(out).toEqual({ created: 0, updated: 2, skipped: 1 }) // t1 and t2 changed (priority), t0 is done

    expect(r0).toMatchObject({ status: 'done', title: 'Моё название', pb_version_id: VERSION, priority: 2 })
    expect(r1).toMatchObject({ status: 'in_progress', title: 'Новое название 1', due_date: '2026-12-31', owner: 'Директор', priority: 5, pb_version_id: VERSION_2, user_comment: 'делаю' })
    expect(rows().find((r) => r.pb_task_key === p.t[2].key)).toMatchObject({ priority: 5, pb_version_id: VERSION_2 })
    expect(rows()).toHaveLength(3)
  })

  it('a task the client dropped or replaced is not brought back or edited', async () => {
    const p = plan()
    await syncPlanTasks(s.h!.sb, input(p.strategy))
    const original = p.t[0].title
    rows().find((r) => r.pb_task_key === p.t[0].key)!.status = 'dropped'
    rows().find((r) => r.pb_task_key === p.t[1].key)!.status = 'replaced'
    p.t[0].title = 'Поменяли'
    p.t[1].title = 'Поменяли тоже'
    p.t[2].title = 'Этот ещё открыт'
    const out = await syncPlanTasks(s.h!.sb, input(p.strategy, { versionId: VERSION_2 }))
    expect(out).toEqual({ created: 0, updated: 1, skipped: 2 })
    expect(rows().find((r) => r.pb_task_key === p.t[0].key)).toMatchObject({ status: 'dropped', title: original })
  })

  it('a task absent from the new version is left as it is', async () => {
    const p = plan()
    await syncPlanTasks(s.h!.sb, input(p.strategy))
    const removed = p.t[2]
    const next: PlanStrategy = { items: p.strategy.items.filter((x) => x.key !== removed.key), milestones: [] }
    const out = await syncPlanTasks(s.h!.sb, input(next, { versionId: VERSION_2 }))
    expect(out.created).toBe(0)
    const left = rows().find((r) => r.pb_task_key === removed.key)!
    expect(left).toMatchObject({ status: 'open', title: removed.title, pb_version_id: VERSION })
    expect(rows()).toHaveLength(3)
  })

  it('other clients’ rows and the client’s own plan rows (no key) are never touched; no tasks → no database access', async () => {
    const p = plan()
    s.h = pbDb({ action_items: [
      { id: 'own-gri', user_id: CLIENT, title: 'Из GRI', status: 'open', source: 'plan', pb_task_key: null },
      { id: 'foreign', user_id: OTHER_CLIENT, title: 'Чужая', status: 'open', source: 'point_b', pb_task_key: p.t[0].key },
    ] })
    const out = await syncPlanTasks(s.h.sb, input(p.strategy))
    expect(out).toEqual({ created: 3, updated: 0, skipped: 0 }) // the same key of ANOTHER client is another row
    expect(s.h.db.action_items).toHaveLength(5)
    expect(s.h.db.action_items.find((r) => r.id === 'foreign')!.title).toBe('Чужая')
    expect(s.h.db.action_items.find((r) => r.id === 'own-gri')!.title).toBe('Из GRI')

    s.h.writes.length = 0
    const empty = await syncPlanTasks(s.h.sb, input({ items: [], milestones: [] }))
    expect(empty).toEqual({ created: 0, updated: 0, skipped: 0 })
    expect(s.h.writes).toEqual([])
  })

  it('a failing table (migration 128 not applied) throws, nothing is half-written', async () => {
    const p = plan()
    const failing = { from: () => { const q: Record<string, unknown> = {}; for (const m of ['select', 'insert', 'update', 'eq', 'neq', 'in']) q[m] = () => q; q.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: '42703' } }).then(r); return q } }
    await expect(syncPlanTasks(failing as never, input(p.strategy))).rejects.toThrow(/42703/)
  })

  it('a task whose parent initiative is missing is still written (priority 3, no initiative line)', async () => {
    const p = plan()
    const orphan: PlanStrategy = { items: [p.t[1]], milestones: [] }
    await syncPlanTasks(s.h!.sb, input(orphan))
    expect(rows()[0]).toMatchObject({ priority: 3, description: null })
  })
})

describe('loadTaskStatuses', () => {
  it('maps the statuses of the client’s rows by key; open / todo / snoozed → open, dropped and replaced are not counted', async () => {
    const p = plan()
    s.h = pbDb({ action_items: [
      { id: 'a', user_id: CLIENT, status: 'open', pb_task_key: p.t[0].key },
      { id: 'b', user_id: CLIENT, status: 'in_progress', pb_task_key: p.t[1].key },
      { id: 'c', user_id: CLIENT, status: 'done', pb_task_key: p.t[2].key },
      { id: 'd', user_id: CLIENT, status: 'snoozed', pb_task_key: 'snoozed-0001' },
      { id: 'e', user_id: CLIENT, status: 'todo', pb_task_key: 'todo-00000001' },
      { id: 'f', user_id: CLIENT, status: 'dropped', pb_task_key: 'dropped-0001' },
      { id: 'g', user_id: CLIENT, status: 'replaced', pb_task_key: 'replaced-001' },
      { id: 'h', user_id: OTHER_CLIENT, status: 'done', pb_task_key: 'foreign-0001' },
      { id: 'i', user_id: CLIENT, status: 'done', pb_task_key: null },
    ] })
    const keys = [p.t[0].key, p.t[1].key, p.t[2].key, 'snoozed-0001', 'todo-00000001', 'dropped-0001', 'replaced-001', 'foreign-0001', 'never-written']
    expect(await loadTaskStatuses(s.h.sb, CLIENT, keys)).toEqual({
      [p.t[0].key]: 'open', [p.t[1].key]: 'in_progress', [p.t[2].key]: 'done', 'snoozed-0001': 'open', 'todo-00000001': 'open',
    })
  })

  it('reads in batches (300 keys) and does not query without keys', async () => {
    const keys = Array.from({ length: 300 }, (_, i) => `task-key-${String(i).padStart(4, '0')}`)
    s.h = pbDb({ action_items: keys.map((k, i) => ({ id: `r${i}`, user_id: CLIENT, status: i % 2 ? 'done' : 'open', pb_task_key: k })) })
    const out = await loadTaskStatuses(s.h.sb, CLIENT, keys)
    expect(Object.keys(out)).toHaveLength(300)
    expect(out[keys[1]]).toBe('done')
    expect(await loadTaskStatuses(s.h.sb, CLIENT, [])).toEqual({})
  })

  it('a read error is thrown (the caller decides what the page shows)', async () => {
    s.breakActionItems = true
    await expect(loadTaskStatuses(dbProxy() as never, CLIENT, ['x-00000001'])).rejects.toThrow(/42703/)
  })
})

// ── publication through the real routes ────────────────────────────────────────

const body = (b?: unknown) => new NextRequest('http://t/api', { method: 'POST', body: b === undefined ? undefined : JSON.stringify(b), headers: { 'content-type': 'application/json', origin: 'http://t' } })
const vp = (versionId: string, id = CLIENT) => ({ params: { id, versionId } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() })
const versions = () => s.h!.db.pb_plan_versions

const goalsSnap = { primary: { metricKey: REVENUE, periodLabel: '12m' }, items: [{ metricKey: REVENUE, periodLabel: '12m', label: null, baselineValue: null, baselinePeriod: null, targetValue: 100, deadline: null, reviewStatus: 'verified' }] }

/** A client with a plan and one version in review that carries `strategy`. */
function seedInReview(strategy: unknown, over: { id?: string; version?: number; published?: boolean } = {}) {
  const h = s.h!
  if (!h.db.pb_plans.length) {
    h.db.pb_plans.push({ id: 'plan-1', company_id: COMPANY, user_id: CLIENT, current_version_id: null, published_version_id: null, settings: {}, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' })
  }
  h.db.pb_plan_versions.push({
    id: over.id ?? VERSION, plan_id: 'plan-1', version: over.version ?? 1, status: 'in_review', base_snapshot_id: null, goals: goalsSnap, assumptions: {}, scenarios: [], selected_scenario: null,
    strategy, risks: [], expert_notes: null, change_reason: 'Первый план', author_id: EXPERT, author_name: 'Алия Эксперт', author_kind: 'expert',
    submitted_at: '2026-10-09T00:00:00Z', approved_by: null, approved_at: null, approval_exception: null, rejected_by: null, rejected_at: null, rejected_reason: null, created_at: '2026-10-09T00:00:00Z',
  })
}

function seedDb() {
  s.h = pbDb({
    companies: [{ id: COMPANY, user_id: CLIENT, name: 'Ромашка' }],
    profiles: [{ id: CLIENT, role: 'client', full_name: 'Клиент Один' }, { id: ADMIN, role: 'admin', full_name: 'Админ Главный' }],
    user_assignments: [],
    metric_targets: [{ id: 'mt-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', target_value: 100, direction: 'higher_is_better', source: 'owner', deadline: null, label: null, note: null, baseline_value: 50, baseline_period: '2025', baseline_at: '2026-01-01T00:00:00Z' }],
    pb_goal_reviews: [{ id: 'gr-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', status: 'verified', proposed_value: null, proposed_deadline: null, previous_value: null, applied_without_agreement: false, created_at: '2026-10-05T00:00:00Z' }],
  })
}

describe('publishing a version', () => {
  beforeEach(seedDb)

  it('approve writes the tasks of the version into the action plan of the client and tells the expert nothing is wrong', async () => {
    const p = plan()
    seedInReview(p.strategy)
    const r = await json(await approveRoute.POST(body({}), vp(VERSION)))
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.data).toMatchObject({ id: VERSION, status: 'approved' })
    expect(r.body.warnings).toBeUndefined()
    expect(rows().map((x) => [x.user_id, x.source, x.pb_task_key])).toEqual(p.t.map((t) => [CLIENT, 'point_b', t.key]))
    const approved = s.audits.find((a) => a.action === 'point_b.plan.approved')!
    expect(approved.metadata).toMatchObject({ tasks: { created: 3, updated: 0, skipped: 0 } })
    expect(s.audits.some((a) => a.action === 'point_b.tasks.sync_failed')).toBe(false)
    expect(s.notify.approved).toHaveBeenCalledTimes(1)
  })

  it('a version without a strategy does not touch action_items', async () => {
    seedInReview({})
    s.h!.writes.length = 0
    const r = await json(await approveRoute.POST(body({}), vp(VERSION)))
    expect(r.status).toBe(200)
    expect(s.h!.writes.some((w) => w.table === 'action_items')).toBe(false)
    expect(r.body.warnings).toBeUndefined()
  })

  it('a failure of the sync does not undo the approval and is audited as point_b.tasks.sync_failed', async () => {
    const p = plan()
    seedInReview(p.strategy)
    s.breakActionItems = true
    const r = await json(await approveRoute.POST(body({}), vp(VERSION)))
    // the approval stands
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.data).toMatchObject({ id: VERSION, status: 'approved' })
    expect(versions()[0].status).toBe('approved')
    expect(s.h!.db.pb_plans[0].published_version_id).toBe(VERSION)
    expect(s.notify.approved).toHaveBeenCalledTimes(1)
    // the expert is warned, the failure is in the audit
    expect(r.body.warnings).toHaveLength(1)
    expect(r.body.warnings[0]).toMatch(/задач/)
    const failed = s.audits.filter((a) => a.action === 'point_b.tasks.sync_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({ entityId: VERSION, targetUserId: CLIENT })
    expect(failed[0].metadata).toMatchObject({ version: 1, tasks: 3 })
    expect(String(failed[0].metadata!.error)).toMatch(/42703/)
    expect(s.audits.filter((a) => a.action === 'point_b.plan.approved')).toHaveLength(1)
    expect(rows()).toHaveLength(0)
  })

  it('the legacy approve route publishes the tasks too and warns in the same way', async () => {
    const p = plan()
    seedInReview(p.strategy)
    const ok = await json(await legacyApprove.POST(body({ versionId: VERSION }), { params: { id: CLIENT } }))
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(rows()).toHaveLength(3)

    seedDb()
    seedInReview(p.strategy)
    s.breakActionItems = true
    const failed = await json(await legacyApprove.POST(body({ versionId: VERSION }), { params: { id: CLIENT } }))
    expect(failed.status).toBe(200)
    expect(failed.body.warnings).toHaveLength(1)
  })

  it('a stored strategy that does not pass validation is a sync failure, not a failed approval', async () => {
    seedInReview({ items: [{ key: 'broken', kind: 'task' }] })
    const r = await json(await approveRoute.POST(body({}), vp(VERSION)))
    expect(r.status).toBe(200)
    expect(r.body.warnings).toHaveLength(1)
    expect(s.audits.some((a) => a.action === 'point_b.tasks.sync_failed')).toBe(true)
    expect(rows()).toHaveLength(0)
  })

  it('the next version updates the open tasks, leaves a done one, and keeps the task that is gone from the tree', async () => {
    const p = plan()
    seedInReview(p.strategy)
    await approveRoute.POST(body({}), vp(VERSION))
    Object.assign(rows().find((x) => x.pb_task_key === p.t[0].key)!, { status: 'done' })

    // version 2: t0 renamed, t2 removed
    const next: PlanStrategy = { items: p.strategy.items.filter((x) => x.key !== p.t[2].key).map((x) => (x.key === p.t[0].key ? { ...x, title: 'Переименовано' } : x.key === p.t[1].key ? { ...x, title: 'Аналитика v2' } : x)), milestones: [] }
    seedInReview(next, { id: VERSION_2, version: 2 })
    const r = await json(await approveRoute.POST(body({}), vp(VERSION_2)))
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(rows()).toHaveLength(3)
    expect(rows().find((x) => x.pb_task_key === p.t[0].key)).toMatchObject({ status: 'done', title: p.t[0].title })
    expect(rows().find((x) => x.pb_task_key === p.t[1].key)).toMatchObject({ title: 'Аналитика v2', pb_version_id: VERSION_2 })
    expect(rows().find((x) => x.pb_task_key === p.t[2].key)).toMatchObject({ status: 'open', pb_version_id: VERSION })
  })
})
