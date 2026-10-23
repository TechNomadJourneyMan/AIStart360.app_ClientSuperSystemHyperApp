/**
 * Static check of migration 136 (the questionnaire chat): cards without a
 * company, survey conversations written by the server only, and the transcript
 * never visible to another client. No database in unit tests: the SQL
 * invariants are pinned here (as migration-134.test.ts does).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/136_survey_chat_rls.sql'), 'utf8')
const code = sql.replace(/--.*$/gm, '')
const policy = (name: string): string => {
  const start = code.indexOf(`CREATE POLICY ${name} `)
  expect(start, name).toBeGreaterThan(-1)
  return code.slice(start, code.indexOf(';', start))
}

describe('migration 136 survey chat RLS', () => {
  it('additive and idempotent', () => {
    expect(code).toContain('ALTER TABLE public.ai_pending_actions ALTER COLUMN company_id DROP NOT NULL;')
    expect(code).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|DROP\s+COLUMN)\b/i)
    expect(code).not.toMatch(/\bUPDATE\s+public\./i)
    const created = [...code.matchAll(/CREATE POLICY (\w+)/g)].map((m) => m[1])
    for (const name of created) expect(code).toContain(`DROP POLICY IF EXISTS ${name} ON`)
    expect(code).toMatch(/NOTIFY pgrst, 'reload schema';/)
  })

  it('every new policy is RESTRICTIVE (it can only narrow 053, never widen it)', () => {
    const created = [...code.matchAll(/CREATE POLICY (\w+) ON public\.\w+\s+AS (\w+)/g)]
    expect(created.length).toBe(8)
    for (const m of created) expect(m[2]).toBe('RESTRICTIVE')
  })

  it('a client JWT cannot write survey conversations or their messages', () => {
    for (const op of ['insert', 'update', 'delete']) {
      expect(policy(`ai_conversations_survey_no_client_${op}`)).toMatch(new RegExp(`FOR ${op.toUpperCase()} TO authenticated, anon`))
      expect(policy(`ai_conversations_survey_no_client_${op}`)).toContain("surface <> 'survey'")
      expect(policy(`ai_messages_survey_no_client_${op}`)).toContain("c.surface = 'survey'")
      expect(policy(`ai_messages_survey_no_client_${op}`)).toContain('NOT EXISTS')
    }
  })

  it('the transcript is not visible to another client', () => {
    expect(policy('ai_conversations_survey_owner_read')).toContain("USING (surface <> 'survey' OR user_id = auth.uid())")
    expect(policy('ai_messages_survey_owner_read')).toContain('c.user_id IS DISTINCT FROM auth.uid()')
    // 053: the base owner-only policies stay; staff read goes through the server.
    expect(code).not.toMatch(/is_platform_staff|service_role/)
  })

  it('134 already allows the survey surface and the card kind', () => {
    const m134 = readFileSync(join(process.cwd(), 'supabase/migrations/134_survey_answer_via.sql'), 'utf8')
    expect(m134).toMatch(/'survey'/)
    expect(m134).toMatch(/'set_survey_answer'/)
  })
})
