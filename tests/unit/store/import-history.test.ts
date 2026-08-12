import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { loadStoreImportHistory } from '@/lib/store/import/history'

function client(result: { data: unknown; error: unknown }) {
  const limit = vi.fn().mockResolvedValue(result)
  const order = vi.fn(() => ({ limit }))
  const inFilter = vi.fn(() => ({ order }))
  const eq = vi.fn(() => ({ in: inFilter }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return {
    supabase: { from } as unknown as SupabaseClient,
    calls: { from, select, eq, inFilter, order, limit },
  }
}

describe('Store import history loader', () => {
  it('scopes published audit rows to the session user', async () => {
    const { supabase, calls } = client({
      data: [{
        id: 'run-1', import_kind: 'sales', scope_key: 'month:2026-07',
        source_sha256: 'a'.repeat(64), status: 'published',
        period_start: '2026-07-01', period_end: '2026-07-31', row_count: 1_200,
        warning_count: 0, error_count: 0, published_at: '2026-08-12T12:00:00Z',
      }],
      error: null,
    })
    const result = await loadStoreImportHistory(supabase, 'user-1')
    expect(result).toEqual([expect.objectContaining({
      id: 'run-1', kind: 'sales', scopeKey: 'month:2026-07', rowCount: 1_200,
    })])
    expect(calls.from).toHaveBeenCalledWith('store_import_runs')
    expect(calls.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(calls.inFilter).toHaveBeenCalledWith('status', ['published', 'superseded'])
    expect(calls.limit).toHaveBeenCalledWith(20)
  })

  it('fails soft on unavailable or malformed audit data', async () => {
    expect(await loadStoreImportHistory(
      client({ data: null, error: { message: 'missing migration' } }).supabase,
      'user-1',
    )).toEqual([])
    expect(await loadStoreImportHistory(
      client({ data: [{ id: 'bad' }], error: null }).supabase,
      'user-1',
    )).toEqual([])
  })
})
