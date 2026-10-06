/**
 * Legacy /api/clients (NextAuth session): a session without an organisation
 * must not list or create clients. Prisma drops an `orgId: undefined` filter,
 * so before the fix such a session listed every organisation's clients.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({ user: {} as Record<string, unknown>, findMany: 0, create: 0 }))
vi.mock('@/lib/api-utils', () => ({ requireAuth: async () => ({ session: { user: s.user }, error: null }) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    client: {
      findMany: async () => { s.findMany++; return [] },
      count: async () => 0,
      create: async () => { s.create++; return { id: 'c1' } },
    },
  },
}))

import { GET, POST } from '@/app/api/clients/route'

beforeEach(() => { s.user = {}; s.findMany = 0; s.create = 0 })

describe('/api/clients organisation scope', () => {
  it('GET without orgId → 403 and no query', async () => {
    const res = await GET(new Request('http://x/api/clients'))
    expect(res.status).toBe(403)
    expect(s.findMany).toBe(0)
  })

  it('POST without orgId → 403 and nothing created', async () => {
    const res = await POST(new Request('http://x/api/clients', { method: 'POST', body: JSON.stringify({ name: 'ТОО Тест' }) }))
    expect(res.status).toBe(403)
    expect(s.create).toBe(0)
  })

  it('GET with an orgId still lists that organisation', async () => {
    s.user = { orgId: 'org-1' }
    const res = await GET(new Request('http://x/api/clients'))
    expect(res.status).toBe(200)
    expect(s.findMany).toBe(1)
  })
})
