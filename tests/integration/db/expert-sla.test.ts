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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asService, asUser, closeTestPool, inRollback, pgErrorCode, seedCompany, seedStaff, seedUser, type Db } from '../../helpers/pg-rls'

const H = 3_600_000

interface SyncRow { r_task: string; r_change: string; r_source: string; r_client: string; r_assignee: string | null; r_via: string | null }
interface TaskRow {
  id: string; source: string; source_id: string; client_id: string; assignee_id: string | null; assigned_via: string | null
  received_at: Date; reaction_due_at: Date; answer_due_at: Date; first_response_at: Date | null; closed_at: Date | null
  close_reason: string | null; escalated_at: Date | null; breached_at: Date | null
  answered?: boolean | null; assign_notified_at?: Date | null; queue_notified_at?: Date | null
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
      expect(changes.map((c) => c.r_change).sort()).toEqual(['new', 'new', 'new'])

      const tasks = await tasksOf(db, client)
      const bySource = Object.fromEntries(tasks.map((t) => [t.source, t]))
      // 149 (решение PO): рекомендации Точки Б на проверке — не работа эксперта под SLA.
      expect(Object.keys(bySource).sort()).toEqual(['case', 'plan_review', 'report_review'])
      expect(bySource.case.source_id).toBe(caseId)
      expect(bySource.report_review.source_id).toBe(reportId)
      expect(bySource.plan_review.source_id).toBe(planId)
      for (const s of ['case', 'report_review']) {
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
      expect(await tasksOf(db, client)).toHaveLength(3)
    }))

  it('a non-worker responsible (CRM manager) or a pending expert → the common queue; the case\'s own assignee only if he may hold it', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const now = await txNow(db)
      const crm = await seedStaff(db, 'crm_manager')
      const pendingExpert = await seedUser(db, { role: 'expert', status: 'pending_approval' })
      const caseExpert = await seedUser(db, { role: 'expert', status: 'approved' })
      const admin = await seedStaff(db, 'admin')
      const a = await seedUser(db, { status: 'approved' })
      const b = await seedUser(db, { status: 'approved' })
      const c = await seedUser(db, { status: 'approved' })
      const d = await seedUser(db, { status: 'approved' })
      await assign(db, a, crm)
      await assign(db, b, pendingExpert)
      await seedCase(db, a)
      await seedCase(db, b)
      // п. 3: an expert who is not the client's responsible (as a client could write before 146) is not trusted.
      await seedCase(db, c, { assignee: caseExpert })
      await seedCase(db, d, { assignee: admin }) // staff that sees every client — kept
      await sync(db, now)
      expect((await tasksOf(db, a))[0].assignee_id).toBeNull()
      expect((await tasksOf(db, b))[0].assignee_id).toBeNull()
      expect((await tasksOf(db, c))[0]).toMatchObject({ assignee_id: null, assigned_via: null })
      expect((await tasksOf(db, d))[0]).toMatchObject({ assignee_id: admin, assigned_via: 'source' })
      expect((await tasksOf(db, d))[0].assign_notified_at).not.toBeNull() // the case flow announced it
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

  it('report decision and a plan decision close their tasks', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const t0 = await txNow(db)
      const client = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, client)
      const reportId = await seedReportInReview(db, company)
      const planId = await seedPlanInReview(db, company, client)
      await sync(db, t0)
      expect(await tasksOf(db, client)).toHaveLength(2)

      await db.query(`UPDATE public.report_versions SET status = 'published', published_at = $2 WHERE id = $1`, [reportId, plus(t0, 4)])
      await db.query(`UPDATE public.pb_plan_versions SET status = 'draft', rejected_at = $2, rejected_reason = 'нет' WHERE id = $1`, [planId, plus(t0, 5)])
      const r2 = (await sync(db, plus(t0, 6))).filter((c) => c.r_client === client)
      expect(r2.map((c) => `${c.r_source}:${c.r_change}`).sort()).toEqual(['plan_review:closed', 'report_review:closed'])
      const bySource = Object.fromEntries((await tasksOf(db, client)).map((t) => [t.source, t]))
      expect(bySource.report_review.closed_at!.getTime()).toBe(plus(t0, 4).getTime())
      expect(bySource.plan_review.close_reason).toBe('rejected')
    }))

  it('149: Point B recommendations on review never open an SLA task, whatever their age', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const t0 = await txNow(db)
      const expert = await seedUser(db, { role: 'expert', status: 'approved' })
      const client = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, client)
      await assign(db, client, expert)
      await seedPendingRecs(db, company, 5)
      for (const h of [0, 25, 49, 200]) {
        expect((await sync(db, plus(t0, h))).filter((c) => c.r_client === client)).toEqual([])
      }
      expect(await tasksOf(db, client)).toEqual([])
      expect((await claim(db, 'escalated', plus(t0, 201))).filter((t) => t.client_id === client)).toEqual([])
    }))

  it('149: applying the migration closes open recommendation tasks as «excluded» (no delete) and is idempotent', () =>
    inRollback(async (db) => {
      const client = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, client)
      const t0 = await txNow(db)
      // An open recommendation task as 145/146 created it, plus an already closed one (history).
      await db.query(
        `INSERT INTO public.expert_sla_tasks (source, source_id, client_id, company_id, title, received_at, reaction_due_at, answer_due_at)
         VALUES ('rec_review', $2, $1, $2, 'Рекомендации Точки Б на проверке', $3, $3::timestamptz + interval '24 hours', $3::timestamptz + interval '48 hours')`,
        [client, company, plus(t0, -30)])
      await db.query(
        `INSERT INTO public.expert_sla_tasks (source, source_id, client_id, company_id, title, received_at, reaction_due_at, answer_due_at, closed_at, close_reason, answered)
         VALUES ('rec_review', $2 || ':old', $1, $2, 'Рекомендации Точки Б на проверке', $3, $3::timestamptz + interval '24 hours', $3::timestamptz + interval '48 hours', $3, 'reviewed', true)`,
        [client, company, plus(t0, -100)])
      const sql = readFileSync(join(process.cwd(), 'supabase/migrations/149_expert_sla_no_rec_review.sql'), 'utf8')
      await db.query(sql)
      await db.query(sql) // a second run changes nothing
      const tasks = await tasksOf(db, client)
      expect(tasks).toHaveLength(2)
      const open = tasks.find((t) => t.source_id === company)!
      expect(open).toMatchObject({ close_reason: 'excluded', answered: false, escalated_at: null, breached_at: null })
      expect(open.closed_at).not.toBeNull()
      const old = tasks.find((t) => t.source_id === `${company}:old`)!
      expect(old).toMatchObject({ close_reason: 'reviewed', answered: true })
      // Closed tasks are never claimed for escalation or breach.
      expect((await claim(db, 'breached', plus(t0, 100))).filter((t) => t.client_id === client)).toEqual([])
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

  it('a case re-assigned in «Эскалации» moves its task only to someone who may hold it', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const t0 = await txNow(db)
      const e1 = await seedUser(db, { role: 'expert', status: 'approved' })
      const stranger = await seedUser(db, { role: 'expert', status: 'approved' })
      const admin = await seedStaff(db, 'admin')
      const client = await seedUser(db, { status: 'approved' })
      await assign(db, client, e1)
      const caseId = await seedCase(db, client, { assignee: e1 })
      await sync(db, t0)
      // An expert who is not the client's responsible: the task stays (he could not open the client).
      await db.query(`UPDATE public.expert_cases SET assignee_id = $2 WHERE id = $1`, [caseId, stranger])
      expect((await sync(db, plus(t0, 1))).filter((c) => c.r_client === client)).toEqual([])
      expect((await tasksOf(db, client))[0].assignee_id).toBe(e1)
      // An admin (sees every client): it follows.
      await db.query(`UPDATE public.expert_cases SET assignee_id = $2 WHERE id = $1`, [caseId, admin])
      const moved = (await sync(db, plus(t0, 2))).filter((c) => c.r_client === client)
      expect(moved).toMatchObject([{ r_change: 'reassigned', r_assignee: admin }])
    }))

  it('RLS: an expert sees his clients\' tasks, a client only his own, staff by scope; nobody writes', () =>
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

      // п. 1–2 (146): a task «assigned» to e1 of a client that is not his gives him nothing.
      await db.query(`UPDATE public.expert_sla_tasks SET assignee_id = $1 WHERE client_id = $2`, [e1, c2])
      expect(await visible(e1)).toEqual([c1])
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

describe.skipIf(!dbTestsEnabled)('R2-B: исправления по ревью (146)', () => {
  afterAll(closeTestPool)

  const insertCase = (db: Db, uid: string, extra: Record<string, unknown> = {}) => {
    const cols = ['user_id', 'trigger_type', 'title', ...Object.keys(extra)]
    const vals = [uid, 'user_requested_help', 'Помогите', ...Object.values(extra)]
    return asUser(db, uid, () =>
      db.query(`INSERT INTO public.expert_cases (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, vals))
  }

  it('п. 3: a client opens a request through PostgREST only with the defaults (no assignee, no reaction, status new)', () =>
    inRollback(async (db) => {
      const client = await seedUser(db, { status: 'approved' })
      const expert = await seedUser(db, { role: 'expert', status: 'approved' })
      const other = await seedUser(db, { status: 'approved' })
      for (const extra of [
        { assignee_id: expert }, { assigned_to: expert }, { status: 'in_progress' }, { status: 'resolved' },
        { first_response_at: new Date() }, { sla_due_at: new Date(Date.now() + 1e9) },
      ]) {
        expect(await pgErrorCode(insertCase(db, client, extra)), JSON.stringify(Object.keys(extra))).toBe('42501')
      }
      expect(await pgErrorCode(asUser(db, client, () =>
        db.query(`INSERT INTO public.expert_cases (user_id, trigger_type, title) VALUES ($1, 'user_requested_help', 'x')`, [other])))).toBe('42501')
      await insertCase(db, client) // the defaults: allowed, as before
      const { rows } = await db.query(`SELECT status, assignee_id FROM public.expert_cases WHERE user_id = $1`, [client])
      expect(rows).toEqual([{ status: 'new', assignee_id: null }])
    }))

  it('п. 2: a change of the client\'s responsible moves open tasks and cases at once; the former expert sees nothing', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const t0 = await txNow(db)
      const e1 = await seedUser(db, { role: 'expert', status: 'approved' })
      const e2 = await seedUser(db, { role: 'expert', status: 'approved' })
      const crm = await seedStaff(db, 'crm_manager')
      const client = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, client)
      await assign(db, client, e1)
      const caseId = await seedCase(db, client, { assignee: e1 })
      await seedReportInReview(db, company)
      await sync(db, t0)
      await db.query(`UPDATE public.expert_sla_tasks SET assign_notified_at = now() WHERE client_id = $1`, [client])
      expect((await tasksOf(db, client)).map((t) => t.assignee_id)).toEqual([e1, e1])

      const seen = async (uid: string) => asUser(db, uid, async () =>
        (await db.query(`SELECT id FROM public.expert_sla_tasks WHERE client_id = $1`, [client])).rowCount)

      // GIGA user card / bulk / «Эксперты» / auto — every path writes user_assignments: the trigger follows.
      await assign(db, client, e2)
      const moved = await tasksOf(db, client)
      expect(moved.map((t) => t.assignee_id)).toEqual([e2, e2])
      expect(moved.every((t) => t.assign_notified_at === null)).toBe(true) // the new assignee will be told
      expect((await db.query(`SELECT assignee_id FROM public.expert_cases WHERE id = $1`, [caseId])).rows[0].assignee_id).toBe(e2)
      expect(await seen(e1)).toBe(0)
      expect(await seen(e2)).toBe(2)
      // The 24-hour escalation goes to the current assignee.
      const esc = await claim(db, 'escalated', plus(t0, 25))
      expect(esc.filter((t) => t.client_id === client).map((t) => t.assignee_id)).toEqual([e2, e2])

      // A responsible who cannot hold expert work (CRM manager) → the queue, SuperExpert is told again.
      await db.query(`UPDATE public.expert_sla_tasks SET queue_notified_at = now() WHERE client_id = $1`, [client])
      await assign(db, client, crm)
      const queued = await tasksOf(db, client)
      expect(queued.map((t) => [t.assignee_id, t.queue_notified_at])).toEqual([[null, null], [null, null]])

      // Back to an expert, then the assignment removed.
      await assign(db, client, e1)
      expect((await tasksOf(db, client)).map((t) => t.assignee_id)).toEqual([e1, e1])
      await db.query(`DELETE FROM public.user_assignments WHERE user_id = $1`, [client])
      expect((await tasksOf(db, client)).map((t) => t.assignee_id)).toEqual([null, null])
    }))

  it('п. 2: a blocked expert loses his tasks on the next pass (realign), they return to the queue', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const t0 = await txNow(db)
      const e1 = await seedUser(db, { role: 'expert', status: 'approved' })
      const client = await seedUser(db, { status: 'approved' })
      await assign(db, client, e1)
      await seedCase(db, client)
      await sync(db, t0)
      expect((await tasksOf(db, client))[0].assignee_id).toBe(e1)
      await db.query(`UPDATE public.profiles SET status = 'blocked' WHERE id = $1`, [e1])
      const changes = (await sync(db, plus(t0, 1))).filter((c) => c.r_client === client)
      expect(changes).toMatchObject([{ r_change: 'unassigned', r_assignee: null }])
    }))

  it('п. 6: delivery is recorded only on success; a failure counts an attempt; a new assignee resets the mark', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const t0 = await txNow(db)
      const e1 = await seedUser(db, { role: 'expert', status: 'approved' })
      const e2 = await seedUser(db, { role: 'expert', status: 'approved' })
      const client = await seedUser(db, { status: 'approved' })
      await assign(db, client, e1)
      await seedCase(db, client)
      await sync(db, t0)
      const [task] = await tasksOf(db, client)
      const mark = (kind: string, ok: boolean, assignee: string | null = null) => asService(db, async () =>
        (await db.query(`SELECT public.expert_sla_mark_notified($1, $2, $3, $4, $5, $6) AS n`, [[task.id], kind, ok, ok ? null : 'telegram 502', assignee, plus(t0, 25)])).rows[0].n as number)
      const row = async () => (await db.query(`SELECT * FROM public.expert_sla_tasks WHERE id = $1`, [task.id])).rows[0]

      await claim(db, 'escalated', plus(t0, 25))
      expect(await mark('escalated', false)).toBe(1)
      expect(await row()).toMatchObject({ escalation_notified_at: null, notify_attempts: 1, notify_error: 'telegram 502' })
      expect(await mark('escalated', true)).toBe(1)
      expect(await row()).toMatchObject({ notify_attempts: 0, notify_error: null })
      expect((await row()).escalation_notified_at).not.toBeNull()

      expect(await mark('assigned', true, e2)).toBe(0) // the message was for someone else
      expect(await mark('assigned', true, e1)).toBe(1)
      expect((await row()).assign_notified_at).not.toBeNull()
      await assign(db, client, e2)
      expect((await row()).assign_notified_at).toBeNull()
      expect(await pgErrorCode(db.query(`SELECT public.expert_sla_mark_notified($1, 'other', true)`, [[task.id]]))).toBe('22023') // last statement
    }))

  it('п. 6: the breach claim settles a pending escalation delivery (one message for a backlog task)', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const t0 = await txNow(db)
      const client = await seedUser(db, { status: 'approved' })
      await seedCase(db, client)
      await sync(db, t0)
      const [task] = await claim(db, 'breached', plus(t0, 60)).then((r) => r.filter((t) => t.client_id === client))
      expect(task.escalated_at).not.toBeNull()
      expect((await db.query(`SELECT escalation_notified_at FROM public.expert_sla_tasks WHERE id = $1`, [task.id])).rows[0].escalation_notified_at).not.toBeNull()
    }))

  it('п. 7: the clock starts at the watcher\'s first pass, not at the migration', () =>
    inRollback(async (db) => {
      await db.query(`DELETE FROM public.system_settings WHERE key = 'expert_sla_clock_start'`)
      const t0 = await txNow(db)
      const firstPass = plus(t0, 72) // Inngest synced three days after the migration
      const client = await seedUser(db, { status: 'approved' })
      const caseId = await seedCase(db, client)
      await db.query(`UPDATE public.expert_cases SET created_at = $2 WHERE id = $1`, [caseId, plus(t0, -100)])
      await sync(db, firstPass)
      const [task] = await tasksOf(db, client)
      expect(task.received_at.getTime()).toBe(firstPass.getTime())
      expect((await claim(db, 'breached', firstPass)).filter((t) => t.client_id === client)).toEqual([])
      const clock = async () => (await db.query(`SELECT value #>> '{}' AS v FROM public.system_settings WHERE key = 'expert_sla_clock_start'`)).rows[0].v as string
      const first = await clock()
      expect(new Date(first).getTime()).toBe(firstPass.getTime())
      await sync(db, plus(firstPass, 5))
      expect(await clock()).toBe(first) // written once
    }))

  it('п. 8: a report replaced without a decision is not an answer; the new version keeps the original clock', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const t0 = await txNow(db)
      const client = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, client)
      const v1 = await seedReportInReview(db, company)
      await sync(db, t0)
      await claim(db, 'escalated', plus(t0, 25))
      // The agent rebuilt the report: v1 superseded with no expert decision, v2 in review.
      await db.query(`UPDATE public.report_versions SET status = 'superseded' WHERE id = $1`, [v1])
      const { rows } = await db.query(
        `INSERT INTO public.report_versions (company_id, report_type, version, status, title, content, provenance, data_hash, created_by, created_at)
         VALUES ($1, 'point_a', 2, 'in_review', 'Точка А', '{}'::jsonb, '{}'::jsonb, 'h2', 'agent:report', $2) RETURNING id`, [company, plus(t0, 25.5)])
      await sync(db, plus(t0, 26))
      const all = await tasksOf(db, client) // same created_at (transaction time): pick by state
      const old = all.find((t) => t.closed_at !== null)!
      const fresh = all.find((t) => t.closed_at === null)!
      expect(old).toMatchObject({ source_id: v1, close_reason: 'superseded', answered: false, first_response_at: null })
      expect(fresh.source_id).toBe(rows[0].id)
      expect(fresh.closed_at).toBeNull()
      expect(fresh.received_at.getTime()).toBe(old.received_at.getTime())
      expect(fresh.answer_due_at.getTime()).toBe(old.answer_due_at.getTime())
      expect(fresh.escalated_at).not.toBeNull() // already escalated — not again
      expect((await claim(db, 'escalated', plus(t0, 27))).filter((t) => t.client_id === client)).toEqual([])
      expect((await claim(db, 'breached', plus(t0, 48.5))).filter((t) => t.client_id === client).map((t) => t.id)).toEqual([fresh.id])
    }))

  it('149 rollback: recommendations are SLA work again, with a fresh clock (not the clock of «excluded» tasks)', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const t0 = await txNow(db)
      const client = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, client)
      // An open recommendation task of 146, already escalated and breached.
      await db.query(
        `INSERT INTO public.expert_sla_tasks (source, source_id, client_id, company_id, title, lineage, received_at, reaction_due_at, answer_due_at, escalated_at, breached_at)
         VALUES ('rec_review', $2, $1, $2, 'Рекомендации Точки Б на проверке', $2, $3, $3::timestamptz + interval '24 hours', $3::timestamptz + interval '48 hours', $3::timestamptz + interval '24 hours', $3::timestamptz + interval '48 hours')`,
        [client, company, plus(t0, -50)])
      await seedPendingRecs(db, company, 2)
      await db.query(readFileSync(join(process.cwd(), 'supabase/migrations/149_expert_sla_no_rec_review.sql'), 'utf8'))
      expect((await sync(db, t0)).filter((c) => c.r_client === client)).toEqual([])
      await db.query(readFileSync(join(process.cwd(), 'supabase/migrations/rollback/149_expert_sla_no_rec_review.down.sql'), 'utf8'))
      const changes = (await sync(db, plus(t0, 1))).filter((c) => c.r_client === client)
      expect(changes.map((c) => `${c.r_source}:${c.r_change}`)).toEqual(['rec_review:new'])
      const fresh = (await tasksOf(db, client)).find((t) => t.closed_at === null)!
      expect(fresh.received_at.getTime()).toBeGreaterThan(plus(t0, -1).getTime()) // its own clock
      expect(fresh.escalated_at).toBeNull()
      expect(fresh.breached_at).toBeNull()
      // Back to 149 for the rest of the suite (the transaction rolls back anyway).
      await db.query(readFileSync(join(process.cwd(), 'supabase/migrations/149_expert_sla_no_rec_review.sql'), 'utf8'))
    }))

  it('п. 8: an expert decision on a report is an answer — the next version starts its own clock', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const t0 = await txNow(db)
      const client = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, client)

      // A report published by the expert is an answer: the next version starts its own clock.
      const v1 = await seedReportInReview(db, company)
      await sync(db, plus(t0, 12))
      await db.query(`UPDATE public.report_versions SET status = 'published', published_at = $2 WHERE id = $1`, [v1, plus(t0, 13)])
      await sync(db, plus(t0, 14))
      await db.query(
        `INSERT INTO public.report_versions (company_id, report_type, version, status, title, content, provenance, data_hash, created_by, created_at)
         VALUES ($1, 'point_a', 2, 'in_review', 'Точка А', '{}'::jsonb, '{}'::jsonb, 'h3', 'agent:report', $2)`, [company, plus(t0, 14.5)])
      await sync(db, plus(t0, 15))
      const reports = (await tasksOf(db, client)).filter((t) => t.source === 'report_review')
      expect(reports).toHaveLength(2)
      // created_at is the transaction time for both rows: pick by state, not by position.
      expect(reports.find((t) => t.closed_at !== null)).toMatchObject({ answered: true, close_reason: 'published' })
      expect(reports.find((t) => t.closed_at === null)!.received_at.getTime()).toBe(plus(t0, 14.5).getTime()) // its own clock
    }))

  it('п. 8: a predecessor closed without an answer longer ago than the answer window is not inherited', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const t0 = await txNow(db)
      const client = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, client)
      const v1 = await seedReportInReview(db, company)
      await sync(db, t0)
      // Replaced without an expert decision (not an answer), long before the next version.
      await db.query(`UPDATE public.report_versions SET status = 'superseded' WHERE id = $1`, [v1])
      await sync(db, plus(t0, 1))
      const later = plus(t0, 100)
      await db.query(
        `INSERT INTO public.report_versions (company_id, report_type, version, status, title, content, provenance, data_hash, created_by, created_at)
         VALUES ($1, 'point_a', 2, 'in_review', 'Точка А', '{}'::jsonb, '{}'::jsonb, 'h2', 'agent:report', $2)`, [company, plus(later, -1)])
      await sync(db, later)
      // created_at is the transaction time for every row here: pick by state, not by position.
      const fresh = (await tasksOf(db, client)).find((t) => t.closed_at === null)!
      expect(fresh.received_at.getTime()).toBe(plus(later, -1).getTime())
      expect(fresh.escalated_at).toBeNull()
    }))
})

// ─── R3-SLA (152): pa_ai_review and plan_prep ───────────────────────────────
const AI_TEXT = {
  executive_summary: 'ИИ: бизнес растёт', industry_context: 'норма отрасли',
  strategic_priorities: [{ title: 'Повторные продажи', rationale: 'база есть', expected_impact: '+10 %' }],
  growth_roadmap: [{ horizon: '30_days', actions: ['a'] }],
  blocks: { finance: { diagnosis: 'маржа ок' } },
}

async function clock152(db: Db, iso = '2000-01-01T00:00:00Z') {
  await db.query(
    `INSERT INTO public.system_settings (key, value) VALUES ('expert_sla_clock_start_152', to_jsonb($1::text))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [iso],
  )
}

async function seedAnalysis(db: Db, userId: string, companyId: string | null, opts: {
  status?: string; analysis?: unknown; generatedAt?: Date; reviewedAt?: Date | null; edits?: unknown
} = {}): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.diagnostics (user_id, company_id, overall_score, ai_status, ai_analysis, ai_generated_at, ai_reviewed_at, ai_reviewed_by_name, ai_expert_edits)
     VALUES ($1, $2, 61, $3, $4::jsonb, $5, $6, CASE WHEN $6::timestamptz IS NULL THEN NULL ELSE 'Эксперт' END, $7::jsonb) RETURNING id::text AS id`,
    [userId, companyId, opts.status ?? 'completed', opts.analysis === undefined ? JSON.stringify(AI_TEXT) : JSON.stringify(opts.analysis),
      opts.generatedAt ?? null, opts.reviewedAt ?? null, opts.edits === undefined ? null : JSON.stringify(opts.edits)],
  )
  return rows[0].id as string
}

async function seedPlan(db: Db, companyId: string, userId: string): Promise<string> {
  return (await db.query(`INSERT INTO public.pb_plans (company_id, user_id) VALUES ($1, $2) RETURNING id`, [companyId, userId])).rows[0].id as string
}

async function planPrep(db: Db, now: Date, waiting: Array<{ company: string; client: string }>, dropped: Array<{ company: string; reason: string }> = []): Promise<SyncRow[]> {
  return asService(db, async () => (await db.query(
    `SELECT * FROM public.expert_sla_plan_prep($1, 24, 48, $2::jsonb, $3::jsonb, 200)`,
    [now, JSON.stringify(waiting), JSON.stringify(dropped)],
  )).rows as SyncRow[])
}

async function openAiReview(db: Db, diag: string, now: Date, claim: boolean, claimQueue: boolean): Promise<SyncRow[]> {
  return asService(db, async () => (await db.query(
    `SELECT * FROM public.expert_sla_open_ai_review($1, $2, 24, 48, 200, $3, $4)`, [diag, now, claim, claimQueue],
  )).rows as SyncRow[])
}

describe.skipIf(!dbTestsEnabled)('R3-SLA: ИИ-разбор Точки А и план Точки Б (152)', () => {
  afterAll(closeTestPool)

  it('the source CHECK admits the two new sources and keeps the old ones', () =>
    inRollback(async (db) => {
      const client = await seedUser(db, { status: 'approved' })
      for (const s of ['case', 'report_review', 'rec_review', 'plan_review', 'pa_ai_review', 'plan_prep']) {
        await db.query(
          `INSERT INTO public.expert_sla_tasks (source, source_id, client_id, title, received_at, reaction_due_at, answer_due_at, closed_at)
           VALUES ($1, $1 || '-x', $2, 't', now(), now(), now(), now())`, [s, client])
      }
      expect(await pgErrorCode(db.query(
        `INSERT INTO public.expert_sla_tasks (source, source_id, client_id, title, received_at, reaction_due_at, answer_due_at)
         VALUES ('bogus', 'b', $1, 't', now(), now(), now())`, [client]))).toBe('23514')
    }))

  it('pa_ai_review: a ready / partial unchecked analysis opens a task for the responsible expert; nothing else does', () =>
    inRollback(async (db) => {
      await clockStart(db)
      await clock152(db)
      const t0 = await txNow(db)
      const expert = await seedUser(db, { role: 'expert', status: 'approved' })
      const mk = async () => { const u = await seedUser(db, { status: 'approved' }); return { u, c: await seedCompany(db, u) } }
      const ready = await mk(); const partial = await mk(); const reviewed = await mk(); const processing = await mk()
      const legacy = await mk(); const none = await mk(); const failedEmpty = await mk()
      await assign(db, ready.u, expert)
      const readyDiag = await seedAnalysis(db, ready.u, ready.c, { generatedAt: plus(t0, -1) })
      await seedAnalysis(db, partial.u, partial.c, { status: 'failed', analysis: { ...AI_TEXT, partial: ['blocksB'] } })
      await seedAnalysis(db, reviewed.u, reviewed.c, { reviewedAt: plus(t0, -0.5) })
      await seedAnalysis(db, processing.u, processing.c, { status: 'processing' })
      await seedAnalysis(db, legacy.u, legacy.c, { analysis: { strengths_text: 'старый v1' } })
      await seedAnalysis(db, none.u, none.c, { status: 'none', analysis: null })
      await seedAnalysis(db, failedEmpty.u, failedEmpty.c, { status: 'failed', analysis: null })
      const all = [ready, partial, reviewed, processing, legacy, none, failedEmpty].map((x) => x.u)

      const changes = (await sync(db, t0)).filter((c) => all.includes(c.r_client))
      expect(changes.map((c) => `${c.r_source}:${c.r_change}`).sort()).toEqual(['pa_ai_review:new', 'pa_ai_review:new'])
      const [r] = await tasksOf(db, ready.u)
      expect(r).toMatchObject({ source: 'pa_ai_review', source_id: readyDiag, assignee_id: expert, assigned_via: 'client', first_response_at: null })
      expect(r.received_at.getTime()).toBe(plus(t0, -1).getTime()) // the analysis' moment
      expect(r.answer_due_at.getTime() - r.received_at.getTime()).toBe(48 * H)
      const [p] = await tasksOf(db, partial.u)
      expect(p).toMatchObject({ source: 'pa_ai_review', assignee_id: null })
      expect((p as unknown as { title: string }).title).toContain('частичный')
      for (const x of [reviewed, processing, legacy, none, failedEmpty]) expect(await tasksOf(db, x.u)).toEqual([])
      // Idempotent: the next pass opens nothing.
      expect((await sync(db, plus(t0, 0.1))).filter((c) => all.includes(c.r_client) && c.r_change === 'new')).toEqual([])
    }))

  it('pa_ai_review: saved corrections = reaction, confirmation = answer; thresholds stop', () =>
    inRollback(async (db) => {
      await clockStart(db)
      await clock152(db)
      const t0 = await txNow(db)
      const client = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, client)
      const diag = await seedAnalysis(db, client, company, { generatedAt: t0 })
      await sync(db, t0)
      const [task] = await tasksOf(db, client)
      expect((await claim(db, 'escalated', plus(t0, 23.9))).filter((x) => x.id === task.id)).toEqual([])

      await db.query(`UPDATE public.diagnostics SET ai_expert_edits = '{"note":"Проверю"}'::jsonb WHERE id = $1`, [diag])
      const reacted = (await sync(db, plus(t0, 5))).filter((c) => c.r_task === task.id)
      expect(reacted.map((c) => c.r_change)).toEqual(['reacted'])
      expect((await tasksOf(db, client))[0].first_response_at!.getTime()).toBe(plus(t0, 5).getTime())
      expect((await claim(db, 'escalated', plus(t0, 30))).filter((x) => x.id === task.id)).toEqual([])

      await db.query(`UPDATE public.diagnostics SET ai_reviewed_at = $2, ai_reviewed_by_name = 'Эксперт' WHERE id = $1`, [diag, plus(t0, 31)])
      const closed = (await sync(db, plus(t0, 32))).filter((c) => c.r_task === task.id)
      expect(closed.map((c) => c.r_change)).toEqual(['closed'])
      const [done] = await tasksOf(db, client)
      expect(done).toMatchObject({ close_reason: 'reviewed', answered: true })
      expect(done.closed_at!.getTime()).toBe(plus(t0, 31).getTime())
      expect((await claim(db, 'breached', plus(t0, 60))).filter((x) => x.id === task.id)).toEqual([])
      // A confirmed analysis never reopens.
      expect((await sync(db, plus(t0, 61))).filter((c) => c.r_client === client)).toEqual([])
    }))

  it('pa_ai_review: a recalculation (new current row) supersedes the task; the new analysis keeps the clock and the escalation', () =>
    inRollback(async (db) => {
      await clockStart(db)
      await clock152(db)
      const t0 = await txNow(db)
      const client = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, client)
      const d1 = await seedAnalysis(db, client, company, { generatedAt: t0 })
      await sync(db, t0)
      expect((await claim(db, 'escalated', plus(t0, 25))).filter((x) => x.client_id === client)).toHaveLength(1)
      // The nightly recalculation: a new current row; the AI analysis is generated later.
      const d2 = await seedAnalysis(db, client, company, { status: 'processing', analysis: null })
      await sync(db, plus(t0, 26))
      let all = await tasksOf(db, client)
      expect(all).toHaveLength(1)
      expect(all[0]).toMatchObject({ source_id: d1, close_reason: 'superseded', answered: false })
      await db.query(`UPDATE public.diagnostics SET ai_status = 'completed', ai_analysis = $2::jsonb, ai_generated_at = $3 WHERE id = $1`,
        [d2, JSON.stringify(AI_TEXT), plus(t0, 27)])
      await sync(db, plus(t0, 28))
      all = await tasksOf(db, client)
      const fresh = all.find((t) => t.closed_at === null)!
      expect(fresh.source_id).toBe(d2)
      expect(fresh.received_at.getTime()).toBe(t0.getTime()) // inherited
      expect(fresh.escalated_at).not.toBeNull() // already escalated — not again
      expect((await claim(db, 'escalated', plus(t0, 29))).filter((x) => x.client_id === client)).toEqual([])
    }))

  it('pa_ai_review: a regeneration of the same row keeps the task; nothing left to check closes it as failed', () =>
    inRollback(async (db) => {
      await clockStart(db)
      await clock152(db)
      const t0 = await txNow(db)
      const client = await seedUser(db, { status: 'approved' })
      const diag = await seedAnalysis(db, client, await seedCompany(db, client), { generatedAt: t0 })
      await sync(db, t0)
      await db.query(`UPDATE public.diagnostics SET ai_status = 'processing' WHERE id = $1`, [diag])
      expect((await sync(db, plus(t0, 1))).filter((c) => c.r_client === client)).toEqual([])
      expect((await tasksOf(db, client))[0].closed_at).toBeNull()
      await db.query(`UPDATE public.diagnostics SET ai_status = 'failed', ai_analysis = NULL WHERE id = $1`, [diag])
      await sync(db, plus(t0, 2))
      expect((await tasksOf(db, client))[0]).toMatchObject({ close_reason: 'failed', answered: false })
    }))

  it('pa_ai_review follows the client\'s responsible (realign); plan_prep never does', () =>
    inRollback(async (db) => {
      await clockStart(db)
      await clock152(db)
      const t0 = await txNow(db)
      const e1 = await seedUser(db, { role: 'expert', status: 'approved' })
      const e2 = await seedUser(db, { role: 'expert', status: 'approved' })
      const client = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, client)
      await assign(db, client, e1)
      await seedAnalysis(db, client, company, { generatedAt: t0 })
      await sync(db, t0)
      await planPrep(db, t0, [{ company, client }])
      await assign(db, client, e2) // the trigger of 146 realigns at once
      const by = Object.fromEntries((await tasksOf(db, client)).map((t) => [t.source, t]))
      expect(by.pa_ai_review.assignee_id).toBe(e2)
      expect(by.plan_prep.assignee_id).toBeNull()
    }))

  it('the immediate path: one row only, the announcement claimed at insert, no duplicate with the pass', () =>
    inRollback(async (db) => {
      await clockStart(db)
      await clock152(db)
      const t0 = await txNow(db)
      const expert = await seedUser(db, { role: 'expert', status: 'approved' })
      const a = await seedUser(db, { status: 'approved' })
      const b = await seedUser(db, { status: 'approved' })
      await assign(db, a, expert)
      const da = await seedAnalysis(db, a, await seedCompany(db, a), { generatedAt: t0 })
      const db2 = await seedAnalysis(db, b, await seedCompany(db, b), { generatedAt: t0 })
      const ra = await openAiReview(db, da, t0, true, true)
      expect(ra.map((r) => [r.r_client, r.r_change, r.r_assignee])).toEqual([[a, 'new', expert]])
      expect(await tasksOf(db, b)).toEqual([]) // only the row asked for
      expect((await tasksOf(db, a))[0].assign_notified_at!.getTime()).toBe(t0.getTime())
      expect((await tasksOf(db, a))[0].queue_notified_at).toBeNull()
      const rb = await openAiReview(db, db2, t0, true, true)
      expect(rb.map((r) => r.r_assignee)).toEqual([null])
      expect((await tasksOf(db, b))[0].queue_notified_at!.getTime()).toBe(t0.getTime())
      // Repeated / the pass afterwards: nothing new.
      expect(await openAiReview(db, da, plus(t0, 0.1), true, true)).toEqual([])
      expect((await sync(db, plus(t0, 0.1))).filter((c) => [a, b].includes(c.r_client) && c.r_change === 'new')).toEqual([])
      // Without the claim (the pass) the outbox announces it.
      const c = await seedUser(db, { status: 'approved' })
      await assign(db, c, expert)
      await seedAnalysis(db, c, await seedCompany(db, c), { generatedAt: t0 })
      await sync(db, plus(t0, 0.2))
      expect((await tasksOf(db, c))[0].assign_notified_at).toBeNull()
    }))

  it('plan_prep: opened for a waiting client only, no assignee; a draft = reaction, an approval = answer', () =>
    inRollback(async (db) => {
      await clockStart(db)
      await clock152(db)
      const t0 = await txNow(db)
      const client = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, client)
      const other = await seedUser(db, { status: 'approved' })
      const busy = await seedUser(db, { status: 'approved' })
      const busyCo = await seedCompany(db, busy)
      await db.query(`INSERT INTO public.pb_plan_versions (plan_id, version, status) VALUES ($1, 1, 'draft')`, [await seedPlan(db, busyCo, busy)])
      const opened = await planPrep(db, t0, [{ company, client }, { company, client: other }, { company: busyCo, client: busy }])
      expect(opened.map((r) => `${r.r_source}:${r.r_change}:${r.r_client}`)).toEqual([`plan_prep:new:${client}`])
      const [task] = await tasksOf(db, client)
      expect(task).toMatchObject({ source_id: company, assignee_id: null, first_response_at: null })
      expect(task.received_at.getTime()).toBe(t0.getTime())
      expect(task.answer_due_at.getTime()).toBe(plus(t0, 48).getTime())
      expect(await planPrep(db, plus(t0, 0.1), [{ company, client }])).toEqual([]) // idempotent
      expect(await tasksOf(db, busy)).toEqual([])

      const plan = await seedPlan(db, company, client)
      const v = (await db.query(`INSERT INTO public.pb_plan_versions (plan_id, version, status, created_at) VALUES ($1, 1, 'draft', $2) RETURNING id`, [plan, plus(t0, 3)])).rows[0].id
      expect((await sync(db, plus(t0, 4))).filter((c) => c.r_task === task.id).map((c) => c.r_change)).toEqual(['reacted'])
      expect((await tasksOf(db, client))[0].first_response_at!.getTime()).toBe(plus(t0, 3).getTime())
      // The scan no longer lists him (a draft is open) — the task is kept while the plan is in work.
      expect(await planPrep(db, plus(t0, 5), [], [{ company, reason: 'needs_data' }])).toEqual([])
      expect((await tasksOf(db, client))[0].closed_at).toBeNull()

      await db.query(`UPDATE public.pb_plan_versions SET status = 'approved', approved_at = $2 WHERE id = $1`, [v, plus(t0, 10)])
      expect((await sync(db, plus(t0, 11))).filter((c) => c.r_task === task.id).map((c) => c.r_change)).toEqual(['closed'])
      const [done] = await tasksOf(db, client)
      expect(done).toMatchObject({ close_reason: 'approved', answered: true })
      expect(done.closed_at!.getTime()).toBe(plus(t0, 10).getTime())
      // An approved plan: the scan's «waiting» cannot reopen it.
      expect(await planPrep(db, plus(t0, 12), [{ company, client }])).toEqual([])
    }))

  it('plan_prep: thresholds 24 / 48 h; dropped without a version → closed without an answer; the company changing owner → gone', () =>
    inRollback(async (db) => {
      await clockStart(db)
      await clock152(db)
      const t0 = await txNow(db)
      const a = await seedUser(db, { status: 'approved' })
      const ca = await seedCompany(db, a)
      const b = await seedUser(db, { status: 'approved' })
      const cb = await seedCompany(db, b)
      await planPrep(db, t0, [{ company: ca, client: a }, { company: cb, client: b }])
      const mine = (rows: TaskRow[]) => rows.filter((t) => t.client_id === a)
      expect(mine(await claim(db, 'escalated', plus(t0, 23.9)))).toEqual([])
      expect(mine(await claim(db, 'escalated', plus(t0, 24.1)))).toHaveLength(1)
      expect(mine(await claim(db, 'breached', plus(t0, 48.5)))).toHaveLength(1)

      expect((await planPrep(db, plus(t0, 49), [], [{ company: ca, reason: 'no_access' }])).map((r) => r.r_change)).toEqual(['closed'])
      expect((await tasksOf(db, a))[0]).toMatchObject({ close_reason: 'no_access', answered: false })
      // He waits again within the window: the clock (and the thresholds already sent) is inherited.
      await planPrep(db, plus(t0, 50), [{ company: ca, client: a }])
      const again = (await tasksOf(db, a)).find((t) => t.closed_at === null)!
      expect(again.received_at.getTime()).toBe(t0.getTime())
      expect(again.breached_at).not.toBeNull()

      const other = await seedUser(db, { status: 'approved' })
      await db.query(`UPDATE public.companies SET user_id = $2 WHERE id = $1`, [cb, other])
      await sync(db, plus(t0, 51))
      expect((await tasksOf(db, b))[0]).toMatchObject({ close_reason: 'gone', answered: false })
    }))

  it('the clock of 152: work that waited before the new sources counts from their clock start', () =>
    inRollback(async (db) => {
      await clockStart(db)
      const t0 = await txNow(db)
      await clock152(db, plus(t0, -2).toISOString())
      const client = await seedUser(db, { status: 'approved' })
      await seedAnalysis(db, client, await seedCompany(db, client), { generatedAt: plus(t0, -500) })
      await sync(db, t0)
      const [task] = await tasksOf(db, client)
      expect(task.received_at.getTime()).toBe(plus(t0, -2).getTime())
      expect((await claim(db, 'breached', t0)).filter((x) => x.client_id === client)).toEqual([])
      // Written once, on the first call.
      await db.query(`DELETE FROM public.system_settings WHERE key = 'expert_sla_clock_start_152'`)
      await asService(db, () => db.query(`SELECT public.expert_sla_clock_152($1)`, [plus(t0, 1)]))
      await asService(db, () => db.query(`SELECT public.expert_sla_clock_152($1)`, [plus(t0, 9)]))
      const v = (await db.query(`SELECT value #>> '{}' AS v FROM public.system_settings WHERE key = 'expert_sla_clock_start_152'`)).rows[0].v
      expect(new Date(v).getTime()).toBe(plus(t0, 1).getTime())
    }))

  it('RLS and rights: the client sees his new tasks, the expert his client\'s; the new functions are service-role only', () =>
    inRollback(async (db) => {
      await clockStart(db)
      await clock152(db)
      const t0 = await txNow(db)
      const expert = await seedUser(db, { role: 'expert', status: 'approved' })
      const stranger = await seedUser(db, { role: 'expert', status: 'approved' })
      const client = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, client)
      await assign(db, client, expert)
      const diag = await seedAnalysis(db, client, company, { generatedAt: t0 })
      await sync(db, t0)
      await planPrep(db, t0, [{ company, client }])
      const seen = (uid: string) => asUser(db, uid, async () =>
        (await db.query(`SELECT source FROM public.expert_sla_tasks WHERE client_id = $1 ORDER BY source`, [client])).rows.map((r) => r.source as string))
      expect(await seen(client)).toEqual(['pa_ai_review', 'plan_prep'])
      expect(await seen(expert)).toEqual(['pa_ai_review', 'plan_prep'])
      expect(await seen(stranger)).toEqual([])
      for (const sql of [
        [`SELECT * FROM public.expert_sla_open_ai_review($1::uuid, now(), 24, 48, 5, true, true)`, [diag]],
        [`SELECT * FROM public.expert_sla_plan_prep(now(), 24, 48, '[]'::jsonb, '[]'::jsonb, 5)`, []],
        [`SELECT public.expert_sla_clock_152(now())`, []],
      ] as Array<[string, unknown[]]>) {
        expect(await pgErrorCode(asUser(db, client, () => db.query(sql[0], sql[1])))).toBe('42501')
        expect(await pgErrorCode(asUser(db, expert, () => db.query(sql[0], sql[1])))).toBe('42501')
      }
    }))

  it('152 is idempotent; the rollback deletes the new-source rows, narrows the CHECK, restores 149 — and 152 applies again', () =>
    inRollback(async (db) => {
      await clockStart(db)
      await clock152(db)
      const t0 = await txNow(db)
      const client = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, client)
      await seedAnalysis(db, client, company, { generatedAt: t0 })
      const caseId = await seedCase(db, client)
      const up = readFileSync(join(process.cwd(), 'supabase/migrations/152_expert_sla_ai_review_plan_prep.sql'), 'utf8')
      const down = readFileSync(join(process.cwd(), 'supabase/migrations/rollback/152_expert_sla_ai_review_plan_prep.down.sql'), 'utf8')
      await db.query(up) // a second application changes nothing
      await sync(db, t0)
      await planPrep(db, t0, [{ company, client }])
      expect((await tasksOf(db, client)).map((t) => t.source).sort()).toEqual(['case', 'pa_ai_review', 'plan_prep'])

      await db.query(down)
      expect((await tasksOf(db, client)).map((t) => t.source)).toEqual(['case']) // the case task stays
      await db.query('SAVEPOINT narrow')
      expect(await pgErrorCode(db.query(
        `INSERT INTO public.expert_sla_tasks (source, source_id, client_id, title, received_at, reaction_due_at, answer_due_at)
         VALUES ('plan_prep', 'p', $1, 't', now(), now(), now())`, [client]))).toBe('23514')
      await db.query('ROLLBACK TO SAVEPOINT narrow')
      expect((await db.query(`SELECT to_regprocedure('public.expert_sla_plan_prep(timestamptz, int, int, jsonb, jsonb, int)') AS f`)).rows[0].f).toBeNull()
      // 149's sync again: no AI-review task, the case still followed.
      await db.query(`UPDATE public.expert_cases SET status = 'resolved' WHERE id = $1`, [caseId])
      const after = (await sync(db, plus(t0, 1))).filter((c) => c.r_client === client)
      expect(after.map((c) => `${c.r_source}:${c.r_change}`)).toEqual(['case:closed'])

      await db.query(up)
      const back = (await sync(db, plus(t0, 2))).filter((c) => c.r_client === client)
      expect(back.map((c) => `${c.r_source}:${c.r_change}`)).toEqual(['pa_ai_review:new'])
    }))
})
