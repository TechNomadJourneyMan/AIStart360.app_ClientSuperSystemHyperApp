/**
 * Static check of migration 134 (the path of a questionnaire answer). No
 * database in unit tests: the SQL invariants are pinned here, the same way
 * migration-131.test.ts pins the author guard.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANSWER_VIA, CLIENT_ANSWER_VIA } from '@/lib/survey/attribution'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/134_survey_answer_via.sql'), 'utf8')
const code = sql.replace(/--.*$/gm, '')
const list = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(', ')

/** The body of one plpgsql function of the migration. */
function fnBody(name: string): string {
  const start = code.indexOf(`CREATE OR REPLACE FUNCTION public.${name}()`)
  expect(start, name).toBeGreaterThan(-1)
  const open = code.indexOf('$$', start)
  return code.slice(open + 2, code.indexOf('$$;', open + 2))
}

describe('migration 134 survey answer via', () => {
  it('additive and idempotent: nullable columns, guarded constraints, no data changes', () => {
    expect(code).toContain('ALTER TABLE public.survey_answers ADD COLUMN IF NOT EXISTS updated_via TEXT;')
    expect(code).toContain('ALTER TABLE public.survey_answer_history ADD COLUMN IF NOT EXISTS via TEXT;')
    expect(code).not.toMatch(/ADD COLUMN[^;]*NOT NULL/)
    expect(code).not.toMatch(/\bDROP\s+(TABLE|COLUMN|POLICY)\b/i)
    expect(code).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE)\b/i)
    expect(code).not.toMatch(/UPDATE\s+public\.survey_answers\b/i)
    expect(code.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/g)).toHaveLength(2)
    expect(code).toMatch(/NOTIFY pgrst, 'reload schema';/)
  })

  it('the CHECKs list exactly the paths of the code', () => {
    expect(code).toContain(`updated_via IS NULL OR updated_via IN (${list(ANSWER_VIA)})`)
    expect(code).toContain(`via IS NULL OR via IN (${list(ANSWER_VIA)})`)
  })

  it('a client JWT may set only its own paths; chat / staff become NULL; document goes with role ai', () => {
    const body = fnBody('stamp_survey_answer_author')
    const client = body.slice(0, body.indexOf('RETURN NEW;'))
    expect(client).toMatch(/coalesce\(auth\.role\(\), ''\) IN \('authenticated', 'anon'\) AND NOT public\.is_platform_staff\(\)/)
    expect(client).toMatch(/NEW\.updated_by := auth\.uid\(\)/)
    // The paths a client may write, and nothing else.
    const allowed = client.match(/WHEN NEW\.updated_via IN \(([^)]*)\) THEN NEW\.updated_via/)
    expect(allowed?.[1]).toBe(list(CLIENT_ANSWER_VIA.filter((v) => v !== 'document')))
    expect(client).toMatch(/WHEN NEW\.updated_by_role = 'ai' THEN 'document'/)
    expect(client).toMatch(/ELSE NULL/)
    expect(client).not.toMatch(/'chat'|'staff'|'system'/)
    expect(client).toMatch(/CASE WHEN NEW\.updated_by_role = 'ai' OR NEW\.updated_via = 'document' THEN 'ai' ELSE 'user' END/)
  })

  it('trusted writers: an unstamped change clears author and path; a new author does not inherit the path', () => {
    const body = fnBody('stamp_survey_answer_author')
    const trusted = body.slice(body.indexOf('RETURN NEW;'))
    expect(trusted).toMatch(/NEW\.answer IS DISTINCT FROM OLD\.answer\s+AND NEW\.updated_at IS NOT DISTINCT FROM OLD\.updated_at THEN\s+NEW\.updated_by := NULL;\s+NEW\.updated_by_role := NULL;\s+NEW\.updated_via := NULL;/)
    expect(trusted).toMatch(/NEW\.updated_via IS NOT DISTINCT FROM OLD\.updated_via\s+AND \(NEW\.updated_by IS DISTINCT FROM OLD\.updated_by OR NEW\.updated_by_role IS DISTINCT FROM OLD\.updated_by_role\) THEN\s+NEW\.updated_via := NULL;/)
    expect(code).toMatch(/REVOKE EXECUTE ON FUNCTION public\.stamp_survey_answer_author\(\) FROM PUBLIC, anon, authenticated/)
    expect(code).toMatch(/BEFORE INSERT OR UPDATE ON public\.survey_answers/)
  })

  it('history: 076 kept (actor headers, 10-minute glue, revisions) plus the path', () => {
    const body = fnBody('track_survey_answer_history')
    expect(body).toMatch(/v_via\s+TEXT := CASE WHEN TG_OP <> 'DELETE' THEN NEW\.updated_via END;/)
    expect(body).toMatch(/AND h\.via IS NOT DISTINCT FROM v_via/)
    expect(body).toMatch(/interval '10 minutes'/)
    expect(body).toMatch(/revisions = revisions \+ 1/)
    expect(body).toMatch(/x-actor-id/)
    expect(body).toMatch(/\(user_id, question_key, operation, old_value, new_value, changed_by, source, impersonation_session_id, via\)/)
    expect(body).toMatch(/VALUES \(v_user, v_key, TG_OP, v_old, v_new, v_actor, v_source, v_imp, v_via\)/)
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.track_survey_answer_history\(\) FROM PUBLIC, anon, authenticated/)
  })

  it('AI chat CHECKs: the existing values plus survey / set_survey_answer', () => {
    expect(code).toContain("CHECK (surface IN ('report', 'dashboard', 'point_a', 'point_b', 'simulator', 'intake', 'gri', 'global', 'survey'))")
    expect(code).toContain("CHECK (kind IN ('set_value', 'resolve_discrepancy', 'set_goal', 'set_survey_answer'))")
    expect(code).toMatch(/DROP CONSTRAINT IF EXISTS ai_conversations_surface_check/)
    expect(code).toMatch(/DROP CONSTRAINT IF EXISTS ai_pending_actions_kind_check/)
  })
})
