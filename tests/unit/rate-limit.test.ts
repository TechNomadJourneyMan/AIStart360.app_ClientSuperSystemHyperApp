// Unit tests for lib/rate-limit isRateLimited — the in-memory fallback path
// (Upstash env is force-cleared below) and the `key` override the assistant
// routes use to throttle per-user instead of per-IP.

import { describe, expect, it, vi } from 'vitest'

// Force the in-memory limiter: the Upstash flag is computed at import time,
// so the env must be cleared BEFORE lib/rate-limit is first imported.
vi.hoisted(() => {
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
})

import { isRateLimited } from '@/lib/rate-limit'

function reqFromIp(ip: string) {
  return new Request('http://localhost/api/v1/assistant/ask', {
    headers: { 'x-forwarded-for': ip },
  })
}

describe('isRateLimited', () => {
  it('rejects the request after `max` hits for the same key', async () => {
    const req = reqFromIp('203.0.113.1')
    for (let i = 0; i < 10; i++) {
      expect(await isRateLimited(req, 'bucket-same-key', { max: 10, key: 'user-1' })).toBe(false)
    }
    expect(await isRateLimited(req, 'bucket-same-key', { max: 10, key: 'user-1' })).toBe(true)
  })

  it('isolates budgets per key even when requests share one IP', async () => {
    const req = reqFromIp('203.0.113.2')
    for (let i = 0; i < 10; i++) {
      await isRateLimited(req, 'bucket-per-key', { max: 10, key: 'user-a' })
    }
    expect(await isRateLimited(req, 'bucket-per-key', { max: 10, key: 'user-a' })).toBe(true)
    // Same IP, different user — must NOT inherit user-a's exhausted budget.
    expect(await isRateLimited(req, 'bucket-per-key', { max: 10, key: 'user-b' })).toBe(false)
  })

  it('falls back to the client IP when no key is given', async () => {
    for (let i = 0; i < 10; i++) {
      await isRateLimited(reqFromIp('203.0.113.3'), 'bucket-ip-fallback', { max: 10 })
    }
    expect(await isRateLimited(reqFromIp('203.0.113.3'), 'bucket-ip-fallback', { max: 10 })).toBe(true)
    // A different IP keeps its own budget.
    expect(await isRateLimited(reqFromIp('203.0.113.4'), 'bucket-ip-fallback', { max: 10 })).toBe(false)
  })

  it('falls back to the client IP when the key is empty', async () => {
    for (let i = 0; i < 10; i++) {
      await isRateLimited(reqFromIp('203.0.113.5'), 'bucket-empty-key', { max: 10, key: '' })
    }
    expect(
      await isRateLimited(reqFromIp('203.0.113.5'), 'bucket-empty-key', { max: 10, key: '' }),
    ).toBe(true)
  })
})
