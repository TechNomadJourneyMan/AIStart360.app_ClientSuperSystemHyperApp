/**
 * Static check of migration 125 (Point B plans): there is no database in unit
 * tests, so the invariants of the SQL text are pinned here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/125_point_b_plans.sql'), 'utf8')
const code = sql.replace(/--.*$/gm, '')
const TABLES = ['pb_plans', 'pb_plan_versions', 'pb_goal_reviews']

describe('migration 125 point b plans', () => {
  it('creates the three tables idempotently', () => {
    for (const t of TABLES) expect(code).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t} \\(`))
    expect(code).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/)
    expect(code).not.toMatch(/DROP TABLE/i)
    expect(code).toMatch(/company_id\s+TEXT\s+NOT NULL UNIQUE REFERENCES public\.companies\(id\) ON DELETE CASCADE/)
    expect(code).toMatch(/base_snapshot_id\s+UUID\s+REFERENCES public\.point_a_snapshots\(id\) ON DELETE SET NULL/)
    expect(code).toMatch(/status\s+TEXT\s+NOT NULL DEFAULT 'draft'\s+CHECK \(status IN \('draft', 'in_review', 'approved', 'superseded'\)\)/)
    expect(code).toMatch(/status\s+TEXT\s+NOT NULL\s+CHECK \(status IN \('verified', 'corrected', 'agreed', 'disputed'\)\)/)
    expect(code).toMatch(/author_kind\s+TEXT[^,]*CHECK \(author_kind IN \('owner', 'expert', 'admin', 'system'\)\)/)
    expect(code).toMatch(/UNIQUE \(plan_id, version\)/)
    expect(code).toMatch(/pb_goal_reviews_goal_idx\s+ON public\.pb_goal_reviews \(company_id, metric_key, period_label, created_at DESC\)/)
  })

  it('enables RLS and revokes anon on all three', () => {
    for (const t of TABLES) expect(code).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`)
    expect(code).toMatch(/REVOKE ALL ON public\.pb_plans, public\.pb_plan_versions, public\.pb_goal_reviews FROM PUBLIC, anon;/)
    expect(code).toMatch(/GRANT ALL ON public\.pb_plans, public\.pb_plan_versions, public\.pb_goal_reviews TO service_role;/)
  })

  it('one open version per plan index exists', () => {
    expect(code).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS pb_plan_versions_one_open_uidx\s+ON public\.pb_plan_versions \(plan_id\)\s+WHERE status IN \('draft', 'in_review'\);/)
  })

  it('immutability trigger allows only approved → superseded', () => {
    const start = code.indexOf('FUNCTION public.pb_plan_versions_immutable()')
    expect(start).toBeGreaterThan(-1)
    const open = code.indexOf('$$', start)
    const body = code.slice(open + 2, code.indexOf('$$', open + 2))
    expect(body).toMatch(/OLD\.status = 'approved'/)
    expect(body).toMatch(/NEW\.status = 'superseded'/)
    // every other column must stay the same
    expect(body).toMatch(/\(to_jsonb\(NEW\) - 'status'\) = \(to_jsonb\(OLD\) - 'status'\)/)
    expect(body).toMatch(/RAISE EXCEPTION/)
    expect(code).toMatch(/CREATE TRIGGER pb_plan_versions_immutable\s+BEFORE UPDATE ON public\.pb_plan_versions/)
  })

  it('has no foreign keys on the columns of an immutable row that could fire the trigger', () => {
    for (const col of ['author_id', 'approved_by', 'rejected_by', 'reviewer_id']) {
      expect(code).not.toMatch(new RegExp(`${col}\\s+UUID[^,]*REFERENCES`))
    }
  })

  it('client SELECT policy on versions is restricted to approved', () => {
    const m = code.match(/CREATE POLICY pb_plan_versions_owner_read ON public\.pb_plan_versions FOR SELECT TO authenticated\s+USING \(([\s\S]*?)\);\s*\n\s*\n/)
    expect(m).not.toBeNull()
    expect(m![1]).toMatch(/status = 'approved'/)
    expect(m![1]).toMatch(/p\.user_id = \(SELECT auth\.uid\(\)\)/)
    expect(code).toMatch(/CREATE POLICY pb_plans_owner_read ON public\.pb_plans FOR SELECT TO authenticated\s+USING \(user_id = \(SELECT auth\.uid\(\)\)\)/)
    expect(code).toMatch(/CREATE POLICY pb_goal_reviews_company_read ON public\.pb_goal_reviews FOR SELECT TO authenticated\s+USING \(public\.can_read_company\(company_id\)\)/)
  })

  it('backfill is guarded by ON CONFLICT DO NOTHING / NOT EXISTS', () => {
    const backfill = code.slice(code.indexOf('INSERT INTO public.pb_plans'))
    expect(backfill).toMatch(/INSERT INTO public\.pb_plans[\s\S]*?ON CONFLICT \(company_id\) DO NOTHING/)
    expect(backfill).toMatch(/INSERT INTO public\.pb_plan_versions[\s\S]*?WHERE NOT EXISTS \(SELECT 1 FROM public\.pb_plan_versions x WHERE x\.plan_id = p\.id\)[\s\S]*?ON CONFLICT \(plan_id, version\) DO NOTHING/)
    expect(backfill).toMatch(/v\.is_approved/)
    expect(backfill).toMatch(/UPDATE public\.pb_plans p[\s\S]*?p\.published_version_id IS NULL/)
    expect(code.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)
  })

  it('no INSERT/UPDATE grants to authenticated', () => {
    expect(code).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON public\.pb_plans, public\.pb_plan_versions, public\.pb_goal_reviews FROM authenticated;/)
    expect(code).toMatch(/GRANT SELECT ON public\.pb_plans, public\.pb_plan_versions, public\.pb_goal_reviews TO authenticated;/)
    expect(code).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE|ALL)[^;]*TO[^;]*authenticated/)
    expect(code).not.toMatch(/TO[^;]*\banon\b/)
  })
})
