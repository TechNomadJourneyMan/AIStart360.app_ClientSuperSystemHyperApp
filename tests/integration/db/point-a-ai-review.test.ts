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
  [['ai_error', 'ai_model', 'ai_generated_at', 'ai_started_at', 'ai_reviewed_at', 'ai_reviewed_by', 'ai_reviewed_by_name', 'ai_expert_edits']],
).then((r) => Object.fromEntries(r.rows.map((x) => [x.column_name, x.data_type])))

describe.skipIf(!dbTestsEnabled)('migration 150 — AI analysis diagnosis and expert review', () => {
  afterAll(async () => { await closeTestPool() })

  it('the columns exist with their types', async () => {
    await inRollback(async (db) => {
      expect(await columns(db)).toEqual({
        ai_error: 'text', ai_expert_edits: 'jsonb', ai_generated_at: 'timestamp with time zone', ai_model: 'text', ai_started_at: 'timestamp with time zone',
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
      expect(Object.keys(await columns(db))).toHaveLength(8)

      await db.query(DOWN)
      expect(await columns(db)).toEqual({})
      const { rows: cons } = await db.query(`SELECT conname FROM pg_constraint WHERE conrelid = 'public.diagnostics'::regclass AND conname LIKE 'diagnostics_ai_%' AND conname <> 'diagnostics_ai_status_check'`)
      expect(cons).toEqual([])

      // An environment where ai_model already existed before 150 (added by hand): 150 keeps it, the rollback too.
      await db.query(`ALTER TABLE public.diagnostics ADD COLUMN ai_model TEXT`)
      await db.query(UP)
      expect(Object.keys(await columns(db))).toHaveLength(8)
      await db.query(DOWN)
      expect(await columns(db)).toEqual({ ai_model: 'text' })
    })
  })

  // Ревью R3-PA M2: on an environment where the columns were added by hand and hold old data
  // of any length / shape, 150 must not fail (it used to: VALIDATE / FK on old rows).
  it('columns already there with unfitting data → 150 passes; the checks bind new writes, old rows untouched; the rollback keeps them', async () => {
    await inRollback(async (db) => {
      await db.query(DOWN)
      expect(await columns(db)).toEqual({})
      const owner = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, owner)
      await db.query(`
        ALTER TABLE public.diagnostics
          ADD COLUMN ai_error TEXT, ADD COLUMN ai_generated_at TEXT, ADD COLUMN ai_reviewed_at TIMESTAMPTZ,
          ADD COLUMN ai_reviewed_by UUID, ADD COLUMN ai_reviewed_by_name TEXT, ADD COLUMN ai_expert_edits JSONB`)
      // an old row breaking every check, and an old row pointing to a deleted profile
      const { rows } = await db.query(
        `INSERT INTO public.diagnostics (user_id, company_id, overall_score, is_current, ai_error, ai_generated_at, ai_reviewed_at, ai_expert_edits)
         VALUES ($1, $2, 50, true, repeat('x', 800), 'вчера вечером', now(), '[1, 2]'::jsonb) RETURNING id::text AS id`,
        [owner, company])
      const old = rows[0].id as string
      await db.query(
        `INSERT INTO public.diagnostics (user_id, company_id, overall_score, is_current, ai_reviewed_by, ai_reviewed_by_name, ai_reviewed_at)
         VALUES ($1, $2, 49, false, gen_random_uuid(), 'Ушедший эксперт', now())`, [owner, company])

      await db.query(UP) // must not throw
      const cons = async () => (await db.query<{ conname: string; convalidated: boolean }>(
        `SELECT conname, convalidated FROM pg_constraint WHERE conrelid = 'public.diagnostics'::regclass AND conname LIKE 'diagnostics_ai_%' AND conname <> 'diagnostics_ai_status_check' ORDER BY 1`)).rows
      // a CHECK over violating old rows is NOT added (it would break every later update of them);
      // the key is added NOT VALID (checked only when it changes)
      expect(await cons()).toEqual([{ conname: 'diagnostics_ai_reviewed_by_fkey', convalidated: false }])
      // the old row is untouched; the columns 150 had to create are there
      const { rows: kept } = await db.query(`SELECT length(ai_error) AS n, ai_generated_at, ai_model, ai_started_at FROM public.diagnostics WHERE id = $1`, [old])
      expect(kept[0]).toEqual({ n: 800, ai_generated_at: 'вчера вечером', ai_model: null, ai_started_at: null })
      // the next recalculation can still retire the violating row; a new row can be written
      // (the orphan row is not updated here: inside this one test transaction Postgres re-checks
      // the key of a row inserted by the same transaction — not the case for real old rows)
      await db.query(`UPDATE public.diagnostics SET is_current = false WHERE id = $1`, [old])
      const { rows: fresh } = await db.query(`INSERT INTO public.diagnostics (user_id, company_id, overall_score) VALUES ($1, $2, 51) RETURNING id::text AS id`, [owner, company])
      await db.query('SAVEPOINT w')
      expect(await pgErrorCode(db.query(`UPDATE public.diagnostics SET ai_reviewed_by = gen_random_uuid(), ai_reviewed_by_name = 'x', ai_reviewed_at = now() WHERE id = $1`, [fresh[0].id]))).toBe('23503')
      await db.query('ROLLBACK TO SAVEPOINT w')

      // the data cleaned → re-running 150 adds and validates the checks
      await db.query(`UPDATE public.diagnostics SET ai_error = left(ai_error, 100), ai_expert_edits = NULL, ai_reviewed_by = NULL, ai_reviewed_by_name = 'Эксперт' WHERE id = $1`, [old])
      await db.query(UP)
      expect(await cons()).toEqual([
        { conname: 'diagnostics_ai_error_len', convalidated: true },
        { conname: 'diagnostics_ai_expert_edits_object', convalidated: true },
        { conname: 'diagnostics_ai_review_complete', convalidated: true },
        { conname: 'diagnostics_ai_reviewed_by_fkey', convalidated: false },
      ])
      expect(await pgErrorCode(db.query(`UPDATE public.diagnostics SET ai_error = repeat('y', 600) WHERE id = $1`, [fresh[0].id]))).toBe('23514')
      await db.query('ROLLBACK TO SAVEPOINT w')
      // idempotent on such an environment too; the rollback drops only what 150 created
      await db.query(UP)
      await db.query(DOWN)
      expect(Object.keys(await columns(db)).sort()).toEqual(['ai_error', 'ai_expert_edits', 'ai_generated_at', 'ai_reviewed_at', 'ai_reviewed_by', 'ai_reviewed_by_name'])
    })
  })
})
