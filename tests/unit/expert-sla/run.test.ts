/**
 * R2-B — один проход SLA экспертов (lib/expert-sla/run.ts) поверх фейковой
 * базы: авто-назначение наименее загруженному эксперту, общая очередь,
 * пороги 24 / 48 ч с подменой времени и идемпотентность (второй проход и
 * ретрай не шлют повторных уведомлений). Захват порогов в фейке повторяет
 * expert_sla_claim миграции 145 (тот же SQL проверен на реальной базе в
 * tests/integration/db/expert-sla.test.ts).
 */
import { describe, expect, it } from 'vitest'
import { runExpertSla } from '@/lib/expert-sla/run'
import type { SlaNotifier, TaskBrief } from '@/lib/expert-sla/notify'
import { DEFAULT_EXPERT_SLA, slaDeadlines, type ExpertSlaConfig } from '@/lib/expert-sla/policy'
import { hoursAfter, slaDb, type Row } from './_fake'

const T0 = new Date('2026-11-14T06:00:00.000Z')

function taskRow(id: string, source: string, client: string, over: Row = {}): Row {
  return {
    id, source, source_id: `${source}-src-${id}`, client_id: client, company_id: null, title: `Задача ${id}`,
    assignee_id: null, assigned_at: null, assigned_via: null, received_at: T0.toISOString(), ...slaDeadlines(T0),
    first_response_at: null, closed_at: null, close_reason: null, escalated_at: null, breached_at: null, created_at: T0.toISOString(), ...over,
  }
}

function recorder() {
  const calls = { assigned: [] as TaskBrief[], queued: [] as TaskBrief[][], threshold: [] as Array<[string, string[]]> }
  const notifier: SlaNotifier = {
    assigned: async (t) => { calls.assigned.push(t) },
    queued: async (ts) => { if (ts.length) calls.queued.push(ts) },
    threshold: async (stage, ts) => { if (ts.length) calls.threshold.push([stage, ts.map((t) => t.id)]) },
  }
  return { calls, notifier }
}

/** A database whose rpc() mirrors migration 145: sync hands over `incoming` once, claim takes each threshold once. */
function world(seed: Record<string, Row[]>, incoming: Row[]) {
  let pending = [...incoming]
  const f = slaDb(seed, (fn, args) => {
    const now = new Date(String(args.p_now))
    if (fn === 'expert_sla_sync') {
      const out = pending.map((t) => {
        f.db.expert_sla_tasks.push(t)
        return { r_task: t.id, r_change: 'new', r_source: t.source, r_client: t.client_id, r_assignee: t.assignee_id ?? null, r_via: t.assigned_via ?? null }
      })
      pending = []
      return out
    }
    if (fn === 'expert_sla_claim') {
      const rows = f.db.expert_sla_tasks.filter((t) => !t.closed_at && (args.p_stage === 'breached'
        ? !t.breached_at && new Date(String(t.answer_due_at)) <= now
        : !t.escalated_at && !t.first_response_at && new Date(String(t.reaction_due_at)) <= now))
      for (const t of rows) {
        if (args.p_stage === 'breached') { t.breached_at = now.toISOString(); t.escalated_at ??= now.toISOString() } else t.escalated_at = now.toISOString()
      }
      return rows.map((t) => ({ ...t }))
    }
    throw new Error(`unexpected rpc ${fn}`)
  })
  return f
}

const cfg = (over: Partial<ExpertSlaConfig> = {}) => async () => ({ ...DEFAULT_EXPERT_SLA, ...over })

describe('runExpertSla', () => {
  it('assigns new expert work to the least loaded expert, queues what has no worker, leaves plan approval to admins', async () => {
    const f = world({
      profiles: [
        { id: 'e1', role: 'expert', status: 'approved' },
        { id: 'e2', role: 'expert', status: 'approved' },
        { id: 'm1', role: 'client', status: 'approved' },
      ],
      staff_roles: [{ user_id: 'm1', role: 'crm_manager' }],
      user_assignments: [{ user_id: 'c2', assignee_id: 'm1' }],
      expert_cases: [{ id: 'case-src-t1', user_id: 'c1', assignee_id: null }],
      expert_sla_tasks: [
        taskRow('old1', 'case', 'cx', { assignee_id: 'e1' }),
        taskRow('old2', 'case', 'cy', { assignee_id: 'e1' }),
      ],
    }, [
      taskRow('t1', 'case', 'c1', { received_at: hoursAfter(T0, 0.1).toISOString() }),
      taskRow('t2', 'report_review', 'c2', { received_at: hoursAfter(T0, 0.2).toISOString() }),
      taskRow('t3', 'rec_review', 'c3', { received_at: hoursAfter(T0, 0.3).toISOString() }),
      taskRow('t4', 'plan_review', 'c1', { received_at: hoursAfter(T0, 0.4).toISOString() }),
      taskRow('t5', 'case', 'c4', { assignee_id: 'e2', assigned_via: 'source', received_at: hoursAfter(T0, 0.5).toISOString() }),
    ])
    const r = recorder()
    const report = await runExpertSla({ sb: f.sb, now: hoursAfter(T0, 1), config: cfg(), notifier: r.notifier })

    const byId = (id: string) => f.db.expert_sla_tasks.find((t) => t.id === id)!
    // e2 had 1 open task (t5) against e1's 2 → c1 goes to e2; then c3 to e1 (equal tasks, fewer clients).
    expect(byId('t1')).toMatchObject({ assignee_id: 'e2', assigned_via: 'auto' })
    expect(byId('t3')).toMatchObject({ assignee_id: 'e1', assigned_via: 'auto' })
    expect(f.db.user_assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: 'c1', assignee_id: 'e2' }),
      expect.objectContaining({ user_id: 'c3', assignee_id: 'e1' }),
    ]))
    expect(f.db.expert_cases[0].assignee_id).toBe('e2') // «Эскалации» in step
    // c2 is led by a CRM manager: not overwritten, not an expert → the common queue.
    expect(byId('t2').assignee_id).toBeNull()
    expect(f.db.user_assignments.find((u) => u.user_id === 'c2')!.assignee_id).toBe('m1')
    expect(byId('t4').assignee_id).toBeNull()

    expect(r.calls.assigned.map((t) => t.id)).toEqual(['t1', 't3']) // t5 was announced when the case was assigned
    expect(r.calls.queued.map((g) => g.map((t) => t.id))).toEqual([['t2']]) // the plan is not in the expert queue
    expect(report).toMatchObject({ enabled: true, created: 5, autoAssigned: 2, queued: 1, escalated: 0, breached: 0 })
  })

  it('24 h without reaction → one escalation; 48 h → one breach; a second run and a retry notify nobody again', async () => {
    const f = world({ profiles: [{ id: 'e1', role: 'expert', status: 'approved' }] }, [
      taskRow('a', 'case', 'c1', { assignee_id: 'e1', assigned_via: 'client' }),
      taskRow('b', 'case', 'c2', { assignee_id: 'e1', assigned_via: 'client', first_response_at: hoursAfter(T0, 1).toISOString() }),
    ])
    const r = recorder()
    const run = (h: number) => runExpertSla({ sb: f.sb, now: hoursAfter(T0, h), config: cfg(), notifier: r.notifier })

    expect(await run(23)).toMatchObject({ escalated: 0, breached: 0 })
    expect(await run(25)).toMatchObject({ escalated: 1, breached: 0 })
    expect(await run(25)).toMatchObject({ escalated: 0, breached: 0 }) // retry of the same minute
    expect(await run(30)).toMatchObject({ escalated: 0, breached: 0 })
    expect(await run(49)).toMatchObject({ escalated: 0, breached: 2 })
    expect(await run(60)).toMatchObject({ escalated: 0, breached: 0 })
    // The reacted task b was never escalated; both breached at 48 h — exactly once each.
    expect(r.calls.threshold).toEqual([['escalated', ['a']], ['breached', ['a', 'b']]])
  })

  it('auto-assignment off: unassigned expert work waits in the queue, nobody\'s responsible is written', async () => {
    const f = world({ profiles: [{ id: 'e1', role: 'expert', status: 'approved' }] }, [taskRow('t1', 'case', 'c1')])
    const r = recorder()
    const report = await runExpertSla({ sb: f.sb, now: T0, config: cfg({ auto_assign: false }), notifier: r.notifier })
    expect(report).toMatchObject({ autoAssigned: 0, queued: 1 })
    expect(f.db.user_assignments).toEqual([])
    expect(r.calls.queued[0].map((t) => t.id)).toEqual(['t1'])
  })

  it('no active expert → the queue (SuperExpert), the task stays unassigned', async () => {
    const f = world({ profiles: [{ id: 'e1', role: 'expert', status: 'pending_approval' }] }, [taskRow('t1', 'report_review', 'c1')])
    const r = recorder()
    expect(await runExpertSla({ sb: f.sb, now: T0, config: cfg(), notifier: r.notifier })).toMatchObject({ queued: 1, autoAssigned: 0 })
    expect(f.db.expert_sla_tasks[0].assignee_id).toBeNull()
  })

  it('switched off: no database work at all', async () => {
    const f = world({}, [taskRow('t1', 'case', 'c1')])
    const r = recorder()
    expect(await runExpertSla({ sb: f.sb, now: T0, config: cfg({ enabled: false }), notifier: r.notifier })).toMatchObject({ enabled: false })
    expect(f.rpcCalls).toEqual([])
  })

  it('passes the configured hours to the sync and stops before the thresholds when the budget is spent', async () => {
    const f = world({}, [])
    let t = 0
    const report = await runExpertSla({
      sb: f.sb, now: T0, config: cfg({ reaction_hours: 12, answer_hours: 36 }), notifier: recorder().notifier,
      budgetMs: 1_000, clock: () => (t += 2_000),
    })
    expect(f.rpcCalls[0]).toMatchObject({ fn: 'expert_sla_sync', args: { p_reaction_hours: 12, p_answer_hours: 36, p_now: T0.toISOString() } })
    expect(f.rpcCalls.filter((c) => c.fn === 'expert_sla_claim')).toEqual([])
    expect(report.budgetExhausted).toBe(true)
  })

  it('a failed sync is an error of the run, not a silent «nothing to do»', async () => {
    const f = slaDb({}, () => { throw new Error('function expert_sla_sync does not exist') })
    await expect(runExpertSla({ sb: f.sb, now: T0, config: cfg(), notifier: recorder().notifier })).rejects.toThrow(/expert_sla_sync/)
  })
})
