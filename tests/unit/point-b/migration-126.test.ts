/**
 * Static check of migration 126 (Point B finmodel inputs): there is no database in unit tests, so the
 * invariants of the SQL text are pinned here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/126_point_b_finmodel.sql'), 'utf8')
const code = sql.replace(/--.*$/gm, '')

/** The 11 keys of the finmodel (kept as a literal here; finmodel-keys.test.ts compares it with lib/point-b/finmodel/keys.ts). */
const MIGRATION_KEYS = [
  'cash_balance', 'fixed_costs_month', 'payroll_month', 'debt_total', 'debt_service_month',
  'interest_rate_annual', 'dso_days', 'dio_days', 'dpo_days', 'tax_rate', 'capex_year',
] as const

describe('migration 126 point b finmodel', () => {
  it('creates the table idempotently', () => {
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.pb_finmodel_inputs \(/)
    expect(code).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/)
    expect(code).not.toMatch(/DROP TABLE/i)
    expect(code).toMatch(/company_id\s+TEXT\s+NOT NULL REFERENCES public\.companies\(id\) ON DELETE CASCADE/)
    expect(code).toMatch(/period_key\s+TEXT\s+NOT NULL DEFAULT ''/)
    expect(code).toMatch(/updated_at\s+TIMESTAMPTZ\s+NOT NULL DEFAULT now\(\)/)
    expect(code).toMatch(/DROP TRIGGER IF EXISTS pb_finmodel_inputs_updated_at/)
    expect(code).toMatch(/BEFORE UPDATE ON public\.pb_finmodel_inputs\s+FOR EACH ROW EXECUTE FUNCTION public\.set_updated_at\(\)/)
    expect(code.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)
  })

  it('RLS on, anon revoked, authenticated has no write grants', () => {
    expect(code).toContain('ALTER TABLE public.pb_finmodel_inputs ENABLE ROW LEVEL SECURITY;')
    expect(code).toMatch(/REVOKE ALL ON public\.pb_finmodel_inputs FROM PUBLIC, anon;/)
    expect(code).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public\.pb_finmodel_inputs FROM authenticated;/)
    expect(code).toMatch(/GRANT SELECT ON public\.pb_finmodel_inputs TO authenticated;/)
    expect(code).toMatch(/GRANT ALL ON public\.pb_finmodel_inputs TO service_role;/)
    expect(code).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE|ALL)[^;]*TO[^;]*authenticated/)
    expect(code).not.toMatch(/TO[^;]*\banon\b/)
  })

  it('unique per company, key and period', () => {
    expect(code).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS pb_finmodel_inputs_company_key_period_uidx\s+ON public\.pb_finmodel_inputs \(company_id, key, period_key\);/)
  })

  it('value must be non-negative; origin limited to owner and expert; status to entered and verified', () => {
    expect(code).toMatch(/value\s+NUMERIC\(20,6\)\s+NOT NULL CHECK \(value >= 0\)/)
    expect(code).toMatch(/origin\s+TEXT\s+NOT NULL CHECK \(origin IN \('owner', 'expert'\)\)/)
    expect(code).toMatch(/status\s+TEXT\s+NOT NULL DEFAULT 'entered' CHECK \(status IN \('entered', 'verified'\)\)/)
    expect(code).toMatch(/note\s+TEXT\s+CHECK \(note IS NULL OR length\(note\) <= 500\)/)
  })

  it('select policy uses can_read_company', () => {
    expect(code).toMatch(/CREATE POLICY pb_finmodel_inputs_company_read ON public\.pb_finmodel_inputs FOR SELECT TO authenticated\s+USING \(public\.can_read_company\(company_id\)\);/)
  })

  it('the key CHECK lists exactly the 11 FINMODEL_KEYS', () => {
    const m = code.match(/key\s+TEXT\s+NOT NULL\s+CHECK \(key IN \(([\s\S]*?)\)\)/)
    expect(m).not.toBeNull()
    const keys = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
    expect(keys).toHaveLength(11)
    expect([...keys].sort()).toEqual([...MIGRATION_KEYS].sort())
  })

  it('verified_* columns carry no foreign keys (a deleted staff account must not block a row)', () => {
    expect(code).not.toMatch(/verified_by\s+UUID[^,]*REFERENCES/)
    expect(code).not.toMatch(/updated_by\s+UUID[^,]*REFERENCES/)
  })
})
