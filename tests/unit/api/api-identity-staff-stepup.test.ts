/**
 * R-005: /api/v1/* granted staff rights (act on another user's data) from
 * profiles.role alone. Middleware gates pages only, so a staff session that
 * never passed its second factor (a stolen password) could read and change
 * clients' data through the API. lib/api-identity.ts is the one place every
 * such route asks «is the caller staff?» (getSessionRole / isStaffRole,
 * resolveTargetUserId): it now admits staff rights only with the step-up of
 * THIS session — the same rule as the GIGA and expert API (staffMfaGate).
 * Clients are unaffected (no extra reads, same answers).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const SESSION = '11111111-1111-4111-8111-111111111111'
const s = vi.hoisted(() => ({
  role: 'expert' as string | null,
  status: 'approved',
  staff: null as null | { role: string; client_scope?: string },
  assigned: true,
  appMeta: {} as Record<string, unknown>,
  mfa: undefined as string | undefined,
  totpInDb: false,
  passkeysInDb: 0,
  dbDown: false,
  settings: { maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: false },
  getUser: 0,
}))

vi.mock('next/headers', () => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const token = `${b64({ alg: 'HS256' })}.${b64({ sub: 'u-1', session_id: '11111111-1111-4111-8111-111111111111' })}.sig`
  const auth = { name: 'sb-supabase-auth-token', value: `base64-${b64({ access_token: token })}` }
  const all = () => [auth, ...(s.mfa ? [{ name: 'aistart360_mfa', value: s.mfa }] : [])]
  return {
    cookies: () => ({ getAll: all, get: (n: string) => all().find((c) => c.name === n) }),
    headers: () => new Headers({ host: 'portal.example' }),
  }
})
vi.mock('@/lib/settings/edge', () => ({ edgeSettings: async () => s.settings }))

process.env.AUTH_SECRET = 'test-auth-secret-for-step-up'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.app'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'

const { getSessionRole, isStaffRole, resolveTargetUserId } = await import('@/lib/api-identity')
const { signStepUp } = await import('@/lib/mfa/step-up')

const sb = {
  auth: {
    getUser: async () => {
      s.getUser++
      return { data: { user: { id: 'u-1', app_metadata: s.appMeta, user_metadata: {} } } }
    },
  },
  from: () => {
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = () => b
    b.maybeSingle = async () => ({ data: s.role ? { role: s.role } : null, error: null })
    return b
  },
} as never

beforeEach(() => {
  s.role = 'expert'
  s.status = 'approved'
  s.staff = null
  s.assigned = true
  s.appMeta = {}
  s.mfa = undefined
  s.totpInDb = false
  s.passkeysInDb = 0
  s.dbDown = false
  s.settings = { maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: false }
  s.getUser = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (s.dbDown) return new Response('down', { status: 503 })
    if (String(url).includes('/user_security')) return new Response(JSON.stringify(s.totpInDb ? [{ totp_enabled: true }] : []))
    if (String(url).includes('/webauthn_credentials')) return new Response(JSON.stringify(Array.from({ length: s.passkeysInDb }, () => ({ user_id: 'u-1' }))))
    // lib/access/actor.ts (migration 140 rule): profile, staff_roles, user_assignments.
    if (String(url).includes('/profiles')) return new Response(JSON.stringify(s.role ? [{ role: s.role, status: s.status }] : []))
    if (String(url).includes('/staff_roles')) return new Response(JSON.stringify(s.staff ? [s.staff] : []))
    if (String(url).includes('/user_assignments')) return new Response(JSON.stringify(s.assigned ? [{ user_id: OTHER }] : []))
    return new Response('[]')
  }))
})

const OTHER = '99999999-9999-4999-8999-999999999999'

describe('R-005: staff rights on /api/v1 need the second factor of this session', () => {
  it('R-005: an enrolled expert without step-up gets no staff rights', async () => {
    s.appMeta = { mfa_totp: true }
    expect(isStaffRole(await getSessionRole(sb, 'u-1'))).toBe(false)
    expect(await resolveTargetUserId(sb, OTHER)).toEqual({ error: 'forbidden' })
    // Own data stays reachable.
    expect(await resolveTargetUserId(sb, 'u-1')).toEqual({ userId: 'u-1' })
  })

  it('R-005: enrolment is read from the database too (JWT flags can lag)', async () => {
    s.passkeysInDb = 1
    expect(await getSessionRole(sb, 'u-1')).toBeNull()
    s.passkeysInDb = 0
    s.totpInDb = true
    expect(await getSessionRole(sb, 'u-1')).toBeNull()
  })

  it('R-005: the proof of THIS session admits; another session\'s does not', async () => {
    s.appMeta = { mfa_webauthn: true }
    s.mfa = signStepUp('u-1', '22222222-2222-4222-8222-222222222222')
    expect(await getSessionRole(sb, 'u-1')).toBeNull()
    s.mfa = signStepUp('u-1', SESSION)
    expect(await getSessionRole(sb, 'u-1')).toBe('expert')
    expect(await resolveTargetUserId(sb, OTHER)).toEqual({ userId: OTHER })
  })

  it('R-005: staff without 2FA keep working unless the platform requires it', async () => {
    expect(await getSessionRole(sb, 'u-1')).toBe('expert')
    s.settings.staff_require_mfa = true
    expect(await getSessionRole(sb, 'u-1')).toBeNull()
  })

  it('R-005: fails closed when the MFA state cannot be read', async () => {
    s.dbDown = true
    expect(await getSessionRole(sb, 'u-1')).toBeNull()
  })

  it('SR-02: the legacy profile role is not staff; a non-approved expert is nobody', async () => {
    for (const role of ['admin', 'super_admin', 'manager', 'analyst']) {
      s.role = role
      expect(await getSessionRole(sb, 'u-1')).toBeNull()
      expect(await resolveTargetUserId(sb, OTHER)).toEqual({ error: 'forbidden' })
    }
    s.role = 'expert'
    s.status = 'rejected'
    expect(await getSessionRole(sb, 'u-1')).toBeNull()
    expect(await resolveTargetUserId(sb, OTHER)).toEqual({ error: 'forbidden' })
  })

  it('SR-02: an expert acts only for assigned clients; a staff admin (staff_roles) for any', async () => {
    expect(await resolveTargetUserId(sb, OTHER)).toEqual({ userId: OTHER })
    s.assigned = false
    expect(await resolveTargetUserId(sb, OTHER)).toEqual({ error: 'forbidden' })
    s.role = 'client'
    s.staff = { role: 'admin', client_scope: 'all' }
    expect(await resolveTargetUserId(sb, OTHER)).toEqual({ userId: OTHER })
    s.staff = { role: 'super_expert', client_scope: 'assigned' }
    expect(await resolveTargetUserId(sb, OTHER)).toEqual({ error: 'forbidden' })
    s.staff = { role: 'analyst', client_scope: 'all' }
    expect(await resolveTargetUserId(sb, OTHER)).toEqual({ error: 'forbidden' })
  })

  it('R-005: clients are unaffected — same role, no extra Auth round trip', async () => {
    s.role = 'client'
    s.appMeta = { mfa_totp: true }
    expect(await getSessionRole(sb, 'u-1')).toBe('client')
    expect(await resolveTargetUserId(sb, 'u-1')).toEqual({ userId: 'u-1' })
    expect(await resolveTargetUserId(sb, OTHER)).toEqual({ error: 'forbidden' })
    expect(s.getUser).toBe(2) // resolveTargetUserId's own getSessionUser calls only
  })
})
