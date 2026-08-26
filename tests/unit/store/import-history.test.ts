import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { loadStoreImportHistory } from '@/lib/store/import/history'

type QueryResult = { data: unknown; error: unknown }

function query(result: QueryResult) {
  const terminal = Promise.resolve(result)
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: terminal.then.bind(terminal),
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.in.mockReturnValue(chain)
  chain.is.mockReturnValue(chain)
  chain.order.mockReturnValue(chain)
  chain.limit.mockReturnValue(chain)
  return chain
}

function client(results: Partial<Record<string, QueryResult>>) {
  const queries = new Map<string, ReturnType<typeof query>>()
  const from = vi.fn((table: string) => {
    const tableQuery = query(results[table] ?? { data: null, error: { message: 'missing table' } })
    queries.set(table, tableQuery)
    return tableQuery
  })
  return {
    supabase: { from } as unknown as SupabaseClient,
    calls: { from, queries },
  }
}

const operationalRow = {
  id: 'run-1',
  import_kind: 'sales',
  scope_key: 'month:2026-07',
  source_sha256: 'a'.repeat(64),
  status: 'published',
  period_start: '2026-07-01',
  period_end: '2026-07-31',
  row_count: 1_200,
  warning_count: 2,
  error_count: 0,
  quarantined_count: 3,
  published_at: '2026-08-12T12:00:00Z',
}

const financialRow = {
  id: 'financial-1',
  scope_key: 'management_period:2026-01:2026-08',
  source_sha256: 'b'.repeat(64),
  status: 'published',
  period_start: '2026-01-01',
  period_end: '2026-08-31',
  row_count: 8,
  warning_count: 4,
  quarantined_count: 2,
  published_at: '2026-08-25T14:30:00Z',
}

describe('Store import history loader', () => {
  it('merges owner-scoped operational and management P&L publications newest first', async () => {
    const { supabase, calls } = client({
      store_import_runs: { data: [operationalRow], error: null },
      store_financial_imports: { data: [financialRow], error: null },
      store_financial_periods: { data: [{ import_id: 'financial-1' }], error: null },
    })

    const result = await loadStoreImportHistory(supabase, 'user-1')

    expect(result).toEqual([
      {
        id: 'financial-1',
        kind: 'management_period',
        scopeKey: 'management_period:2026-01:2026-08',
        sourceSha256: 'b'.repeat(64),
        status: 'published',
        periodStart: '2026-01-01',
        periodEnd: '2026-08-31',
        rowCount: 8,
        warningCount: 4,
        errorCount: 0,
        quarantinedCount: 2,
        publishedAt: '2026-08-25T14:30:00Z',
      },
      expect.objectContaining({
        id: 'run-1',
        kind: 'sales',
        rowCount: 1_200,
        warningCount: 2,
        quarantinedCount: 3,
      }),
    ])
    expect(calls.from).toHaveBeenCalledWith('store_import_runs')
    expect(calls.from).toHaveBeenCalledWith('store_financial_imports')
    expect(calls.from).toHaveBeenCalledWith('store_financial_periods')
    for (const table of ['store_import_runs', 'store_financial_imports', 'store_financial_periods']) {
      expect(calls.queries.get(table)?.eq).toHaveBeenCalledWith('user_id', 'user-1')
    }
    expect(calls.queries.get('store_import_runs')?.in)
      .toHaveBeenCalledWith('status', ['published', 'superseded'])
    expect(calls.queries.get('store_financial_imports')?.eq)
      .toHaveBeenCalledWith('status', 'published')
  })

  it('marks a financial publication replaced only when none of its periods is current', async () => {
    const { supabase } = client({
      store_import_runs: { data: [], error: null },
      store_financial_imports: {
        data: [
          financialRow,
          { ...financialRow, id: 'financial-2', published_at: '2026-08-24T14:30:00Z' },
        ],
        error: null,
      },
      store_financial_periods: { data: [{ import_id: 'financial-2' }], error: null },
    })

    const result = await loadStoreImportHistory(supabase, 'user-1')

    expect(result.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 'financial-1', status: 'superseded' },
      { id: 'financial-2', status: 'published' },
    ])
  })

  it('fails soft independently when either history source is unavailable', async () => {
    const financialOnly = await loadStoreImportHistory(client({
      store_import_runs: { data: null, error: { message: 'missing operational migration' } },
      store_financial_imports: { data: [financialRow], error: null },
      store_financial_periods: { data: [{ import_id: 'financial-1' }], error: null },
    }).supabase, 'user-1')
    expect(financialOnly).toEqual([expect.objectContaining({ id: 'financial-1' })])

    const operationalOnly = await loadStoreImportHistory(client({
      store_import_runs: { data: [operationalRow], error: null },
      store_financial_imports: { data: null, error: { message: 'missing financial migration' } },
    }).supabase, 'user-1')
    expect(operationalOnly).toEqual([expect.objectContaining({ id: 'run-1' })])
  })

  it('does not infer replacement when the optional current-period source fails', async () => {
    const result = await loadStoreImportHistory(client({
      store_import_runs: { data: [], error: null },
      store_financial_imports: { data: [financialRow], error: null },
      store_financial_periods: { data: null, error: { message: 'periods unavailable' } },
    }).supabase, 'user-1')

    expect(result).toEqual([expect.objectContaining({
      id: 'financial-1',
      status: 'published',
    })])
  })

  it('drops malformed rows and caps the merged timeline at 20 records', async () => {
    const operational = Array.from({ length: 20 }, (_, index) => ({
      ...operationalRow,
      id: `run-${index}`,
      published_at: `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00Z`,
    }))
    const financial = Array.from({ length: 20 }, (_, index) => ({
      ...financialRow,
      id: `financial-${index}`,
      published_at: `2026-07-${String(index + 1).padStart(2, '0')}T12:00:00Z`,
    }))
    const { supabase } = client({
      store_import_runs: { data: [...operational, { id: 'bad' }], error: null },
      store_financial_imports: { data: [...financial, { id: 'bad' }], error: null },
      store_financial_periods: {
        data: financial.map((entry) => ({ import_id: entry.id })),
        error: null,
      },
    })

    const result = await loadStoreImportHistory(supabase, 'user-1')

    expect(result).toHaveLength(20)
    expect(result[0].id).toBe('run-19')
    expect(result.at(-1)?.id).toBe('run-0')
  })
})
