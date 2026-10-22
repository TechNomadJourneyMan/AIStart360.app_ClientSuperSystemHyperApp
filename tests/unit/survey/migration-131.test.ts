/**
 * Static check of migration 131 (survey answer authors, documents.question_key).
 * No database in unit tests: the SQL invariants are pinned here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANSWER_AUTHOR_ROLES } from '@/lib/survey/attribution'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/131_survey_answer_attribution.sql'), 'utf8')
const code = sql.replace(/--.*$/gm, '')

describe('migration 131 survey answer attribution', () => {
  it('additive and idempotent: nullable columns, guarded constraints, no drops of data', () => {
    for (const col of ['updated_by UUID', 'updated_by_role TEXT', 'updated_at TIMESTAMPTZ']) {
      expect(code).toContain(`ALTER TABLE public.survey_answers ADD COLUMN IF NOT EXISTS ${col};`)
    }
    expect(code).toContain('ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS question_key TEXT;')
    expect(code).not.toMatch(/ADD COLUMN[^;]*NOT NULL/)
    expect(code).not.toMatch(/\bDROP\s+(TABLE|COLUMN|POLICY)\b/i)
    expect(code).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|UPDATE\s+public\.)/i)
    expect(code).toMatch(/CREATE INDEX IF NOT EXISTS documents_user_question_idx\s+ON public\.documents \(user_id, question_key\)/)
    expect(code.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/g)).toHaveLength(2)
  })

  it('the role CHECK matches the code', () => {
    const roles = ANSWER_AUTHOR_ROLES.map((r) => `'${r}'`).join(', ')
    expect(code).toContain(`updated_by_role IN (${roles})`)
  })

  it('the author guard: a client JWT is always the user (or the AI it accepted), trusted unstamped changes clear the author', () => {
    expect(code).toMatch(/coalesce\(auth\.role\(\), ''\) IN \('authenticated', 'anon'\) AND NOT public\.is_platform_staff\(\)/)
    expect(code).toMatch(/NEW\.updated_by := auth\.uid\(\)/)
    expect(code).toMatch(/CASE WHEN NEW\.updated_by_role = 'ai' THEN 'ai' ELSE 'user' END/)
    expect(code).toMatch(/NEW\.answer IS DISTINCT FROM OLD\.answer\s+AND NEW\.updated_at IS NOT DISTINCT FROM OLD\.updated_at/)
    expect(code).toMatch(/DROP TRIGGER IF EXISTS survey_answers_stamp_author ON public\.survey_answers;/)
    expect(code).toMatch(/BEFORE INSERT OR UPDATE ON public\.survey_answers/)
    expect(code).toMatch(/REVOKE EXECUTE ON FUNCTION public\.stamp_survey_answer_author\(\) FROM PUBLIC, anon, authenticated/)
  })

  it('reloads the PostgREST schema cache', () => {
    expect(code).toMatch(/NOTIFY pgrst, 'reload schema';/)
  })
})
