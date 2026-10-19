/**
 * Static check of migration 127 (Point B saved what-if scenarios): there is no database in unit tests,
 * so the invariants of the SQL text are pinned here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/127_point_b_saved_whatif.sql'), 'utf8')
const code = sql.replace(/--.*$/gm, '')

describe('migration 127 point b saved what-if', () => {
  it('creates the table idempotently', () => {
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.pb_saved_scenarios \(/)
    expect(code).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/)
    expect(code).not.toMatch(/DROP TABLE/i)
    expect(code).toMatch(/id\s+UUID\s+PRIMARY KEY DEFAULT gen_random_uuid\(\)/)
    expect(code).toMatch(/company_id\s+TEXT\s+NOT NULL REFERENCES public\.companies\(id\) ON DELETE CASCADE/)
    expect(code).toMatch(/user_id\s+UUID\s+NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/)
    expect(code).toMatch(/model_version\s+TEXT\s+NOT NULL/)
    expect(code).toMatch(/proposed_at\s+TIMESTAMPTZ,/)
    expect(code).toMatch(/proposal_message_id\s+UUID,/)
    expect(code).toMatch(/created_at\s+TIMESTAMPTZ NOT NULL DEFAULT now\(\)/)
    expect(code).toMatch(/updated_at\s+TIMESTAMPTZ NOT NULL DEFAULT now\(\)/)
    // The migration may be applied twice without an error.
    expect(code).toMatch(/CREATE INDEX IF NOT EXISTS/)
    expect(code).toMatch(/DROP TRIGGER IF EXISTS pb_saved_scenarios_updated_at/)
    expect(code).toMatch(/DROP POLICY IF EXISTS pb_saved_scenarios_owner_read/)
    expect(code.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)
  })

  it('RLS on, anon revoked, no write grants for authenticated', () => {
    expect(code).toContain('ALTER TABLE public.pb_saved_scenarios ENABLE ROW LEVEL SECURITY;')
    expect(code).toMatch(/REVOKE ALL ON public\.pb_saved_scenarios FROM PUBLIC, anon;/)
    expect(code).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public\.pb_saved_scenarios FROM authenticated;/)
    expect(code).toMatch(/GRANT SELECT ON public\.pb_saved_scenarios TO authenticated;/)
    expect(code).toMatch(/GRANT ALL ON public\.pb_saved_scenarios TO service_role;/)
    expect(code).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE|ALL)[^;]*TO[^;]*authenticated/)
    expect(code).not.toMatch(/TO[^;]*\banon\b/)
  })

  it('select policy is owner-only', () => {
    expect(code).toMatch(/CREATE POLICY pb_saved_scenarios_owner_read ON public\.pb_saved_scenarios FOR SELECT TO authenticated\s+USING \(user_id = \(SELECT auth\.uid\(\)\)\);/)
    // Exactly one policy, and it is a SELECT one.
    expect(code.match(/CREATE POLICY/g)).toHaveLength(1)
    expect(code).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/)
  })

  it('name 1..80, note ≤ 500, changes is an array, summary is an object, both ≤ 16 KB', () => {
    expect(code).toMatch(/name\s+TEXT\s+NOT NULL CHECK \(length\(btrim\(name\)\) BETWEEN 1 AND 80\)/)
    expect(code).toMatch(/note\s+TEXT\s+CHECK \(note IS NULL OR length\(note\) <= 500\)/)
    expect(code).toMatch(/changes\s+JSONB\s+NOT NULL CHECK \(jsonb_typeof\(changes\) = 'array' AND pg_column_size\(changes\) <= 16384\)/)
    expect(code).toMatch(/summary\s+JSONB\s+NOT NULL DEFAULT '\{\}'::jsonb CHECK \(jsonb_typeof\(summary\) = 'object' AND pg_column_size\(summary\) <= 16384\)/)
  })

  it('index and updated_at trigger exist', () => {
    expect(code).toMatch(/CREATE INDEX IF NOT EXISTS pb_saved_scenarios_company_created_idx\s+ON public\.pb_saved_scenarios \(company_id, created_at DESC\);/)
    expect(code).toMatch(/BEFORE UPDATE ON public\.pb_saved_scenarios\s+FOR EACH ROW EXECUTE FUNCTION public\.set_updated_at\(\)/)
  })

  it('the 20-scenario limit is left to the application (no trigger counts rows)', () => {
    expect(code).not.toMatch(/count\(\*\)/i)
    expect(code.match(/CREATE TRIGGER/g)).toHaveLength(1)
  })
})
