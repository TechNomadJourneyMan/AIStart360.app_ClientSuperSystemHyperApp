import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/072_omnichannel_direct_catalog.sql'),
  'utf8',
)

describe('direct catalog migration', () => {
  it('configures the exact Honor catalog on both channels', () => {
    expect(migration).toContain("'url', 'https://myhonor.shop/catalog'")
    expect(migration).toContain("'text', 'Конечно! Посмотреть каталог можно здесь:'")
    expect(migration).toContain("settings.channel IN ('instagram', 'whatsapp')")
    expect(migration).toContain("'{equipment_sales_flow,catalog}'")
  })

  it('fails closed on partial or operator-customized state', () => {
    expect(migration).toContain('IF v_target_count <> 2')
    expect(migration).toContain('IF v_current_count = 1')
    expect(migration).toContain('an operator catalog configuration already exists')
    expect(migration).toContain('IF v_updated_count <> 2')
  })

  it('does not change channel mode or enabled flags', () => {
    expect(migration).not.toMatch(/\bSET\s+mode\b/iu)
    expect(migration).not.toMatch(/\bSET\s+enabled\b/iu)
  })
})
