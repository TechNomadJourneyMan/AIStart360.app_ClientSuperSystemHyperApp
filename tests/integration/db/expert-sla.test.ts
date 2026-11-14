/**
 * R2-B — SLA экспертов на реальной базе (миграция 145_expert_sla_tasks.sql):
 *   • expert_sla_sync открывает задачи для всех четырёх источников, берёт
 *     исполнителя у кейса / ответственного клиента (только если он может вести
 *     экспертную работу), отмечает реакцию и закрывает выполненное;
 *   • пороги 24 / 48 ч с подменой времени (p_now): каждая задача захватывается
 *     ровно один раз — повторный вызов ничего не возвращает (идемпотентность);
 *     просрочка бэклога закрывает и эскалацию (одно сообщение);
 *   • RLS: эксперт видит только свои / своих клиентов, клиент — только свои,
 *     писать и вызывать функции могут только сервер (service role).
 * Каждый случай — в транзакции с откатом (tests/helpers/pg-rls.ts).
 */
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asService, asUser, closeTestPool, inRollback, pgErrorCode, seedCompany, seedStaff, seedUser, type Db } from '../../helpers/pg-rls'

const H = 3_600_000

interface SyncRow { r_task: string; r_change: string; r_source: string; r_client: string; r_assignee: string | null; r_via: string | null }
interface TaskRow {
  id: string; source: string; source_id: string; client_id: string; assignee_id: string | null; assigned_via: string | null
  received_at: Date; reaction_due_at: Date; answer_due_at: Date; first_response_at: Date | null; closed_at: Date | null
  close_reason: string | null; escalated_at: Date | null; breached_at: Date | null
}

async function clockStart(db: Db, iso = '2000-01-01T00:00:00Z') {
  await db.query(
    `INSERT INTO public.system_settings (key, value) VALUES ('expert_sla_clock_start', to_jsonb($1::text))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [iso],
  )
}

async function txNow(db: Db): Promise<Date> {
  return (await db.query(`SELECT now() AS n`)).rows[0].n as Date
}

async function sync(db: Db, now: Date, reaction = 24, answer = 48): Promise<SyncRow[]> {
  return asService(db, async () => (await db.query(`SELECT * FROM public.expert_sla_sync($1, $2, $3, 200)`, [now, reaction, answer])).rows as SyncRow[])
}

async function claim(db: Db, stage: 'escalated' | 'breached', now: Date): Promise<TaskRow[]> {
  return asService(db, async () => (await db.query(`SELECT * FROM public.expert_sla_claim($1, $2, 50)`, [stage, now])).rows as TaskRow[])
}

async function tasksOf(db: Db, clientId: string): Promise<TaskRow[]> {
  return (await db.query(`SELECT * FROM public.expert_sla_tasks WHERE client_id = $1 ORDER BY created_at, source`, [clientId])).rows as TaskRow[]
}

async function seedCase(db: Db, userId: string, opts: { assignee?: string | null; status?: string; title?: string } = {}): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.expert_cases (user_id, status, priority, trigger_type, title, assignee_id)
     VALUES ($1, $2, 'medium', 'user_requested_help', $3, $4) RETURNING id`,
    [userId, opts.status ?? 'new', opts.title ?? 'Помогите с анкетой', opts.assignee ?? null],
  )
  return rows[0].id as string
}

async function seedReportInReview(db: Db, companyId: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.report_versions (company_id, report_type, version, status, title, content, provenance, data_hash, created_by)
     VALUES ($1, 'point_a', 1, 'in_review', 'Точка А', '{}'::jsonb, '{}'::jsonb, 'h1', 'agent:report') RETURNING id`,
    [companyId],
  )
  return rows[0].id as string
}

async function seedPendingRecs(db: Db, companyId: string, n = 2): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const { rows } = await db.query(
      `INSERT INTO public.pb_recommendations (company_id, kind, title, generated_by) VALUES ($1, 'lever', $2, 'rule') RETURNING id`,
      [companyId, `Рекомендация ${i + 1}`],
    )
    ids.push(rows[0].id as string)
  }
  return ids
}

async function seedPlanInReview(db: Db, companyId: string, userId: string): Promise<string> {
  const plan = (await db.query(`INSERT INTO public.pb_plans (company_id, user_id) VALUES ($1, $2) RETURNING id`, [companyId, userId])).rows[0].id
  const { rows } = await db.query(
    `INSERT INTO public.pb_plan_versions (plan_id, version, status, submitted_at) VALUES ($1, 1, 'in_review', now()) RETURNING id`,
    [plan],
  )
  return rows[0].id as string
}

async function assign(db: Db, client: string, assignee: string | null) {
  await db.query(
    `INSERT INTO public.user_assignments (user_id, assignee_id) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET assignee_id = EXCLUDED.assignee_id`,
    [client, assignee],
  )
}

const plus = (d: Date, hours: number) => new Date(d.getTime() + hours * H)

describe.skipIf(!dbTestsEnabled)('R2-B: SLA экспертов (145)', () => {
  afterAll(closeTestPool)

  it('sync opens a task per source; the assignee is the case\'s own or the client\'s responsible worker', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const now = await txNow(db)
      const expert = await seedUser(db, { role: 'expert', status: 'approved' })
      const client = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, client, 'ООО Ромашка')
      await assign(db, client, expert)
      const caseId = await seedCase(db, client)
      const reportId = await seedReportInReview(db, company)
      await seedPendingRecs(db, company, 3)
      const planId = await seedPlanInReview(db, company, client)

      const changes = (await sync(db, now)).filter((c) => c.r_client === client)
      expect(changes.map((c) => c.r_change).sort()).toEqual(['new', 'new', 'new', 'new'])

      const tasks = await tasksOf(db, client)
      const bySource = Object.fromEntries(tasks.map((t) => [t.source, t]))
      expect(Object.keys(bySource).sort()).toEqual(['case', 'plan_review', 'rec_review', 'report_review'])
      expect(bySource.case.source_id).toBe(caseId)
      expect(bySource.report_review.source_id).toBe(reportId)
      expect(bySource.rec_review.source_id).toBe(company) // grouped: one task per company
      expect(bySource.plan_review.source_id).toBe(planId)
      for (const s of ['case', 'report_review', 'rec_review']) {
        expect(bySource[s].assignee_id, s).toBe(expert)
        expect(bySource[s].assigned_via, s).toBe('client')
      }
      expect(bySource.plan_review.assignee_id).toBeNull() // Admin / Super Admin approve
      for (const t of tasks) {
        expect(t.reaction_due_at.getTime() - t.received_at.getTime()).toBe(24 * H)
        expect(t.answer_due_at.getTime() - t.received_at.getTime()).toBe(48 * H)
      }

      // A second pass opens nothing new (one open task per source item).
      expect((await sync(db, now)).filter((c) => c.r_client === client)).toEqual([])
      expect(await tasksOf(db, client)).toHaveLength(4)
    }))

  it('a non-worker responsible (CRM manager) or a pending expert → the common queue; the case\'s own expert wins', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const now = await txNow(db)
      const crm = await seedStaff(db, 'crm_manager')
      const pendingExpert = await seedUser(db, { role: 'expert', status: 'pending_approval' })
      const caseExpert = await seedUser(db, { role: 'expert', status: 'approved' })
      const a = await seedUser(db, { status: 'approved' })
      const b = await seedUser(db, { status: 'approved' })
      const c = await seedUser(db, { status: 'approved' })
      await assign(db, a, crm)
      await assign(db, b, pendingExpert)
      await seedCase(db, a)
      await seedCase(db, b)
      await seedCase(db, c, { assignee: caseExpert })
      await sync(db, now)
      expect((await tasksOf(db, a))[0].assignee_id).toBeNull()
      expect((await tasksOf(db, b))[0].assignee_id).toBeNull()
      expect((await tasksOf(db, c))[0]).toMatchObject({ assignee_id: caseExpert, assigned_via: 'source' })
    }))

  it('thresholds with a substituted clock: 24 h without reaction → escalated once, 48 h without answer → breached once', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const t0 = await txNow(db)
      const client = await seedUser(db, { status: 'approved' })
      await seedCase(db, client)
      await sync(db, t0)
      const [task] = await tasksOf(db, client)

      const mine = (rows: TaskRow[]) => rows.filter((r) => r.id === task.id)
      expect(mine(await claim(db, 'escalated', plus(t0, 23.9)))).toEqual([])
      const esc = mine(await claim(db, 'escalated', plus(t0, 24.1)))
      expect(esc).toHaveLength(1)
      expect(esc[0].escalated_at!.getTime()).toBe(plus(t0, 24.1).getTime())
      // Idempotent: a retry / an overlapping run gets nothing.
      expect(mine(await claim(db, 'escalated', plus(t0, 24.2)))).toEqual([])
      expect(mine(await claim(db, 'escalated', plus(t0, 30)))).toEqual([])

      expect(mine(await claim(db, 'breached', plus(t0, 47.9)))).toEqual([])
      expect(mine(await claim(db, 'breached', plus(t0, 48.5)))).toHaveLength(1)
      expect(mine(await claim(db, 'breached', plus(t0, 49)))).toEqual([])
      const [after] = await tasksOf(db, client)
      expect(after.escalated_at!.getTime()).toBe(plus(t0, 24.1).getTime()) // not moved by the breach
      expect(after.breached_at!.getTime()).toBe(plus(t0, 48.5).getTime())
    }))

  it('a backlog task past 48 h: the breach also marks the escalation — one notification, not two', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const t0 = await txNow(db)
      const client = await seedUser(db, { status: 'approved' })
      await seedCase(db, client)
      await sync(db, t0)
      const [task] = await tasksOf(db, client)
      const late = plus(t0, 60)
      expect((await claim(db, 'breached', late)).filter((r) => r.id === task.id)).toHaveLength(1)
      expect((await claim(db, 'escalated', late)).filter((r) => r.id === task.id)).toEqual([])
    }))

  it('a reaction before 24 h prevents the escalation; the answer closes the task and stops the breach', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const t0 = await txNow(db)
      const client = await seedUser(db, { status: 'approved' })
      const caseId = await seedCase(db, client)
      await sync(db, t0)
      const [task] = await tasksOf(db, client)

      await db.query(`UPDATE public.expert_cases SET status = 'in_progress', first_response_at = $2 WHERE id = $1`, [caseId, plus(t0, 2)])
      const reacted = (await sync(db, plus(t0, 3))).filter((c) => c.r_task === task.id)
      expect(reacted.map((c) => c.r_change)).toEqual(['reacted'])
      expect((await tasksOf(db, client))[0].first_response_at!.getTime()).toBe(plus(t0, 2).getTime())
      expect((await claim(db, 'escalated', plus(t0, 30))).filter((r) => r.id === task.id)).toEqual([])

      await db.query(`UPDATE public.expert_cases SET status = 'resolved' WHERE id = $1`, [caseId])
      const closed = (await sync(db, plus(t0, 31))).filter((c) => c.r_task === task.id)
      expect(closed.map((c) => c.r_change)).toEqual(['closed'])
      const [done] = await tasksOf(db, client)
      expect(done.closed_at).not.toBeNull()
      expect(done.close_reason).toBe('resolved')
      expect((await claim(db, 'breached', plus(t0, 60))).filter((r) => r.id === task.id)).toEqual([])
    }))

  it('report decision, reviewed recommendations and a plan decision close their tasks', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const t0 = await txNow(db)
      const client = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, client)
      const reportId = await seedReportInReview(db, company)
      const recs = await seedPendingRecs(db, company, 2)
      const planId = await seedPlanInReview(db, company, client)
      await sync(db, t0)
      expect(await tasksOf(db, client)).toHaveLength(3)

      // One recommendation reviewed: a reaction, still open (another one waits).
      await db.query(`UPDATE public.pb_recommendations SET status = 'expert_verified', reviewed_at = $2 WHERE id = $1`, [recs[0], plus(t0, 1)])
      const r1 = (await sync(db, plus(t0, 2))).filter((c) => c.r_client === client)
      expect(r1.map((c) => `${c.r_source}:${c.r_change}`)).toEqual(['rec_review:reacted'])

      await db.query(`UPDATE public.pb_recommendations SET status = 'expert_rejected', reviewed_at = $2 WHERE id = $1`, [recs[1], plus(t0, 3)])
      await db.query(`UPDATE public.report_versions SET status = 'published', published_at = $2 WHERE id = $1`, [reportId, plus(t0, 4)])
      await db.query(`UPDATE public.pb_plan_versions SET status = 'draft', rejected_at = $2, rejected_reason = 'нет' WHERE id = $1`, [planId, plus(t0, 5)])
      const r2 = (await sync(db, plus(t0, 6))).filter((c) => c.r_client === client)
      expect(r2.map((c) => `${c.r_source}:${c.r_change}`).sort()).toEqual(['plan_review:closed', 'rec_review:closed', 'report_review:closed'])
      const bySource = Object.fromEntries((await tasksOf(db, client)).map((t) => [t.source, t]))
      expect(bySource.report_review.closed_at!.getTime()).toBe(plus(t0, 4).getTime())
      expect(bySource.rec_review.closed_at!.getTime()).toBe(plus(t0, 3).getTime())
      expect(bySource.plan_review.close_reason).toBe('rejected')
    }))

  it('work older than the clock start counts from the clock start; a reopened case starts a new task', () =>
    inRollback(async (db) => {
      const t0 = await txNow(db)
      await clockStart(db, plus(t0, -1).toISOString())
      const client = await seedUser(db, { status: 'approved' })
      const caseId = await seedCase(db, client)
      await db.query(`UPDATE public.expert_cases SET created_at = $2 WHERE id = $1`, [caseId, plus(t0, -100)])
      await sync(db, t0)
      const [first] = await tasksOf(db, client)
      expect(first.received_at.getTime()).toBe(plus(t0, -1).getTime())

      await db.query(`UPDATE public.expert_cases SET status = 'closed' WHERE id = $1`, [caseId])
      await sync(db, plus(t0, 1))
      await db.query(`UPDATE public.expert_cases SET status = 'new' WHERE id = $1`, [caseId])
      const reopened = (await sync(db, plus(t0, 2))).filter((c) => c.r_client === client)
      expect(reopened.map((c) => c.r_change)).toEqual(['new'])
      const tasks = await tasksOf(db, client)
      expect(tasks).toHaveLength(2)
      expect(tasks.filter((t) => !t.closed_at)).toHaveLength(1)
    }))

  it('a case re-assigned in «Эскалации» moves its open task', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const t0 = await txNow(db)
      const e1 = await seedUser(db, { role: 'expert', status: 'approved' })
      const e2 = await seedUser(db, { role: 'expert', status: 'approved' })
      const client = await seedUser(db, { status: 'approved' })
      const caseId = await seedCase(db, client, { assignee: e1 })
      await sync(db, t0)
      await db.query(`UPDATE public.expert_cases SET assignee_id = $2 WHERE id = $1`, [caseId, e2])
      const moved = (await sync(db, plus(t0, 1))).filter((c) => c.r_client === client)
      expect(moved).toMatchObject([{ r_change: 'reassigned', r_assignee: e2 }])
    }))

  it('RLS: an expert sees his own and his clients\' tasks, a client only his own, staff by scope; nobody writes', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const t0 = await txNow(db)
      const e1 = await seedUser(db, { role: 'expert', status: 'approved' })
      const e2 = await seedUser(db, { role: 'expert', status: 'approved' })
      const admin = await seedStaff(db, 'admin')
      const superExpertAssigned = await seedStaff(db, 'super_expert')
      await db.query(`UPDATE public.staff_roles SET client_scope = 'assigned' WHERE user_id = $1`, [superExpertAssigned])
      const c1 = await seedUser(db, { status: 'approved' })
      const c2 = await seedUser(db, { status: 'approved' })
      const c3 = await seedUser(db, { status: 'approved' })
      await assign(db, c1, e1)
      await assign(db, c2, e2)
      await seedCase(db, c1)
      await seedCase(db, c2)
      await seedCase(db, c3) // queue: nobody's
      await sync(db, t0)

      const visible = async (uid: string | null) => asUser(db, uid, async () =>
        (await db.query(`SELECT client_id::text AS c FROM public.expert_sla_tasks WHERE client_id = ANY($1) ORDER BY 1`, [[c1, c2, c3]])).rows.map((r) => r.c as string))
      const sorted = (ids: string[]) => [...ids].sort()

      expect(await visible(e1)).toEqual([c1])
      expect(await visible(e2)).toEqual([c2])
      expect(await visible(c1)).toEqual([c1])
      expect(await visible(c3)).toEqual([c3])
      expect(await pgErrorCode(visible(null))).toBe('42501') // anon: no grant at all
      expect(await visible(admin)).toEqual(sorted([c1, c2, c3]))
      expect(await visible(superExpertAssigned)).toEqual([])
      await assign(db, c3, superExpertAssigned)
      expect(await visible(superExpertAssigned)).toEqual([c3])

      // A task assigned to e1 personally (manual re-assignment) is his even before the client is.
      await db.query(`UPDATE public.expert_sla_tasks SET assignee_id = $1 WHERE client_id = $2`, [e1, c2])
      expect(sorted(await visible(e1))).toEqual(sorted([c1, c2]))
      // A pending (not approved) expert sees nothing, even his own assigned task.
      await db.query(`UPDATE public.profiles SET status = 'pending_approval' WHERE id = $1`, [e1])
      expect(await visible(e1)).toEqual([])

      // Writes and the functions: service role only.
      for (const uid of [e2, c1, admin]) {
        expect(await pgErrorCode(asUser(db, uid, () => db.query(`UPDATE public.expert_sla_tasks SET closed_at = now() WHERE client_id = $1`, [c2])))).toBe('42501')
        expect(await pgErrorCode(asUser(db, uid, () =>
          db.query(`INSERT INTO public.expert_sla_tasks (source, source_id, client_id, title, received_at, reaction_due_at, answer_due_at)
                    VALUES ('case', 'x', $1, 't', now(), now(), now())`, [c2])))).toBe('42501')
        expect(await pgErrorCode(asUser(db, uid, () => db.query(`SELECT * FROM public.expert_sla_claim('escalated', now(), 5)`)))).toBe('42501')
        expect(await pgErrorCode(asUser(db, uid, () => db.query(`SELECT * FROM public.expert_sla_sync(now(), 24, 48, 5)`)))).toBe('42501')
      }
    }))

  it('expert_sla_is_worker: approved expert / super_admin / admin / super_expert only', () =>
    inRollback(async (db) => {
      const check = async (id: string | null) => asService(db, async () => (await db.query(`SELECT public.expert_sla_is_worker($1) AS w`, [id])).rows[0].w as boolean)
      expect(await check(await seedUser(db, { role: 'expert', status: 'approved' }))).toBe(true)
      expect(await check(await seedUser(db, { role: 'expert', status: 'rejected' }))).toBe(false)
      expect(await check(await seedStaff(db, 'super_expert'))).toBe(true)
      expect(await check(await seedStaff(db, 'admin'))).toBe(true)
      expect(await check(await seedStaff(db, 'crm_manager'))).toBe(false)
      expect(await check(await seedStaff(db, 'support'))).toBe(false)
      expect(await check(await seedUser(db, { status: 'approved' }))).toBe(false)
      expect(await check(null)).toBe(false)
    }))
})
