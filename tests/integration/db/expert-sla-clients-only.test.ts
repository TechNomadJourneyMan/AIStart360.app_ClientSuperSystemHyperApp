/**
 * R4 S0 — expert SLA work exists only for clients of the product (migration 153).
 *
 * Production 2026-11-16: 5 of 7 open SLA tasks were about staff accounts (both Super Admins and an Admin — their
 * own test case, reports, Point B plan). On the real schema, inside a rolled-back transaction:
 *   • every source (case, report_review via expert_sla_sync; pa_ai_review; plan_prep) opens a task for a client
 *     and none for a staff account (staff_roles row, also with a «client» profile, as on production) or an expert;
 *   • expert_sla_close_non_clients closes what was opened before 153 ('excluded', answered = false), a client's
 *     task stays open;
 *   • the plan scan (lib/point-b/plan/waiting.ts) does not calculate the model for a staff account.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { pgPostgrest } from '../../helpers/pg-postgrest'
import { asService, closeTestPool, inRollback, seedCompany, seedStaff, seedUser, type Db } from '../../helpers/pg-rls'

const { listClientsWaitingForPlan } = await import('@/lib/point-b/plan/waiting')

const AI = { executive_summary: 'ИИ: бизнес растёт', strategic_priorities: [{ title: 'Повторные продажи' }], blocks: { finance: { diagnosis: 'ok' } } }

async function clocks(db: Db) {
  for (const key of ['expert_sla_clock_start', 'expert_sla_clock_start_152']) {
    await db.query(
      `INSERT INTO public.system_settings (key, value) VALUES ($1, to_jsonb('2000-01-01T00:00:00Z'::text))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key])
  }
}

/** A case, a report in review and a current AI analysis of Point A for the account; returns its company. */
async function work(db: Db, userId: string): Promise<string> {
  const company = await seedCompany(db, userId, `Co ${userId.slice(0, 4)}`)
  await db.query(
    `INSERT INTO public.expert_cases (user_id, status, priority, trigger_type, title) VALUES ($1, 'new', 'medium', 'user_requested_help', 'Вопрос')`,
    [userId])
  await db.query(
    `INSERT INTO public.report_versions (company_id, report_type, version, status, title, content, provenance, data_hash, created_by)
     VALUES ($1, 'point_a', 1, 'in_review', 'Точка А', '{}'::jsonb, '{}'::jsonb, 'h1', 'agent:report')`, [company])
  await db.query(
    `INSERT INTO public.diagnostics (user_id, company_id, overall_score, ai_status, ai_analysis, ai_generated_at)
     VALUES ($1, $2, 61, 'completed', $3::jsonb, now())`, [userId, company, JSON.stringify(AI)])
  return company
}

const sources = async (db: Db, userId: string): Promise<string[]> =>
  ((await db.query(`SELECT source FROM public.expert_sla_tasks WHERE client_id = $1 AND closed_at IS NULL ORDER BY source`, [userId])).rows as Array<{ source: string }>).map((r) => r.source)

async function pass(db: Db, waiting: Array<{ company: string; client: string }>) {
  await asService(db, async () => {
    await db.query(`SELECT * FROM public.expert_sla_sync(now(), 24, 48, 200)`)
    await db.query(`SELECT * FROM public.expert_sla_plan_prep(now(), 24, 48, $1::jsonb, '[]'::jsonb, 200)`, [JSON.stringify(waiting)])
  })
}

describe.skipIf(!dbTestsEnabled)('expert SLA — clients only (153)', () => {
  afterAll(closeTestPool)

  it('every source opens work for a client and none for staff (also with a «client» profile) or an expert', () =>
    inRollback(async (db) => {
      await clocks(db)
      const client = await seedUser(db, { status: 'approved' })
      const superAdmin = await seedStaff(db, 'super_admin')
      const adminWithClientProfile = await seedStaff(db, 'admin') // profile role 'client' + staff_roles admin, as on production
      const expert = await seedUser(db, { status: 'approved', role: 'expert' })
      const companies = new Map<string, string>()
      for (const u of [client, superAdmin, adminWithClientProfile, expert]) companies.set(u, await work(db, u))

      await pass(db, [...companies].map(([u, c]) => ({ company: c, client: u })))

      expect(await sources(db, client)).toEqual(['case', 'pa_ai_review', 'plan_prep', 'report_review'])
      expect(await sources(db, superAdmin)).toEqual([])
      expect(await sources(db, adminWithClientProfile)).toEqual([])
      expect(await sources(db, expert)).toEqual([])

      // a second pass does not change that (the skipped rows are not «missing» work to retry)
      await pass(db, [...companies].map(([u, c]) => ({ company: c, client: u })))
      expect(await sources(db, superAdmin)).toEqual([])
      expect((await db.query(`SELECT count(*)::int AS n FROM public.expert_sla_tasks WHERE client_id = $1`, [client])).rows[0].n).toBe(4)
    }))

  it('expert_sla_is_client: staff row or a non-client profile role → not a client; NULL keeps the work', () =>
    inRollback(async (db) => {
      const client = await seedUser(db, { status: 'approved' })
      const staff = await seedStaff(db, 'support')
      const manager = await seedUser(db, { status: 'approved', role: 'manager' }) // a non-client profile role without staff_roles
      const r = (await db.query(
        `SELECT public.expert_sla_is_client($1) AS c, public.expert_sla_is_client($2) AS s,
                public.expert_sla_is_client($3) AS m, public.expert_sla_is_client(NULL) AS n`,
        [client, staff, manager])).rows[0]
      expect(r).toEqual({ c: true, s: false, m: false, n: true })
    }))

  it('tasks opened before 153 for staff are closed as excluded; a client task stays open', () =>
    inRollback(async (db) => {
      await clocks(db)
      const client = await seedUser(db, { status: 'approved' })
      const staff = await seedStaff(db, 'super_admin')
      await db.query(`ALTER TABLE public.expert_sla_tasks DISABLE TRIGGER expert_sla_tasks_clients_only`)
      for (const u of [client, staff]) await work(db, u)
      await pass(db, [])
      await db.query(`ALTER TABLE public.expert_sla_tasks ENABLE TRIGGER expert_sla_tasks_clients_only`)
      expect(await sources(db, staff)).toEqual(['case', 'pa_ai_review', 'report_review'])

      const closed = await asService(db, async () =>
        (await db.query(`SELECT * FROM public.expert_sla_close_non_clients(now())`)).rows as Array<{ r_client: string }>)
      expect(new Set(closed.map((c) => c.r_client))).toEqual(new Set([staff]))
      expect(await sources(db, staff)).toEqual([])
      expect(await sources(db, client)).toEqual(['case', 'pa_ai_review', 'report_review'])
      const reasons = (await db.query(
        `SELECT DISTINCT close_reason, answered FROM public.expert_sla_tasks WHERE client_id = $1`, [staff])).rows
      expect(reasons).toEqual([{ close_reason: 'excluded', answered: false }])
    }))

  it('only the service role runs the new functions', () =>
    inRollback(async (db) => {
      const r = (await db.query(
        `SELECT has_function_privilege('authenticated', 'public.expert_sla_close_non_clients(timestamptz)', 'EXECUTE') AS a,
                has_function_privilege('anon', 'public.expert_sla_is_client(uuid)', 'EXECUTE') AS b,
                has_function_privilege('service_role', 'public.expert_sla_close_non_clients(timestamptz)', 'EXECUTE') AS c`)).rows[0]
      expect(r).toEqual({ a: false, b: false, c: true })
    }))

  it('the plan scan does not calculate the model for a staff account with a goal', () =>
    inRollback(async (db) => {
      const client = await seedUser(db, { status: 'approved' })
      const staff = await seedStaff(db, 'super_admin')
      const companies: Record<string, string> = {}
      for (const u of [client, staff]) {
        companies[u] = await seedCompany(db, u, `Goal ${u.slice(0, 4)}`)
        await db.query(
          `INSERT INTO public.metric_targets (company_id, metric_key, target_value, period_label, source, baseline_at)
           VALUES ($1, 'biz.finansy.vyruchka_god', 120000000, '12m', 'owner', now())`, [companies[u]])
      }
      const modelled: string[] = []
      const scan = await listClientsWaitingForPlan(pgPostgrest(db, null) as never, {
        hasAccess: async () => true,
        model: async (userId) => { modelled.push(userId); return { level: 1, scenarios: [{ key: 'moderate' }], missing: [] } as never },
      })
      expect(modelled).toEqual([client])
      expect(scan.waiting.map((w) => w.userId)).toEqual([client])
      expect(scan.candidates).not.toContain(companies[staff])
    }))
})
