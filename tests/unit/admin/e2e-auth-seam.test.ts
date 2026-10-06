/**
 * The E2E auth seam is test-only: it must be impossible to switch on in a
 * production build, and inert without a long secret. When it is on, it never
 * mints a role — the role comes from the database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({ $queryRaw: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: prismaMock }))

import {
  E2E_SEAM_COOKIE_NAME,
  e2eSeamEnabled,
  signE2eSeamCookie,
  verifyE2eSeamEdge,
} from '@/lib/admin/e2e-auth-seam-edge'
import { resolveE2eSeamIdentity } from '@/lib/admin/e2e-auth-seam'

const SECRET = 'seam-secret-for-unit-tests-0123456789'
const USER = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b'

function jar(value?: string) {
  return { get: (name: string) => (name === E2E_SEAM_COOKIE_NAME && value ? { value } : undefined) }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('E2E_AUTH_SEAM_SECRET', SECRET)
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('switch', () => {
  it('is on only outside production with a secret of at least 32 characters', () => {
    expect(e2eSeamEnabled()).toBe(true)
    vi.stubEnv('E2E_AUTH_SEAM_SECRET', 'x'.repeat(31))
    expect(e2eSeamEnabled()).toBe(false)
    vi.stubEnv('E2E_AUTH_SEAM_SECRET', '')
    expect(e2eSeamEnabled()).toBe(false)
    vi.stubEnv('E2E_AUTH_SEAM_SECRET', SECRET)
    vi.stubEnv('NODE_ENV', 'production')
    expect(e2eSeamEnabled()).toBe(false)
  })

  it('refuses to sign a cookie when disabled', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await expect(signE2eSeamCookie(USER)).rejects.toThrow(/disabled/)
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('E2E_AUTH_SEAM_SECRET', 'short')
    await expect(signE2eSeamCookie(USER)).rejects.toThrow(/disabled/)
  })
})

describe('cookie', () => {
  it('round-trips the user id', async () => {
    const cookie = await signE2eSeamCookie(USER)
    expect(cookie.startsWith(`${USER}.`)).toBe(true)
    expect(await verifyE2eSeamEdge(cookie)).toBe(USER)
  })

  it('rejects tampering, a swapped user id, junk and a foreign secret', async () => {
    const cookie = await signE2eSeamCookie(USER)
    const other = '00000000-0000-4000-8000-000000000000'
    const [, sig] = cookie.split('.')
    expect(await verifyE2eSeamEdge(`${other}.${sig}`)).toBeNull()
    expect(await verifyE2eSeamEdge(cookie.slice(0, -2) + (cookie.endsWith('AA') ? 'BB' : 'AA'))).toBeNull()
    expect(await verifyE2eSeamEdge(cookie.toUpperCase())).toBeNull()
    expect(await verifyE2eSeamEdge('super_admin')).toBeNull()
    expect(await verifyE2eSeamEdge('')).toBeNull()
    expect(await verifyE2eSeamEdge(undefined)).toBeNull()
    vi.stubEnv('E2E_AUTH_SEAM_SECRET', SECRET + '-rotated')
    expect(await verifyE2eSeamEdge(cookie)).toBeNull()
  })

  it('an authentic cookie is worthless in production or without the secret', async () => {
    const cookie = await signE2eSeamCookie(USER)
    vi.stubEnv('NODE_ENV', 'production')
    expect(await verifyE2eSeamEdge(cookie)).toBeNull()
    vi.stubEnv('NODE_ENV', 'development')
    expect(await verifyE2eSeamEdge(cookie)).toBe(USER)
    vi.stubEnv('E2E_AUTH_SEAM_SECRET', '')
    expect(await verifyE2eSeamEdge(cookie)).toBeNull()
  })
})

describe('resolveE2eSeamIdentity (Node, database role)', () => {
  it('reads the role from the database: super_admin profile, else the staff_roles row', async () => {
    const cookie = await signE2eSeamCookie(USER)
    prismaMock.$queryRaw.mockResolvedValueOnce([{ role: 'super_admin', status: 'approved', email: 'o@x.kz', staff_role: null }])
    expect(await resolveE2eSeamIdentity(jar(cookie))).toEqual({ userId: USER, role: 'super_admin', email: 'o@x.kz' })
    prismaMock.$queryRaw.mockResolvedValueOnce([{ role: 'client', status: 'approved', email: null, staff_role: 'support' }])
    expect(await resolveE2eSeamIdentity(jar(cookie))).toEqual({ userId: USER, role: 'support', email: undefined })
  })

  it('refuses unapproved, role-less, unknown users and database errors', async () => {
    const cookie = await signE2eSeamCookie(USER)
    prismaMock.$queryRaw.mockResolvedValueOnce([{ role: 'super_admin', status: 'blocked', email: null, staff_role: 'super_admin' }])
    expect(await resolveE2eSeamIdentity(jar(cookie))).toBeNull()
    prismaMock.$queryRaw.mockResolvedValueOnce([{ role: 'client', status: 'approved', email: null, staff_role: 'not-a-role' }])
    expect(await resolveE2eSeamIdentity(jar(cookie))).toBeNull()
    prismaMock.$queryRaw.mockResolvedValueOnce([])
    expect(await resolveE2eSeamIdentity(jar(cookie))).toBeNull()
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('db down'))
    expect(await resolveE2eSeamIdentity(jar(cookie))).toBeNull()
  })

  it('never touches the database when the seam is off or the cookie is missing/forged', async () => {
    const cookie = await signE2eSeamCookie(USER)
    expect(await resolveE2eSeamIdentity(jar())).toBeNull()
    expect(await resolveE2eSeamIdentity(jar(`${USER}.${'A'.repeat(43)}`))).toBeNull()
    vi.stubEnv('NODE_ENV', 'production')
    expect(await resolveE2eSeamIdentity(jar(cookie))).toBeNull()
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })
})
