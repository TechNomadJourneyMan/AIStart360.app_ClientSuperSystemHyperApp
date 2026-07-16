import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/069_omnichannel_conversation_ux.sql'),
  'utf8',
)

describe('069 omnichannel conversation UX migration', () => {
  it('is a one-time revision for the supported flow version', () => {
    expect(migration).toContain("'conversation_ux_revision', 1")
    expect(migration).toContain(
      "automation_config #> '{equipment_sales_flow,version}' = '1'::jsonb",
    )
    expect(migration).toContain(
      "automation_config #> '{equipment_sales_flow,opt_in_revision}' = '1'::jsonb",
    )
    expect(migration).toContain(
      "automation_config #> '{equipment_sales_flow,conversation_ux_revision}' IS NULL",
    )
  })

  it('updates conversation copy without replacing manager routing', () => {
    expect(migration).toContain("'messages', jsonb_build_object(")
    expect(migration).toContain("'choices', jsonb_build_array(")
    expect(migration).toContain("'community', (automation_config #> '{equipment_sales_flow,community}')")
    expect(migration).not.toContain("'city_routes',")
    expect(migration).not.toContain("'fallback_route_id',")
    expect(migration).not.toContain("'manager_phone',")
  })
})
