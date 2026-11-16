import { describe, it, expect, vi, beforeEach } from 'vitest'

const cfg = vi.hoisted(() => ({ value: undefined as any, error: null as any, throwIt: false }))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => {
    if (cfg.throwIt) throw new Error('no service key')
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: cfg.value === undefined ? null : { value: cfg.value }, error: cfg.error }),
          }),
        }),
        upsert: () => Promise.resolve({ error: cfg.error }),
      }),
    }
  },
}))

import { getRegistrationMode, setRegistrationMode, isRegistrationMode, __resetRegistrationModeCacheForTests } from '@/lib/settings/system-settings'

describe('registration mode settings (no row → approval; a read error → closed, R4 B3 review W3A-3)', () => {
  beforeEach(() => {
    cfg.value = undefined
    cfg.error = null
    cfg.throwIt = false
    __resetRegistrationModeCacheForTests()
  })

  it('defaults to approval when no row exists', async () => {
    expect(await getRegistrationMode()).toBe('approval')
  })

  it('returns the stored mode when valid', async () => {
    cfg.value = 'open'
    expect(await getRegistrationMode()).toBe('open')
  })

  it('falls back to approval for a malformed stored value', async () => {
    cfg.value = 'weird'
    expect(await getRegistrationMode()).toBe('approval')
  })

  // R4 B3 (review W3A-3): every caller creates accounts or shows sign-up / the
  // demo — a failed read used to open all of it on prod in 'invite' mode.
  it('a query error is closed: invite (no last known mode)', async () => {
    cfg.error = { message: 'sorry, too many clients already' }
    expect(await getRegistrationMode()).toBe('invite')
  })

  it('a throwing service client (no key) is closed too: invite', async () => {
    cfg.throwIt = true
    expect(await getRegistrationMode()).toBe('invite')
  })

  it('a failed read right after a good one keeps the mode just read', async () => {
    cfg.value = 'open'
    expect(await getRegistrationMode()).toBe('open')
    cfg.error = { message: 'timeout' }
    expect(await getRegistrationMode()).toBe('open')
  })

  it('rejects an invalid mode on write', async () => {
    await expect(setRegistrationMode('nope' as any)).rejects.toThrow()
  })

  it('accepts a valid mode on write', async () => {
    await expect(setRegistrationMode('invite')).resolves.toBeUndefined()
  })

  it('isRegistrationMode guards values', () => {
    expect(isRegistrationMode('open')).toBe(true)
    expect(isRegistrationMode('approval')).toBe(true)
    expect(isRegistrationMode('invite')).toBe(true)
    expect(isRegistrationMode('x')).toBe(false)
    expect(isRegistrationMode(null)).toBe(false)
  })
})
