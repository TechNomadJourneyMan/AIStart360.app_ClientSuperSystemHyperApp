/**
 * R3-PB (L1, R-045): RLS of every pb_* table by role, on the real policies of the disposable test DB (125–132, 140,
 * 147, 151). What PostgREST would return to a session that reads the table straight with its JWT:
 *
 *   owner (Pro)            his own rows; of the plan versions — the APPROVED one only (never a draft); of the
 *                          recommendations — the expert-verified only; never the run journal
 *   owner (Free, gates on) nothing (the paid section is closed at the database level, 147)
 *   another client         nothing of this company
 *   staff by scope         the company-scoped tables (goal reviews, finmodel, verified recommendations, checkpoints,
 *                          monthly facts) of the clients in their scope; never the owner-only tables (plans, versions,
 *                          saved what-if, invites) and never the journal — the staff tools read those with the
 *                          service role after their own scope check (lib/admin/client-scope.ts)
 *   staff out of scope     nothing
 *   anon                   no grant at all (42501)
 * Nobody writes through the API roles: every write is the server's (service role).
 */
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asUser, closeTestPool, inRollback, seedCompany, seedStaff, seedUser, type Db } from '../../helpers/pg-rls'

const TABLES = [
  'pb_plans', 'pb_plan_versions', 'pb_goal_reviews', 'pb_finmodel_inputs', 'pb_saved_scenarios',
  'pb_recommendations', 'pb_invites', 'pb_checkpoints', 'pb_monthly_facts', 'pb_runs',
] as const
type Table = (typeof TABLES)[number]
type Seen = Record<Table, number>

interface World { owner: string; company: string; other: string; otherCompany: string }

async function seedPointB(db: Db, owner: string, company: string): Promise<void> {
  const plan = (await db.query(`INSERT INTO public.pb_plans (company_id, user_id) VALUES ($1, $2) RETURNING id`, [company, owner])).rows[0].id as string
  const approved = (await db.query(
    `INSERT INTO public.pb_plan_versions (plan_id, version, status, scenarios, selected_scenario, change_reason, approved_at)
     VALUES ($1, 1, 'approved', '[{"key":"moderate"}]'::jsonb, 'moderate', 'Первая версия плана', now()) RETURNING id`,
    [plan],
  )).rows[0].id as string
  await db.query(`INSERT INTO public.pb_plan_versions (plan_id, version, status, change_reason) VALUES ($1, 2, 'draft', 'Черновик')`, [plan])
  await db.query(`UPDATE public.pb_plans SET published_version_id = $2, current_version_id = $2 WHERE id = $1`, [plan, approved])
  await db.query(`INSERT INTO public.pb_goal_reviews (company_id, metric_key, period_label, status, proposed_value) VALUES ($1, 'biz.finansy.vyruchka_god', '12m', 'verified', 120000000)`, [company])
  await db.query(`INSERT INTO public.pb_finmodel_inputs (company_id, key, value, origin) VALUES ($1, 'cash_balance', 1000000, 'owner')`, [company])
  await db.query(`INSERT INTO public.pb_saved_scenarios (company_id, user_id, name, changes, model_version) VALUES ($1, $2, 'Мой расчёт', '[]'::jsonb, 'pb-model-2')`, [company, owner])
  await db.query(
    `INSERT INTO public.pb_recommendations (company_id, version_id, kind, title, generated_by, status, reviewer_name, reviewed_at)
     VALUES ($1, $2, 'lever', 'Проверенная', 'rule', 'expert_verified', 'Админ', now()),
            ($1, $2, 'lever', 'На проверке', 'ai', 'pending_review', NULL, NULL)`,
    [company, approved],
  )
  await db.query(`INSERT INTO public.pb_invites (company_id, user_id, rule_key, dedupe_key, title) VALUES ($1, $2, 'test', $3, 'Приглашение')`, [company, owner, `k-${company}`])
  await db.query(`INSERT INTO public.pb_checkpoints (company_id, plan_id, version_id, period) VALUES ($1, $2, $3, '2026-09')`, [company, plan, approved])
  await db.query(`INSERT INTO public.pb_monthly_facts (company_id, period, metric, value, source, entered_role) VALUES ($1, '2026-09', 'revenue', 5000000, 'revenue_history', 'owner')`, [company])
  await db.query(`INSERT INTO public.pb_runs (kind, company_id, status) VALUES ('manual', $1, 'done')`, [company])
}

async function world(db: Db, gates = true): Promise<World> {
  await db.query(
    `INSERT INTO public.system_settings (key, value) VALUES ('access_gates', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(gates)],
  )
  const owner = await seedUser(db, { status: 'approved' })
  const other = await seedUser(db, { status: 'approved' })
  await db.query(`UPDATE public.profiles SET tier = 'pro' WHERE id = ANY($1)`, [[owner, other]])
  const company = await seedCompany(db, owner, 'Ромашка')
  const otherCompany = await seedCompany(db, other, 'Лютик')
  await seedPointB(db, owner, company)
  await seedPointB(db, other, otherCompany)
  return { owner, company, other, otherCompany }
}

/** The read, or -1 when it is refused with 42501 (inside its own savepoint, so the transaction goes on). */
async function denied(db: Db, read: () => Promise<number>): Promise<number> {
  await db.query('SAVEPOINT pb_read')
  try {
    const out = await read()
    await db.query('RELEASE SAVEPOINT pb_read')
    return out
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT pb_read')
    if ((err as { code?: string }).code !== '42501') throw err
    return -1
  }
}

/** The Postgres code a statement is refused with (null = it ran), inside its own savepoint. */
async function codeOf(db: Db, sql: string, args: unknown[] = []): Promise<string | null> {
  await db.query('SAVEPOINT pb_try')
  try {
    await db.query(sql, args)
    await db.query('RELEASE SAVEPOINT pb_try')
    return null
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT pb_try')
    return (err as { code?: string }).code ?? 'unknown'
  }
}

/** Rows of THE OWNER'S company (and his user rows) that `uid` reads, per table. */
async function seen(db: Db, uid: string, w: World): Promise<Seen> {
  return asUser(db, uid, async () => {
    const n = async (sql: string, args: unknown[]) => Number((await db.query(sql, args)).rows[0].n)
    const byCompany = (t: string) => n(`SELECT count(*) AS n FROM public.${t} WHERE company_id = $1`, [w.company])
    return {
      pb_plans: await byCompany('pb_plans'),
      pb_plan_versions: await n(`SELECT count(*) AS n FROM public.pb_plan_versions v WHERE v.plan_id IN (SELECT id FROM public.pb_plans WHERE company_id = $1) OR v.plan_id IN (SELECT p.id FROM public.pb_plans p WHERE p.user_id = $2)`, [w.company, w.owner]),
      pb_goal_reviews: await byCompany('pb_goal_reviews'),
      pb_finmodel_inputs: await byCompany('pb_finmodel_inputs'),
      pb_saved_scenarios: await byCompany('pb_saved_scenarios'),
      pb_recommendations: await byCompany('pb_recommendations'),
      pb_invites: await byCompany('pb_invites'),
      pb_checkpoints: await byCompany('pb_checkpoints'),
      pb_monthly_facts: await byCompany('pb_monthly_facts'),
      // No grant at all for the API roles: the read is refused (-1), never an empty answer by accident.
      pb_runs: await denied(db, () => n(`SELECT count(*) AS n FROM public.pb_runs WHERE company_id = $1`, [w.company])),
    }
  })
}

const NONE: Seen = Object.fromEntries(TABLES.map((t) => [t, 0])) as Seen
/** The owner: his rows; the approved version only (not the draft); the verified recommendation only; no journal. */
const OWNER: Seen = {
  pb_plans: 1, pb_plan_versions: 1, pb_goal_reviews: 1, pb_finmodel_inputs: 1, pb_saved_scenarios: 1,
  pb_recommendations: 1, pb_invites: 1, pb_checkpoints: 1, pb_monthly_facts: 1, pb_runs: -1,
}
/** Staff by scope: the company-scoped tables; never the owner-only ones (service role in the staff tools). */
const STAFF: Seen = { ...NONE, pb_goal_reviews: 1, pb_finmodel_inputs: 1, pb_recommendations: 1, pb_checkpoints: 1, pb_monthly_facts: 1, pb_runs: -1 }
const OUTSIDER: Seen = { ...NONE, pb_runs: -1 }

async function assign(db: Db, client: string, assignee: string): Promise<void> {
  await db.query(
    `INSERT INTO public.user_assignments (user_id, assignee_id) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET assignee_id = EXCLUDED.assignee_id`,
    [client, assignee],
  )
}

describe.skipIf(!dbTestsEnabled)('RLS of the pb_* tables by role (R3-PB, R-045)', () => {
  afterAll(closeTestPool)

  it('the owner (Pro) reads his own Point B: approved version only, verified recommendations only, no journal', () =>
    inRollback(async (db) => {
      const w = await world(db)
      expect(await seen(db, w.owner, w)).toEqual(OWNER)
      // and never the draft's content or the pending recommendation's text
      const titles = await asUser(db, w.owner, async () => (await db.query(`SELECT title FROM public.pb_recommendations`)).rows.map((r) => r.title))
      expect(titles).toEqual(['Проверенная'])
      const statuses = await asUser(db, w.owner, async () => (await db.query(`SELECT status FROM public.pb_plan_versions`)).rows.map((r) => r.status))
      expect(statuses).toEqual(['approved'])
    }))

  it('another client reads nothing of this company (and only his own Point B)', () =>
    inRollback(async (db) => {
      const w = await world(db)
      expect(await seen(db, w.other, w)).toEqual(OUTSIDER)
      const own = await asUser(db, w.other, async () => Number((await db.query(`SELECT count(*) AS n FROM public.pb_plans`)).rows[0].n))
      expect(own).toBe(1)
    }))

  it('a Free owner with the gates on reads nothing of his own Point B (147); with the gates off — as Pro', () =>
    inRollback(async (db) => {
      const w = await world(db)
      await db.query(`UPDATE public.profiles SET tier = 'free' WHERE id = $1`, [w.owner])
      expect(await seen(db, w.owner, w)).toEqual(OUTSIDER)
      await db.query(`UPDATE public.system_settings SET value = 'false'::jsonb WHERE key = 'access_gates'`)
      expect(await seen(db, w.owner, w)).toEqual(OWNER)
    }))

  it('staff see by scope: admin — the company-scoped tables of any client; an «assigned» super_expert — only after the assignment', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const admin = await seedStaff(db, 'admin')
      expect(await seen(db, admin, w)).toEqual(STAFF)

      const scoped = await seedStaff(db, 'super_expert')
      await db.query(`UPDATE public.staff_roles SET client_scope = 'assigned' WHERE user_id = $1`, [scoped])
      expect(await seen(db, scoped, w)).toEqual(OUTSIDER)
      await assign(db, w.other, scoped) // another client: still nothing of this one
      expect(await seen(db, scoped, w)).toEqual(OUTSIDER)
      await assign(db, w.owner, scoped)
      expect(await seen(db, scoped, w)).toEqual(STAFF)
    }))

  it('an approved expert sees the company-scoped tables of his assigned clients only', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const expert = await seedUser(db, { role: 'expert', status: 'approved' })
      expect(await seen(db, expert, w)).toEqual(OUTSIDER)
      await assign(db, w.owner, expert)
      expect(await seen(db, expert, w)).toEqual(STAFF)
    }))

  it('anon has no grant on any pb_* table; no API role writes', () =>
    inRollback(async (db) => {
      const w = await world(db)
      for (const t of TABLES) {
        expect(await asUser(db, null, () => codeOf(db, `SELECT 1 FROM public.${t} LIMIT 1`)), t).toBe('42501')
      }
      for (const uid of [w.owner, await seedStaff(db, 'super_admin')]) {
        expect(await asUser(db, uid, () => codeOf(db, `INSERT INTO public.pb_plans (company_id, user_id) VALUES ($1, $2)`, [w.company, w.owner]))).toBe('42501')
        expect(await asUser(db, uid, () => codeOf(db, `UPDATE public.pb_plan_versions SET status = 'approved' WHERE status = 'draft'`))).toBe('42501')
        expect(await asUser(db, uid, () => codeOf(db, `INSERT INTO public.pb_monthly_facts (company_id, period, metric, value, entered_role) VALUES ($1, '2026-10', 'revenue', 1, 'owner')`, [w.company]))).toBe('42501')
        expect(await asUser(db, uid, () => codeOf(db, `DELETE FROM public.pb_recommendations`))).toBe('42501')
      }
    }))

  it('R3-PB review H1 (151): point_b_analysis — the staff-only AI strategy: the client neither reads nor writes it; staff and the service role do', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const diag = (await db.query(`INSERT INTO public.diagnostics (user_id, company_id, overall_score) VALUES ($1, $2, 60) RETURNING id`, [w.owner, w.company])).rows[0].id as string
      await db.query(
        `INSERT INTO public.point_b_analysis (diagnostic_id, is_current, ai_status, ai_strategy) VALUES ($1, true, 'completed', '{"draft":"ИИ-черновик для персонала"}'::jsonb)`,
        [diag],
      )
      const read = (uid: string | null) => asUser(db, uid, () => codeOf(db, `SELECT ai_strategy FROM public.point_b_analysis`))
      const rows = (uid: string) => asUser(db, uid, async () => (await db.query(`SELECT ai_status, ai_strategy FROM public.point_b_analysis WHERE diagnostic_id = $1`, [diag])).rows)

      // the owner (Pro, gates on): no row at all, and no write — not the AI fields, not the V2 snapshot staff read
      expect(await read(w.owner)).toBeNull()
      expect(await rows(w.owner)).toEqual([])
      expect(await asUser(db, w.owner, () => codeOf(db, `UPDATE public.point_b_analysis SET ai_strategy = '{"x":1}'::jsonb, ai_status = 'completed'`))).toBe('42501')
      expect(await asUser(db, w.owner, () => codeOf(db, `INSERT INTO public.point_b_analysis (diagnostic_id, is_current, ai_status) VALUES ($1, false, 'completed')`, [diag]))).toBe('42501')
      expect(await asUser(db, w.owner, () => codeOf(db, `DELETE FROM public.point_b_analysis`))).toBe('42501')
      // another client: nothing either; anon: no grant
      expect(await rows(w.other)).toEqual([])
      expect(await read(null)).toBe('42501')

      // staff read it (the draft is theirs): Admin always, an expert once assigned; a staff session does not write
      const admin = await seedStaff(db, 'admin')
      expect(await rows(admin)).toEqual([{ ai_status: 'completed', ai_strategy: { draft: 'ИИ-черновик для персонала' } }])
      expect(await asUser(db, admin, () => codeOf(db, `UPDATE public.point_b_analysis SET ai_status = 'none'`))).toBe('42501')
      const expert = await seedUser(db, { role: 'expert', status: 'approved' })
      expect(await rows(expert)).toEqual([])
      await assign(db, w.owner, expert)
      expect(await rows(expert)).toHaveLength(1)

      // the service role (every path of the app) reads and writes as before
      const svc = await db.query(`SELECT has_table_privilege('service_role', 'public.point_b_analysis', 'SELECT, UPDATE, INSERT') AS ok`)
      expect(svc.rows[0].ok).toBe(true)
      const policies = (await db.query(`SELECT polname FROM pg_policy WHERE polrelid = 'public.point_b_analysis'::regclass ORDER BY 1`)).rows.map((r) => r.polname)
      expect(policies).not.toContain('point_b_owner_read')
      expect(policies).not.toContain('point_b_owner_write')
    }))
})

