import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/082_myhonor_canonical_product_ids.sql',
  ),
  'utf8',
)

describe('078 canonical MyHonor product ids', () => {
  it('tightens product and order-item joins to the public catalog hash', () => {
    expect(migration).toMatch(
      /ecommerce_products_external_id_check[\s\S]*?\^myhonor:\[a-f0-9\]\{64\}\$/,
    )
    expect(migration).toMatch(
      /ecommerce_order_items_product_external_id_check[\s\S]*?\^myhonor:\[a-f0-9\]\{64\}\$/,
    )
    expect(migration).toContain(
      'VALIDATE CONSTRAINT ecommerce_products_external_id_check',
    )
    expect(migration).toContain(
      'VALIDATE CONSTRAINT ecommerce_order_items_product_external_id_check',
    )
  })
})
