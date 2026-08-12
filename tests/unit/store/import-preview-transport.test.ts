import { describe, expect, it } from 'vitest'
import { toStoreImportPreviewTransport } from '@/lib/store/import/preview-transport'
import type { StoreImportPreview } from '@/lib/store/import/types'

function fixture(): StoreImportPreview {
  return {
    file: {
      fileName: 'sales.xlsx',
      format: 'xlsx',
      sizeBytes: 4_096,
      sha256: 'a'.repeat(64),
    },
    detectedKinds: ['sales'],
    data: {
      prices: [],
      inventory: [],
      sales: [
        {
          externalLineId: '1',
          sku: 'A',
          name: 'HONOR A',
          warehouseCode: 'astana',
          warehouseName: 'Астана',
          channel: 'retail_store',
          occurredOn: '2026-07-01',
          quantity: 2,
          listAmount: 1_000,
          netRevenue: 800,
          costAmount: 500,
          discountAmount: 200,
        },
        {
          externalLineId: '2',
          sku: 'A',
          name: 'HONOR A',
          warehouseCode: 'astana',
          warehouseName: 'Астана',
          channel: 'retail_store',
          occurredOn: '2026-07-02',
          quantity: -1,
          listAmount: -500,
          netRevenue: -400,
          costAmount: -250,
          discountAmount: -100,
        },
      ],
    },
    quarantine: [{
      sheetName: 'Продажи',
      rowNumber: 9,
      kind: 'sales',
      reasonCodes: ['formula_cell'],
      fields: ['netRevenue'],
    }],
    issues: [
      { code: 'row_quarantined', severity: 'warning', message: 'Строка 9 в карантине' },
    ],
    sheets: [{
      sheetName: 'Продажи',
      detectedKind: 'sales',
      headerRows: [7],
      columnCount: 12,
      candidateRows: 3,
      acceptedRows: 2,
      quarantinedRows: 1,
      skippedRows: 0,
    }],
    summary: { acceptedRows: 2, quarantinedRows: 1, skippedRows: 0 },
  }
}

describe('Store import preview transport', () => {
  it('returns a bounded canonical sample and signed control totals', () => {
    const result = toStoreImportPreviewTransport(fixture())
    expect(result).toMatchObject({
      ready: true,
      fileName: 'sales.xlsx',
      kind: 'sales',
      sheetName: 'Продажи',
      rowCount: 3,
      acceptedRows: 2,
      quarantinedRows: 1,
      totals: {
        'Выручка, KZT': 400,
        'Себестоимость, KZT': 250,
        'Скидка, KZT': 100,
        'Количество, ед.': 1,
      },
    })
    expect(result.headers).toContain('netRevenue')
    expect(result.previewRows).toHaveLength(2)
    expect(result.warnings).toEqual([
      'Лист «Продажи»: 1 строк в карантине',
      'Строка 9 в карантине',
    ])
  })

  it('never returns more than twelve data rows or twenty issue messages', () => {
    const input = fixture()
    input.data.sales = Array.from({ length: 30 }, (_, index) => ({
      ...input.data.sales[0],
      externalLineId: String(index),
    }))
    input.issues = Array.from({ length: 25 }, (_, index) => ({
      code: 'row_quarantined' as const,
      severity: 'warning' as const,
      message: `issue ${index}`,
    }))
    input.quarantine = []
    const result = toStoreImportPreviewTransport(input)
    expect(result.previewRows).toHaveLength(12)
    expect(result.warnings).toHaveLength(20)
    expect(result.warnings).toEqual(Array.from({ length: 20 }, (_, index) => `issue ${index}`))
  })
})
