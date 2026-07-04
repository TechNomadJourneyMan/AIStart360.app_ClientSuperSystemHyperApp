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

import { getRegistrationMode, setRegistrationMode, isRegistrationMode } from '@/lib/settings/system-settings'

describe('registration mode settings (fail-safe)', () => {
  beforeEach(() => {
    cfg.value = undefined
    cfg.error = null
    cfg.throwIt = false
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

  it('falls back to approval on a query error (e.g. table not migrated)', async () => {
    cfg.error = { message: 'relation "system_settings" does not exist' }
    expect(await getRegistrationMode()).toBe('approval')
  })

  it('falls back to approval when the service client throws (no key)', async () => {
    cfg.throwIt = true
    expect(await getRegistrationMode()).toBe('approval')
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
