import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/077_myhonor_catalog_sweeps.sql',
  ),
  'utf8',
)

describe('077 MyHonor complete catalog sweeps', () => {
  it('marks current catalog rows active and tombstones only after a complete sweep', () => {
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS catalog_active BOOLEAN NOT NULL DEFAULT FALSE',
    )
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.finalize_myhonor_ecommerce_catalog_sweep',
    )
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS public.ecommerce_catalog_sync_state',
    )
    expect(migration).toContain('v_verified < p_expected_product_count')
    expect(migration).toContain("availability = 'discontinued'")
    expect(migration).toContain('catalog_synced_at < p_sweep_started_at')
    expect(migration).toContain(
      'INSERT INTO public.ecommerce_catalog_sync_state',
    )
  })

  it('allows only the service role to finalize a tenant-bound sweep', () => {
    expect(migration).toMatch(
      /FROM public\.companies[\s\S]*?id::TEXT = btrim\(p_company_id\)[\s\S]*?user_id = p_user_id/,
    )
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.finalize_myhonor_ecommerce_catalog_sweep[\s\S]*?FROM PUBLIC, anon, authenticated;/,
    )
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.finalize_myhonor_ecommerce_catalog_sweep[\s\S]*?TO service_role;/,
    )
  })
})
