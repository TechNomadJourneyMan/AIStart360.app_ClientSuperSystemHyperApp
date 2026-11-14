/**
 * W → I1: POST /api/giga-admin/requests.
 *   • admin_requests is a Prisma table: the timestamps are "createdAt" / "updatedAt" (the old created_at /
 *     updated_at made every POST a 500, as in client/register before R-053);
 *   • the body goes through Zod (R-149): type / priority are the Prisma enums, unknown keys (status, userId…)
 *     are refused with 400 before any write; defaults as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>
const h = vi.hoisted(() => ({ inserts: [] as Row[], guard: null as unknown }))

vi.mock('@/lib/admin/giga-actor', () => ({ requireGiga: async () => h.guard }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      insert: async (row: Row) => {
        h.inserts.push({ table, ...row })
        return { error: null }
      },
    }),
  }),
}))

const { POST } = await import('@/app/api/giga-admin/requests/route')

const post = async (body: unknown, raw = false) => {
  const res = await POST(new NextRequest('http://localhost/api/giga-admin/requests', {
    method: 'POST', body: raw ? (body as string) : JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  h.inserts = []
  h.guard = { actor: { id: 'staff-1', role: 'admin' }, response: null }
})

describe('POST /api/giga-admin/requests', () => {
  it('writes the Prisma camelCase timestamps, never created_at / updated_at', async () => {
    const { status } = await post({ type: 'support', priority: 'high', payload: { note: 'x' } })
    expect(status).toBe(201)
    const row = h.inserts[0]
    expect(row.table).toBe('admin_requests')
    expect(typeof row.createdAt).toBe('string')
    expect(typeof row.updatedAt).toBe('string')
    expect(row).not.toHaveProperty('created_at')
    expect(row).not.toHaveProperty('updated_at')
    expect(row).toMatchObject({ type: 'support', priority: 'high', status: 'new', source: 'manual', payload: { note: 'x' } })
  })

  it('an empty body keeps the old defaults', async () => {
    expect((await post({})).status).toBe(201)
    expect(h.inserts[0]).toMatchObject({ type: 'registration', priority: 'medium', source: 'manual', payload: {} })
  })

  it.each([
    [{ type: 'hack' }],
    [{ priority: 'urgent' }],
    [{ status: 'approved' }],
    [{ payload: 'text' }],
  ])('a wrong body %j is a 400 invalid_body with no write', async (body) => {
    const { status, body: json } = await post(body)
    expect(status).toBe(400)
    expect(json.code).toBe('invalid_body')
    expect(h.inserts).toHaveLength(0)
  })

  it('not JSON → 400', async () => {
    expect((await post('{', true)).status).toBe(400)
  })

  it('the GIGA guard answers first', async () => {
    h.guard = { response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) }
    expect((await post({})).status).toBe(403)
    expect(h.inserts).toHaveLength(0)
  })
})
