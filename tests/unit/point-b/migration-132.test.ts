/**
 * Static check of migration 132 (Point B Ф6b: plan-fact checkpoints, the recompute journal, the monthly facts of the
 * reconciliation): there is no database in unit tests, so the invariants of the SQL text are pinned here. The settings
 * of the group «Точка Б» that come with it (recompute cron, verdict tolerances) are checked against the registry.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SETTINGS, coerceSetting, validateSetting } from '@/lib/settings/registry'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/132_point_b_checkpoints_runs.sql'), 'utf8')
const code = sql.replace(/--.*$/gm, '')

function tableBody(name: string): string {
  const m = code.match(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${name} \\(([\\s\\S]*?)\\n\\);`))
  expect(m, `table ${name}`).not.toBeNull()
  return m![1]
}

const TABLES = ['pb_checkpoints', 'pb_runs', 'pb_monthly_facts']

describe('migration 132 point b checkpoints, runs and monthly facts', () => {
  it('creates the three tables idempotently and never drops anything', () => {
    for (const t of TABLES) expect(code).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t} \\(`))
    expect((code.match(/CREATE TABLE/g) ?? []).length).toBe((code.match(/CREATE TABLE IF NOT EXISTS/g) ?? []).length)
    expect((code.match(/CREATE (UNIQUE )?INDEX/g) ?? []).length).toBe((code.match(/CREATE (UNIQUE )?INDEX IF NOT EXISTS/g) ?? []).length)
    for (const t of code.match(/CREATE TRIGGER (\w+)/g) ?? []) expect(code).toContain(`DROP TRIGGER IF EXISTS ${t.split(' ')[2]}`)
    for (const p of code.match(/CREATE POLICY (\w+)/g) ?? []) expect(code).toContain(`DROP POLICY IF EXISTS ${p.split(' ')[2]}`)
    expect(code).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE FROM|UPDATE public\./i)
    expect(code.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)
  })

  it('pb_checkpoints: one row per version and month, the verdict is one of four, jsonb parts are objects', () => {
    const t = tableBody('pb_checkpoints')
    expect(t).toMatch(/company_id\s+TEXT\s+NOT NULL REFERENCES public\.companies\(id\) ON DELETE CASCADE/)
    expect(t).toMatch(/plan_id\s+UUID\s+NOT NULL REFERENCES public\.pb_plans\(id\) ON DELETE CASCADE/)
    expect(t).toMatch(/version_id\s+UUID\s+NOT NULL REFERENCES public\.pb_plan_versions\(id\) ON DELETE CASCADE/)
    expect(t).toMatch(/period\s+TEXT\s+NOT NULL CHECK \(period ~ '\^\[0-9\]\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$'\)/)
    expect(t).toMatch(/overall\s+TEXT\s+NOT NULL DEFAULT 'no_data'\s+CHECK \(overall IN \('on_track', 'risk', 'behind', 'no_data'\)\)/)
    for (const col of ['planned', 'actual', 'forecast', 'verdict']) {
      expect(t, col).toMatch(new RegExp(`${col}\\s+JSONB\\s+NOT NULL DEFAULT '\\{\\}'::jsonb\\s+CHECK \\(jsonb_typeof\\(${col}\\) = 'object'`))
    }
    for (const col of ['reason', 'inputs_hash', 'computed_at', 'created_at', 'updated_at']) expect(t, col).toMatch(new RegExp(`\\n\\s+${col}\\s`))
    expect(t).toMatch(/CONSTRAINT pb_checkpoints_version_period_uniq UNIQUE \(version_id, period\)/)
    expect(code).toMatch(/CREATE INDEX IF NOT EXISTS pb_checkpoints_company_idx\s+ON public\.pb_checkpoints \(company_id, period DESC\)/)
  })

  it('pb_runs: kind scheduled / manual, counters non-negative, errors an array', () => {
    const t = tableBody('pb_runs')
    expect(t).toMatch(/kind\s+TEXT\s+NOT NULL CHECK \(kind IN \('scheduled', 'manual'\)\)/)
    expect(t).toMatch(/status\s+TEXT\s+NOT NULL DEFAULT 'running'\s+CHECK \(status IN \('running', 'done', 'failed'\)\)/)
    expect(t).toMatch(/companies\s+INT\s+NOT NULL DEFAULT 0 CHECK \(companies >= 0\)/)
    expect(t).toMatch(/ai_calls\s+INT\s+NOT NULL DEFAULT 0 CHECK \(ai_calls >= 0\)/)
    expect(t).toMatch(/cost\s+NUMERIC\(12,4\)\s+NOT NULL DEFAULT 0 CHECK \(cost >= 0\)/)
    expect(t).toMatch(/errors\s+JSONB\s+NOT NULL DEFAULT '\[\]'::jsonb\s+CHECK \(jsonb_typeof\(errors\) = 'array'/)
    for (const col of ['started_at', 'finished_at', 'triggered_by', 'company_id']) expect(t, col).toMatch(new RegExp(`\\n\\s+${col}\\s`))
    // the button's «once in 10 minutes per company» check reads by company and time
    expect(code).toMatch(/CREATE INDEX IF NOT EXISTS pb_runs_company_idx\s+ON public\.pb_runs \(company_id, started_at DESC\)/)
  })

  it('pb_monthly_facts: one value per company, month and metric, source «ежемесячная сверка»', () => {
    const t = tableBody('pb_monthly_facts')
    expect(t).toMatch(/company_id\s+TEXT\s+NOT NULL REFERENCES public\.companies\(id\) ON DELETE CASCADE/)
    expect(t).toMatch(/metric\s+TEXT\s+NOT NULL CHECK \(metric IN \('revenue', 'leads', 'conversion', 'avg_check', 'cash'\)\)/)
    expect(t).toMatch(/value\s+NUMERIC\(24,6\)\s+NOT NULL/)
    expect(t).toMatch(/source\s+TEXT\s+NOT NULL DEFAULT 'monthly_reconciliation'\s+CHECK \(source = 'monthly_reconciliation'\)/)
    expect(t).toMatch(/entered_role\s+TEXT\s+NOT NULL CHECK \(entered_role IN \('owner', 'expert'\)\)/)
    expect(t).toMatch(/note\s+TEXT\s+CHECK \(note IS NULL OR length\(note\) <= 500\)/)
    expect(t).toMatch(/CONSTRAINT pb_monthly_facts_uniq UNIQUE \(company_id, period, metric\)/)
  })

  it('RLS: on everywhere; the client reads checkpoints and monthly facts of his company, never the run journal; no writes', () => {
    for (const tbl of TABLES) expect(code).toMatch(new RegExp(`ALTER TABLE public\\.${tbl} ENABLE ROW LEVEL SECURITY;`))
    expect(code).toMatch(/REVOKE ALL ON public\.pb_checkpoints, public\.pb_runs, public\.pb_monthly_facts FROM PUBLIC, anon;/)
    expect(code).toMatch(/REVOKE ALL ON public\.pb_runs FROM authenticated;/)
    expect(code).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON public\.pb_checkpoints, public\.pb_monthly_facts FROM authenticated;/)
    expect(code).toMatch(/GRANT SELECT ON public\.pb_checkpoints, public\.pb_monthly_facts TO authenticated;/)
    expect(code).toMatch(/GRANT ALL ON public\.pb_checkpoints, public\.pb_runs, public\.pb_monthly_facts TO service_role;/)
    expect(code).toMatch(/CREATE POLICY pb_checkpoints_client_read ON public\.pb_checkpoints FOR SELECT TO authenticated\s+USING \(public\.can_read_company\(company_id\)\);/)
    expect(code).toMatch(/CREATE POLICY pb_monthly_facts_client_read ON public\.pb_monthly_facts FOR SELECT TO authenticated\s+USING \(public\.can_read_company\(company_id\)\);/)
    expect(code).not.toMatch(/GRANT (INSERT|UPDATE|DELETE)[^;]*TO authenticated/)
    expect(code).not.toMatch(/CREATE POLICY \w+ ON public\.pb_runs/)
  })

  it('updated_at triggers on the rewritten tables', () => {
    expect(code).toMatch(/CREATE TRIGGER pb_checkpoints_updated_at\s+BEFORE UPDATE ON public\.pb_checkpoints\s+FOR EACH ROW EXECUTE FUNCTION public\.set_updated_at\(\);/)
    expect(code).toMatch(/CREATE TRIGGER pb_monthly_facts_updated_at\s+BEFORE UPDATE ON public\.pb_monthly_facts\s+FOR EACH ROW EXECUTE FUNCTION public\.set_updated_at\(\);/)
  })
})

describe('settings of Ф6b (group «Точка Б»)', () => {
  it('pb_recompute_cron: Mon + Thu 22:00 UTC by default; only a 5-field cron is accepted', () => {
    expect(SETTINGS.pb_recompute_cron.group).toBe('point_b')
    expect(coerceSetting('pb_recompute_cron', undefined)).toBe('0 22 * * 1,4')
    expect(validateSetting('pb_recompute_cron', '0 21 * * 2').ok).toBe(true)
    expect(validateSetting('pb_recompute_cron', '*/5 * * * *').ok).toBe(false) // more often than once an hour
    expect(validateSetting('pb_recompute_cron', 'каждый день').ok).toBe(false)
    expect(coerceSetting('pb_recompute_cron', 'rm -rf')).toBe('0 22 * * 1,4')
  })

  it('pb_verdict_tolerances: 5% / 15% by default, the risk tolerance is wider than the on-track one', () => {
    expect(SETTINGS.pb_verdict_tolerances.group).toBe('point_b')
    expect(coerceSetting('pb_verdict_tolerances', undefined)).toEqual({ on_track_pct: 5, risk_pct: 15 })
    expect(coerceSetting('pb_verdict_tolerances', { risk_pct: 20 })).toEqual({ on_track_pct: 5, risk_pct: 20 })
    expect(validateSetting('pb_verdict_tolerances', { on_track_pct: 10, risk_pct: 5 }).ok).toBe(false)
    expect(validateSetting('pb_verdict_tolerances', { on_track_pct: 0, risk_pct: 10 }).ok).toBe(true)
  })
})
