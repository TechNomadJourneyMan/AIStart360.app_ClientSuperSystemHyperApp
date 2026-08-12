import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/084_store_control_center.sql'),
  'utf8',
)

const TABLES = [
  'store_import_runs',
  'store_warehouses',
  'store_product_variants',
  'store_price_snapshots',
  'store_inventory_snapshots',
  'store_sales_lines',
]

describe('Store Control Center migration', () => {
  it('creates every operational table and enables RLS', () => {
    for (const table of TABLES) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`)
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
      expect(migration).toMatch(new RegExp(
        `REVOKE ALL ON TABLE public\\.${table}[\\s\\S]*?FROM PUBLIC, anon, authenticated, service_role`,
      ))
      expect(migration).toContain(`GRANT SELECT ON TABLE public.${table} TO authenticated`)
    }
  })

  it('scopes every read policy to the authenticated owner', () => {
    for (const table of TABLES) {
      expect(migration).toMatch(new RegExp(
        `CREATE POLICY ${table}_owner_read[\\s\\S]*?ON public\\.${table}[\\s\\S]*?auth\\.uid\\(\\) = user_id`,
      ))
    }
    expect(migration).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE)[^;]* TO authenticated/)
  })

  it('supports UUID and reconciled TEXT company ids through a server check', () => {
    expect(migration).toContain('company_id TEXT NOT NULL')
    expect(migration).toContain('id::TEXT = btrim(NEW.company_id)')
    expect(migration).toContain('NEW.user_id')
    expect(migration).toContain('store_enforce_ecommerce_product_owner')
    expect(migration).toMatch(/ecommerce_products[\s\S]*?id = NEW\.ecommerce_product_id[\s\S]*?user_id = NEW\.user_id/)
  })

  it('deduplicates source files and permits only one published version per scope', () => {
    expect(migration).toContain('UNIQUE (user_id, company_id, import_kind, source_sha256)')
    expect(migration).toContain('idx_store_import_runs_one_published_scope')
    expect(migration).toMatch(/WHERE status = 'published'/)
  })

  it('keeps size and color variants that share one supplier article distinct', () => {
    expect(migration).toContain('variant_key TEXT NOT NULL')
    expect(migration).toContain('UNIQUE (user_id, company_id, sku, variant_key)')
    expect(migration).not.toContain('UNIQUE (user_id, company_id, sku),')
  })

  it('preserves signed return facts and exact discount arithmetic', () => {
    expect(migration).toContain('quantity NUMERIC(18,3) NOT NULL CHECK (quantity <> 0)')
    expect(migration).toContain('quantity < 0 AND list_amount <= 0 AND net_revenue <= 0 AND cost_amount <= 0')
    expect(migration).toContain('discount_amount = list_amount - net_revenue')
  })

  it('keeps raw files and customer or bank PII out of the schema', () => {
    for (const forbiddenColumn of ['customer_email', 'customer_phone', 'bank_account', 'raw_payload', 'file_contents']) {
      expect(migration).not.toContain(forbiddenColumn)
    }
  })
})
