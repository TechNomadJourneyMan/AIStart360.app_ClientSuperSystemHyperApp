import { describe, expect, it } from 'vitest'
import {
  buildStorePublishManifestSha256,
  buildStorePreviewDigest,
  buildStorePublishPayload,
  deriveStoreVariantKey,
  normalizeStoreVariantName,
  StorePublishValidationError,
} from '@/lib/store/import/publication'
import type { StoreImportPreview } from '@/lib/store/import/types'

function preview(overrides: Partial<StoreImportPreview> = {}): StoreImportPreview {
  return {
    file: {
      fileName: 'inventory.xlsx',
      format: 'xlsx',
      sizeBytes: 100,
      sha256: 'a'.repeat(64),
    },
    detectedKinds: ['inventory'],
    data: {
      prices: [],
      inventory: [{
        sku: '2002-903М',
        name: 'Футболка HONOR, размер L',
        warehouseCode: 'ASTANA',
        warehouseName: 'Астана',
        quantityAvailable: 3,
        snapshotDate: null,
      }],
      sales: [],
    },
    quarantine: [],
    issues: [],
    sheets: [],
    summary: { acceptedRows: 1, quarantinedRows: 0, skippedRows: 0 },
    ...overrides,
  }
}

describe('Store import publication contract', () => {
  it('derives the same variant identity across harmless name formatting changes', () => {
    expect(normalizeStoreVariantName('  Футболка  Ёж — XL ')).toBe('футболка еж xl')
    expect(deriveStoreVariantKey('Футболка Ёж — XL')).toBe(
      deriveStoreVariantKey('футболка еж XL'),
    )
    expect(deriveStoreVariantKey('Футболка — L')).not.toBe(
      deriveStoreVariantKey('Футболка — XL'),
    )
  })

  it('requires and applies one confirmed inventory snapshot date', () => {
    const payload = buildStorePublishPayload(preview(), '2026-07-31')
    expect(payload).toMatchObject({
      importKind: 'inventory',
      scopeKey: 'warehouse:astana',
      effectiveDate: '2026-07-31',
      periodStart: '2026-07-31',
      periodEnd: '2026-07-31',
      rowCount: 1,
    })
    expect(payload.rows[0]).toMatchObject({
      snapshotDate: '2026-07-31',
      warehouseKind: 'warehouse',
      quantityReserved: 0,
    })
  })

  it('rejects a missing date, a date mismatch and a multi-warehouse inventory file', () => {
    expect(() => buildStorePublishPayload(preview())).toThrowError(
      expect.objectContaining({ code: 'effective_date_required' }),
    )

    const dated = preview({
      data: {
        prices: [],
        inventory: [{
          ...preview().data.inventory[0],
          snapshotDate: '2026-07-30',
        }],
        sales: [],
      },
    })
    expect(() => buildStorePublishPayload(dated, '2026-07-31')).toThrowError(
      expect.objectContaining({ code: 'snapshot_date_mismatch' }),
    )

    const multiWarehouse = preview({
      data: {
        prices: [],
        inventory: [
          preview().data.inventory[0],
          { ...preview().data.inventory[0], warehouseCode: 'UKA', warehouseName: 'Усть-Каменогорск' },
        ],
        sales: [],
      },
      summary: { acceptedRows: 2, quarantinedRows: 0, skippedRows: 0 },
    })
    expect(() => buildStorePublishPayload(multiWarehouse, '2026-07-31')).toThrowError(
      expect.objectContaining({ code: 'inventory_scope_ambiguous' }),
    )
  })

  it('keeps signed sales rows and scopes corrections to the same period', () => {
    const salesPreview = preview({
      detectedKinds: ['sales'],
      data: {
        prices: [],
        inventory: [],
        sales: [{
          externalLineId: 'sheet:8',
          sku: 'A-1',
          name: 'Кепка HONOR',
          warehouseCode: 'KASPI',
          warehouseName: 'Kaspi',
          channel: 'kaspi',
          occurredOn: '2026-07-31',
          quantity: -1,
          listAmount: -10_000,
          netRevenue: -8_000,
          costAmount: -5_000,
          discountAmount: -2_000,
        }],
      },
    })
    const payload = buildStorePublishPayload(salesPreview)
    expect(payload).toMatchObject({
      importKind: 'sales',
      scopeKey: 'month:2026-07',
      effectiveDate: null,
    })
    expect(payload.rows[0]).toMatchObject({
      quantity: -1,
      netRevenue: -8_000,
      warehouseKind: 'marketplace',
    })
  })

  it('rejects sales that span more than one calendar month', () => {
    const source = preview({
      detectedKinds: ['sales'],
      data: {
        prices: [],
        inventory: [],
        sales: [
          {
            externalLineId: 'july', sku: 'A', name: 'A',
            warehouseCode: 'MAIN', warehouseName: 'Main', channel: 'retail_store',
            occurredOn: '2026-07-31', quantity: 1, listAmount: 10,
            netRevenue: 10, costAmount: 5, discountAmount: 0,
          },
          {
            externalLineId: 'august', sku: 'A', name: 'A',
            warehouseCode: 'MAIN', warehouseName: 'Main', channel: 'retail_store',
            occurredOn: '2026-08-01', quantity: 1, listAmount: 10,
            netRevenue: 10, costAmount: 5, discountAmount: 0,
          },
        ],
      },
      summary: { acceptedRows: 2, quarantinedRows: 0, skippedRows: 0 },
    })
    expect(() => buildStorePublishPayload(source)).toThrowError(
      expect.objectContaining({ code: 'sales_period_ambiguous' }),
    )
  })

  it('requires exactly one ready import kind', () => {
    expect(() => buildStorePublishPayload(preview({ detectedKinds: ['prices', 'inventory'] }), '2026-07-31'))
      .toThrowError(expect.objectContaining({ code: 'mixed_import_kinds' }))
    expect(() => buildStorePublishPayload(preview({
      issues: [{ code: 'no_importable_rows', severity: 'error', message: 'Нет строк' }],
    }), '2026-07-31')).toThrow(StorePublishValidationError)
  })

  it('binds the idempotency manifest to the date and normalized rows', () => {
    const first = buildStorePublishPayload(preview(), '2026-07-31')
    const second = buildStorePublishPayload(preview(), '2026-08-01')
    const firstHash = buildStorePublishManifestSha256({
      sourceSha256: 'a'.repeat(64),
      sourceSizeBytes: 100,
      payload: first,
    })
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/)
    expect(buildStorePublishManifestSha256({
      sourceSha256: 'a'.repeat(64),
      sourceSizeBytes: 100,
      payload: first,
    })).toBe(firstHash)
    expect(buildStorePublishManifestSha256({
      sourceSha256: 'a'.repeat(64),
      sourceSizeBytes: 100,
      payload: second,
    })).not.toBe(firstHash)
  })

  it('builds a deterministic digest of the complete normalized preview', () => {
    const first = preview()
    expect(buildStorePreviewDigest(first)).toMatch(/^[a-f0-9]{64}$/)
    expect(buildStorePreviewDigest(preview())).toBe(buildStorePreviewDigest(first))
    expect(buildStorePreviewDigest({
      ...first,
      data: {
        ...first.data,
        inventory: [{ ...first.data.inventory[0], quantityAvailable: 4 }],
      },
    })).not.toBe(buildStorePreviewDigest(first))
  })
})
