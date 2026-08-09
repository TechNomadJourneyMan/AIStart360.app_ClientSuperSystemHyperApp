import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/083_myhonor_server_owned_catalog_sweeps.sql',
  ),
  'utf8',
)

describe('079 MyHonor server-owned catalog sweeps', () => {
  it('stores one durable, generation-fenced in-progress sweep', () => {
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS public.ecommerce_catalog_sweeps',
    )
    expect(migration).toContain(
      "status IN ('in_progress', 'completed', 'failed', 'superseded')",
    )
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]*?WHERE status = 'in_progress'/,
    )
    expect(migration).toContain('generation BIGINT NOT NULL')
    expect(migration).toContain('failure_code TEXT')
    expect(migration).toContain('failed_at TIMESTAMPTZ')
  })

  it('freezes and independently verifies the exact ordered canonical id set', () => {
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS public.ecommerce_catalog_sweep_manifest',
    )
    expect(migration).toContain('UNIQUE (sweep_id, product_external_id)')
    expect(migration).toContain(
      "product_external_id ~ '^myhonor:[a-f0-9]{64}$'",
    )
    expect(migration).toContain(
      "string_agg(item.value #>> '{}', E'\\n' ORDER BY item.ordinality)",
    )
    expect(migration).toContain(
      'IF v_computed_hash IS DISTINCT FROM p_manifest_hash',
    )
    expect(migration).toContain(
      'v_page_ids IS DISTINCT FROM v_manifest_page',
    )
  })

  it('owns the sequential cursor in the DB and fences stale/concurrent writers', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.get_myhonor_ecommerce_catalog_sweep',
    )
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.record_myhonor_ecommerce_catalog_sweep_page',
    )
    expect(migration).toContain('p_offset <> v_sweep.next_offset')
    expect(migration).toContain("'offset_mismatch'")
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain("v_sweep.status <> 'in_progress'")
    expect(migration).toContain("'superseded_by_new_sweep'")
  })

  it('cannot finalize a partial manifest and tombstones by exact anti-join', () => {
    expect(migration).toContain('v_unseen_count <> 0')
    expect(migration).toContain(
      'v_persisted_count <> v_sweep.expected_product_count',
    )
    expect(migration).toMatch(
      /SET catalog_active = FALSE,[\s\S]*?AND NOT EXISTS \([\s\S]*?ecommerce_catalog_sweep_manifest/,
    )
    expect(migration).toContain(
      'v_active_count <> v_sweep.expected_product_count',
    )
    expect(migration).toContain("SET status = 'completed'")
  })

  it('keeps failures durable and exposes writes only through service RPCs', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.fail_myhonor_ecommerce_catalog_sweep',
    )
    expect(migration).toContain("SET status = 'failed'")
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.ecommerce_catalog_sweep_manifest[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/,
    )
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.record_myhonor_ecommerce_catalog_sweep_page[\s\S]*?TO service_role/,
    )
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.finalize_myhonor_ecommerce_catalog_sweep[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/,
    )
  })
})
