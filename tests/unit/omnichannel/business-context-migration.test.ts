import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/071_omnichannel_honor_context.sql'),
  'utf8',
)
const newContext = migration.match(/\$honor\$([\s\S]*?)\$honor\$/u)?.[1] ?? ''

describe('071 Honor Group omnichannel context migration', () => {
  it('updates only the exact audited pair and fails on a partial concurrent edit', () => {
    expect(migration).toContain('business_context = v_old_context')
    expect(migration).toContain('IF v_old_count = 1 THEN')
    expect(migration).toContain('IF v_old_count = 2 THEN')
    expect(migration).toContain('IF v_updated_count <> 2 THEN')
    expect(migration).toContain("channel IN ('instagram', 'whatsapp')")
  })

  it('contains the corrected Honor facts without the stale domain or route', () => {
    expect(newContext).toContain('Honor Group')
    expect(newContext).toContain('Outdoor · Hunt · Fish')
    expect(newContext).toContain('https://myhonor.shop/catalog')
    expect(newContext).toContain('https://wa.me/77054057775')
    expect(newContext).toContain('https://wa.me/77714057775')
    expect(newContext).not.toContain('мотоэкипировки')
    expect(newContext).not.toContain('77780457775')
  })

  it('normalizes every manager route without changing channel modes', () => {
    expect(migration).toContain("route.value ->> 'id' = 'astana'")
    expect(migration).toContain("to_jsonb('77054057775'::TEXT)")
    expect(migration).toContain("to_jsonb('77714057775'::TEXT)")
    expect(migration).not.toMatch(/\bSET\s+mode\s*=/iu)
    expect(migration).not.toMatch(/\benabled\s*=/iu)
  })
})
