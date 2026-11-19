/**
 * R5 review (wave 1B, L-3): the per-account limit of the GIGA owner login counted EVERY attempt
 * with the e-mail, so anyone sending 8 requests per 10 minutes kept the owner out, and the owner's
 * own sign-ins used it up. Now (with the REAL limiter here — the in-memory store on a fake clock):
 *   • only the owner's e-mail has an account bucket; other e-mails never touch it (IP limit only);
 *   • only FAILED attempts count: a slot is reserved before the password check (so a burst of
 *     concurrent guesses cannot all be checked) and given back when the password is right, or the
 *     login is not configured;
 *   • after others' failures fill the limit the owner is refused until the window has passed —
 *     refused attempts are not counted, so they do not extend it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { hashOwnerPassword } from '@/lib/admin/owner-password'

const s = vi.hoisted(() => ({ generateLink: 0 }))
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

const rl = await import('@/lib/rate-limit')
const { createMemoryStore } = await import('@/lib/rate-limit/memory')
const { POST } = await import('@/app/api/giga-admin/auth/route')

const OWNER = 'owner@example.test'
const PASSWORD = 'correct horse battery staple'
const ORIGINAL = { hash: process.env.GIGA_OWNER_PASSWORD_HASH, email: process.env.GIGA_OWNER_EMAIL }
const MIN = 60_000
let clock = 0
let ipSeq = 0
const login = (email: string, password: string) =>
  POST(new NextRequest('http://localhost/api/giga-admin/auth', {
    method: 'POST',
    // A new address for every attempt: the per-IP limit never trips.
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.${Math.floor(++ipSeq / 250) % 250}.${ipSeq % 250}` },
    body: JSON.stringify({ email, password }),
  }))
const statuses = async (n: number, email: string, password: (i: number) => string) => {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push((await login(email, password(i))).status)
  return out
}

beforeEach(() => {
  clock = 1_800_000_000_000 // the start of a 10-minute window
  rl.__setRateLimitStoreForTests(createMemoryStore({ now: () => clock }))
  s.generateLink = 0
  process.env.GIGA_OWNER_PASSWORD_HASH = hashOwnerPassword(PASSWORD, 1024)
  process.env.GIGA_OWNER_EMAIL = OWNER
})
afterEach(() => {
  rl.__setRateLimitStoreForTests(null)
  if (ORIGINAL.hash === undefined) delete process.env.GIGA_OWNER_PASSWORD_HASH
  else process.env.GIGA_OWNER_PASSWORD_HASH = ORIGINAL.hash
  if (ORIGINAL.email === undefined) delete process.env.GIGA_OWNER_EMAIL
  else process.env.GIGA_OWNER_EMAIL = ORIGINAL.email
})

describe('POST /api/giga-admin/auth — only failed attempts at the owner account count (R5 L-3)', () => {
  it('the owner signing in 20 times in a row is never refused', async () => {
    expect(await statuses(20, OWNER, () => PASSWORD)).toEqual(Array(20).fill(200))
    expect(s.generateLink).toBe(20)
  })

  it('attempts with other e-mails never get an account limit, and never lock the owner', async () => {
    expect(new Set(await statuses(12, 'someone@example.test', (i) => `guess-${i}`))).toEqual(new Set([401]))
    expect(new Set(await statuses(12, 'other@example.test', (i) => `guess-${i}`))).toEqual(new Set([401]))
    expect((await login(OWNER, PASSWORD)).status).toBe(200)
  })

  it('a successful login gives its slot back: 7 failures, the owner, 1 failure → still 401; the next → 429', async () => {
    expect(new Set(await statuses(7, OWNER, (i) => `guess-${i}`))).toEqual(new Set([401]))
    expect((await login(OWNER, PASSWORD)).status).toBe(200)
    expect((await login(OWNER, 'guess-8')).status).toBe(401)
    expect((await login(OWNER, 'guess-9')).status).toBe(429)
  })

  it('a login that is not configured (no hash) does not count', async () => {
    delete process.env.GIGA_OWNER_PASSWORD_HASH
    expect(new Set(await statuses(10, OWNER, () => PASSWORD))).toEqual(new Set([503]))
    process.env.GIGA_OWNER_PASSWORD_HASH = hashOwnerPassword(PASSWORD, 1024)
    expect((await login(OWNER, PASSWORD)).status).toBe(200)
  })

  it('others\' failures lock the owner (even the right password) only until the window has passed; refused attempts do not extend it', async () => {
    expect(new Set(await statuses(8, ` ${OWNER.toUpperCase()} `, (i) => `guess-${i}`))).toEqual(new Set([401]))
    expect((await login(OWNER, PASSWORD)).status).toBe(429)
    expect(s.generateLink).toBe(0)
    clock += 5 * MIN
    expect(new Set(await statuses(5, OWNER, (i) => `late-${i}`))).toEqual(new Set([429]))
    clock += 15 * MIN // two windows after the failures
    expect((await login(OWNER, PASSWORD)).status).toBe(200)
  })

  it('a burst of concurrent wrong guesses: at most 8 reach the password check', async () => {
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => login(OWNER, `burst-${i}`)))
    const codes = res.map((r) => r.status)
    expect(codes.filter((c) => c === 401)).toHaveLength(8)
    expect(codes.filter((c) => c === 429)).toHaveLength(12)
  })
})
