/** R-049 — the activity journal records the trusted client IP, not the client-typed XFF prefix. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const inserted: Array<Record<string, unknown>> = []
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({ insert: async (row: Record<string, unknown>) => { inserted.push(row); return { error: null } } }),
  }),
}))

import { logActivity } from '@/lib/activity/log'

beforeEach(() => { inserted.length = 0 })

describe('R-049 logActivity ip_address', () => {
  it('R-049: stores the address our proxy appended, not the spoofed leftmost one', async () => {
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' } })
    await logActivity({ userId: 'u1', action: 'login', req })
    expect(inserted[0].ip_address).toBe('203.0.113.7')
  })

  it('R-049: prefers X-Real-IP and drops garbage', async () => {
    await logActivity({ userId: 'u1', action: 'a', req: new Request('http://x', { headers: { 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '6.6.6.6' } }) })
    await logActivity({ userId: 'u1', action: 'b', req: new Request('http://x', { headers: { 'x-forwarded-for': '<script>' } }) })
    expect(inserted.map((r) => r.ip_address)).toEqual(['198.51.100.1', null])
  })
})
