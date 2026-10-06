/**
 * lib/mfa/store.ts: supabase-js returns `{ error }` instead of throwing. An
 * ignored GoTrue / PostgREST failure used to let a route report "2FA enabled"
 * without the gate flag, or an admin reset that left the user locked out.
 * Every write now throws so the route answers 5xx.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  updateError: null as null | { message: string; status?: number },
  upsertError: null as null | { message: string; code?: string },
  deleteError: null as null | { message: string; code?: string },
  readError: null as null | { message: string; code?: string },
  calls: [] as string[],
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      upsert: async () => { s.calls.push(`upsert:${table}`); return { error: s.upsertError } },
      delete: () => ({ eq: async () => { s.calls.push(`delete:${table}`); return { error: s.deleteError } } }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: s.readError }) }) }),
    }),
    auth: {
      admin: {
        updateUserById: async () => { s.calls.push('updateUserById'); return { data: { user: null }, error: s.updateError } },
      },
    },
  }),
}))

import { adminResetUserMfa, getUserSecurity, setMfaMetadataFlag, setMfaWebauthnFlag, upsertUserSecurity } from '@/lib/mfa/store'

beforeEach(() => {
  s.updateError = null
  s.upsertError = null
  s.deleteError = null
  s.readError = null
  s.calls = []
})

describe('MFA store surfaces write failures', () => {
  it('setMfaMetadataFlag / setMfaWebauthnFlag throw when GoTrue returns an error', async () => {
    s.updateError = { message: 'rate limited', status: 429 }
    await expect(setMfaMetadataFlag('u1', true)).rejects.toThrow(/mfa_totp flag/)
    await expect(setMfaWebauthnFlag('u1', false)).rejects.toThrow(/mfa_webauthn flag/)
  })

  it('adminResetUserMfa throws when clearing the gate flags fails (the reset is not done)', async () => {
    s.updateError = { message: 'boom', status: 500 }
    await expect(adminResetUserMfa('u1')).rejects.toThrow(/mfa flags reset/)
  })

  it('adminResetUserMfa stops at the first failed step', async () => {
    s.upsertError = { message: 'timeout', code: '57014' }
    await expect(adminResetUserMfa('u1')).rejects.toThrow(/user_security reset/)
    expect(s.calls).toEqual(['upsert:user_security'])
  })

  it('upsertUserSecurity and getUserSecurity throw on PostgREST errors', async () => {
    s.upsertError = { message: 'timeout', code: '57014' }
    await expect(upsertUserSecurity('u1', { totp_enabled: true })).rejects.toThrow(/upsert/)
    s.readError = { message: 'timeout', code: '57014' }
    await expect(getUserSecurity('u1')).rejects.toThrow(/read/)
  })

  it('succeeds quietly when every call succeeds', async () => {
    await expect(setMfaMetadataFlag('u1', true)).resolves.toBeUndefined()
    await expect(adminResetUserMfa('u1')).resolves.toBeUndefined()
    expect(s.calls).toEqual(['updateUserById', 'upsert:user_security', 'delete:webauthn_credentials', 'updateUserById'])
    await expect(getUserSecurity('u1')).resolves.toBeNull()
  })
})
