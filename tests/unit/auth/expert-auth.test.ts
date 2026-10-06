/**
 * requireExpert (lib/expert-auth.ts): experts are platform staff (D1), so the
 * expert portal API applies the same rules as GIGA — an approved profile and
 * the second factor (staffMfaGate). Before, any session whose profiles.role was
 * expert/admin/super_admin passed, without status or step-up checks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> },
  profile: null as null | { id: string; role: string; status: string },
  profileHttpStatus: 200,
  mfaCookie: undefined as string | undefined,
  security: null as null | { totp_enabled?: boolean },
  securityError: null as null | { message: string },
  passkeys: 0,
  settings: { staff_require_mfa: false } as Record<string, boolean>,
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: s.user } }) } }),
}))
vi.mock('next/headers', () => ({
  cookies: () => ({ get: (name: string) => (name === 'aistart360_mfa' && s.mfaCookie ? { value: s.mfaCookie } : undefined) }),
}))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: string) =>
      table === 'webauthn_credentials'
        ? { select: () => ({ eq: async () => ({ count: s.passkeys, error: null }) }) }
        : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: s.security, error: s.securityError }) }) }) },
  }),
}))
vi.mock('@/lib/settings/store', () => ({ getSetting: async (k: string) => s.settings[k] ?? false }))

import { requireExpert, resolveExpert } from '@/lib/expert-auth'
import { MFA_COOKIE_NAME, signStepUp } from '@/lib/mfa/step-up'

process.env.AUTH_SECRET = 'test-auth-secret-for-step-up'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.example'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'

const fetchMock = vi.fn(async () =>
  new Response(JSON.stringify(s.profile ? [s.profile] : []), { status: s.profileHttpStatus }),
)

beforeEach(() => {
  s.user = { id: 'e-1', email: 'e@x.kz', app_metadata: {}, user_metadata: {} }
  s.profile = { id: 'e-1', role: 'expert', status: 'approved' }
  s.profileHttpStatus = 200
  s.mfaCookie = undefined
  s.security = null
  s.securityError = null
  s.passkeys = 0
  s.settings = { staff_require_mfa: false }
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('requireExpert', () => {
  it('admits an approved expert without a second factor (platform does not require one)', async () => {
    expect(await requireExpert()).toEqual({ id: 'e-1', role: 'expert', email: 'e@x.kz' })
    expect(MFA_COOKIE_NAME).toBe('aistart360_mfa')
  })

  it.each(['pending_approval', 'rejected', 'blocked', 'archived'])('refuses an expert whose status is %s', async (status) => {
    s.profile = { id: 'e-1', role: 'expert', status }
    expect(await requireExpert()).toBeNull()
    expect(await resolveExpert()).toEqual({ ok: false, block: 'forbidden' })
  })

  it('refuses an enrolled super_admin session without the step-up cookie', async () => {
    s.profile = { id: 'e-1', role: 'super_admin', status: 'approved' }
    s.user!.app_metadata = { mfa_totp: true }
    expect(await requireExpert()).toBeNull()
    expect(await resolveExpert()).toEqual({ ok: false, block: 'step_up' })
  })

  it('reads enrolment from the database, not only the JWT flags', async () => {
    s.security = { totp_enabled: true }
    expect(await resolveExpert()).toEqual({ ok: false, block: 'step_up' })
    s.security = null
    s.passkeys = 1
    expect(await resolveExpert()).toEqual({ ok: false, block: 'step_up' })
  })

  it('admits the session with the step-up cookie of the same user only', async () => {
    s.user!.app_metadata = { mfa_totp: true }
    s.mfaCookie = signStepUp('someone-else')
    expect(await requireExpert()).toBeNull()
    s.mfaCookie = signStepUp('e-1')
    expect(await requireExpert()).toMatchObject({ id: 'e-1' })
  })

  it('asks a non-enrolled expert to enrol when the platform requires 2FA for staff', async () => {
    s.settings.staff_require_mfa = true
    expect(await resolveExpert()).toEqual({ ok: false, block: 'enroll' })
  })

  it('fails closed when the MFA state or the profile cannot be read', async () => {
    s.securityError = { message: 'timeout' }
    expect(await resolveExpert()).toEqual({ ok: false, block: 'unavailable' })
    s.securityError = null
    s.profileHttpStatus = 500
    expect(await resolveExpert()).toEqual({ ok: false, block: 'unavailable' })
  })

  it('refuses non-staff roles and anonymous callers', async () => {
    s.profile = { id: 'e-1', role: 'client', status: 'approved' }
    expect(await requireExpert()).toBeNull()
    s.user = null
    expect(await resolveExpert()).toEqual({ ok: false, block: 'unauthenticated' })
  })
})
