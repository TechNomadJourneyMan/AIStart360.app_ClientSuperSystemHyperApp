/**
 * R-049: the GIGA owner password login (POST /api/giga-admin/auth) was limited per IP only —
 * rotating addresses (or a spoofable hop) allowed unlimited guesses at the owner password. Now a
 * second, per-account limit keyed by the submitted e-mail (normalised) refuses before the password
 * is checked, whatever the IP; its store failing refuses too (fail-closed), like
 * /api/auth/password.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { hashOwnerPassword } from '@/lib/admin/owner-password'

const s = vi.hoisted(() => ({
  hits: new Map<string, number>(),
  calls: [] as Array<{ id: string; bucket: string; opts: { max?: number; windowMs?: number; failClosed?: boolean } }>,
  storeDown: false,
  generateLink: 0,
}))

/** An in-memory sliding counter per bucket + identifier (what the real store does, minus the window). */
vi.mock('@/lib/rate-limit', () => ({
  isRateLimitedKey: async (id: string, bucket: string, opts: { max?: number; failClosed?: boolean } = {}) => {
    s.calls.push({ id, bucket, opts })
    if (s.storeDown && bucket === 'giga-owner-login-account') return opts.failClosed !== false
    const k = `${bucket}:${id}`
    const n = (s.hits.get(k) ?? 0) + 1
    s.hits.set(k, n)
    return n > (opts.max ?? 10)
  },
}))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ ilike: () => ({ maybeSingle: async () => ({ data: { id: 'owner-id', role: 'super_admin', status: 'approved' } }) }) }) }),
    auth: { admin: { generateLink: async () => { s.generateLink++; return { data: { properties: { hashed_token: 'th' } }, error: null } } } },
  }),
}))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { verifyOtp: async () => ({ data: { user: { id: 'owner-id' } }, error: null }) } }),
}))

const { POST } = await import('@/app/api/giga-admin/auth/route')

const OWNER = 'owner@example.test'
const PASSWORD = 'correct horse battery staple'
const ORIGINAL = { hash: process.env.GIGA_OWNER_PASSWORD_HASH, email: process.env.GIGA_OWNER_EMAIL }
let ipSeq = 0
const login = (email: string, password: string) =>
  POST(new NextRequest('http://localhost/api/giga-admin/auth', {
    method: 'POST',
    // A new address for every attempt: the per-IP limit never trips.
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${++ipSeq % 250}` },
    body: JSON.stringify({ email, password }),
  }))

beforeEach(() => {
  s.hits = new Map()
  s.calls = []
  s.storeDown = false
  s.generateLink = 0
  process.env.GIGA_OWNER_PASSWORD_HASH = hashOwnerPassword(PASSWORD, 1024)
  process.env.GIGA_OWNER_EMAIL = OWNER
})
afterEach(() => {
  if (ORIGINAL.hash === undefined) delete process.env.GIGA_OWNER_PASSWORD_HASH
  else process.env.GIGA_OWNER_PASSWORD_HASH = ORIGINAL.hash
  if (ORIGINAL.email === undefined) delete process.env.GIGA_OWNER_EMAIL
  else process.env.GIGA_OWNER_EMAIL = ORIGINAL.email
})

describe('POST /api/giga-admin/auth — per-account limit (R-049)', () => {
  it('rotating IPs cannot brute-force the owner password: after the account limit even the right password is refused', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) statuses.push((await login(i % 2 ? OWNER.toUpperCase() : ` ${OWNER} `, `guess-${i}`)).status)
    expect(statuses.filter((x) => x === 401).length).toBeLessThanOrEqual(8)
    expect(statuses.at(-1)).toBe(429)
    const right = await login(OWNER, PASSWORD)
    expect(right.status).toBe(429)
    expect(s.generateLink).toBe(0)
    const account = s.calls.filter((c) => c.bucket === 'giga-owner-login-account')
    expect(new Set(account.map((c) => c.id))).toEqual(new Set([OWNER]))
    expect(account[0].opts.failClosed).toBe(true)
  })

  it('the account-limit store failing refuses (fail-closed)', async () => {
    s.storeDown = true
    const res = await login(OWNER, PASSWORD)
    expect(res.status).toBe(429)
    expect(s.generateLink).toBe(0)
  })

  it('under the limit the owner signs in', async () => {
    expect((await login(OWNER, PASSWORD)).status).toBe(200)
    expect(s.generateLink).toBe(1)
  })
})
