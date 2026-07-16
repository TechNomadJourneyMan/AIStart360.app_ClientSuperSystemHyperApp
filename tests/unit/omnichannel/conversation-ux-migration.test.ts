import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/069_omnichannel_conversation_ux.sql'),
  'utf8',
)

describe('069 omnichannel conversation UX migration', () => {
  it('is a one-time target revision for the supported flow version', () => {
    expect(migration).toContain("'conversation_ux_revision', 1")
    expect(migration).toContain(
      "settings.automation_config #> '{equipment_sales_flow,version}' = '1'::jsonb",
    )
    expect(migration).toContain(
      "settings.automation_config #> '{equipment_sales_flow,opt_in_revision}' = '1'::jsonb",
    )
    expect(migration).toContain(
      "settings.automation_config #> '{equipment_sales_flow,conversation_ux_revision}' IS NULL",
    )
  })

  it('only upgrades the exact unedited source revision', () => {
    expect(migration).toContain('WITH expected_revision AS (')
    expect(migration).toContain(
      "settings.automation_config #> '{equipment_sales_flow,messages}' = expected.messages",
    )
    expect(migration).toContain(
      "settings.automation_config #> '{equipment_sales_flow,choices}' = expected.choices",
    )
    expect(migration).toContain(
      "settings.automation_config #>> '{equipment_sales_flow,community,text}' = expected.community_text",
    )
    expect(migration).toContain("Добрый день, Вы из какого города?")
    expect(migration).toContain("Присоединяйтесь в чат, здесь будем публиковать все новинки и акции")
  })

  it('does not force a timestamp change when the guarded update is a no-op', () => {
    expect(migration).not.toMatch(/\bupdated_at\s*=\s*(?:now\(\)|current_timestamp)/iu)
  })

  it('updates conversation copy without replacing manager routing', () => {
    expect(migration).toContain("'messages', jsonb_build_object(")
    expect(migration).toContain("'choices', jsonb_build_array(")
    expect(migration).toContain("'community', (settings.automation_config #> '{equipment_sales_flow,community}')")
    expect(migration).not.toContain("'city_routes',")
    expect(migration).not.toContain("'fallback_route_id',")
    expect(migration).not.toContain("'manager_phone',")
  })
})
