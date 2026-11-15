/**
 * R3-SLA end to end on the real schema (migration 152) — the TypeScript of lib/expert-sla and lib/point-a runs
 * unchanged over the test database (tests/helpers/pg-postgrest.ts, inside a rolled-back transaction):
 *   • the AI analysis is announced at once (announceAiReviewNow): one task for the responsible expert, one message;
 *     the pass afterwards does not send it again; the expert's correction is the reaction, the confirmation the
 *     answer — the client reads «Проверено экспертом» through RLS;
 *   • the plan of Point B: the pass opens plan_prep from the scan, tells Admin / Super Admin, «Взять себе» by an
 *     admin, the client is told «План готовит: <имя>, до <срок>», a draft is the reaction, an approval the answer.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { pgPostgrest, type PgPostgrest } from '../../helpers/pg-postgrest'
import { closeTestPool, inRollback, seedCompany, seedStaff, seedUser, type Db } from '../../helpers/pg-rls'

const s = vi.hoisted(() => ({ service: null as unknown }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.service }))

const { announceAiReviewNow } = await import('@/lib/expert-sla/immediate')
const { runExpertSla } = await import('@/lib/expert-sla/run')
const { takePlanTask } = await import('@/lib/expert-sla/store')
const { loadClientTaskNotice } = await import('@/lib/expert-sla/client-view')
const { saveAiReview } = await import('@/lib/point-a/ai-review-store')
const { aiAnalysisView, AI_VIEW_COLUMNS } = await import('@/lib/point-a/ai-review')
const { DEFAULT_EXPERT_SLA } = await import('@/lib/expert-sla/policy')
type Notifier = import('@/lib/expert-sla/notify').SlaNotifier

const H = 3_600_000
const AI = {
  executive_summary: 'ИИ: бизнес растёт', industry_context: 'норма',
  strategic_priorities: [{ title: 'Повторные продажи', rationale: 'база есть', expected_impact: '+10 %' }],
  growth_roadmap: [{ horizon: '30_days', actions: ['Собрать базу'] }], blocks: { finance: { diagnosis: 'маржа ок' } },
}
const config = async () => ({ ...DEFAULT_EXPERT_SLA })
const noScan = async () => ({ waiting: [], checked: 0, truncated: false, dropped: [], candidates: [] })

function recorder() {
  const calls = { assigned: [] as Array<[string, string[]]>, queued: [] as Array<[string, string[]]> }
  const notifier: Notifier = {
    assigned: async (a, ts) => { calls.assigned.push([a, ts.map((t) => t.id)]); return { ok: true } },
    queued: async (ts, audience = 'experts') => { calls.queued.push([audience, ts.map((t) => t.id)]); return { ok: true } },
    threshold: async () => ({ ok: true }),
    syncFailed: async () => undefined,
  }
  return { calls, notifier }
}

async function clocks(db: Db) {
  for (const key of ['expert_sla_clock_start', 'expert_sla_clock_start_152']) {
    await db.query(
      `INSERT INTO public.system_settings (key, value) VALUES ($1, to_jsonb('2000-01-01T00:00:00Z'::text))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key])
  }
  // Paid sections open: this file is about the SLA, not the tariff (147 / 148).
  await db.query(`DELETE FROM public.system_settings WHERE key = 'access_gates'`)
}

const tasksOf = async (db: Db, client: string) =>
  (await db.query(`SELECT * FROM public.expert_sla_tasks WHERE client_id = $1 ORDER BY created_at, source`, [client])).rows as Array<Record<string, unknown>>

beforeEach(() => { s.service = null })

describe.skipIf(!dbTestsEnabled)('R3-SLA end to end (152)', () => {
  afterAll(closeTestPool)

  it('the AI analysis: announced at once to the responsible expert, corrected, confirmed — the client sees «Проверено экспертом»', () =>
    inRollback(async (db) => {
      await clocks(db)
      const now = (await db.query(`SELECT now() AS n`)).rows[0].n as Date
      const expert = await seedUser(db, { role: 'expert', status: 'approved' })
      await db.query(`UPDATE public.profiles SET full_name = 'Пётр Эксперт' WHERE id = $1`, [expert])
      const client = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, client)
      await db.query(`INSERT INTO public.user_assignments (user_id, assignee_id) VALUES ($1, $2)`, [client, expert])
      const diag = (await db.query(
        `INSERT INTO public.diagnostics (user_id, company_id, overall_score, ai_status, ai_analysis, ai_generated_at) VALUES ($1, $2, 61, 'completed', $3::jsonb, $4) RETURNING id::text AS id`,
        [client, company, JSON.stringify(AI), now],
      )).rows[0].id as string
      const svc: PgPostgrest = pgPostgrest(db, null)
      s.service = svc

      const r = recorder()
      expect(await announceAiReviewNow({ sb: svc, diagnosticId: diag, now, config, notifier: r.notifier })).toEqual({ opened: true, notified: 'assignee' })
      expect(r.calls.assigned).toHaveLength(1)
      const [task] = await tasksOf(db, client)
      expect(task).toMatchObject({ source: 'pa_ai_review', source_id: diag, assignee_id: expert, assigned_via: 'client' })
      expect(task.assign_notified_at).not.toBeNull()

      // The pass 5 minutes later: the task exists and was announced — nothing new, no second message.
      const pass = recorder()
      await runExpertSla({ sb: svc, now: new Date(now.getTime() + 0.1 * H), config, notifier: pass.notifier, audit: async () => true, planPrepScan: noScan })
      expect(pass.calls.assigned).toEqual([])
      expect(await tasksOf(db, client)).toHaveLength(1)

      // The expert corrects: the reaction; the client sees the correction, still a draft.
      const saved = await saveAiReview(svc, { clientId: client, diagnosticId: diag, edits: { executive_summary: 'Эксперт: маржа падает' }, confirm: false, actor: { id: expert, name: 'Пётр Эксперт' }, now: new Date(now.getTime() + 2 * H) })
      expect(saved.ok).toBe(true)
      expect((await tasksOf(db, client))[0].first_response_at).not.toBeNull()
      const asClient = pgPostgrest(db, client)
      let row = (await asClient.from('diagnostics').select(AI_VIEW_COLUMNS).eq('id', diag).maybeSingle()).data as Record<string, unknown>
      expect(aiAnalysisView(row)).toMatchObject({ draft: true, editedByExpert: ['executive_summary'] })

      // Confirmed: the answer — the task is closed with an answer; the client reads «Проверено экспертом: Пётр Эксперт».
      const done = await saveAiReview(svc, { clientId: client, diagnosticId: diag, edits: { executive_summary: 'Эксперт: маржа падает' }, confirm: true, actor: { id: expert, name: 'Пётр Эксперт' }, now: new Date(now.getTime() + 3 * H) })
      expect(done.ok).toBe(true)
      expect((await tasksOf(db, client))[0]).toMatchObject({ close_reason: 'reviewed', answered: true })
      row = (await asClient.from('diagnostics').select(AI_VIEW_COLUMNS).eq('id', diag).maybeSingle()).data as Record<string, unknown>
      expect(aiAnalysisView(row)).toMatchObject({ draft: false, review: { by: 'Пётр Эксперт' } })
      // The pass agrees: nothing to open or close.
      const changes = (await svc.rpc('expert_sla_sync', { p_now: new Date(now.getTime() + 4 * H).toISOString(), p_reaction_hours: 24, p_answer_hours: 48, p_limit: 200 })).data as Array<{ r_client: string }>
      expect(changes.filter((c) => c.r_client === client)).toEqual([])
    }))

  it('the plan of Point B: the scan opens plan_prep, Admin / Super Admin hear of it, an admin takes it, the client sees who and until when', () =>
    inRollback(async (db) => {
      await clocks(db)
      const now = (await db.query(`SELECT now() AS n`)).rows[0].n as Date
      const admin = await seedStaff(db, 'admin')
      await db.query(`UPDATE public.profiles SET full_name = 'Анна Админ' WHERE id = $1`, [admin])
      await seedUser(db, { role: 'expert', status: 'approved' }) // an expert exists — the plan never goes to him
      const client = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, client)
      const svc: PgPostgrest = pgPostgrest(db, null)
      s.service = svc

      const r = recorder()
      const report = await runExpertSla({
        sb: svc, now, config, notifier: r.notifier, audit: async () => true,
        planPrepScan: async () => ({ waiting: [{ userId: client, companyId: company, since: null }], checked: 1, truncated: false, dropped: [], candidates: [company] }),
      })
      expect(report.planPrep).toMatchObject({ opened: 1, error: null })
      const [task] = await tasksOf(db, client)
      expect(task).toMatchObject({ source: 'plan_prep', source_id: company, assignee_id: null })
      expect(r.calls.queued).toEqual([['admins', [task.id]]])
      expect(r.calls.assigned).toEqual([])
      expect(await loadClientTaskNotice(svc, { source: 'plan_prep', clientId: client, sourceId: company, now, config })).toMatchObject({ assignee: null, overdue: false })

      expect(await takePlanTask(svc, { taskId: String(task.id), assigneeId: admin, actorId: admin, now })).toMatchObject({ ok: true, moved: 1 })
      const notice = await loadClientTaskNotice(svc, { source: 'plan_prep', clientId: client, sourceId: company, now, config })
      expect(notice).toMatchObject({ assignee: 'Анна Админ', overdue: false })
      expect(new Date(notice!.dueAt).getTime()).toBe(now.getTime() + 48 * H)
      // The pass: the task stays with the admin (no realign, no auto-assignment), no «new task» message to himself.
      const again = recorder()
      await runExpertSla({ sb: svc, now: new Date(now.getTime() + 0.1 * H), config, notifier: again.notifier, audit: async () => true, planPrepScan: async () => ({ waiting: [{ userId: client, companyId: company, since: null }], checked: 1, truncated: false, dropped: [], candidates: [company] }) })
      expect((await tasksOf(db, client))[0].assignee_id).toBe(admin)
      expect(again.calls.assigned).toEqual([])

      // A draft = the reaction; the approval = the answer.
      const plan = (await db.query(`INSERT INTO public.pb_plans (company_id, user_id) VALUES ($1, $2) RETURNING id`, [company, client])).rows[0].id
      const v = (await db.query(`INSERT INTO public.pb_plan_versions (plan_id, version, status, created_at) VALUES ($1, 1, 'draft', $2) RETURNING id`, [plan, new Date(now.getTime() + H)])).rows[0].id
      await runExpertSla({ sb: svc, now: new Date(now.getTime() + 2 * H), config, notifier: recorder().notifier, audit: async () => true, planPrepScan: async () => ({ waiting: [], checked: 0, truncated: false, dropped: [], candidates: [] }) })
      expect(((await tasksOf(db, client))[0].first_response_at as Date).getTime()).toBe(now.getTime() + H)
      expect((await tasksOf(db, client))[0].closed_at).toBeNull() // the draft is open: «no goal» does not drop it
      await db.query(`UPDATE public.pb_plan_versions SET status = 'approved', approved_at = $2 WHERE id = $1`, [v, new Date(now.getTime() + 5 * H)])
      await runExpertSla({ sb: svc, now: new Date(now.getTime() + 6 * H), config, notifier: recorder().notifier, audit: async () => true, planPrepScan: noScan })
      expect((await tasksOf(db, client))[0]).toMatchObject({ close_reason: 'approved', answered: true })
      expect(await loadClientTaskNotice(svc, { source: 'plan_prep', clientId: client, sourceId: company, now, config })).toBeNull()
    }))
})
