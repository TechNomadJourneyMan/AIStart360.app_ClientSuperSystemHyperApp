/** Dev-tools pure helpers: test-account e-mail / password / kinds, permission matrix, diagnostics. */
import { describe, expect, it } from 'vitest'
import {
  TEST_ACCOUNT_KINDS, generateTestPassword, isMissingColumnError, isTestEmail, testAccountEmail, testAccountKind,
} from '@/lib/devtools/test-accounts'
import { navForRole, permissionMatrix } from '@/lib/devtools/matrix'
import { buildInfo, migration120Status } from '@/lib/devtools/diagnostics'
import { STAFF_ROLES } from '@/lib/admin/rbac'

describe('test accounts', () => {
  it('cover every staff role below super_admin and three client states', () => {
    const staff = TEST_ACCOUNT_KINDS.map((k) => k.staffRole).filter(Boolean)
    expect(new Set(staff)).toEqual(new Set(STAFF_ROLES.filter((r) => r !== 'super_admin')))
    expect(TEST_ACCOUNT_KINDS.filter((k) => k.client).map((k) => k.status).sort()).toEqual(['approved', 'blocked', 'pending_approval'])
    expect(testAccountKind('expert')).toMatchObject({ profileRole: 'expert', staffRole: null })
    expect(testAccountKind('nope')).toBeNull()
    expect(TEST_ACCOUNT_KINDS.some((k) => (k.staffRole as string | null) === 'super_admin')).toBe(false)
  })

  it('e-mails live in the test domain', () => {
    const e = testAccountEmail('super-expert')
    expect(e).toMatch(/^super-expert\.[a-z0-9]{8}@test\.aistart360\.app$/)
    expect(isTestEmail(e)).toBe(true)
    expect(isTestEmail('owner@aistart360.app')).toBe(false)
    expect(isTestEmail('x@test.aistart360.app.evil.com')).toBe(false)
    expect(isTestEmail(null)).toBe(false)
  })

  it('passwords are strong and random', () => {
    const a = generateTestPassword()
    expect(a).toHaveLength(20)
    expect(a).toMatch(/[a-z]/)
    expect(a).toMatch(/[A-Z]/)
    expect(a).toMatch(/[0-9]/)
    expect(a).toMatch(/[^A-Za-z0-9]/)
    expect(generateTestPassword()).not.toBe(a)
  })

  it('recognises a missing is_test column (migration 120 not applied)', () => {
    expect(isMissingColumnError({ code: '42703', message: 'column profiles.is_test does not exist' })).toBe(true)
    expect(isMissingColumnError({ code: 'PGRST204', message: "Could not find the 'is_test' column of 'profiles' in the schema cache" })).toBe(true)
    expect(isMissingColumnError({ message: 'column profiles.is_test does not exist' })).toBe(true)
    expect(isMissingColumnError({ code: '23514', message: 'violates check constraint' })).toBe(false)
    expect(isMissingColumnError(null)).toBe(false)
  })
})

describe('permission matrix', () => {
  it('devtools.use belongs to super_admin only', () => {
    const row = permissionMatrix().find((r) => r.permission === 'devtools.use')!
    expect(Object.entries(row.roles).filter(([, v]) => v).map(([r]) => r)).toEqual(['super_admin'])
    expect(row.description).toBeTruthy()
  })

  it('the nav of a role is filtered by its permissions', () => {
    const analyst = navForRole('analyst').giga.flatMap((g) => g.items.map((i) => i.href))
    expect(analyst).not.toContain('/admin-giga-panel/dev-tools')
    expect(analyst).not.toContain('/admin-giga-panel/settings')
    expect(analyst).toContain('/admin-giga-panel/users')
    expect(navForRole('super_admin').giga.flatMap((g) => g.items.map((i) => i.href))).toContain('/admin-giga-panel/dev-tools')
    expect(navForRole('analyst').superExpert).toBeNull()
    expect(navForRole('super_expert').superExpert?.length).toBeGreaterThan(0)
  })
})

describe('diagnostics', () => {
  it('build info from the environment (no secrets)', () => {
    const b = buildInfo({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'abcdef1234567', VERCEL_GIT_COMMIT_MESSAGE: 'feat: x\n\nbody', NODE_ENV: 'production' }, 'v20.0.0')
    expect(b).toMatchObject({ vercelEnv: 'production', commitShort: 'abcdef1', commitMessage: 'feat: x', region: null, node: 'v20.0.0' })
  })

  it('migration 120 status', () => {
    expect(migration120Status(true, null)).toBe('applied')
    expect(migration120Status(false, true)).toBe('applied')
    expect(migration120Status(false, false)).toBe('missing')
    expect(migration120Status(null, false)).toBe('unknown')
  })
})
