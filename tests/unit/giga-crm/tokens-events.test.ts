import { beforeAll, describe, expect, it } from 'vitest'
import { signToken, verifyToken } from '@/lib/security/signed-token'
import { isViewModeAllowed, readImpersonation, signImpersonation } from '@/lib/impersonation/token'
import { isClientEvent, isEventName, sanitizeMetadata, sanitizePage } from '@/lib/events/registry'

beforeAll(() => { process.env.GIGA_COOKIE_SECRET = 'test-secret-for-signed-tokens-0123456789' })

describe('signed tokens', () => {
  it('round-trips claims', async () => {
    const t = await signToken('staff', { sub: 'u1' }, 60)
    const v = await verifyToken<{ sub: string }>('staff', t)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.claims.sub).toBe('u1')
  })

  it('rejects a token of another type', async () => {
    const t = await signToken('staff', { sub: 'u1' }, 60)
    expect((await verifyToken('imp', t)).ok).toBe(false)
  })

  it('rejects tampering', async () => {
    const t = await signToken('staff', { sub: 'u1' }, 60)
    const [v, , sig] = t.split('.')
    const forged = `${v}.${Buffer.from(JSON.stringify({ sub: 'admin', typ: 'staff', iat: 1, exp: 9999999999 })).toString('base64url')}.${sig}`
    const r = await verifyToken('staff', forged)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('signature')
    expect((await verifyToken('staff', 'garbage')).ok).toBe(false)
    expect((await verifyToken('staff', null)).ok).toBe(false)
  })

  it('reports expiry with the authentic claims', async () => {
    const t = await signToken('imp', { sid: 's1' }, 1)
    const r = await verifyToken<{ sid: string }>('imp', t, Date.now() + 5000)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('expired')
      expect(r.claims?.sid).toBe('s1')
    }
  })

  it('impersonation token carries mode and target', async () => {
    const t = await signImpersonation({ sid: 'a', uid: 'b', mode: 'view', aid: 'giga:super_admin', alabel: 'x', tlabel: 'y' })
    const r = await readImpersonation(t)
    expect(r.ok && r.claims.mode).toBe('view')
  })

  it('view mode allows only exit, analytics and staff API', () => {
    expect(isViewModeAllowed('/api/v1/impersonation/exit')).toBe(true)
    expect(isViewModeAllowed('/api/v1/events')).toBe(true)
    expect(isViewModeAllowed('/api/giga-admin/users')).toBe(true)
    expect(isViewModeAllowed('/api/v1/onboarding/survey')).toBe(false)
    expect(isViewModeAllowed('/api/v1/gri/assessment')).toBe(false)
  })
})

describe('event registry', () => {
  it('only marked events may come from the browser', () => {
    expect(isClientEvent('PAGE_VIEWED')).toBe(true)
    expect(isClientEvent('GRI_COMPLETED')).toBe(false)
    expect(isClientEvent('QUESTIONNAIRE_COMPLETED')).toBe(false)
    expect(isClientEvent('DROP_TABLE')).toBe(false)
    expect(isEventName('USER_REGISTERED')).toBe(true)
  })

  it('keeps metadata small and flat', () => {
    const m = sanitizeMetadata({ ok: 1, s: 'x'.repeat(500), nested: { a: 1 }, 'bad key': 1, arr: [1], nan: NaN, b: true, n: null })
    expect(m).toEqual({ ok: 1, s: 'x'.repeat(200), b: true, n: null })
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]))
    expect(Object.keys(sanitizeMetadata(many))).toHaveLength(20)
    expect(sanitizeMetadata('nope')).toEqual({})
  })

  it('strips query strings and collapses ids in pages', () => {
    expect(sanitizePage('/client/home?token=secret#x')).toBe('/client/home')
    expect(sanitizePage('/admin-giga-panel/users/11111111-2222-3333-4444-555555555555')).toBe('/admin-giga-panel/users/:id')
    expect(sanitizePage('https://evil.example')).toBeNull()
    expect(sanitizePage(42)).toBeNull()
  })
})
