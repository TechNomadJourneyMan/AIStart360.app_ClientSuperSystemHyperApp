/**
 * R3-PA, migration 150 (supabase/migrations/150_point_a_ai_review.sql): the AI
 * analysis of Point A is diagnosable (ai_error / ai_model / ai_generated_at)
 * and ready for the expert's review (ai_reviewed_at / _by / _by_name,
 * ai_expert_edits). On the real schema of the disposable test DB, every case
 * in a transaction that is rolled back:
 *   • the columns and their checks; the reviewer's profile deleted → the
 *     review and its name stay, the link goes;
 *   • the owner reads them through RLS (as PostgREST would), a client cannot
 *     write them (no UPDATE policy), the service role can;
 *   • what the page reads (lib/point-a/ai-review.ts aiAnalysisView) from a
 *     real row: a draft until reviewed, the expert's corrections over the AI text;
 *   • the migration is idempotent; the rollback drops only what 150 created.
 */
import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asService, asUser, closeTestPool, inRollback, pgErrorCode, seedCompany, seedUser, type Db } from '../../helpers/pg-rls'
import { aiAnalysisView, AI_VIEW_COLUMNS } from '@/lib/point-a/ai-review'

const UP = readFileSync('supabase/migrations/150_point_a_ai_review.sql', 'utf8')
const DOWN = readFileSync('supabase/migrations/rollback/150_point_a_ai_review.down.sql', 'utf8')

const AI = {
  executive_summary: 'ИИ: бизнес растёт', industry_context: 'норма отрасли',
  strategic_priorities: [{ title: 'Повторные продажи', rationale: 'база есть', expected_impact: '+10 %' }],
  growth_roadmap: [{ horizon: '30_days', actions: ['a', 'b'] }],
  blocks: { finance: { diagnosis: 'маржа ок', benchmark_comparison: '—', key_risk: 'нет плана', top_recommendation: 'бюджет' } },
  model_used: 'm', generated_at: '2026-11-15T10:00:00Z',
}

async function world(db: Db) {
  // Gates off: this file is about the new columns, not the tariff (147 / 148).
  await db.query(`DELETE FROM public.system_settings WHERE key = 'access_gates'`)
  const owner = await seedUser(db, { status: 'approved' })
  const company = await seedCompany(db, owner)
  const expert = await seedUser(db, { status: 'approved', role: 'expert' })
  const { rows } = await db.query(
    `INSERT INTO public.diagnostics (user_id, company_id, overall_score, ai_status, ai_analysis) VALUES ($1, $2, 61, 'completed', $3::jsonb) RETURNING id::text AS id`,
    [owner, company, JSON.stringify(AI)],
  )
  return { owner, company, expert, diag: rows[0].id as string }
}

const columns = (db: Db) => db.query<{ column_name: string; data_type: string }>(
  `SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'diagnostics' AND column_name = ANY($1::text[]) ORDER BY 1`,
  [['ai_error', 'ai_model', 'ai_generated_at', 'ai_reviewed_at', 'ai_reviewed_by', 'ai_reviewed_by_name', 'ai_expert_edits']],
).then((r) => Object.fromEntries(r.rows.map((x) => [x.column_name, x.data_type])))

describe.skipIf(!dbTestsEnabled)('migration 150 — AI analysis diagnosis and expert review', () => {
  afterAll(async () => { await closeTestPool() })

  it('the columns exist with their types', async () => {
    await inRollback(async (db) => {
      expect(await columns(db)).toEqual({
        ai_error: 'text', ai_expert_edits: 'jsonb', ai_generated_at: 'timestamp with time zone', ai_model: 'text',
        ai_reviewed_at: 'timestamp with time zone', ai_reviewed_by: 'uuid', ai_reviewed_by_name: 'text',
      })
    })
  })

  it('checks: a code list ≤ 500, edits are an object, «проверено» needs a name', async () => {
    await inRollback(async (db) => {
      const { diag } = await world(db)
      expect(await pgErrorCode(db.query(`UPDATE public.diagnostics SET ai_error = repeat('x', 501) WHERE id = $1`, [diag]))).toBe('23514')
    })
    await inRollback(async (db) => {
      const { diag } = await world(db)
      expect(await pgErrorCode(db.query(`UPDATE public.diagnostics SET ai_expert_edits = '["not an object"]'::jsonb WHERE id = $1`, [diag]))).toBe('23514')
    })
    await inRollback(async (db) => {
      const { diag } = await world(db)
      expect(await pgErrorCode(db.query(`UPDATE public.diagnostics SET ai_reviewed_at = now() WHERE id = $1`, [diag]))).toBe('23514')
    })
    await inRollback(async (db) => {
      const { diag, expert } = await world(db)
      await db.query(
        `UPDATE public.diagnostics SET ai_error = 'blocksB:cut', ai_model = 'qwen3-8', ai_generated_at = now(),
                ai_reviewed_at = now(), ai_reviewed_by = $2, ai_reviewed_by_name = 'Алия', ai_expert_edits = '{"executive_summary":"Эксперт"}'::jsonb
          WHERE id = $1`, [diag, expert])
      // The reviewer's profile is deleted: the review and the name stay, the link goes.
      await db.query(`DELETE FROM auth.users WHERE id = $1`, [expert])
      const { rows } = await db.query(`SELECT ai_reviewed_by, ai_reviewed_by_name, ai_reviewed_at IS NOT NULL AS reviewed FROM public.diagnostics WHERE id = $1`, [diag])
      expect(rows[0]).toEqual({ ai_reviewed_by: null, ai_reviewed_by_name: 'Алия', reviewed: true })
    })
  })

  it('RLS: the owner reads the new columns; a client cannot write the review; the service role can', async () => {
    await inRollback(async (db) => {
      const { owner, diag, expert } = await world(db)
      await asService(db, () => db.query(
        `UPDATE public.diagnostics SET ai_reviewed_at = '2026-11-16T09:00:00Z', ai_reviewed_by = $2, ai_reviewed_by_name = 'Алия',
                ai_expert_edits = '{"executive_summary":"Текст эксперта","note":"Сверил с ОПиУ"}'::jsonb, ai_model = 'qwen3-8'
          WHERE id = $1`, [diag, expert]))
      // A client's own write (PostgREST, his JWT) changes nothing — diagnostics has no UPDATE policy.
      const tried = await asUser(db, owner, async () => {
        await db.query('SAVEPOINT client_write')
        const code = await pgErrorCode(db.query(`UPDATE public.diagnostics SET ai_reviewed_by_name = 'Я сам' WHERE id = $1`, [diag]))
        await db.query(code ? 'ROLLBACK TO SAVEPOINT client_write' : 'RELEASE SAVEPOINT client_write')
        return code
      })
      const { rows: after } = await db.query(`SELECT ai_reviewed_by_name FROM public.diagnostics WHERE id = $1`, [diag])
      expect(after[0].ai_reviewed_by_name).toBe('Алия')
      expect(tried === null || tried === '42501').toBe(true)

      // What the Point A page reads, through the owner's RLS — a reviewed analysis with the expert's text.
      const row = await asUser(db, owner, async () => (await db.query(`SELECT ${AI_VIEW_COLUMNS} FROM public.diagnostics WHERE id = $1`, [diag])).rows[0])
      expect(row).toBeTruthy()
      const view = aiAnalysisView(row)!
      expect(view).toMatchObject({ status: 'completed', draft: false, review: { by: 'Алия' }, expertNote: 'Сверил с ОПиУ', model: 'qwen3-8' })
      expect(view.analysis?.executive_summary).toBe('Текст эксперта')
      expect(view.editedByExpert).toEqual(['executive_summary'])
    })
  })

  it('a row without a review is a draft for the page', async () => {
    await inRollback(async (db) => {
      const { owner, diag } = await world(db)
      const row = await asUser(db, owner, async () => (await db.query(`SELECT ${AI_VIEW_COLUMNS} FROM public.diagnostics WHERE id = $1`, [diag])).rows[0])
      expect(aiAnalysisView(row)).toMatchObject({ status: 'completed', draft: true, review: null, editedByExpert: [] })
    })
  })

  it('idempotent; the rollback drops only the columns 150 created (a hand-made column survives)', async () => {
    await inRollback(async (db) => {
      await db.query(UP)
      await db.query(UP)
      expect(Object.keys(await columns(db))).toHaveLength(7)

      await db.query(DOWN)
      expect(await columns(db)).toEqual({})
      const { rows: cons } = await db.query(`SELECT conname FROM pg_constraint WHERE conrelid = 'public.diagnostics'::regclass AND conname LIKE 'diagnostics_ai_%' AND conname <> 'diagnostics_ai_status_check'`)
      expect(cons).toEqual([])

      // An environment where ai_model already existed before 150 (added by hand): 150 keeps it, the rollback too.
      await db.query(`ALTER TABLE public.diagnostics ADD COLUMN ai_model TEXT`)
      await db.query(UP)
      expect(Object.keys(await columns(db))).toHaveLength(7)
      await db.query(DOWN)
      expect(await columns(db)).toEqual({ ai_model: 'text' })
    })
  })
})
