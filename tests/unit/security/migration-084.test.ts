/**
 * Статическая проверка миграции 084 (F-001 / F-002 / F-006): БД в юнит-тестах
 * нет, поэтому фиксируем инварианты текста миграции, чтобы их не откатили.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/084_security_hardening.sql'), 'utf8')
const code = sql.replace(/--.*$/gm, '')

function fnBody(name: string): string {
  const start = code.indexOf(`FUNCTION public.${name}()`)
  expect(start).toBeGreaterThan(-1)
  const open = code.indexOf('$$', start)
  const close = code.indexOf('$$', open + 2)
  return code.slice(open + 2, close)
}

describe('migration 084 security hardening', () => {
  it('handle_new_user always inserts client + pending_approval and ignores metadata role/status', () => {
    const body = fnBody('handle_new_user')
    expect(body).toMatch(/'client',\s*'pending_approval'/)
    expect(body).not.toMatch(/raw_user_meta_data->>'role'/)
    expect(body).not.toMatch(/raw_user_meta_data->>'status'/)
  })

  it('guards role/status/tier/feature_flags for everyone except service_role / direct DB', () => {
    const body = fnBody('profiles_protect_privileged_columns')
    for (const col of ['role', 'status', "'tier'", "'feature_flags'"]) expect(body).toContain(col)
    expect(body).toContain("'service_role'")
    expect(body).toMatch(/NOT IN \('anon', 'authenticated', 'authenticator'\)/)
    expect(body).toMatch(/RAISE EXCEPTION/)
    expect(code).toMatch(/CREATE TRIGGER profiles_protect_privileged_columns\s+BEFORE UPDATE ON public\.profiles/)
    expect(code).toMatch(/DROP POLICY IF EXISTS "profiles_admin_update" ON public\.profiles/)
  })

  it("removes the 'owner' role", () => {
    expect(code).toMatch(/UPDATE public\.profiles SET role = 'client' WHERE role = 'owner'/)
    const check = code.match(/ADD CONSTRAINT profiles_role_check\s+CHECK \(([^;]+)\);/)
    expect(check).not.toBeNull()
    expect(check![1]).not.toContain('owner')
    expect(check![1]).toContain("'client'")
  })

  it('locks Prisma + 033 tables but never the shared Supabase companies table', () => {
    for (const t of ['users', 'sessions', 'accounts', 'audit_logs', 'admin_requests', 'crm_integrations', 'mini_gri_leads', 'shared_reports', 'subscriptions', 'payment_transactions']) {
      expect(code).toContain(`'${t}'`)
    }
    expect(code).not.toContain("'companies'")
    expect(code).toMatch(/REVOKE ALL ON TABLE public\.%I FROM anon, authenticated/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
  })
})
