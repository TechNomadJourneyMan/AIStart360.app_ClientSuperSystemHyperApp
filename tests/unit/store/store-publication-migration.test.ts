import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/085_store_import_publication.sql'),
  'utf8',
)

const RPC_SIGNATURE = [
  'UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, UUID, TEXT, TEXT, TEXT,',
  'DATE, DATE, DATE, INTEGER, INTEGER, JSONB',
].join('\n  ')

const WRITE_TABLES = [
  'store_import_runs',
  'store_warehouses',
  'store_product_variants',
  'store_price_snapshots',
  'store_inventory_snapshots',
  'store_sales_lines',
  'store_import_variant_mappings',
]

describe('Store import publication migration', () => {
  it('creates the exact service-owned atomic RPC contract', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.publish_store_import(')
    for (const parameter of [
      'p_user_id UUID',
      'p_company_id TEXT',
      'p_source_sha256 TEXT',
      'p_source_file_name TEXT',
      'p_source_size_bytes INTEGER',
      'p_schema_version INTEGER',
      'p_idempotency_key UUID',
      'p_manifest_sha256 TEXT',
      'p_import_kind TEXT',
      'p_scope_key TEXT',
      'p_effective_date DATE',
      'p_period_start DATE',
      'p_period_end DATE',
      'p_warning_count INTEGER',
      'p_quarantined_count INTEGER',
      'p_rows JSONB',
    ]) {
      expect(migration).toContain(parameter)
    }
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.publish_store_import\([\s\S]*?RETURNS TABLE \([\s\S]*?outcome TEXT[\s\S]*?import_run_id UUID[\s\S]*?import_kind TEXT[\s\S]*?scope_key TEXT[\s\S]*?row_count INTEGER[\s\S]*?superseded_run_id UUID[\s\S]*?LANGUAGE plpgsql[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = pg_catalog, pg_temp/,
    )
    expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.publish_store_import(
  ${RPC_SIGNATURE}
) TO service_role`)
    expect(migration).toContain(`REVOKE ALL ON FUNCTION public.publish_store_import(
  ${RPC_SIGNATURE}
) FROM PUBLIC, anon, authenticated, service_role`)
  })

  it('prevents public-schema shadowing in every store security definer path', () => {
    expect(migration).toContain(
      'REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;',
    )
    expect(migration).not.toContain(
      'REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role',
    )
    expect(migration).toContain(
      'ALTER FUNCTION public.store_enforce_company_owner()\n  SET search_path = pg_catalog, pg_temp;',
    )
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.store_enforce_ecommerce_product_owner\(\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = pg_catalog, pg_temp/,
    )
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.store_cleanup_deleted_company\(\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = pg_catalog, pg_temp/,
    )
    expect(migration).not.toContain('SET search_path = public, pg_temp')
  })

  it('validates owner/company and serializes the complete publication transaction', () => {
    expect(migration).toMatch(
      /FROM public\.companies AS company[\s\S]*?company\.id::TEXT = v_company_id[\s\S]*?company\.user_id = p_user_id/,
    )
    expect(migration).toContain('pg_advisory_xact_lock(hashtextextended(')
    expect(migration).toContain("':store-publication'")
    expect(migration).toContain("status = 'validated'")
    expect(migration).toContain("SET status = 'superseded'")
    expect(migration).toContain("SET status = 'published'")

    const factInsert = migration.indexOf('INSERT INTO public.store_sales_lines')
    const supersede = migration.indexOf("SET status = 'superseded'")
    const publish = migration.indexOf("SET status = 'published'")
    expect(factInsert).toBeGreaterThan(0)
    expect(supersede).toBeGreaterThan(factInsert)
    expect(publish).toBeGreaterThan(supersede)
  })

  it('binds retries to both idempotency key and semantic manifest SHA-256', () => {
    expect(migration).toContain('idempotency_key UUID')
    expect(migration).toContain('manifest_sha256 TEXT')
    expect(migration).toContain('idx_store_import_runs_owner_idempotency')
    expect(migration).toContain('idx_store_import_runs_owner_manifest')
    expect(migration).toContain("p_manifest_sha256 !~ '^[a-f0-9]{64}$'")
    expect(migration).toMatch(
      /run\.idempotency_key = p_idempotency_key[\s\S]*?run\.manifest_sha256 = p_manifest_sha256/,
    )
    expect(migration).toContain("'duplicate'::TEXT")
    expect(migration).toContain("ERRCODE = 'P0002'")
  })

  it('replaces raw-file uniqueness with semantic manifest uniqueness', () => {
    expect(migration).toContain("constraint_row.contype = 'u'")
    expect(migration).toContain(
      "ARRAY['user_id', 'company_id', 'import_kind', 'source_sha256']::TEXT[]",
    )
    expect(migration).toContain(
      "'ALTER TABLE public.store_import_runs DROP CONSTRAINT %I'",
    )
    expect(migration).not.toContain('store publication source conflict')
    expect(migration).not.toMatch(
      /WHERE run\.user_id = p_user_id[\s\S]{0,250}?run\.source_sha256 = p_source_sha256[\s\S]{0,150}?FOR UPDATE/,
    )
  })

  it('derives and revalidates one allowed kind, scope and period from rows', () => {
    expect(migration).toContain("p_import_kind NOT IN ('prices', 'inventory', 'sales')")
    expect(migration).toContain("p_scope_key IS DISTINCT FROM 'global'")
    expect(migration).toContain("'warehouse:' || v_inventory_warehouse_code")
    expect(migration).toContain("'month:' || v_sales_month")
    expect(migration).toContain('sales publication must have one calendar month')
    expect(migration).toContain('p_period_start IS DISTINCT FROM v_min_date')
    expect(migration).toContain('p_period_end IS DISTINCT FROM v_max_date')
    expect(migration).toContain('v_snapshot_date IS DISTINCT FROM p_effective_date')
  })

  it('enforces bounded, exact row shapes and decimal/sign invariants', () => {
    expect(migration).toContain("jsonb_typeof(p_rows) <> 'array'")
    expect(migration).toContain('pg_column_size(p_rows) > 16777216')
    expect(migration).toContain('v_row_count NOT BETWEEN 1 AND 10000')
    expect(migration).toContain("jsonb_object_keys(v_item) AS field(key)")
    expect(migration).toContain('v_number IS DISTINCT FROM trunc(v_number, 2)')
    expect(migration).toContain('v_number IS DISTINCT FROM trunc(v_number, 3)')
    expect(migration).toContain('v_discount_amount IS DISTINCT FROM v_list_amount - v_net_revenue')
    expect(migration).toContain('duplicate sales external line id')
    expect(migration).toContain('store publication fact count mismatch')
  })

  it('resolves cross-file variants by full-name variant key, never by source SKU alone', () => {
    expect(migration).toContain('idx_store_variants_owner_variant_key')
    expect(migration).toContain(
      'ON public.store_product_variants (user_id, company_id, variant_key)',
    )
    expect(migration).toContain(
      "'name-v1:' || encode(sha256(convert_to(v_normalized_name, 'UTF8')), 'hex')",
    )
    expect(migration).toMatch(
      /JOIN public\.store_product_variants AS variant[\s\S]*?variant\.user_id = p_user_id[\s\S]*?variant\.company_id = v_company_id[\s\S]*?variant\.variant_key = source_row\."variantKey"/,
    )
    expect(migration).toContain(
      'ON CONFLICT (user_id, company_id, variant_key) DO UPDATE SET',
    )
    expect(migration).toContain("store_product_variants.sku LIKE 'name:%'")
    expect(migration).toContain(
      "EXCLUDED.sku NOT LIKE 'name:%'",
    )
    expect(migration).toContain('ELSE store_product_variants.sku')
    expect(migration).not.toContain('store variant explicit sku conflict')
    expect(migration).not.toMatch(
      /JOIN public\.store_product_variants AS variant[\s\S]{0,300}?variant\.sku = source_row\.sku/,
    )
  })

  it('keeps an immutable per-run mapping audit and owner-scoped read policy', () => {
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS public.store_import_variant_mappings',
    )
    expect(migration).toContain('source_variant_key TEXT NOT NULL')
    expect(migration).toContain('resolution_method IN (\'existing\', \'created\')')
    expect(migration).toContain(
      'FOREIGN KEY (variant_id, user_id, company_id)',
    )
    expect(migration).toContain(
      'ALTER TABLE public.store_import_variant_mappings ENABLE ROW LEVEL SECURITY',
    )
    expect(migration).toMatch(
      /CREATE POLICY store_import_variant_mappings_owner_read[\s\S]*?auth\.uid\(\) = user_id/,
    )
  })

  it('upserts references and inserts exactly one matching fact table', () => {
    expect(migration).toContain('INSERT INTO public.store_warehouses')
    expect(migration).toContain(
      'ON CONFLICT (user_id, company_id, code) DO UPDATE SET',
    )
    expect(migration).toContain('INSERT INTO public.store_product_variants')
    expect(migration).toContain('INSERT INTO public.store_price_snapshots')
    expect(migration).toContain('INSERT INTO public.store_inventory_snapshots')
    expect(migration).toContain('INSERT INTO public.store_sales_lines')
    expect(migration).toMatch(
      /IF p_import_kind = 'prices' THEN[\s\S]*?ELSIF p_import_kind = 'inventory' THEN[\s\S]*?ELSE[\s\S]*?INSERT INTO public\.store_sales_lines/,
    )
  })

  it('removes every direct application DML path after installing the RPC', () => {
    for (const table of WRITE_TABLES) {
      expect(migration).toContain(
        `REVOKE INSERT, UPDATE, DELETE ON TABLE public.${table}\n  FROM PUBLIC, anon, authenticated, service_role`,
      )
    }
    expect(migration).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE)[^;]* TO (?:anon|authenticated|service_role)/)
  })

  it('requires linked ecommerce products to match both owner and company', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.store_enforce_ecommerce_product_owner\(\)[\s\S]*?product\.id = NEW\.ecommerce_product_id[\s\S]*?product\.user_id = NEW\.user_id[\s\S]*?product\.company_id = btrim\(NEW\.company_id\)/,
    )
    expect(migration).toContain(
      'BEFORE INSERT OR UPDATE OF ecommerce_product_id, user_id, company_id',
    )
  })

  it('removes exact owner-company facts before a company can become orphaned', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.store_cleanup_deleted_company()',
    )
    expect(migration).toContain('v_company_id TEXT := btrim(OLD.id::TEXT)')
    expect(migration).toMatch(
      /DELETE FROM public\.store_import_runs[\s\S]*?import_run\.user_id = OLD\.user_id[\s\S]*?import_run\.company_id = v_company_id/,
    )
    const runs = migration.indexOf('DELETE FROM public.store_import_runs')
    const variants = migration.indexOf('DELETE FROM public.store_product_variants')
    const warehouses = migration.indexOf('DELETE FROM public.store_warehouses')
    expect(runs).toBeGreaterThan(0)
    expect(variants).toBeGreaterThan(runs)
    expect(warehouses).toBeGreaterThan(variants)
    expect(migration).toContain('BEFORE DELETE ON public.companies')
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.store_cleanup_deleted_company()\n  FROM PUBLIC, anon, authenticated, service_role',
    )
  })
})
