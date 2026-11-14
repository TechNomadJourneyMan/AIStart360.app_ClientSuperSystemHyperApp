/**
 * R2-B — один проход SLA экспертов (lib/expert-sla/run.ts) поверх фейковой
 * базы. RPC фейка повторяют миграцию 146 (тот же SQL проверен на реальной
 * базе в tests/integration/db/expert-sla.test.ts):
 *   expert_sla_sync         — отдаёт подготовленные «новые» задачи один раз (или падает);
 *   expert_sla_claim        — захват порога ровно один раз; просрочка закрывает и эскалацию;
 *   expert_sla_mark_notified — outbox: «уведомлено» только при успехе, иначе +1 попытка.
 * Проверяется: авто-назначение (наименее загруженный, только обычные клиенты,
 * журнал аудита), бюджет (недоделанное — следующим проходом), сводки,
 * повтор недоставленной эскалации, независимость шагов, чанки id.
 */
import { describe, expect, it } from 'vitest'
import { runExpertSla, SYSTEM_AUDIT_ACTOR } from '@/lib/expert-sla/run'
import type { Delivery, SlaNotifier, SlaThreshold, TaskBrief } from '@/lib/expert-sla/notify'
import { DEFAULT_EXPERT_SLA, slaDeadlines, type ExpertSlaConfig } from '@/lib/expert-sla/policy'
import type { AuditEntry } from '@/lib/admin/audit'
import { hoursAfter, slaDb, type Row } from './_fake'

const T0 = new Date('2026-11-14T06:00:00.000Z')

function taskRow(id: string, source: string, client: string, over: Row = {}): Row {
  return {
    id, source, source_id: `${source}-src-${id}`, client_id: client, company_id: null, title: `Задача ${id}`,
    assignee_id: null, assigned_at: null, assigned_via: null, received_at: T0.toISOString(), ...slaDeadlines(T0),
    first_response_at: null, closed_at: null, close_reason: null, escalated_at: null, breached_at: null, created_at: T0.toISOString(),
    answered: null, lineage: id, assign_notified_at: null, queue_notified_at: null, escalation_notified_at: null, breach_notified_at: null,
    notify_attempts: 0, info_attempts: 0, notify_error: null, ...over,
  }
}

const client = (id: string, over: Row = {}): Row => ({ id, role: 'client', status: 'approved', ...over })
const expert = (id: string, over: Row = {}): Row => ({ id, role: 'expert', status: 'approved', ...over })

function recorder(fail: Partial<Record<'assigned' | 'queued' | SlaThreshold, number>> = {}) {
  const calls = {
    assigned: [] as Array<[string, string[]]>,
    queued: [] as string[][],
    threshold: [] as Array<[string, string[]]>,
    syncFailed: [] as string[],
  }
  const left = { ...fail }
  const result = (kind: keyof typeof left): Delivery => {
    if ((left[kind] ?? 0) > 0) { left[kind]!--; return { ok: false, error: `${kind} channel down` } }
    return { ok: true }
  }
  const notifier: SlaNotifier = {
    assigned: async (a, ts) => { calls.assigned.push([a, ts.map((t) => t.id)]); return result('assigned') },
    queued: async (ts) => { calls.queued.push(ts.map((t) => t.id)); return result('queued') },
    threshold: async (stage, ts) => { calls.threshold.push([stage, ts.map((t) => t.id)]); return result(stage) },
    syncFailed: async (m) => { calls.syncFailed.push(m) },
  }
  return { calls, notifier }
}

/** A database whose rpc() mirrors migration 146. */
function world(seed: Record<string, Row[]>, incoming: Row[] = [], opts: { syncFails?: boolean } = {}) {
  let pending = [...incoming]
  const f = slaDb(seed, (fn, args) => {
    const now = new Date(String(args.p_now))
    const tasks = () => f.db.expert_sla_tasks
    if (fn === 'expert_sla_sync') {
      if (opts.syncFails) throw new Error('column rv.title does not exist')
      const out = pending.map((t) => {
        tasks().push(t)
        return { r_task: t.id, r_change: 'new', r_source: t.source, r_client: t.client_id, r_assignee: t.assignee_id ?? null, r_via: t.assigned_via ?? null }
      })
      pending = []
      return out
    }
    if (fn === 'expert_sla_claim') {
      const rows = tasks().filter((t) => !t.closed_at && (args.p_stage === 'breached'
        ? !t.breached_at && new Date(String(t.answer_due_at)) <= now
        : !t.escalated_at && !t.first_response_at && new Date(String(t.reaction_due_at)) <= now))
      for (const t of rows) {
        if (args.p_stage === 'breached') {
          t.breached_at = now.toISOString()
          t.escalated_at ??= now.toISOString()
          t.escalation_notified_at ??= now.toISOString()
        } else t.escalated_at = now.toISOString()
      }
      return rows.map((t) => ({ ...t }))
    }
    if (fn === 'expert_sla_mark_notified') {
      const col = { assigned: 'assign_notified_at', queued: 'queue_notified_at', escalated: 'escalation_notified_at', breached: 'breach_notified_at' }[String(args.p_kind)]!
      const info = args.p_kind === 'assigned' || args.p_kind === 'queued'
      let n = 0
      for (const t of tasks()) {
        if (!(args.p_ids as string[]).includes(String(t.id))) continue
        if (args.p_kind === 'assigned' && t.assignee_id !== args.p_assignee) continue
        n++
        if (args.p_ok) { t[col] = String(args.p_now); t[info ? 'info_attempts' : 'notify_attempts'] = 0; t.notify_error = null } else {
          t[info ? 'info_attempts' : 'notify_attempts'] = Number(t[info ? 'info_attempts' : 'notify_attempts'] ?? 0) + 1
          t.notify_error = args.p_error
        }
      }
      return n
    }
    throw new Error(`unexpected rpc ${fn}`)
  })
  return f
}

const cfg = (over: Partial<ExpertSlaConfig> = {}) => async () => ({ ...DEFAULT_EXPERT_SLA, ...over })
const byId = (f: ReturnType<typeof world>, id: string) => f.db.expert_sla_tasks.find((t) => t.id === id)!

describe('runExpertSla — assignment', () => {
  it('least loaded expert for plain clients, with an audit entry; one assignment message per assignee', async () => {
    const audits: AuditEntry[] = []
    const f = world({
      profiles: [expert('e1'), expert('e2'), client('c1'), client('c3'), client('c4'), client('m1')],
      staff_roles: [{ user_id: 'm1', role: 'crm_manager' }],
      user_assignments: [{ user_id: 'c2', assignee_id: 'm1' }],
      expert_cases: [{ id: 'case-src-t1', user_id: 'c1', status: 'new', assignee_id: null }],
      expert_sla_tasks: [
        taskRow('old1', 'case', 'cx', { assignee_id: 'e1', assign_notified_at: T0.toISOString() }),
        taskRow('old2', 'case', 'cy', { assignee_id: 'e1', assign_notified_at: T0.toISOString() }),
      ],
    }, [
      taskRow('t1', 'case', 'c1', { received_at: hoursAfter(T0, 0.1).toISOString() }),
      taskRow('t1b', 'report_review', 'c1', { received_at: hoursAfter(T0, 0.15).toISOString() }),
      taskRow('t2', 'report_review', 'c2', { received_at: hoursAfter(T0, 0.2).toISOString() }),
      taskRow('t3', 'rec_review', 'c3', { received_at: hoursAfter(T0, 0.3).toISOString() }),
      taskRow('t4', 'plan_review', 'c1', { received_at: hoursAfter(T0, 0.4).toISOString() }),
    ])
    f.db.profiles.push(client('c2'))
    const r = recorder()
    const report = await runExpertSla({ sb: f.sb, now: hoursAfter(T0, 1), config: cfg(), notifier: r.notifier, audit: async (e) => { audits.push(e); return true } })

    // e1 holds 2 open tasks, e2 none → c1 (both its tasks) to e2; c3 then to e2? e2 has 2 now, e1 2 → fewer clients: e1.
    expect(byId(f, 't1')).toMatchObject({ assignee_id: 'e2', assigned_via: 'auto' })
    expect(byId(f, 't1b')).toMatchObject({ assignee_id: 'e2', assigned_via: 'auto' })
    expect(byId(f, 't3')).toMatchObject({ assignee_id: 'e1', assigned_via: 'auto' })
    expect(f.db.expert_cases[0].assignee_id).toBe('e2')
    // c2 is led by a CRM manager: never overwritten, not an expert → the queue (SuperExpert).
    expect(byId(f, 't2').assignee_id).toBeNull()
    expect(f.db.user_assignments.find((u) => u.user_id === 'c2')!.assignee_id).toBe('m1')
    expect(byId(f, 't4').assignee_id).toBeNull() // plan approval: Admin / Super Admin, not the expert queue

    // Audit (п. 4): one system entry per auto-assigned client.
    expect(audits).toEqual([
      expect.objectContaining({ action: 'user.assigned', targetUserId: 'c1', newValue: { assignee_id: 'e2' }, metadata: expect.objectContaining({ via: 'expert_sla.auto_assign' }) }),
      expect.objectContaining({ action: 'user.assigned', targetUserId: 'c3', newValue: { assignee_id: 'e1' } }),
    ])
    expect(SYSTEM_AUDIT_ACTOR).toEqual({ id: 'system:expert-sla', kind: 'system' })
    // One message per assignee (п. 5), the queue once.
    expect(r.calls.assigned.sort()).toEqual([['e1', ['t3']], ['e2', ['t1', 't1b']]])
    expect(r.calls.queued).toEqual([['t2']])
    expect(byId(f, 't1').assign_notified_at).not.toBeNull()
    expect(byId(f, 't2').queue_notified_at).not.toBeNull()
    expect(report).toMatchObject({ enabled: true, created: 5, autoAssigned: 3, queued: 1, syncError: null })

    // A second pass announces nothing again.
    const again = recorder()
    await runExpertSla({ sb: f.sb, now: hoursAfter(T0, 1.1), config: cfg(), notifier: again.notifier, audit: async () => true })
    expect(again.calls).toMatchObject({ assigned: [], queued: [], threshold: [] })
  })

  it('п. 4: staff, a legacy super_admin, an expert, a pending or blocked account never get an automatic responsible', async () => {
    const f = world({
      profiles: [
        expert('e1'),
        client('s1'), { id: 'sa', role: 'super_admin', status: 'approved' }, expert('ex2'),
        client('pend', { status: 'pending_approval' }), client('blk', { status: 'blocked' }), client('own', { role: 'owner' }),
      ],
      staff_roles: [{ user_id: 's1', role: 'support' }],
    }, ['s1', 'sa', 'ex2', 'pend', 'blk', 'own'].map((c, i) => taskRow(`t${i}`, 'rec_review', c)))
    const audits: AuditEntry[] = []
    await runExpertSla({ sb: f.sb, now: T0, config: cfg(), notifier: recorder().notifier, audit: async (e) => { audits.push(e); return true } })
    expect(f.db.user_assignments.map((u) => u.user_id)).toEqual(['own']) // only the plain client (owner is a client role)
    expect(audits.map((a) => a.targetUserId)).toEqual(['own'])
    for (const id of ['t0', 't1', 't2', 't3', 't4']) expect(byId(f, id).assignee_id).toBeNull()
  })

  it('п. 5: tasks the budget did not reach are NOT queued — the next pass assigns them', async () => {
    const f = world({ profiles: [expert('e1'), client('c1'), client('c2'), client('c3')] },
      ['c1', 'c2', 'c3'].map((c, i) => taskRow(`t${i}`, 'case', c, { received_at: hoursAfter(T0, i * 0.1).toISOString() })))
    let calls = 0
    const r = recorder()
    // The budget runs out after the first assignment.
    const report = await runExpertSla({
      sb: f.sb, now: T0, config: cfg(), notifier: r.notifier, audit: async () => true,
      // clock(): start, the step-2 check, the first task — then the budget is gone.
      budgetMs: 1_000, clock: () => (calls++ < 3 ? 0 : 5_000),
    })
    expect(report.budgetExhausted).toBe(true)
    expect(byId(f, 't0').assignee_id).toBe('e1')
    expect(byId(f, 't1').assignee_id).toBeNull()
    expect(r.calls.queued).toEqual([]) // not «без исполнителя» forever
    await runExpertSla({ sb: f.sb, now: hoursAfter(T0, 0.1), config: cfg(), notifier: recorder().notifier, audit: async () => true })
    expect(['t1', 't2'].map((id) => byId(f, id).assignee_id)).toEqual(['e1', 'e1'])
  })

  it('auto-assignment off: unassigned expert work waits in the queue, nobody\'s responsible is written', async () => {
    const f = world({ profiles: [expert('e1'), client('c1')] }, [taskRow('t1', 'case', 'c1')])
    const r = recorder()
    const report = await runExpertSla({ sb: f.sb, now: T0, config: cfg({ auto_assign: false }), notifier: r.notifier })
    expect(report).toMatchObject({ autoAssigned: 0, queued: 1 })
    expect(f.db.user_assignments).toEqual([])
    expect(r.calls.queued).toEqual([['t1']])
  })

  it('no active expert → the queue (SuperExpert), the task stays unassigned', async () => {
    const f = world({ profiles: [expert('e1', { status: 'pending_approval' }), client('c1')] }, [taskRow('t1', 'report_review', 'c1')])
    expect(await runExpertSla({ sb: f.sb, now: T0, config: cfg(), notifier: recorder().notifier, audit: async () => true })).toMatchObject({ queued: 1, autoAssigned: 0 })
    expect(byId(f, 't1').assignee_id).toBeNull()
  })

  it('п. 5: reads by id lists go in chunks of ≤ 100 (250 clients in one pass)', async () => {
    const clients = Array.from({ length: 250 }, (_, i) => `c${String(i).padStart(3, '0')}`)
    const f = world({ profiles: [expert('e1'), ...clients.map((c) => client(c))] },
      clients.map((c, i) => taskRow(`t${i}`, 'rec_review', c, { received_at: hoursAfter(T0, i / 1000).toISOString() })))
    await runExpertSla({ sb: f.sb, now: T0, config: cfg({ auto_assign: true }), notifier: recorder().notifier, audit: async () => true })
    expect(Math.max(...f.listSizes)).toBeLessThanOrEqual(100)
  })
})

describe('runExpertSla — thresholds and delivery', () => {
  it('24 h → one escalation; 48 h → one breach; retries and later passes notify nobody again', async () => {
    const f = world({ profiles: [expert('e1')] }, [
      taskRow('a', 'case', 'c1', { assignee_id: 'e1', assigned_via: 'client' }),
      taskRow('b', 'case', 'c2', { assignee_id: 'e1', assigned_via: 'client', first_response_at: hoursAfter(T0, 1).toISOString() }),
    ])
    const r = recorder()
    const run = (h: number) => runExpertSla({ sb: f.sb, now: hoursAfter(T0, h), config: cfg(), notifier: r.notifier })
    expect(await run(23)).toMatchObject({ escalated: 0, breached: 0 })
    expect(await run(25)).toMatchObject({ escalated: 1, delivered: { escalated: 1 } })
    expect(await run(25)).toMatchObject({ escalated: 0, delivered: { escalated: 0 } })
    expect(await run(49)).toMatchObject({ breached: 2, delivered: { breached: 2 } })
    expect(await run(60)).toMatchObject({ breached: 0, delivered: { breached: 0 } })
    expect(r.calls.threshold).toEqual([['escalated', ['a']], ['breached', ['a']], ['breached', ['b']]])
  })

  it('п. 6: a failed delivery is NOT marked sent — the attempt is counted, the next pass delivers it', async () => {
    const f = world({ profiles: [expert('e1')] }, [taskRow('a', 'case', 'c1', { assignee_id: 'e1', assigned_via: 'client', assign_notified_at: T0.toISOString() })])
    const down = recorder({ escalated: 1 })
    expect(await runExpertSla({ sb: f.sb, now: hoursAfter(T0, 25), config: cfg(), notifier: down.notifier })).toMatchObject({ escalated: 1, failedDeliveries: 1 })
    expect(byId(f, 'a')).toMatchObject({ escalation_notified_at: null, notify_attempts: 1, notify_error: 'escalated channel down' })

    const up = recorder()
    expect(await runExpertSla({ sb: f.sb, now: hoursAfter(T0, 25.1), config: cfg(), notifier: up.notifier })).toMatchObject({ escalated: 0, delivered: { escalated: 1 } })
    expect(up.calls.threshold).toEqual([['escalated', ['a']]])
    expect(byId(f, 'a')).toMatchObject({ notify_attempts: 0, notify_error: null })
    expect(byId(f, 'a').escalation_notified_at).not.toBeNull()
  })

  it('п. 6: after 5 failed attempts the run stops retrying (the GIGA page shows it)', async () => {
    const f = world({ profiles: [expert('e1')] }, [taskRow('a', 'case', 'c1', { assignee_id: 'e1', assign_notified_at: T0.toISOString() })])
    const down = recorder({ escalated: 99 })
    for (let i = 0; i < 7; i++) await runExpertSla({ sb: f.sb, now: hoursAfter(T0, 25 + i * 0.1), config: cfg(), notifier: down.notifier })
    expect(down.calls.threshold).toHaveLength(5)
    expect(byId(f, 'a').notify_attempts).toBe(5)
  })

  it(`п. 5: more than 5 tasks crossing a threshold at once → one summary`, async () => {
    const f = world({}, Array.from({ length: 8 }, (_, i) => taskRow(`b${i}`, 'case', `c${i}`, { assign_notified_at: T0.toISOString(), queue_notified_at: T0.toISOString() })))
    const r = recorder()
    await runExpertSla({ sb: f.sb, now: hoursAfter(T0, 25), config: cfg({ auto_assign: false }), notifier: r.notifier })
    expect(r.calls.threshold).toEqual([['escalated', ['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7']]])
  })

  it('п. 9: a failed sync does not stop the thresholds of open tasks; staff are told', async () => {
    const f = world({ expert_sla_tasks: [taskRow('a', 'case', 'c1', { queue_notified_at: T0.toISOString() })] }, [], { syncFails: true })
    const r = recorder()
    const report = await runExpertSla({ sb: f.sb, now: hoursAfter(T0, 49), config: cfg({ auto_assign: false }), notifier: r.notifier })
    expect(report.syncError).toMatch(/expert_sla_sync/)
    expect(report).toMatchObject({ breached: 1, delivered: { breached: 1 } })
    expect(r.calls.syncFailed).toHaveLength(1)
    expect(f.rpcCalls.map((c) => c.fn)).toEqual(['expert_sla_sync', 'expert_sla_claim', 'expert_sla_claim', 'expert_sla_mark_notified'])
  })

  it('switched off: no database work at all', async () => {
    const f = world({}, [taskRow('t1', 'case', 'c1')])
    expect(await runExpertSla({ sb: f.sb, now: T0, config: cfg({ enabled: false }), notifier: recorder().notifier })).toMatchObject({ enabled: false })
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
})
