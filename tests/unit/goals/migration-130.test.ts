/**
 * Static check of migration 130 (one-time sync of the revenue goals between
 * the questionnaire and metric_targets). There is no database in unit tests,
 * so the invariants of the SQL text are pinned here; the behaviour was run
 * against a throwaway Postgres with stub tables (see the W1 report).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SURVEY_KEY_STEP } from '@/lib/survey/steps'
import { REVENUE_GOAL_METRIC } from '@/lib/goals/store'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/130_goals_survey_sync.sql'), 'utf8')
const code = sql.replace(/--.*$/gm, '')
const header = sql.split('\n').filter((l) => l.startsWith('--')).join('\n')

describe('migration 130 goals ↔ survey sync', () => {
  it('the header explains the rule', () => {
    expect(header).toMatch(/updated_by IS NULL/)
    expect(header).toMatch(/updated_by NOT NULL/)
    expect(header).toMatch(/newer than the answer/)
    expect(header).toMatch(/idempotent/i)
  })

  it('data only: no DDL, no policies, no grants', () => {
    expect(code).not.toMatch(/\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|POLICY|TRIGGER|FUNCTION|COLUMN)/i)
    expect(code).not.toMatch(/ADD COLUMN/i)
    expect(code).not.toMatch(/\b(GRANT|REVOKE|TRUNCATE)\b/i)
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i)
    const tables = new Set(code.match(/public\.\w+/g))
    expect([...tables].sort()).toEqual(['public.companies', 'public.metric_targets', 'public.survey_answers'])
  })

  it('only the revenue goal on 12m / 3y, from the numeric step-1 answers (year, else month × 12)', () => {
    expect(code).toContain(`'${REVENUE_GOAL_METRIC}'`)
    expect(code).toMatch(/VALUES \('12m'\), \('3y'\)/)
    expect(code).toMatch(/'s1_goal_' \|\| p\.period_label \|\| '_revenue_year'/)
    expect(code).toMatch(/'s1_goal_' \|\| p\.period_label \|\| '_revenue_month'/)
    expect(code).toMatch(/WHEN year_value > 0 THEN round\(year_value\) ELSE round\(month_value \* 12\)/)
    expect(code).not.toMatch(/goal_month_v2|goal_week_v2/)
    // the owner's answers: joined through companies.user_id (survey_answers.company_id is often NULL)
    expect(code).toMatch(/sy\.user_id = c\.user_id/)
  })

  it('a person\'s newer goal is kept and written back; otherwise the survey wins', () => {
    expect(code).toMatch(/r\.updated_by IS NOT NULL AND r\.updated_at > coalesce\(r\.survey_at/)
    expect(code).toMatch(/UPDATE public\.metric_targets\s+SET target_value = r\.survey_value/)
    expect(code).toMatch(/INSERT INTO public\.metric_targets/)
    expect(code).toMatch(/ON CONFLICT \(company_id, metric_key, period_label\) DO NOTHING/)
    expect(code).toMatch(/INSERT INTO public\.survey_answers/)
    expect(code).toMatch(/ON CONFLICT \(user_id, question_key\) DO UPDATE/)
    expect(code).toMatch(/round\(v_goal \/ 12\)/)
  })

  it('the answers get the step that owns them (no «1/12» step corruption)', () => {
    expect(SURVEY_KEY_STEP.s1_goal_12m_revenue_year).toBe(1)
    expect(SURVEY_KEY_STEP.s1_goal_3y_revenue_month).toBe(1)
    const inserted = code.slice(code.indexOf('INSERT INTO public.survey_answers'), code.indexOf('ON CONFLICT (user_id, question_key)'))
    expect(inserted.match(/\(r\.user_id, r\.company_id, (\d+),/g)).toEqual(['(r.user_id, r.company_id, 1,', '(r.user_id, r.company_id, 1,'])
  })

  it('idempotent: every write is guarded by a difference', () => {
    expect(code).toMatch(/round\(r\.target_value\) IS DISTINCT FROM r\.survey_value/)
    expect(code).toMatch(/target_revenue_12m_kzt IS DISTINCT FROM v_goal/)
    expect(code).toMatch(/target_revenue_3y_kzt IS DISTINCT FROM v_goal/)
  })
})
