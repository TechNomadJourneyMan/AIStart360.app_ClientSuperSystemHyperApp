/**
 * POST /api/v1/security/2fa/verify: enabling the factor and writing the gate
 * flag succeed together or not at all. A failed flag write used to leave
 * totp_enabled=true in user_security with no flag (middleware never gated).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  upserts: [] as Array<Record<string, unknown>>,
  flagFails: false,
  upsertFails: false,
  recordFails: false,
  cookie: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/api-identity', () => ({ getSessionUser: async () => ({ id: 'u-1' }) }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/crypto/secrets', () => ({ decryptSecret: () => 'SECRET' }))
vi.mock('@/lib/mfa/totp', () => ({ verifyTOTP: () => true }))
vi.mock('@/lib/mfa/backup-codes', () => ({ generateBackupCodes: () => ['a', 'b'], hashBackupCodes: async () => ['ha', 'hb'] }))
vi.mock('@/lib/mfa/step-up', () => ({ MFA_COOKIE_NAME: 'mfa', MFA_COOKIE_OPTIONS: {}, signStepUp: () => 'signed', currentStepUpSessionKey: () => 'session-1' }))
// SR-01 (143): the record + cookie (lib/mfa/step-up-session.ts has its own tests).
vi.mock('@/lib/mfa/step-up-session', () => ({
  STEP_UP_RECORD_FAILED_MESSAGE: 'record failed',
  issueStepUp: async (jar: { set: (n: string, v: string, o: unknown) => void }) => {
    if (h.recordFails) throw new Error('step-up record: store_failed')
    jar.set('mfa', 'signed', {})
  },
}))
// First enrolment of an account without factors (R-003 rules: tests/unit/api/security-factor-stepup.test.ts).
vi.mock('@/lib/mfa/factor-guard', () => ({ guardFactorChange: async () => ({ ok: true, firstFactor: true, state: { totp: false, passkeys: 0, backupCodes: 0 } }) }))
vi.mock('@/lib/activity/log', () => ({ logActivity: async () => undefined }))
vi.mock('@/lib/notifications/create', () => ({ createNotification: async () => undefined }))
vi.mock('next/headers', () => ({ cookies: async () => ({ set: h.cookie }) }))
vi.mock('@/lib/mfa/store', () => ({
  getUserSecurity: async () => h.row,
  upsertUserSecurity: async (_id: string, patch: Record<string, unknown>) => {
    if (h.upsertFails) throw new Error('mfa store: user_security upsert failed (500)')
    h.upserts.push(patch)
    h.row = { ...h.row, ...patch }
  },
  setMfaMetadataFlag: async () => { if (h.flagFails) throw new Error('mfa store: mfa_totp flag failed (500)') },
}))

const { POST } = await import('@/app/api/v1/security/2fa/verify/route')
const verify = () => POST(new Request('http://x/api/v1/security/2fa/verify', { method: 'POST', body: JSON.stringify({ code: '123456' }) }))

beforeEach(() => {
  h.row = { user_id: 'u-1', totp_enabled: false, totp_secret_enc: null, totp_pending_enc: 'enc-pending', backup_codes: [] }
  h.upserts = []
  h.flagFails = false
  h.upsertFails = false
  h.recordFails = false
  h.cookie.mockClear()
})

describe('POST /api/v1/security/2fa/verify', () => {
  it('enables the factor, writes the flag and issues backup codes', async () => {
    const res = await verify()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, backup_codes: ['a', 'b'] })
    expect(h.row).toMatchObject({ totp_enabled: true, totp_secret_enc: 'enc-pending', totp_pending_enc: null })
    expect(h.cookie).toHaveBeenCalled()
  })

  it('a failed flag write rolls user_security back to the pending state; no step-up cookie', async () => {
    h.flagFails = true
    const res = await verify()
    expect(res.status).toBe(500)
    expect(h.row).toMatchObject({ totp_enabled: false, totp_secret_enc: null, totp_pending_enc: 'enc-pending', backup_codes: [] })
    expect(h.cookie).not.toHaveBeenCalled()
  })

  it('SR-01: the step-up record fails → 2FA is on, but no step-up cookie; the user is told to confirm once more', async () => {
    h.recordFails = true
    const res = await verify()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, backup_codes: ['a', 'b'], step_up: false, notice: expect.stringContaining('record failed') })
    expect(h.row).toMatchObject({ totp_enabled: true })
    expect(h.cookie).not.toHaveBeenCalled()
  })

  it('a failed DB write is a 500 and the flag is never set', async () => {
    h.upsertFails = true
    const res = await verify()
    expect(res.status).toBe(500)
    expect(h.cookie).not.toHaveBeenCalled()
  })
})
