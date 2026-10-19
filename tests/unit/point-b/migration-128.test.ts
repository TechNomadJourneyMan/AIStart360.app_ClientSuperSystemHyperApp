/**
 * Static check of migration 128 (Point B: the link of plan tasks with action_items): there is no
 * database in unit tests, so the invariants of the SQL text are pinned here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/128_point_b_action_items_link.sql'), 'utf8')
const code = sql.replace(/--.*$/gm, '')

describe('migration 128 point b action_items link', () => {
  it('adds the two columns idempotently', () => {
    expect(code).toMatch(/ALTER TABLE public\.action_items/)
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS pb_task_key\s+TEXT/)
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS pb_version_id\s+UUID/)
    // every ADD COLUMN is guarded, nothing is dropped or recreated
    expect((code.match(/ADD COLUMN/g) ?? []).length).toBe((code.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length)
    expect(code).not.toMatch(/DROP (TABLE|COLUMN)/i)
    expect(code).not.toMatch(/CREATE TABLE/i)
    expect(code.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)
  })

  it('unique partial index on (user_id, pb_task_key)', () => {
    expect(code).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS action_items_pb_task_uidx\s+ON public\.action_items \(user_id, pb_task_key\)\s+WHERE pb_task_key IS NOT NULL;/,
    )
    expect(code.match(/CREATE (UNIQUE )?INDEX/g)).toHaveLength(1)
  })

  it('key length check', () => {
    expect(code).toMatch(/CHECK \(pb_task_key IS NULL OR length\(pb_task_key\) BETWEEN 8 AND 64\)/)
  })

  it('does not touch RLS or policies of action_items', () => {
    expect(code).not.toMatch(/POLICY/i)
    expect(code).not.toMatch(/ROW LEVEL SECURITY/i)
    expect(code).not.toMatch(/\b(GRANT|REVOKE)\b/i)
    expect(code).not.toMatch(/\bTRIGGER\b/i)
    // the only table touched is action_items
    expect(code.match(/public\.\w+/g)!.every((t) => t === 'public.action_items')).toBe(true)
  })
})
