import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/090_store_financial_analytics.sql'),
  'utf8',
)

const RPC_SIGNATURE = [
  'UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, UUID, TEXT, TEXT, DATE, DATE,',
  '  INTEGER, INTEGER, JSONB',
].join('\n')

describe('migration 090 — isolated store financial publication', () => {
  it('creates the loader-facing import and monthly period columns', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.store_financial_imports')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.store_financial_periods')
    for (const column of [
      'period_month DATE',
      'revenue NUMERIC(18,2)',
      'cost_amount NUMERIC(18,2)',
      'reported_gross_profit NUMERIC(18,2)',
      'period_expenses NUMERIC(18,2)',
      'bonuses NUMERIC(18,2)',
      'write_offs NUMERIC(18,2)',
      'ebitda NUMERIC(18,2)',
      'note TEXT',
      'scope_key TEXT',
      'rows_fingerprint_md5 TEXT',
      'source_sheet TEXT',
      'import_id UUID',
    ]) expect(migration).toContain(column)
  })

  it('exposes only owner current facts from published imports', () => {
    expect(migration).toContain('ALTER TABLE public.store_financial_imports ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE public.store_financial_periods ENABLE ROW LEVEL SECURITY')
    expect(migration).toMatch(
      /CREATE POLICY store_financial_imports_owner_published_read[\s\S]*?auth\.uid\(\) = user_id AND status = 'published'/,
    )
    expect(migration).toMatch(
      /CREATE POLICY store_financial_periods_owner_current_read[\s\S]*?auth\.uid\(\) = user_id[\s\S]*?superseded_at IS NULL[\s\S]*?financial_import\.status = 'published'/,
    )
    expect(migration).toContain('idx_store_financial_periods_current_scope')
    expect(migration).toContain('WHERE superseded_at IS NULL')
  })

  it('keeps the security-definer RPC as the only write path', () => {
    for (const table of ['store_financial_imports', 'store_financial_periods']) {
      expect(migration).toContain(
        `REVOKE ALL ON TABLE public.${table}\n  FROM PUBLIC, anon, authenticated, service_role`,
      )
    }
    expect(migration).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)(?:\s*,\s*(?:INSERT|UPDATE|DELETE))*\s+ON TABLE public\.store_financial_/,
    )
    expect(migration).toContain(`REVOKE ALL ON FUNCTION public.publish_store_financial_import(
  ${RPC_SIGNATURE}
) FROM PUBLIC, anon, authenticated, service_role`)
    expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.publish_store_financial_import(
  ${RPC_SIGNATURE}
) TO service_role`)
    expect(migration).not.toMatch(/\) TO (?:PUBLIC|anon|authenticated);/)
  })

  it('validates exact rows and both canonical and independently reported profit math', () => {
    expect(migration).toContain("jsonb_object_keys(v_item) AS field(key)")
    expect(migration).toContain("v_gross IS DISTINCT FROM v_revenue - v_cost")
    expect(migration).toContain(
      'v_reconciliation_delta IS DISTINCT FROM v_reported_gross - v_gross',
    )
    expect(migration).toContain('abs(v_reconciliation_delta) > 1.00')
    expect(migration).toContain(
      'v_ebitda IS DISTINCT FROM v_reported_gross - v_expenses',
    )
    expect(migration).toContain("duplicate store financial month")
    expect(migration).toContain("EXTRACT(DAY FROM v_period_month) <> 1")
    expect(migration).toContain("p_schema_version IS DISTINCT FROM 1")
  })

  it('fully validates before changing current scope and supersedes only matching owner/company/months', () => {
    const validation = migration.indexOf('FOR v_item IN SELECT item.value')
    const lock = migration.indexOf('pg_advisory_xact_lock')
    const supersede = migration.indexOf('UPDATE public.store_financial_periods AS period')
    const insertFacts = migration.indexOf('INSERT INTO public.store_financial_periods')
    expect(validation).toBeGreaterThan(0)
    expect(lock).toBeGreaterThan(validation)
    expect(supersede).toBeGreaterThan(lock)
    expect(insertFacts).toBeGreaterThan(supersede)
    expect(migration).toMatch(
      /UPDATE public\.store_financial_periods AS period[\s\S]*?period\.user_id = p_user_id[\s\S]*?period\.company_id = v_company_id[\s\S]*?period\.scope_key IN/,
    )
  })

  it('locks company ownership and keeps deletion/supersession lifecycle consistent', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.store_enforce_company_owner\(\)[\s\S]*?FOR SHARE OF company/,
    )
    expect(migration).toMatch(
      /invalid store financial owner binding[\s\S]*?pg_advisory_xact_lock/,
    )
    expect(migration).toContain('superseded_by_import_id UUID REFERENCES public.store_financial_imports(id)\n    ON DELETE CASCADE')
    const cleanup = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.store_cleanup_financial_company()'))
    expect(cleanup.indexOf('DELETE FROM public.store_financial_periods')).toBeLessThan(
      cleanup.indexOf('DELETE FROM public.store_financial_imports'),
    )
    expect(cleanup).toContain("':store-financial-publication'")
    expect(migration).toContain('store_guard_financial_company_identity_before_update')
    expect(migration).toContain('cannot change company identity while Store financial history exists')
  })

  it('binds retries to owner, idempotency key and semantic manifest', () => {
    expect(migration).toContain('UNIQUE (user_id, company_id, idempotency_key)')
    expect(migration).toContain('UNIQUE (user_id, company_id, manifest_sha256)')
    expect(migration).toMatch(
      /financial_import\.idempotency_key = p_idempotency_key[\s\S]*?financial_import\.manifest_sha256 = p_manifest_sha256/,
    )
    expect(migration).toContain("'duplicate'::TEXT")
    expect(migration).toContain("ERRCODE = 'P0002'")
    expect(migration).toContain('v_rows_fingerprint := md5(p_rows::TEXT)')
    expect(migration).toContain('v_existing.rows_fingerprint_md5 IS DISTINCT FROM v_rows_fingerprint')
    expect(migration).toContain("v_existing.status IS DISTINCT FROM 'published'")
    expect(migration).toMatch(
      /period\.import_id = v_existing\.id[\s\S]*?period\.superseded_at IS NULL/,
    )
    expect(migration).toContain('store financial manifest is superseded; publish a new audited release')
  })

  it('rejects gapped management ranges and timestamps only after serialization', () => {
    expect(migration).toMatch(
      /v_row_count IS DISTINCT FROM \([\s\S]*?generate_series\([\s\S]*?INTERVAL '1 month'/,
    )
    expect(migration).toContain('v_now TIMESTAMPTZ;')
    const lock = migration.indexOf('pg_advisory_xact_lock')
    const timestamp = migration.indexOf('v_now := clock_timestamp()')
    expect(timestamp).toBeGreaterThan(lock)
  })

  it('stores a hashed label and normalized facts, never the raw workbook or PII fields', () => {
    expect(migration).toContain('source_file_label TEXT NOT NULL')
    expect(migration).toContain("^store-import-[a-f0-9]{12}\\.(xls|xlsx|csv)$")
    expect(migration).not.toMatch(/\b(?:BYTEA|raw_file|raw_workbook|bank_account|iban|customer_email|customer_phone)\b/i)
  })
})
