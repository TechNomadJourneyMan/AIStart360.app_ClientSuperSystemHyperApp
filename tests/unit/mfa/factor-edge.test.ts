/**
 * lib/mfa/factor-edge.ts — the factor on record, as the server counts it
 * (user_security.totp_enabled OR a passkey); unreadable → null (fail closed).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  totp: [] as unknown[] | 'error',
  keys: [] as unknown[] | 'error',
  calls: [] as string[],
}))
vi.mock('@/lib/supabase/transport-edge', () => ({
  edgeSupabaseFetch: async (url: string) => {
    s.calls.push(url)
    const body = url.includes('/user_security?') ? s.totp : s.keys
    if (body === 'error') return new Response('{}', { status: 500 })
    return new Response(JSON.stringify(body), { status: 200 })
  },
}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.app'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
const { secondFactorOnRecordEdge, __resetSecondFactorCacheForTests } = await import('@/lib/mfa/factor-edge')
const UID = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  s.totp = []
  s.keys = []
  s.calls = []
  __resetSecondFactorCacheForTests()
})

describe('secondFactorOnRecordEdge', () => {
  it('no rows → false', async () => {
    expect(await secondFactorOnRecordEdge(UID)).toBe(false)
  })
  it('TOTP enabled → true', async () => {
    s.totp = [{ totp_enabled: true }]
    expect(await secondFactorOnRecordEdge(UID)).toBe(true)
  })
  it('TOTP set up but off → false', async () => {
    s.totp = [{ totp_enabled: false }]
    expect(await secondFactorOnRecordEdge(UID)).toBe(false)
  })
  it('a passkey → true', async () => {
    s.keys = [{ user_id: UID }]
    expect(await secondFactorOnRecordEdge(UID)).toBe(true)
  })
  it('either read failing → null, and it is not cached', async () => {
    s.keys = 'error'
    expect(await secondFactorOnRecordEdge(UID)).toBeNull()
    s.keys = []
    expect(await secondFactorOnRecordEdge(UID)).toBe(false)
  })
  it('not a user id → null, nothing is asked', async () => {
    expect(await secondFactorOnRecordEdge('x&role=eq.admin')).toBeNull()
    expect(s.calls).toHaveLength(0)
  })
  it('the answer is cached briefly per instance', async () => {
    s.totp = [{ totp_enabled: true }]
    await secondFactorOnRecordEdge(UID)
    await secondFactorOnRecordEdge(UID)
    expect(s.calls).toHaveLength(2) // one pair of reads
  })
})
