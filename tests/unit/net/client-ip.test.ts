/**
 * R-049 — trusted client IP. The first X-Forwarded-For entry is whatever the
 * client typed; only X-Real-IP (set by the Railway / Vercel edge) and the
 * entries appended by our own trusted proxies count.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientIpFromHeaders, normalizeIp, trustedProxyHops } from '@/lib/net/client-ip'

const h = (init: Record<string, string>) => new Headers(init)

afterEach(() => vi.unstubAllEnvs())

describe('R-049 clientIpFromHeaders', () => {
  it('R-049: a spoofed leftmost X-Forwarded-For entry is ignored (rightmost trusted hop wins)', () => {
    expect(clientIpFromHeaders(h({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('R-049: X-Real-IP (set by the edge) wins over X-Forwarded-For', () => {
    expect(clientIpFromHeaders(h({ 'x-real-ip': '198.51.100.9', 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }))).toBe('198.51.100.9')
  })

  it('R-049: TRUSTED_PROXY_HOPS=2 takes the second entry from the right', () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', '2')
    expect(clientIpFromHeaders(h({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7, 10.0.0.2' }))).toBe('203.0.113.7')
  })

  it('R-049: fewer entries than hops → the leftmost one (nothing else to take)', () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', '3')
    expect(clientIpFromHeaders(h({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('R-049: TRUSTED_PROXY_HOPS=0 trusts no forwarding header at all', () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', '0')
    expect(clientIpFromHeaders(h({ 'x-real-ip': '198.51.100.9', 'x-forwarded-for': '203.0.113.7' }))).toBeNull()
  })

  it('R-049: garbage, over-long and multi-value X-Real-IP fall back to XFF', () => {
    expect(clientIpFromHeaders(h({ 'x-real-ip': 'evil', 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(clientIpFromHeaders(h({ 'x-real-ip': '1.2.3.4, 5.6.7.8', 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(clientIpFromHeaders(h({ 'x-forwarded-for': 'not-an-ip' }))).toBeNull()
    expect(clientIpFromHeaders(h({}))).toBeNull()
  })

  it('R-049: ports, brackets and zone ids are stripped', () => {
    expect(normalizeIp(' 203.0.113.7:51234 ')).toBe('203.0.113.7')
    expect(normalizeIp('[2a02:6b8::feed:ff]:443')).toBe('2a02:6b8::feed:ff')
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1')
    expect(normalizeIp('2A02:6B8::2:242')).toBe('2a02:6b8::2:242')
    expect(normalizeIp('256.1.1.1')).toBeNull()
    expect(normalizeIp('1.2.3')).toBeNull()
    expect(normalizeIp('x'.repeat(100))).toBeNull()
  })

  it('R-049: invalid TRUSTED_PROXY_HOPS falls back to 1', () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', 'abc')
    expect(trustedProxyHops()).toBe(1)
    vi.stubEnv('TRUSTED_PROXY_HOPS', '-2')
    expect(trustedProxyHops()).toBe(1)
    vi.stubEnv('TRUSTED_PROXY_HOPS', '99')
    expect(trustedProxyHops()).toBe(10)
  })
})
