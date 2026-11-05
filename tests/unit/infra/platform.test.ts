/**
 * Which runtime we are on. Vercel kills a function once it answered, so it needs waitUntil; on a
 * long-lived server (Railway: `next start`, PERSISTENT_SERVER=1) the same after-response work simply
 * keeps running. Without either flag (tests, local dev) nothing is started behind the response.
 */
import { describe, expect, it } from 'vitest'
import { canRunAfterResponse, isPersistentServer } from '@/lib/runtime/platform'

describe('canRunAfterResponse', () => {
  it('is true on Vercel', () => {
    expect(canRunAfterResponse({ VERCEL: '1' })).toBe(true)
  })

  it('is true on a persistent server', () => {
    expect(canRunAfterResponse({ PERSISTENT_SERVER: '1' })).toBe(true)
  })

  it('is false without a flag (tests, local dev)', () => {
    expect(canRunAfterResponse({})).toBe(false)
  })

  it('is false when the persistent-server flag is not exactly "1"', () => {
    expect(canRunAfterResponse({ PERSISTENT_SERVER: '0' })).toBe(false)
    expect(canRunAfterResponse({ PERSISTENT_SERVER: 'true' })).toBe(false)
  })
})

describe('isPersistentServer', () => {
  it('is true only for PERSISTENT_SERVER=1', () => {
    expect(isPersistentServer({ PERSISTENT_SERVER: '1' })).toBe(true)
    expect(isPersistentServer({ PERSISTENT_SERVER: '0' })).toBe(false)
    expect(isPersistentServer({ VERCEL: '1' })).toBe(false)
    expect(isPersistentServer({})).toBe(false)
  })

  it('reads process.env by default', () => {
    const before = process.env.PERSISTENT_SERVER
    try {
      process.env.PERSISTENT_SERVER = '1'
      expect(isPersistentServer()).toBe(true)
      delete process.env.PERSISTENT_SERVER
      expect(isPersistentServer()).toBe(false)
    } finally {
      if (before === undefined) delete process.env.PERSISTENT_SERVER
      else process.env.PERSISTENT_SERVER = before
    }
  })
})
