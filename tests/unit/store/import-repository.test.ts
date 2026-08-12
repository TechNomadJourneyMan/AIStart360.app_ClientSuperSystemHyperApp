import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import {
  publishStoreImport,
  StorePublishRepositoryError,
} from '@/lib/store/import/repository'

const payload = {
  importKind: 'inventory' as const,
  scopeKey: 'warehouse:astana',
  effectiveDate: '2026-07-31',
  periodStart: '2026-07-31',
  periodEnd: '2026-07-31',
  rowCount: 1,
  warningCount: 0,
  quarantinedCount: 0,
  rows: [{
    variantKey: `name-v1:${'b'.repeat(64)}`,
    sku: 'A',
    name: 'A L',
    normalizedName: 'a l',
    snapshotDate: '2026-07-31',
    warehouseCode: 'ASTANA',
    warehouseName: 'Астана',
    warehouseKind: 'warehouse' as const,
    quantityAvailable: 1,
    quantityReserved: 0,
  }],
}

function input() {
  return {
    userId: 'user-1',
    companyId: 'company-1',
    sourceFileName: 'inventory.xlsx',
    sourceSizeBytes: 100,
    sourceSha256: 'a'.repeat(64),
    idempotencyKey: '5e78b3d0-a4c3-4f47-8cd8-c48c4b7c3221',
    payload,
  }
}

describe('Store import publication repository', () => {
  it('passes only server-derived ownership, manifest and normalized rows to the RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        outcome: 'published',
        import_run_id: 'run-1',
        import_kind: 'inventory',
        scope_key: 'warehouse:astana',
        row_count: 1,
        published_at: '2026-08-12T12:00:00Z',
        superseded_run_id: null,
      }],
      error: null,
    })
    const result = await publishStoreImport({ rpc } as unknown as SupabaseClient, input())
    expect(result).toMatchObject({ outcome: 'published', importRunId: 'run-1', rowCount: 1 })
    expect(rpc).toHaveBeenCalledOnce()
    const [name, args] = rpc.mock.calls[0]
    expect(name).toBe('publish_store_import')
    expect(args).toMatchObject({
      p_user_id: 'user-1',
      p_company_id: 'company-1',
      p_source_sha256: 'a'.repeat(64),
      p_import_kind: 'inventory',
      p_scope_key: 'warehouse:astana',
      p_effective_date: '2026-07-31',
      p_rows: payload.rows,
    })
    expect(args.p_manifest_sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('maps database details to bounded application errors', async () => {
    for (const [databaseCode, expected] of [
      ['23505', 'conflict'],
      ['22023', 'invalid_payload'],
      ['XX000', 'unavailable'],
    ] as const) {
      const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: databaseCode } })
      await expect(publishStoreImport(
        { rpc } as unknown as SupabaseClient,
        input(),
      )).rejects.toEqual(expect.objectContaining({
        name: StorePublishRepositoryError.name,
        code: expected,
      }))
    }
  })

  it('fails closed on an incomplete RPC response', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ outcome: 'published' }], error: null })
    await expect(publishStoreImport(
      { rpc } as unknown as SupabaseClient,
      input(),
    )).rejects.toEqual(expect.objectContaining({ code: 'unavailable' }))
  })
})
