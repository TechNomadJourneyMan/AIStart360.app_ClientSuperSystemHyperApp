import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/080_myhonor_catalog_snapshot.sql',
  ),
  'utf8',
)

describe('076 MyHonor catalog snapshot migration', () => {
  it('keeps catalog writes in a service-role-only function', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.sync_myhonor_ecommerce_catalog',
    )
    expect(migration).toContain('SECURITY DEFINER')
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.sync_myhonor_ecommerce_catalog[\s\S]*?FROM PUBLIC, anon, authenticated;/,
    )
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.sync_myhonor_ecommerce_catalog[\s\S]*?TO service_role;/,
    )
  })

  it('validates the owner/company binding and the fixed MyHonor source', () => {
    expect(migration).toContain("v_source CONSTANT TEXT := 'myhonor.shop'")
    expect(migration).toMatch(
      /FROM public\.companies[\s\S]*?id::TEXT = btrim\(p_company_id\)[\s\S]*?user_id = p_user_id/,
    )
    expect(migration).toContain(
      "v_url !~ '^https://myhonor[.]shop/product/[a-z0-9-]+/?$'",
    )
    expect(migration).toContain(
      "v_external_id !~ '^myhonor:[a-f0-9]{64}$'",
    )
  })
})
