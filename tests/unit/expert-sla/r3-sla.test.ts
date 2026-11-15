/**
 * R3-SLA (миграция 152) — два новых источника SLA в коде:
 *   • policy / links: подписи, экспертная работа (pa_ai_review — да, plan_prep — нет),
 *     ссылки ГИГА / SuperExpert / кабинета эксперта;
 *   • run: скан «клиент ждёт план» → RPC expert_sla_plan_prep (ждущие, выбывшие, «нет цели»),
 *     сбой скана не останавливает пороги; plan_prep никогда не назначается эксперту,
 *     о нём сообщают Admin / Super Admin (очередь 'admins'); pa_ai_review назначается
 *     как экспертная работа;
 *   • notify: очередь плана — лента ГИГА для Admin / Super Admin, ссылка в «Точку Б» клиента;
 *   • immediate: «сразу» для ИИ-разбора — одно сообщение, захват при вставке, откат захвата
 *     при сбое доставки (проход повторит), без сообщения при выключенном SLA;
 *   • store: «Взять себе» плана — только Admin / Super Admin, ответственный клиента не меняется.
 * SQL миграции 152 проверен на настоящей БД: tests/integration/db/expert-sla.test.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXPERT_SLA, EXPERT_SLA_SOURCES, EXPERT_WORK_SOURCES, SOURCE_LABELS, clientDueLabel, isExpertWorkSource, isPlanSource, slaDeadlines,
  type ExpertSlaConfig,
} from '@/lib/expert-sla/policy'
import { expertTaskHref, planDraftHref, staffTaskHref } from '@/lib/expert-sla/links'
import { runExpertSla, type PlanPrepScan } from '@/lib/expert-sla/run'
import { createDefaultNotifier, type Delivery, type QueueAudience, type SlaNotifier } from '@/lib/expert-sla/notify'
import { announceAiReviewNow } from '@/lib/expert-sla/immediate'
import { decorate, inView, summarize, takePlanTask, type SlaTaskRow } from '@/lib/expert-sla/store'
import { hoursAfter, slaDb, type Row } from './_fake'

const T0 = new Date('2026-11-15T06:00:00.000Z')
const cfg = (over: Partial<ExpertSlaConfig> = {}) => async () => ({ ...DEFAULT_EXPERT_SLA, ...over })

function taskRow(id: string, source: string, client: string, over: Row = {}): Row {
  return {
    id, source, source_id: `${source}-${id}`, client_id: client, company_id: null, title: `Задача ${id}`,
    assignee_id: null, assigned_at: null, assigned_via: null, received_at: T0.toISOString(), ...slaDeadlines(T0),
    first_response_at: null, closed_at: null, close_reason: null, escalated_at: null, breached_at: null, created_at: T0.toISOString(),
    answered: null, lineage: id, assign_notified_at: null, queue_notified_at: null, escalation_notified_at: null, breach_notified_at: null,
    notify_attempts: 0, info_attempts: 0, notify_error: null, ...over,
  }
}

function recorder(fail: Partial<Record<'assigned' | 'queued', number>> = {}) {
  const calls = { assigned: [] as Array<[string, string[]]>, queued: [] as Array<[QueueAudience, string[]]>, threshold: [] as string[][] }
  const left = { ...fail }
  const result = (k: keyof typeof left): Delivery => ((left[k] ?? 0) > 0 ? (left[k]!--, { ok: false, error: `${k} down` }) : { ok: true })
  const notifier: SlaNotifier = {
    assigned: async (a, ts) => { calls.assigned.push([a, ts.map((t) => t.id)]); return result('assigned') },
    queued: async (ts, audience = 'experts') => { calls.queued.push([audience, ts.map((t) => t.id)]); return result('queued') },
    threshold: async (_s, ts) => { calls.threshold.push(ts.map((t) => t.id)); return { ok: true } },
    syncFailed: async () => {},
  }
  return { calls, notifier }
}

/** rpc() of 146 / 152 for the pass: sync (nothing new), plan_prep (opens the waiting), claims, outbox marks. */
function world(seed: Record<string, Row[]>) {
  const prepCalls: Array<Record<string, unknown>> = []
  const f = slaDb(seed, (fn, args) => {
    const tasks = () => f.db.expert_sla_tasks
    if (fn === 'expert_sla_sync') return []
    if (fn === 'expert_sla_claim') return []
    if (fn === 'expert_sla_plan_prep') {
      prepCalls.push(args)
      return (args.p_waiting as Array<{ company: string; client: string }>).map((w) => {
        const t = taskRow(`prep-${w.company}`, 'plan_prep', w.client, { source_id: w.company, company_id: w.company })
        tasks().push(t)
        return { r_task: t.id, r_change: 'new', r_source: 'plan_prep', r_client: w.client, r_assignee: null, r_via: null }
      })
    }
    if (fn === 'expert_sla_mark_notified') {
      const col = { assigned: 'assign_notified_at', queued: 'queue_notified_at' }[String(args.p_kind)] ?? 'escalation_notified_at'
      let n = 0
      for (const t of tasks()) {
        if (!(args.p_ids as string[]).includes(String(t.id))) continue
        n++
        if (args.p_ok) t[col] = String(args.p_now)
        else { t.info_attempts = Number(t.info_attempts ?? 0) + 1; t.notify_error = args.p_error }
      }
      return n
    }
    throw new Error(`unexpected rpc ${fn}`)
  })
  return { ...f, prepCalls }
}

const scanOf = (over: Partial<Awaited<ReturnType<PlanPrepScan>>> = {}): PlanPrepScan => async () => ({
  waiting: [], checked: 0, truncated: false, dropped: [], candidates: [], ...over,
})

describe('policy and links of the new sources (152)', () => {
  it('labels; the AI review is expert work, the plan is Admin / Super Admin work', () => {
    expect(EXPERT_SLA_SOURCES).toEqual(expect.arrayContaining(['case', 'report_review', 'rec_review', 'plan_review', 'pa_ai_review', 'plan_prep']))
    expect(SOURCE_LABELS.pa_ai_review).toBe('Разбор ИИ Точки А на проверке')
    expect(SOURCE_LABELS.plan_prep).toBe('Подготовить план Точки Б')
    expect(EXPERT_WORK_SOURCES).toContain('pa_ai_review')
    expect(isExpertWorkSource('pa_ai_review')).toBe(true)
    expect(isExpertWorkSource('plan_prep')).toBe(false)
    expect(isPlanSource('plan_prep')).toBe(true)
    expect(isPlanSource('plan_review')).toBe(true)
    expect(isPlanSource('pa_ai_review')).toBe(false)
    expect(clientDueLabel('2026-11-17T09:00:00.000Z')).toBe('17 ноября, 14:00') // Алматы, UTC+5
  })

  it('links: the AI review opens the client\'s Point A at the review panel; the plan — the client\'s Point B', () => {
    const ai = { source: 'pa_ai_review' as const, source_id: 'diag-1', client_id: 'c1' }
    const plan = { source: 'plan_prep' as const, source_id: 'co-1', client_id: 'c1' }
    expect(expertTaskHref(ai)).toBe('/expert/clients/c1?tab=point-a#ai-review')
    expect(staffTaskHref(ai, '/admin-giga-panel')).toBe('/admin-giga-panel/users/c1?tab=point-a#ai-review')
    expect(staffTaskHref(plan, '/admin-giga-panel')).toBe('/admin-giga-panel/users/c1?tab=point-b')
    expect(staffTaskHref(plan, '/super-expert')).toBe('/super-expert/users/c1')
    expect(planDraftHref('c1', '/admin-giga-panel')).toBe('/admin-giga-panel/users/c1?tab=point-b')
  })
})

describe('the pass: «клиент ждёт план» (plan_prep)', () => {
  it('the scan opens tasks for the waiting and drops those who no longer wait or lost the goal; Admin / Super Admin hear of it', async () => {
    const f = world({
      profiles: [{ id: 'e1', role: 'expert', status: 'approved' }, { id: 'c1', role: 'client', status: 'approved' }],
      expert_sla_tasks: [taskRow('old', 'plan_prep', 'c9', { source_id: 'co-gone', queue_notified_at: T0.toISOString() })],
    })
    const r = recorder()
    const report = await runExpertSla({
      sb: f.sb, now: T0, config: cfg(), notifier: r.notifier, audit: async () => true,
      planPrepScan: scanOf({
        waiting: [{ userId: 'c1', companyId: 'co-1', since: null }],
        dropped: [{ companyId: 'co-2', userId: 'c2', reason: 'no_access' }],
        candidates: ['co-1', 'co-2'], checked: 2,
      }),
    })
    expect(f.prepCalls).toHaveLength(1)
    expect(f.prepCalls[0]).toMatchObject({
      p_waiting: [{ company: 'co-1', client: 'c1' }],
      p_dropped: [{ company: 'co-2', reason: 'no_access' }, { company: 'co-gone', reason: 'no_goal' }],
      p_reaction_hours: 24, p_answer_hours: 48,
    })
    expect(report.planPrep).toMatchObject({ opened: 1, waiting: 1, checked: 2, error: null, skipped: false })
    // Never auto-assigned to the expert e1; the queue notice goes to Admin / Super Admin.
    expect(f.db.expert_sla_tasks.find((t) => t.id === 'prep-co-1')!.assignee_id).toBeNull()
    expect(f.db.user_assignments).toEqual([])
    expect(r.calls.queued).toEqual([['admins', ['prep-co-1']]])
    expect(f.db.expert_sla_tasks.find((t) => t.id === 'prep-co-1')!.queue_notified_at).toBe(T0.toISOString())
    // The next pass: nothing new, no second notice.
    const again = recorder()
    await runExpertSla({ sb: f.sb, now: hoursAfter(T0, 0.1), config: cfg(), notifier: again.notifier, planPrepScan: scanOf({ candidates: ['co-1'] }) })
    expect(again.calls.queued).toEqual([])
  })

  it('nothing waits and nothing to drop → no round trip; a failed scan stops nothing else', async () => {
    const f = world({ expert_sla_tasks: [taskRow('a', 'case', 'c1', { queue_notified_at: T0.toISOString() })] })
    await runExpertSla({ sb: f.sb, now: T0, config: cfg({ auto_assign: false }), notifier: recorder().notifier, planPrepScan: scanOf() })
    expect(f.prepCalls).toEqual([])
    const r = recorder()
    const report = await runExpertSla({
      sb: f.sb, now: hoursAfter(T0, 25), config: cfg({ auto_assign: false }), notifier: r.notifier,
      planPrepScan: async () => { throw new Error('model down') },
    })
    expect(report.planPrep.error).toMatch(/model down/)
    expect(f.rpcCalls.map((c) => c.fn)).toContain('expert_sla_claim') // the thresholds still ran
  })

  it('a tight budget skips the scan (the thresholds come first)', async () => {
    const f = world({})
    let called = false
    const report = await runExpertSla({ sb: f.sb, now: T0, config: cfg(), notifier: recorder().notifier, budgetMs: 5_000, planPrepScan: async () => { called = true; return scanOf()(f.sb, {}) } })
    expect(called).toBe(false)
    expect(report.planPrep.skipped).toBe(true)
  })

  it('pa_ai_review without a responsible is auto-assigned like any expert work', async () => {
    const f = world({
      profiles: [{ id: 'e1', role: 'expert', status: 'approved' }, { id: 'c1', role: 'client', status: 'approved' }],
      expert_sla_tasks: [taskRow('ai', 'pa_ai_review', 'c1')],
    })
    const r = recorder()
    await runExpertSla({ sb: f.sb, now: T0, config: cfg(), notifier: r.notifier, audit: async () => true, planPrepScan: scanOf() })
    expect(f.db.expert_sla_tasks.find((t) => t.id === 'ai')).toMatchObject({ assignee_id: 'e1', assigned_via: 'auto' })
    expect(r.calls.assigned).toEqual([['e1', ['ai']]])
  })
})

describe('notify: the plan queue goes to Admin / Super Admin', () => {
  it('feed event expert_sla.plan_prep, admins only, a link into the client\'s Point B', async () => {
    const f = slaDb({
      staff_roles: [{ user_id: 'adm', role: 'admin' }, { user_id: 'se', role: 'super_expert' }],
      profiles: [{ id: 'adm', status: 'approved' }, { id: 'se', status: 'approved' }, { id: 'c1', full_name: 'Иван', organization: null }],
      companies: [{ user_id: 'c1', name: 'ООО Ромашка' }],
    })
    const sent: Array<Record<string, unknown>> = []
    const notifier = createDefaultNotifier({ sb: f.sb, notifyStaff: async (n) => { sent.push(n as unknown as Record<string, unknown>); return { eventId: 'ev1' } } })
    const t = taskRow('p1', 'plan_prep', 'c1') as unknown as Parameters<SlaNotifier['queued']>[0][number]
    expect(await notifier.queued([t], 'admins')).toEqual({ ok: true })
    expect(sent[0]).toMatchObject({
      type: 'expert_sla.plan_prep', audienceUserIds: ['adm'], link: '/admin-giga-panel/users/c1?tab=point-b', dedupeKey: 'expert_sla.queued:p1',
    })
    expect(String(sent[0].title)).toContain('ООО Ромашка')
  })
})

describe('immediate announcement of the AI review («сразу»)', () => {
  const diag = 'dddddddd-0000-4000-8000-000000000001'

  function immediateWorld(seed: Record<string, Row[]>, opts: { assignee?: string | null } = {}) {
    const f = slaDb({ diagnostics: [{ id: diag, user_id: 'c1' }], ...seed }, (fn, args) => {
      if (fn === 'expert_sla_open_ai_review') {
        if (f.db.expert_sla_tasks.some((t) => t.source === 'pa_ai_review' && !t.closed_at)) return []
        const who = opts.assignee ?? null
        const t = taskRow('ai1', 'pa_ai_review', 'c1', {
          source_id: diag, assignee_id: who, assigned_via: who ? 'client' : null,
          assign_notified_at: args.p_claim && who ? String(args.p_now) : null,
          queue_notified_at: args.p_claim_queue && !who ? String(args.p_now) : null,
        })
        f.db.expert_sla_tasks.push(t)
        return [{ r_task: 'ai1', r_change: 'new', r_source: 'pa_ai_review', r_client: 'c1', r_assignee: who, r_via: who ? 'client' : null }]
      }
      if (fn === 'expert_sla_mark_notified') {
        for (const t of f.db.expert_sla_tasks) if ((args.p_ids as string[]).includes(String(t.id)) && !args.p_ok) { t.info_attempts = Number(t.info_attempts) + 1; t.notify_error = args.p_error }
        return 1
      }
      throw new Error(`unexpected rpc ${fn}`)
    })
    return f
  }

  it('the responsible expert gets ONE message at once; the claim keeps the pass from sending it again', async () => {
    const f = immediateWorld({ profiles: [{ id: 'c1', role: 'client', status: 'approved' }, { id: 'e1', role: 'expert', status: 'approved' }], user_assignments: [{ user_id: 'c1', assignee_id: 'e1' }] }, { assignee: 'e1' })
    const r = recorder()
    expect(await announceAiReviewNow({ sb: f.sb, diagnosticId: diag, now: T0, config: cfg(), notifier: r.notifier })).toEqual({ opened: true, notified: 'assignee' })
    expect(r.calls.assigned).toEqual([['e1', ['ai1']]])
    expect(f.rpcCalls[0].args).toMatchObject({ p_diagnostic: diag, p_claim: true, p_claim_queue: true })
    expect(f.db.expert_sla_tasks[0].assign_notified_at).toBe(T0.toISOString())
    // A second save of the same analysis: no new task, no second message.
    expect(await announceAiReviewNow({ sb: f.sb, diagnosticId: diag, now: T0, config: cfg(), notifier: r.notifier })).toEqual({ opened: false, notified: null })
    expect(r.calls.assigned).toHaveLength(1)
  })

  it('a failed delivery releases the claim and counts the attempt — the pass delivers it', async () => {
    const f = immediateWorld({ profiles: [{ id: 'c1', role: 'client', status: 'approved' }, { id: 'e1', role: 'expert', status: 'approved' }], user_assignments: [{ user_id: 'c1', assignee_id: 'e1' }] }, { assignee: 'e1' })
    const r = recorder({ assigned: 1 })
    const res = await announceAiReviewNow({ sb: f.sb, diagnosticId: diag, now: T0, config: cfg(), notifier: r.notifier })
    expect(res).toMatchObject({ opened: true, notified: null, failed: true })
    expect(f.db.expert_sla_tasks[0]).toMatchObject({ assign_notified_at: null, info_attempts: 1, notify_error: 'assigned down' })
  })

  it('no experts (prod today) → the common queue is told at once; experts present and a plain client → the pass assigns, no queue notice', async () => {
    const noExperts = immediateWorld({ profiles: [{ id: 'c1', role: 'client', status: 'approved' }] })
    const r = recorder()
    expect(await announceAiReviewNow({ sb: noExperts.sb, diagnosticId: diag, now: T0, config: cfg(), notifier: r.notifier })).toEqual({ opened: true, notified: 'queue' })
    expect(r.calls.queued).toEqual([['experts', ['ai1']]])

    const withExpert = immediateWorld({ profiles: [{ id: 'c1', role: 'client', status: 'approved' }, { id: 'e1', role: 'expert', status: 'approved' }] })
    const r2 = recorder()
    expect(await announceAiReviewNow({ sb: withExpert.sb, diagnosticId: diag, now: T0, config: cfg(), notifier: r2.notifier })).toEqual({ opened: true, notified: null })
    expect(withExpert.rpcCalls[0].args).toMatchObject({ p_claim_queue: false })
    expect(r2.calls.queued).toEqual([])
    expect(withExpert.db.expert_sla_tasks[0].queue_notified_at).toBeNull() // the pass announces after assigning
  })

  it('SLA switched off → nothing opened, nothing sent; a database error never throws', async () => {
    const f = immediateWorld({})
    const r = recorder()
    expect(await announceAiReviewNow({ sb: f.sb, diagnosticId: diag, config: cfg({ enabled: false }), notifier: r.notifier })).toEqual({ opened: false, notified: null })
    expect(f.rpcCalls).toEqual([])
    f.failing.add('diagnostics')
    const res = await announceAiReviewNow({ sb: f.sb, diagnosticId: diag, config: cfg(), notifier: r.notifier })
    expect(res.opened).toBe(false)
  })
})

describe('store: plan tasks are taken by Admin / Super Admin', () => {
  const plan = () => slaDb({
    profiles: [{ id: 'adm', status: 'approved' }, { id: 'sa', status: 'approved' }, { id: 'se', status: 'approved' }, { id: 'e1', role: 'expert', status: 'approved' }],
    staff_roles: [{ user_id: 'adm', role: 'admin' }, { user_id: 'sa', role: 'super_admin' }, { user_id: 'se', role: 'super_expert' }],
    expert_sla_tasks: [taskRow('p1', 'plan_prep', 'c1'), taskRow('k1', 'case', 'c1'), taskRow('p2', 'plan_prep', 'c2', { closed_at: T0.toISOString() })],
  })

  it('«Взять себе»: the admin holds it, no self-notice, the client\'s responsible untouched', async () => {
    const f = plan()
    expect(await takePlanTask(f.sb, { taskId: 'p1', assigneeId: 'adm', actorId: 'adm', now: T0 })).toEqual({ ok: true, moved: 1, previous: null })
    expect(f.db.expert_sla_tasks.find((t) => t.id === 'p1')).toMatchObject({ assignee_id: 'adm', assigned_via: 'manual', assign_notified_at: T0.toISOString() })
    expect(f.db.user_assignments).toEqual([])
    // Handing it to another admin: he hears of it through the outbox.
    await takePlanTask(f.sb, { taskId: 'p1', assigneeId: 'sa', actorId: 'adm', now: T0 })
    expect(f.db.expert_sla_tasks.find((t) => t.id === 'p1')).toMatchObject({ assignee_id: 'sa', assign_notified_at: null })
  })

  it('refused: a SuperExpert or an expert as the actor / the target, an expert task, a closed task', async () => {
    const f = plan()
    expect(await takePlanTask(f.sb, { taskId: 'p1', assigneeId: 'se', actorId: 'se' })).toMatchObject({ ok: false, status: 403 })
    expect(await takePlanTask(f.sb, { taskId: 'p1', assigneeId: 'e1', actorId: 'adm' })).toMatchObject({ ok: false, status: 400 })
    expect(await takePlanTask(f.sb, { taskId: 'k1', assigneeId: 'adm', actorId: 'adm' })).toMatchObject({ ok: false, status: 400 })
    expect(await takePlanTask(f.sb, { taskId: 'p2', assigneeId: 'adm', actorId: 'adm' })).toMatchObject({ ok: false, status: 409 })
    expect(f.db.expert_sla_tasks.find((t) => t.id === 'p1')!.assignee_id).toBeNull()
  })

  it('views: an unassigned plan_prep is in the common queue; plan tasks are «takeable», not reassignable', async () => {
    const f = plan()
    const rows = f.db.expert_sla_tasks.filter((t) => !t.closed_at) as unknown as SlaTaskRow[]
    expect(summarize(rows, null, T0).queue).toBe(2)
    expect(rows.filter((r) => inView('queue', r, null, T0)).map((r) => r.id).sort()).toEqual(['k1', 'p1'])
    const view = await decorate(f.sb, rows, T0)
    expect(view.find((v) => v.id === 'p1')).toMatchObject({ takeable: true, reassignable: false, sourceLabel: 'Подготовить план Точки Б' })
    expect(view.find((v) => v.id === 'k1')).toMatchObject({ takeable: false, reassignable: true })
  })
})
