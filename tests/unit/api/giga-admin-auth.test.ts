/**
 * POST /api/giga-admin/auth — вход владельца в ГИГА-Панель: email владельца +
 * пароль, чей хеш живёт только в окружении. Общего аварийного пароля больше нет.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { hashOwnerPassword, verifyOwnerPassword } from '@/lib/admin/owner-password'

const s = vi.hoisted(() => ({
  limited: false,
  profile: { id: 'owner-id', role: 'super_admin', status: 'approved' } as null | { id: string; role: string; status: string },
  verifiedUserId: 'owner-id' as string | null,
  generateLink: 0,
  audits: [] as string[],
}))

vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => s.limited }))
vi.mock('@/lib/audit', () => ({ logAudit: async (e: { action: string }) => { s.audits.push(e.action) } }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ ilike: () => ({ maybeSingle: async () => ({ data: s.profile }) }) }) }),
    auth: { admin: { generateLink: async () => { s.generateLink++; return { data: { properties: { hashed_token: 'th' } }, error: null } } } },
  }),
}))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    auth: {
      verifyOtp: async () => (s.verifiedUserId ? { data: { user: { id: s.verifiedUserId } }, error: null } : { data: { user: null }, error: { message: 'x' } }),
      getUser: async () => ({ data: { user: null } }),
      signOut: async () => ({}),
    },
  }),
}))

const { POST } = await import('@/app/api/giga-admin/auth/route')

const PASSWORD = 'correct horse battery staple'
const HASH = hashOwnerPassword(PASSWORD, 1024)
const ORIGINAL = { hash: process.env.GIGA_OWNER_PASSWORD_HASH, email: process.env.GIGA_OWNER_EMAIL }

const login = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/giga-admin/auth', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' }, body: JSON.stringify(body),
  }))

beforeEach(() => {
  s.limited = false
  s.profile = { id: 'owner-id', role: 'super_admin', status: 'approved' }
  s.verifiedUserId = 'owner-id'
  s.generateLink = 0
  s.audits = []
  process.env.GIGA_OWNER_PASSWORD_HASH = HASH
  delete process.env.GIGA_OWNER_EMAIL
})
afterEach(() => {
  if (ORIGINAL.hash === undefined) delete process.env.GIGA_OWNER_PASSWORD_HASH
  else process.env.GIGA_OWNER_PASSWORD_HASH = ORIGINAL.hash
  if (ORIGINAL.email === undefined) delete process.env.GIGA_OWNER_EMAIL
  else process.env.GIGA_OWNER_EMAIL = ORIGINAL.email
})

describe('owner password hash', () => {
  it('verifies only the right password; malformed hashes fail closed', () => {
    expect(verifyOwnerPassword(PASSWORD, HASH)).toBe(true)
    expect(verifyOwnerPassword(PASSWORD + '!', HASH)).toBe(false)
    expect(verifyOwnerPassword(PASSWORD, 'plain-text')).toBe(false)
    expect(verifyOwnerPassword(PASSWORD, undefined)).toBe(false)
    expect(HASH).not.toContain(PASSWORD)
    expect(HASH).not.toContain('$')
  })
})

describe('POST /api/giga-admin/auth', () => {
  it('owner email + right password → personal Supabase session, no break-glass cookie', async () => {
    const res = await login({ email: 'TechNomadJourneyMan@gmail.com', password: PASSWORD })
    expect(res.status).toBe(200)
    expect(s.generateLink).toBe(1)
    expect(res.cookies.get('aistart360_giga')?.value).toBe('')
    expect(s.audits).toEqual(['admin.login'])
  })

  it('wrong password or another email → 401, no session minted', async () => {
    expect((await login({ email: 'technomadjourneyman@gmail.com', password: 'nope' })).status).toBe(401)
    expect((await login({ email: 'someone@else.io', password: PASSWORD })).status).toBe(401)
    expect(s.generateLink).toBe(0)
    expect(s.audits).toEqual(['admin.login_failed', 'admin.login_failed'])
  })

  it('password alone (old break-glass form) is rejected', async () => {
    expect((await login({ password: PASSWORD })).status).toBe(400)
  })

  it('fails closed without a configured hash', async () => {
    delete process.env.GIGA_OWNER_PASSWORD_HASH
    expect((await login({ email: 'technomadjourneyman@gmail.com', password: PASSWORD })).status).toBe(503)
    expect(s.generateLink).toBe(0)
  })

  it('account must still be an approved super_admin', async () => {
    s.profile = { id: 'owner-id', role: 'client', status: 'approved' }
    expect((await login({ email: 'technomadjourneyman@gmail.com', password: PASSWORD })).status).toBe(403)
    expect(s.generateLink).toBe(0)
  })

  it('rate limit applies before any check', async () => {
    s.limited = true
    expect((await login({ email: 'technomadjourneyman@gmail.com', password: PASSWORD })).status).toBe(429)
    expect(s.audits).toEqual([])
  })

  it('session for another user id is refused', async () => {
    s.verifiedUserId = 'someone-else'
    expect((await login({ email: 'technomadjourneyman@gmail.com', password: PASSWORD })).status).toBe(500)
  })
})
