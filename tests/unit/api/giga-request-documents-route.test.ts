/**
 * GET /api/giga-admin/requests/[id]/documents: a failed documents query is
 * reported as an error (500, ok:false) — never as «the client uploaded no
 * documents» (ok:true with an empty list).
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  error: null as { message: string; code?: string } | null,
}))

vi.mock('@/lib/admin/user-data-access', () => ({
  resolveRequestUserId: vi.fn(),
  authorizeUserDataRead: async () => ({
    viewer: 'staff-1',
    userId: 'client-1',
    sb: {
      from: () => {
        const q = {
          select: () => q,
          eq: () => q,
          order: () => Promise.resolve({ data: s.error ? null : s.rows, error: s.error }),
        }
        return q
      },
      storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://signed/x' } }) }) },
    },
  }),
}))

import { GET } from '@/app/api/giga-admin/requests/[id]/documents/route'

const call = async () => {
  const res = await GET(new NextRequest('http://localhost/api/giga-admin/requests/r1/documents'), { params: { id: 'r1' } })
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  s.rows = []
  s.error = null
})

describe('GET /api/giga-admin/requests/[id]/documents', () => {
  it('a database error is a 500, not an empty list', async () => {
    s.error = { message: 'column documents.storage_bucket does not exist', code: '42703' }
    const res = await call()
    expect(res.status).toBe(500)
    expect(res.body).toMatchObject({ ok: false, code: 'DB_ERROR' })
    expect(res.body.data).toBeUndefined()
    expect(JSON.stringify(res.body)).not.toContain('storage_bucket') // no raw DB text to the client
  })

  it('returns the client documents with signed links when the query succeeds', async () => {
    s.rows = [{ id: 'd1', user_id: 'client-1', file_name: 'a.pdf', file_url: null, storage_bucket: 'client-documents', storage_path: 'client-1/a.pdf' }]
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.data[0]).toMatchObject({ id: 'd1', download_url: 'https://signed/x' })
    expect(res.body.data[0].storage_path).toBeUndefined()
  })
})
