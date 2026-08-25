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

const financialPayload = {
  importKind: 'management_period' as const,
  scopeKey: 'management_period:2026-06:2026-06',
  effectiveDate: null,
  periodStart: '2026-06-01',
  periodEnd: '2026-06-30',
  rowCount: 1,
  warningCount: 0,
  quarantinedCount: 0,
  rows: [{
    scopeKey: 'month:2026-06',
    periodStart: '2026-06-01',
    periodEnd: '2026-06-30',
    granularity: 'month' as const,
    currency: 'KZT' as const,
    revenueBasis: 'net_after_discounts_returns' as const,
    revenue: 10_173_402,
    costAmount: 3_945_902,
    grossProfit: 6_227_500,
    grossMarginPct: 61.2135,
    reportedGrossProfit: 6_227_499.71,
    grossProfitReconciliationDelta: -0.29,
    periodExpenses: 8_467_124.69,
    bonuses: 872_035.44,
    writeOffs: 1_578_282.33,
    ebitda: -2_239_624.98,
    ebitdaMarginPct: -22.0145,
    completeness: 'complete' as const,
    note: 'округление между management sheets',
    sourceSheet: 'Динамика по месяцам',
    sourceRange: 'A22:H22; P&L 2026 (май–июль)!A5:F5',
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

  it('routes management periods only to the isolated financial RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        outcome: 'published',
        import_run_id: 'financial-run-1',
        import_kind: 'management_period',
        scope_key: financialPayload.scopeKey,
        row_count: 1,
        published_at: '2026-08-25T12:00:00Z',
        superseded_run_id: null,
      }],
      error: null,
    })
    const result = await publishStoreImport(
      { rpc } as unknown as SupabaseClient,
      { ...input(), sourceFileName: 'store-import-aaaaaaaaaaaa.xlsx', payload: financialPayload },
    )

    expect(result).toMatchObject({
      importKind: 'management_period',
      importRunId: 'financial-run-1',
    })
    expect(rpc).toHaveBeenCalledOnce()
    const [name, args] = rpc.mock.calls[0]
    expect(name).toBe('publish_store_financial_import')
    expect(args).toMatchObject({
      p_scope_key: financialPayload.scopeKey,
      p_period_start: '2026-06-01',
      p_rows: financialPayload.rows,
    })
    expect(args).not.toHaveProperty('p_import_kind')
    expect(args).not.toHaveProperty('p_effective_date')
  })

  it('fails closed on an incomplete RPC response', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ outcome: 'published' }], error: null })
    await expect(publishStoreImport(
      { rpc } as unknown as SupabaseClient,
      input(),
    )).rejects.toEqual(expect.objectContaining({ code: 'unavailable' }))
  })
})
