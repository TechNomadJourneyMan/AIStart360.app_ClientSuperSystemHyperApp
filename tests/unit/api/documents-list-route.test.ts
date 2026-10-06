/**
 * GET /api/v1/onboarding/documents is polled every 5 s while a document is in
 * flight: it selects the ClientDocument columns (not '*'), is limited, and
 * ships parsed_data without its row arrays (the row count stays in stats).
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  rows: [] as Array<Record<string, unknown>>,
  error: null as { message: string; code?: string } | null,
  select: '' as string,
  limit: null as number | null,
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: s.user } }) },
    from: () => {
      const q = {
        select: (cols: string) => { s.select = cols; return q },
        eq: () => q,
        order: () => q,
        limit: (n: number) => { s.limit = n; return q },
        then: (resolve: (v: unknown) => unknown) => resolve({ data: s.error ? null : s.rows, error: s.error }),
      }
      return q
    },
  }),
}))
vi.mock('@/lib/documents/finalize-http', () => ({ handleDocumentFinalize: vi.fn() }))

import { GET } from '@/app/api/v1/onboarding/documents/route'

const req = () => new NextRequest('http://localhost/api/v1/onboarding/documents')

beforeEach(() => {
  s.user = { id: 'user-1' }
  s.error = null
  s.select = ''
  s.limit = null
  const rawRows = Array.from({ length: 5_000 }, (_, i) => ({ client_id: `c${i}`, amount: 1000 + i, occurred_at: '2025-03-05T00:00:00.000Z' }))
  s.rows = [{
    id: 'd1', file_name: 'sales.csv', doc_type: 'sales_report', parse_status: 'parsed',
    parsed_data: {
      schema_version: 2, summary: 'Распознано строк продаж: 5000.', fields: [{ key: 'revenue', value: 1 }],
      warnings: ['w'], coverage: { partial: false }, raw_rows: rawRows,
      unverified_rows: [{ client_id: 'x', amount: 1, occurred_at: '2025-01-01' }],
    },
  }, {
    id: 'd2', file_name: 'old.pdf', doc_type: 'pl_report', parse_status: 'parsed',
    parsed_data: { summary: 'old', fields: [], client_rows: [{ client_id: 'a' }, { client_id: 'b' }] },
  }]
})

describe('GET /api/v1/onboarding/documents', () => {
  it('selects explicit columns with a limit and drops the row arrays, keeping the row count', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(s.select).not.toBe('*')
    expect(s.select).toContain('parsed_data')
    expect(s.select).toContain('processing_stage')
    expect(s.limit).toBeGreaterThan(0)
    const body = await res.json()
    const [d1, d2] = body.data
    expect(d1.parsed_data.raw_rows).toBeUndefined()
    expect(d1.parsed_data.unverified_rows).toBeUndefined()
    expect(d1.parsed_data).toMatchObject({ summary: 'Распознано строк продаж: 5000.', fields: [{ key: 'revenue', value: 1 }], warnings: ['w'], stats: { row_count: 5000 } })
    expect(d2.parsed_data.client_rows).toBeUndefined()
    expect(d2.parsed_data.stats).toEqual({ row_count: 2 })
    expect(JSON.stringify(body).length).toBeLessThan(5_000)
  })

  it('a database error is an error, not an empty list', async () => {
    s.error = { message: 'boom', code: '42P01' }
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect((await res.json()).ok).toBe(false)
  })
})
