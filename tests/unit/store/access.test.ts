import { afterEach, describe, expect, it, vi } from 'vitest'
import { signStepUp } from '@/lib/mfa/step-up'
import { hasStoreMfaStepUp, resolveStoreAccess } from '@/lib/store/access'

function clientWithProfile(
  data: { role?: unknown; status?: unknown } | null,
  error: unknown = null,
) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return {
    client: { from } as never,
    from,
    select,
    eq,
    maybeSingle,
  }
}

describe('resolveStoreAccess', () => {
  it.each([
    ['client', 'approved'],
    ['admin', null],
    ['admin', 'active'],
    ['super_admin', 'approved'],
  ])('allows %s with status %s', async (role, status) => {
    const mock = clientWithProfile({ role, status })
    await expect(resolveStoreAccess(mock.client, 'user-1')).resolves.toBe('allowed')
    expect(mock.from).toHaveBeenCalledWith('profiles')
    expect(mock.select).toHaveBeenCalledWith('role, status')
    expect(mock.eq).toHaveBeenCalledWith('id', 'user-1')
  })

  it.each([
    ['client', 'pending_approval'],
    ['client', 'rejected'],
    ['expert', 'approved'],
    ['owner', 'approved'],
    ['manager', 'approved'],
    ['admin', 'blocked'],
    ['super_admin', 'archived'],
  ])('denies %s with status %s', async (role, status) => {
    const mock = clientWithProfile({ role, status })
    await expect(resolveStoreAccess(mock.client, 'user-1')).resolves.toBe('forbidden')
  })

  it('fails closed for a missing profile and distinguishes a database failure', async () => {
    await expect(resolveStoreAccess(clientWithProfile(null).client, 'user-1'))
      .resolves.toBe('forbidden')
    await expect(resolveStoreAccess(clientWithProfile(null, new Error('offline')).client, 'user-1'))
      .resolves.toBe('unavailable')
  })
})

describe('hasStoreMfaStepUp', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('allows users who have not enrolled a second factor', () => {
    expect(hasStoreMfaStepUp({ id: 'user-1', user_metadata: {} }, null)).toBe(true)
  })

  it('requires a valid, unexpired token bound to the enrolled user', () => {
    vi.stubEnv('AUTH_SECRET', 'store-api-mfa-test-secret')
    const user = { id: 'user-1', user_metadata: { mfa_totp: true } }

    expect(hasStoreMfaStepUp(user, signStepUp('user-1', 60_000))).toBe(true)
    expect(hasStoreMfaStepUp(user, signStepUp('user-2', 60_000))).toBe(false)
    expect(hasStoreMfaStepUp(user, signStepUp('user-1', -1))).toBe(false)
    expect(hasStoreMfaStepUp(user, 'invalid')).toBe(false)
    expect(hasStoreMfaStepUp(user, null)).toBe(false)
  })

  it('also enforces step-up for an enrolled passkey', () => {
    vi.stubEnv('AUTH_SECRET', 'store-api-mfa-test-secret')
    const user = { id: 'user-1', user_metadata: { mfa_webauthn: true } }
    expect(hasStoreMfaStepUp(user, null)).toBe(false)
  })
})
