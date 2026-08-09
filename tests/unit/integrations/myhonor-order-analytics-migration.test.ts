import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/079_myhonor_ecommerce_analytics.sql',
  ),
  'utf8',
)

describe('075 MyHonor ecommerce analytics migration', () => {
  it('creates normalized products, orders, items, and ingest audit/state', () => {
    for (const table of [
      'ecommerce_products',
      'ecommerce_orders',
      'ecommerce_order_items',
      'ecommerce_order_ingest_events',
      'ecommerce_order_ingest_state',
    ]) {
      expect(migration).toContain(
        `CREATE TABLE IF NOT EXISTS public.${table}`,
      )
      expect(migration).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
      )
    }
    expect(migration).toContain('customer_hash TEXT NOT NULL')
    expect(migration).not.toMatch(/\b(customer_email|customer_phone)\b/i)
  })

  it('allows authenticated owners to read but not mutate analytics tables', () => {
    expect(migration).toContain(
      'CREATE POLICY ecommerce_orders_owner_read',
    )
    expect(migration).toMatch(
      /CREATE POLICY ecommerce_orders_owner_read[\s\S]*?FOR SELECT TO authenticated[\s\S]*?auth\.uid\(\) = user_id/,
    )
    expect(migration).not.toMatch(
      /CREATE POLICY ecommerce_[^\n]+[\s\S]{0,160}?FOR (?:INSERT|UPDATE|DELETE)/,
    )
    expect(migration).toContain(
      'GRANT SELECT ON TABLE public.ecommerce_orders TO authenticated',
    )
  })

  it('keeps writes in one service-role-only transactional RPC', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.ingest_myhonor_ecommerce_order',
    )
    expect(migration).toContain('SECURITY DEFINER')
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.ingest_myhonor_ecommerce_order',
    )
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.ingest_myhonor_ecommerce_order[\s\S]*?FROM PUBLIC, anon, authenticated;/,
    )
    expect(migration).toContain('TO service_role')
  })

  it('binds the company to its server-selected owner and serializes events/orders', () => {
    expect(migration).toMatch(
      /FROM public\.companies[\s\S]*?id::TEXT = btrim\(p_company_id\)[\s\S]*?user_id = p_user_id/,
    )
    expect(migration).toContain("'myhonor:event:' || p_user_id::TEXT")
    expect(migration).toContain("'myhonor:order:' || p_user_id::TEXT")
    expect(migration).toContain('pg_advisory_xact_lock')
  })

  it('handles event replay, out-of-order versions, conflicts, cancel, and refund states', () => {
    expect(migration).toContain(
      "THEN 'duplicate'",
    )
    expect(migration).toContain("v_result := 'out_of_order'")
    expect(migration).toContain("THEN 'duplicate_version'")
    expect(migration).toContain("v_result := 'conflict'")
    expect(migration).toContain("status = 'cancelled'")
    expect(migration).toContain("status = 'partially_refunded'")
    expect(migration).toContain("status = 'refunded'")
    expect(migration).toMatch(
      /v_existing\.status = 'partially_refunded'[\s\S]*?'refunded', 'cancelled'/,
    )
    expect(migration).toContain(
      'item totals do not equal gross amount',
    )
  })

  it('does not overwrite current catalog facts with historical order-line facts', () => {
    expect(migration).toContain('catalog_synced_at TIMESTAMPTZ')
    expect(migration).toMatch(
      /price = CASE[\s\S]*?ecommerce_products\.catalog_synced_at IS NULL[\s\S]*?ELSE public\.ecommerce_products\.price/,
    )
    expect(migration).toMatch(
      /availability = CASE[\s\S]*?ecommerce_products\.catalog_synced_at IS NULL[\s\S]*?ELSE public\.ecommerce_products\.availability/,
    )
    expect(migration).toMatch(
      /url = CASE[\s\S]*?catalog_synced_at IS NULL[\s\S]*?ELSE public\.ecommerce_products\.url/,
    )
  })
})
