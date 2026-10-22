/**
 * Static check of migration 129 (Point B Ф6a: recommendations with expert verification and invites):
 * there is no database in unit tests, so the invariants of the SQL text are pinned here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/129_point_b_recommendations_invites.sql'), 'utf8')
const code = sql.replace(/--.*$/gm, '')

/** The CREATE TABLE body of a table (up to the closing `);`). */
function tableBody(name: string): string {
  const m = code.match(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${name} \\(([\\s\\S]*?)\\n\\);`))
  expect(m, `table ${name}`).not.toBeNull()
  return m![1]
}

describe('migration 129 point b recommendations and invites', () => {
  it('creates both tables idempotently', () => {
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.pb_recommendations \(/)
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.pb_invites \(/)
    expect((code.match(/CREATE TABLE/g) ?? []).length).toBe((code.match(/CREATE TABLE IF NOT EXISTS/g) ?? []).length)
    expect((code.match(/CREATE (UNIQUE )?INDEX/g) ?? []).length).toBe((code.match(/CREATE (UNIQUE )?INDEX IF NOT EXISTS/g) ?? []).length)
    // triggers and policies are dropped first, so a second run does not fail
    for (const t of code.match(/CREATE TRIGGER (\w+)/g) ?? []) expect(code).toContain(`DROP TRIGGER IF EXISTS ${t.split(' ')[2]}`)
    for (const p of code.match(/CREATE POLICY (\w+)/g) ?? []) expect(code).toContain(`DROP POLICY IF EXISTS ${p.split(' ')[2]}`)
    expect(code).not.toMatch(/DROP TABLE|DROP COLUMN/i)
    expect(code.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)

    const rec = tableBody('pb_recommendations')
    expect(rec).toMatch(/company_id\s+TEXT\s+NOT NULL REFERENCES public\.companies\(id\) ON DELETE CASCADE/)
    expect(rec).toMatch(/version_id\s+UUID\s+REFERENCES public\.pb_plan_versions\(id\) ON DELETE SET NULL/)
    expect(rec).toMatch(/supersedes_id\s+UUID\s+REFERENCES public\.pb_recommendations\(id\) ON DELETE SET NULL/)
    expect(rec).toMatch(/rec_version\s+INT\s+NOT NULL DEFAULT 1 CHECK \(rec_version >= 1\)/)
    for (const col of ['title', 'essence', 'reason', 'expected_effect', 'resources', 'confidence', 'confidence_reason', 'risks', 'next_action',
      'source_refs', 'status', 'generated_by', 'inputs_hash', 'reviewer_id', 'reviewer_name', 'reviewer_specialty', 'reviewed_at',
      'scope_note', 'review_comment', 'created_at', 'updated_at']) {
      expect(rec, col).toMatch(new RegExp(`\\n\\s+${col}\\s`))
    }

    const inv = tableBody('pb_invites')
    expect(inv).toMatch(/company_id\s+TEXT\s+NOT NULL REFERENCES public\.companies\(id\) ON DELETE CASCADE/)
    expect(inv).toMatch(/user_id\s+UUID\s+NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/)
    expect(inv).toMatch(/source_rec_id\s+UUID\s+REFERENCES public\.pb_recommendations\(id\) ON DELETE SET NULL/)
    expect(inv).toMatch(/status\s+TEXT\s+NOT NULL DEFAULT 'new'/)
    expect(inv).toMatch(/delivered\s+JSONB\s+NOT NULL DEFAULT '\{\}'::jsonb/)
    for (const col of ['rule_key', 'dedupe_key', 'kind', 'title', 'body', 'href', 'why', 'source_refs', 'priority', 'display',
      'snoozed_until', 'expires_at', 'created_at', 'updated_at']) {
      expect(inv, col).toMatch(new RegExp(`\\n\\s+${col}\\s`))
    }
  })

  it('RLS on and anon revoked on both; authenticated has no write grants', () => {
    expect(code).toMatch(/ALTER TABLE public\.pb_recommendations ENABLE ROW LEVEL SECURITY;/)
    expect(code).toMatch(/ALTER TABLE public\.pb_invites ENABLE ROW LEVEL SECURITY;/)
    expect(code).toMatch(/REVOKE ALL ON public\.pb_recommendations, public\.pb_invites FROM PUBLIC, anon;/)
    expect(code).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON public\.pb_recommendations, public\.pb_invites FROM authenticated;/)
    expect(code).toMatch(/GRANT SELECT ON public\.pb_recommendations, public\.pb_invites TO authenticated;/)
    expect(code).toMatch(/GRANT ALL ON public\.pb_recommendations, public\.pb_invites TO service_role;/)
    // no write grant / policy for the API roles
    expect(code).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO (authenticated|anon)/)
    expect(code).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/)
  })

  it('the client policy on recommendations exposes only expert_verified', () => {
    const rec = code.match(/CREATE POLICY pb_recommendations_client_read ON public\.pb_recommendations FOR SELECT TO authenticated\s+USING \(([\s\S]*?)\);/)
    expect(rec).not.toBeNull()
    expect(rec![1]).toMatch(/status = 'expert_verified'/)
    expect(rec![1]).toMatch(/public\.can_read_company\(company_id\)/)
    expect(rec![1]).not.toMatch(/pending_review|stale|expert_rejected/)
    const inv = code.match(/CREATE POLICY pb_invites_owner_read ON public\.pb_invites FOR SELECT TO authenticated\s+USING \(([\s\S]*?)\);/)
    expect(inv).not.toBeNull()
    expect(inv![1]).toMatch(/user_id = \(SELECT auth\.uid\(\)\)/)
    expect(code.match(/CREATE POLICY/g)).toHaveLength(2)
  })

  it('unique partial index on invites (user_id, dedupe_key) for active statuses', () => {
    expect(code).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS pb_invites_active_dedupe_uidx\s+ON public\.pb_invites \(user_id, dedupe_key\)\s+WHERE status IN \('new', 'seen', 'snoozed'\);/,
    )
  })

  it('check constraints: statuses, kinds, confidence, generated_by, lengths', () => {
    const rec = tableBody('pb_recommendations')
    expect(rec).toMatch(/CHECK \(kind IN \('lever', 'risk', 'action', 'contradiction', 'constraint'\)\)/)
    expect(rec).toMatch(/CHECK \(status IN \('pending_review', 'expert_verified', 'expert_rejected', 'stale'\)\)/)
    expect(rec).toMatch(/CHECK \(confidence IN \('low', 'medium', 'high'\)\)/)
    expect(rec).toMatch(/CHECK \(generated_by IN \('rule', 'ai', 'expert'\)\)/)
    expect(rec).toMatch(/CHECK \(length\(title\) BETWEEN 1 AND 200\)/)
    expect(rec).toMatch(/CHECK \(length\(essence\) <= 2000\)/)
    expect(rec).toMatch(/CHECK \(length\(reason\) <= 2000\)/)
    for (const col of ['expected_effect', 'resources', 'risks', 'next_action', 'confidence_reason', 'scope_note', 'review_comment']) {
      expect(rec, col).toMatch(new RegExp(`CHECK \\(${col} IS NULL OR length\\(${col}\\) <= 2000\\)`))
    }
    expect(rec).toMatch(/CHECK \(reviewer_name IS NULL OR length\(reviewer_name\) <= 200\)/)
    expect(rec).toMatch(/CHECK \(reviewer_specialty IS NULL OR length\(reviewer_specialty\) <= 200\)/)
    expect(rec).toMatch(/CHECK \(jsonb_typeof\(source_refs\) = 'array' AND pg_column_size\(source_refs\) <= 16384\)/)

    const inv = tableBody('pb_invites')
    expect(inv).toMatch(/CHECK \(status IN \('new', 'seen', 'dismissed', 'snoozed', 'acted', 'expired'\)\)/)
    expect(inv).toMatch(/CHECK \(kind IN \('insight', 'recommendation'\)\)/)
    expect(inv).toMatch(/CHECK \(display IN \('card', 'modal'\)\)/)
    expect(inv).toMatch(/CHECK \(length\(title\) BETWEEN 1 AND 200\)/)
    expect(inv).toMatch(/CHECK \(length\(body\) <= 1000\)/)
    expect(inv).toMatch(/CHECK \(href IS NULL OR length\(href\) <= 300\)/)
    expect(inv).toMatch(/CHECK \(length\(why\) <= 600\)/)
    expect(inv).toMatch(/CHECK \(jsonb_typeof\(source_refs\) = 'array' AND pg_column_size\(source_refs\) <= 16384\)/)
    expect(inv).toMatch(/CHECK \(jsonb_typeof\(delivered\) = 'object'\)/)
  })

  it('indexes and updated_at triggers exist', () => {
    expect(code).toMatch(/CREATE INDEX IF NOT EXISTS pb_recommendations_company_idx\s+ON public\.pb_recommendations \(company_id, status, created_at DESC\);/)
    expect(code).toMatch(/CREATE INDEX IF NOT EXISTS pb_recommendations_pending_idx\s+ON public\.pb_recommendations \(created_at\)\s+WHERE status = 'pending_review';/)
    expect(code).toMatch(/CREATE INDEX IF NOT EXISTS pb_invites_user_idx\s+ON public\.pb_invites \(user_id, status, created_at DESC\);/)
    for (const t of ['pb_recommendations', 'pb_invites']) {
      expect(code).toMatch(new RegExp(`CREATE TRIGGER ${t}_updated_at\\s+BEFORE UPDATE ON public\\.${t}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.set_updated_at\\(\\);`))
    }
  })
})
