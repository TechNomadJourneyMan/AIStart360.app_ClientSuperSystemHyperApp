/**
 * R3-PB (L1 of the audit R3-B): Точка Б end to end on the REAL schema of the disposable test DB — the migrations,
 * constraints, triggers (the immutability of an approved version, one open version per plan) and RLS — with the app
 * code unchanged (tests/helpers/pg-postgrest.ts turns its supabase-js calls into SQL in a rolled-back transaction).
 *
 *   a Pro client with a revenue goal and a funnel waits for a plan (the sign of the next round's queue)
 *   → Admin: «Собрать черновик плана» (M1): scenarios of the model, pace «умеренный», «Первая версия плана», a rule
 *     strategy, pending recommendations — the client sees none of it (state, RLS), only «План готовит команда»
 *   → the approval is refused until the goal is verified; then submit → approve (tasks → «Мои задачи»)
 *   → the client sees the approved plan (state, report for PDF / share / chat, RLS)
 *   → «Выручка по месяцам» (M2): 12 months → the overview gets its forecast and a verdict
 *   → «Пересчитать» (the staff button) → checkpoints; «Факт за месяц» → the plan-fact of that month.
 * Notifications, the invite rules and the rate limits are doubles (they are not what this test is about); no AI call.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { pgPostgrest, type PgPostgrest } from '../../helpers/pg-postgrest'
import { asUser, closeTestPool, inRollback, seedCompany, seedStaff, seedUser, type Db } from '../../helpers/pg-rls'

const s = vi.hoisted(() => ({ service: null as unknown }))

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.service }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/point-b/plan/notify', () => ({
  POINT_B_STAFF_PERMISSION: 'clients.review',
  pointBStaffLink: (id: string) => `/admin-giga-panel/users/${id}?tab=point-b`,
  notifyPlanApproved: async () => undefined,
  notifyPlanSubmitted: async () => undefined,
  notifyGoalCorrection: async () => undefined,
  notifyGoalNeedsReview: async () => undefined,
  notifyGoalResponded: async () => undefined,
}))
vi.mock('@/lib/point-b/planfact/notify', () => ({ notifyDeviation: async () => undefined }))
vi.mock('@/lib/point-b/invites/run', () => ({
  runInviteRules: async () => ({ created: 0, skipped: 0 }),
  inviteFromVerifiedRecommendation: async () => undefined,
}))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: () => undefined }))
vi.mock('@/lib/settings/store', async (orig) => ({ ...(await orig<typeof import('@/lib/settings/store')>()), getSetting: async () => null }))

const { buildQuickDraft, QUICK_DRAFT_REASON_FIRST } = await import('@/lib/point-b/plan/quick-draft')
const { approvePlanVersion, submitPlanVersion } = await import('@/lib/point-b/plan/flow')
const { reviewGoal } = await import('@/lib/point-b/plan/goals')
const { loadPlanBundle } = await import('@/lib/point-b/plan/store')
const { REASON_PRIMARY_NOT_VERIFIED } = await import('@/lib/point-b/plan/status')
const { listClientsWaitingForPlan } = await import('@/lib/point-b/plan/waiting')
const { loadPointBState } = await import('@/lib/point-b/model/load')
const { loadPointBReport } = await import('@/lib/point-b/report')
const { revenueHistoryPeriods, saveRevenueHistory, loadRevenueTable } = await import('@/lib/point-b/finmodel/revenue-history')
const { recomputeNow, saveFactsAndRefresh } = await import('@/lib/point-b/planfact/route')
const { lastFinishedPeriod } = await import('@/lib/point-b/planfact/kpis')

const REVENUE = 'biz.finansy.vyruchka_god'

interface World { client: string; company: string; admin: string; other: string; otherCompany: string; svc: PgPostgrest }

async function world(db: Db): Promise<World> {
  await db.query(
    `INSERT INTO public.system_settings (key, value) VALUES ('access_gates', 'true'::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  )
  const client = await seedUser(db, { status: 'approved' })
  await db.query(`UPDATE public.profiles SET tier = 'pro', full_name = 'Клиент Про' WHERE id = $1`, [client])
  const company = await seedCompany(db, client, 'Ромашка')
  await db.query(`UPDATE public.companies SET industry = 'Интернет-магазин' WHERE id = $1`, [company])
  await db.query(
    `INSERT INTO public.metric_targets (company_id, metric_key, target_value, period_label, source, baseline_at)
     VALUES ($1, $2, 120000000, '12m', 'owner', now())`,
    [company, REVENUE],
  )
  for (const [key, value] of [[REVENUE, 60_000_000], ['biz.marketing.lidov_v_mes', 300], ['biz.marketing.konversiya_lid_klient', 12], ['biz.prodazhi.sredniy_chek', 140_000]] as const) {
    await db.query(
      `INSERT INTO public.metrics (company_id, metric_key, metric_value, source, period_year, computed_at) VALUES ($1, $2, $3, 'survey', $4, now())`,
      [company, key, value, new Date().getUTCFullYear()],
    )
  }
  await db.query(
    `INSERT INTO public.gri_assessments (user_id, company_id, gri_index, is_current, top_5_limits)
     VALUES ($1, $2, 5.5, true, $3::jsonb)`,
    [client, company, JSON.stringify([{ rank: 1, title: 'Нет системы продаж', block: 'operations', severity: 'critical' }, { rank: 2, title: 'Нет повторных клиентов', block: 'product-demand', severity: 'high' }])],
  )
  const admin = await seedStaff(db, 'admin')
  const other = await seedUser(db, { status: 'approved' })
  await db.query(`UPDATE public.profiles SET tier = 'pro' WHERE id = $1`, [other])
  const otherCompany = await seedCompany(db, other, 'Лютик')
  const svc = pgPostgrest(db, null)
  s.service = svc
  return { client, company, admin, other, otherCompany, svc }
}

const count = async (db: Db, sql: string, args: unknown[]) => Number((await db.query(sql, args)).rows[0].n)
const asClient = <T>(db: Db, uid: string, fn: () => Promise<T>) => asUser(db, uid, fn)

/** The rule texts are reworded without numbers; a node whose new text would carry a foreign number keeps its own. */
const wordingStub = async (input: { strategy: { items: Array<{ key: string; kind: string; title: string }>; milestones: unknown[] } }) => ({
  strategy: { ...input.strategy, items: input.strategy.items.map((n, i) => (i === 0 ? { ...n, title: `${n.title} — главное направление` } : n)) },
  warnings: [],
  usage: null,
  reworded: 1,
})
const recsAiStub = async () => ({ items: [], warnings: ['no_api_key'], usage: null })

beforeEach(() => { s.service = null })

describe.skipIf(!dbTestsEnabled)('Точка Б end to end on the real schema (R3-PB, L1)', () => {
  afterAll(closeTestPool)

  it('draft in one click → approval → the client sees the plan → «Пересчитать» → a month fact → plan-fact', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const now = new Date()

      // ── 0. The Pro client with a goal and a funnel WAITS for a plan (the sign of the queue «Pro без плана»).
      const before = await loadPointBState(w.svc, w.client, { now })
      expect(before.overview.result).toMatchObject({ level: 1, kind: 'funnel' })
      expect(before.plan).toMatchObject({ status: 'preparing', scenarios: [], prep: { kind: 'waiting' } })
      const scan = await listClientsWaitingForPlan(w.svc, { now, hasAccess: async (u) => u === w.client })
      expect(scan.waiting.map((c) => c.userId)).toEqual([w.client])
      expect(scan.waiting[0]).toMatchObject({ companyId: w.company })

      // ── 1. Admin: «Собрать черновик плана».
      const author = { id: w.admin, name: 'Админ Главный', kind: 'admin' as const }
      const built = await buildQuickDraft(w.svc, { companyId: w.company, userId: w.client, author, now, wording: wordingStub as never, recsAi: recsAiStub as never })
      expect(built.created).toBe(true)
      expect(built).toMatchObject({ level: 1, scenarios: 3, selectedScenario: 'moderate' })
      expect(built.strategy.filled).toBe(true)
      expect(built.strategy.tasks).toBeGreaterThanOrEqual(3)
      expect(built.strategy.tasks).toBeLessThanOrEqual(7)
      expect(built.recommendations.created).toBeGreaterThanOrEqual(1) // the limiting factor of the rules

      const row = (await db.query(`SELECT * FROM public.pb_plan_versions WHERE id = $1`, [built.version.id])).rows[0]
      expect(row).toMatchObject({ status: 'draft', version: 1, change_reason: QUICK_DRAFT_REASON_FIRST, selected_scenario: 'moderate', author_kind: 'admin' })
      expect((row.scenarios as Array<{ key: string }>).map((x) => x.key)).toEqual(['cautious', 'moderate', 'aggressive'])
      const items = (row.strategy as { items: Array<{ kind: string; title: string }> }).items
      expect(items.find((n) => n.kind === 'strategy')!.title).toMatch(/главное направление$/)
      expect(items.some((n) => n.kind === 'initiative' && n.title.includes('Нет системы продаж'))).toBe(true)
      expect(await count(db, `SELECT count(*) AS n FROM public.pb_recommendations WHERE company_id = $1 AND status = 'pending_review' AND version_id = $2`, [w.company, built.version.id]))
        .toBe(built.recommendations.created)

      // the client sees nothing of the draft: the state says «План готовит команда», RLS hides the row
      const working = await loadPointBState(w.svc, w.client, { now })
      expect(working.plan).toMatchObject({ status: 'preparing', scenarios: [], strategy: null, prep: { kind: 'in_work' } })
      expect(JSON.stringify(working)).not.toContain('главное направление')
      expect(await asClient(db, w.client, () => count(db, `SELECT count(*) AS n FROM public.pb_plan_versions`, []))).toBe(0)
      expect(await asClient(db, w.client, () => count(db, `SELECT count(*) AS n FROM public.pb_recommendations`, []))).toBe(0)
      // a second click completes the same draft (one open version per plan), it never forks
      const again = await buildQuickDraft(w.svc, { companyId: w.company, userId: w.client, author, now, wording: wordingStub as never, recsAi: recsAiStub as never })
      expect(again).toMatchObject({ created: false })
      expect(again.version.id).toBe(built.version.id)
      expect(again.strategy.filled).toBe(false) // a strategy staff already have is never overwritten
      expect(await count(db, `SELECT count(*) AS n FROM public.pb_plan_versions WHERE plan_id = $1`, [row.plan_id])).toBe(1)

      // ── 2. The approval: refused while the primary goal is the owner's draft; then verify → submit → approve.
      const submitted = await submitPlanVersion(w.svc, { companyId: w.company, userId: w.client, version: built.version, actor: author })
      expect(submitted.status).toBe('in_review')
      expect((await loadPointBState(w.svc, w.client, { now })).plan.prep.kind).toBe('in_review')
      await expect(approvePlanVersion(w.svc, { companyId: w.company, userId: w.client, version: submitted, actor: author }))
        .rejects.toMatchObject({ code: 'conditions', reasons: [REASON_PRIMARY_NOT_VERIFIED] })
      await reviewGoal(w.svc, { companyId: w.company, metricKey: REVENUE, periodLabel: '12m', action: 'verify', reviewer: { id: w.admin, name: 'Админ Главный' } })
      const published = await approvePlanVersion(w.svc, { companyId: w.company, userId: w.client, version: submitted, actor: author })
      expect(published.version).toMatchObject({ status: 'approved', approved_by: w.admin })
      expect(published.tasks).toMatchObject({ ok: true })
      const tasks = await count(db, `SELECT count(*) AS n FROM public.action_items WHERE user_id = $1 AND source = 'point_b'`, [w.client])
      expect(tasks).toBe(built.strategy.tasks)
      // an approved version is immutable (trigger of migration 125)
      await db.query('SAVEPOINT imm')
      await expect(db.query(`UPDATE public.pb_plan_versions SET change_reason = 'x' WHERE id = $1`, [built.version.id])).rejects.toBeTruthy()
      await db.query('ROLLBACK TO SAVEPOINT imm')

      // ── 3. The client sees the approved plan — the page, the report (PDF / share / chat) and RLS agree.
      const after = await loadPointBState(w.svc, w.client, { now })
      expect(after.plan).toMatchObject({ status: 'published', version: 1, selectedScenario: 'moderate', prep: { kind: 'published' } })
      expect(after.plan.scenarios.map((x) => x.key)).toEqual(['cautious', 'moderate', 'aggressive'])
      expect(after.plan.strategy!.items.filter((n) => n.kind === 'task')).toHaveLength(tasks)
      const report = await loadPointBReport(w.svc, w.client, { now })
      expect(report.plan).toMatchObject({ status: 'published', version: 1, selectedScenario: 'moderate' })
      expect(report.plan.scenarios.find((x) => x.selected)!.key).toBe('moderate')
      expect(report.plan.strategy.length).toBeGreaterThanOrEqual(2)
      expect(report.gap).toMatchObject({ baseAnnual: 60_000_000, targetAnnual: 120_000_000 })
      expect(await asClient(db, w.client, () => count(db, `SELECT count(*) AS n FROM public.pb_plan_versions WHERE status = 'approved'`, []))).toBe(1)
      expect(await asClient(db, w.other, () => count(db, `SELECT count(*) AS n FROM public.pb_plan_versions`, []))).toBe(0)
      // the client is not waiting any more
      expect((await listClientsWaitingForPlan(w.svc, { now, hasAccess: async () => true })).waiting.map((c) => c.userId)).not.toContain(w.client)
    }), 60_000)

  it('M2: 12 months of revenue before any plan give the overview its forecast and a verdict (one history)', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const now = new Date()
      expect((await loadPointBState(w.svc, w.client, { now })).overview.result.verdict.key).toBe('no_data')

      const months = revenueHistoryPeriods(now).slice(-12).map((period, i) => ({ period, revenue: 4_000_000 + i * 50_000 }))
      await saveRevenueHistory(w.svc, { companyId: w.company, enteredBy: w.client, role: 'owner', months })
      const stored = (await db.query(`SELECT source, entered_role FROM public.pb_monthly_facts WHERE company_id = $1 AND metric = 'revenue'`, [w.company])).rows
      expect(stored).toHaveLength(12)
      expect(new Set(stored.map((r) => r.source))).toEqual(new Set(['revenue_history']))

      const table = await loadRevenueTable(w.svc, w.company, now)
      expect(table).toMatchObject({ run: 12, needed: 0, stale: false })
      expect(table.months.filter((m) => m.source === 'owner')).toHaveLength(12)

      const state = await loadPointBState(w.svc, w.client, { now })
      expect(state.overview.result.forecast.basis).toBe('history')
      expect(state.overview.result.verdict.key).not.toBe('no_data')
      // the client reads his own months (132 + 147), not the other company's
      expect(await asClient(db, w.client, () => count(db, `SELECT count(*) AS n FROM public.pb_monthly_facts`, []))).toBe(12)
      expect(await asClient(db, w.other, () => count(db, `SELECT count(*) AS n FROM public.pb_monthly_facts`, []))).toBe(0)

      // clearing a month breaks the run: the forecast is honestly gone again
      await saveRevenueHistory(w.svc, { companyId: w.company, enteredBy: w.client, role: 'owner', months: [{ period: months[6].period, revenue: null }] })
      expect((await loadRevenueTable(w.svc, w.company, now)).run).toBeLessThan(12)
      expect((await loadPointBState(w.svc, w.client, { now })).overview.result.forecast.basis).toBe('insufficient')
    }), 60_000)

  it('«Пересчитать» and «Факт за месяц» on an approved plan write the plan-fact the client reads', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const now = new Date()
      const author = { id: w.admin, name: 'Админ Главный', kind: 'admin' as const }
      // revenue history first (M2), then the plan
      const months = revenueHistoryPeriods(now).slice(-12).map((period) => ({ period, revenue: 5_000_000 }))
      await saveRevenueHistory(w.svc, { companyId: w.company, enteredBy: w.client, role: 'owner', months })
      const built = await buildQuickDraft(w.svc, { companyId: w.company, userId: w.client, author, now, ai: false })
      await reviewGoal(w.svc, { companyId: w.company, metricKey: REVENUE, periodLabel: '12m', action: 'verify', reviewer: { id: w.admin, name: 'Админ Главный' } })
      const submitted = await submitPlanVersion(w.svc, { companyId: w.company, userId: w.client, version: built.version, actor: author })
      await approvePlanVersion(w.svc, { companyId: w.company, userId: w.client, version: submitted, actor: author })
      const bundle = await loadPlanBundle(w.svc, w.company)
      expect(bundle.published!.id).toBe(built.version.id)

      // «Пересчитать» (the staff button: synchronous, journaled)
      const run = await recomputeNow(w.svc, { companyId: w.company, userId: w.client, actorId: w.admin, now })
      expect(run).toMatchObject({ ok: true })
      if (!run.ok) throw new Error('limited')
      expect(run.outcome.status).toBe('done')
      expect(await count(db, `SELECT count(*) AS n FROM public.pb_checkpoints WHERE version_id = $1`, [built.version.id])).toBe(2)
      expect((await db.query(`SELECT kind, status, triggered_by FROM public.pb_runs WHERE company_id = $1`, [w.company])).rows)
        .toEqual([{ kind: 'manual', status: 'done', triggered_by: w.admin }])

      // «Факт за месяц» of the last finished month → that checkpoint has the owner's fact from the reconciliation
      const period = lastFinishedPeriod(now)
      const saved = await saveFactsAndRefresh(w.svc, {
        companyId: w.company, userId: w.client, body: { period, values: { revenue: 7_000_000 } }, enteredBy: w.client, role: 'owner', now,
      })
      expect(saved).toMatchObject({ period, saved: ['revenue'] })
      expect(saved.checkpoint.status).toBe('done')
      const fact = (await db.query(`SELECT source FROM public.pb_monthly_facts WHERE company_id = $1 AND metric = 'revenue' AND period = $2`, [w.company, period])).rows[0]
      expect(fact.source).toBe('monthly_reconciliation')

      const state = await loadPointBState(w.svc, w.client, { now })
      const cp = state.planFact!.checkpoints.find((c) => c.period === period)!
      expect(cp.actual.revenue).toBe(7_000_000)
      expect(cp.actualSources.revenue).toBe('reconciliation')
      expect(['on_track', 'risk', 'behind', 'no_data']).toContain(cp.overall)
      // the client reads the checkpoints of his company through RLS; another client does not
      expect(await asClient(db, w.client, () => count(db, `SELECT count(*) AS n FROM public.pb_checkpoints`, []))).toBe(2)
      expect(await asClient(db, w.other, () => count(db, `SELECT count(*) AS n FROM public.pb_checkpoints`, []))).toBe(0)
    }), 60_000)

  it('migration 151: the source «revenue_history» is accepted, anything else is refused by the CHECK', () =>
    inRollback(async (db) => {
      const w = await world(db)
      await db.query(`INSERT INTO public.pb_monthly_facts (company_id, period, metric, value, source, entered_role) VALUES ($1, '2026-01', 'revenue', 1, 'revenue_history', 'owner')`, [w.company])
      await db.query('SAVEPOINT bad')
      await expect(db.query(`INSERT INTO public.pb_monthly_facts (company_id, period, metric, value, source, entered_role) VALUES ($1, '2026-02', 'revenue', 1, 'csv_upload', 'owner')`, [w.company]))
        .rejects.toMatchObject({ code: '23514' })
      await db.query('ROLLBACK TO SAVEPOINT bad')
      const def = (await db.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'pb_monthly_facts_source_check'`)).rows[0].d as string
      expect(def).toContain('revenue_history')
      expect(def).toContain('monthly_reconciliation')
    }))

  it('the draft is not built without the data a plan needs — nothing is written', () =>
    inRollback(async (db) => {
      const w = await world(db)
      await db.query(`DELETE FROM public.metric_targets WHERE company_id = $1`, [w.company])
      const author = { id: w.admin, name: 'Админ Главный', kind: 'admin' as const }
      await expect(buildQuickDraft(w.svc, { companyId: w.company, userId: w.client, author, now: new Date(), ai: false }))
        .rejects.toMatchObject({ code: 'conditions' })
      expect(await count(db, `SELECT count(*) AS n FROM public.pb_plan_versions v JOIN public.pb_plans p ON p.id = v.plan_id WHERE p.company_id = $1`, [w.company])).toBe(0)
      const state = await loadPointBState(w.svc, w.client, { now: new Date() })
      expect(state.plan.prep.kind).toBe('needs_data')
      expect(state.plan.prep.missing.map((m) => m.key)).toContain('goal')
    }))
})
