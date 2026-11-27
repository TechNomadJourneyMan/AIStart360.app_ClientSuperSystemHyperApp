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
      management_period: [],
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

  it('shows separate canonical and reported financial controls', () => {
    const input = fixture()
    input.detectedKinds = ['management_period']
    input.data.sales = []
    input.data.management_period = [{
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      granularity: 'month',
      currency: 'KZT',
      revenueBasis: 'net_after_discounts_returns',
      revenue: 120000,
      costOfGoods: 70000,
      grossProfit: 50000,
      grossMarginPct: 41.6667,
      reportedGrossProfit: 49999.71,
      grossProfitReconciliationDelta: -0.29,
      periodExpenses: 65000,
      bonusExpense: 2000,
      writeOffExpense: 1500,
      ebitda: -15000.29,
      ebitdaMarginPct: -12.5002,
      completeness: 'complete',
      qualityNote: 'округление между management sheets',
      sourceSheet: 'Динамика по месяцам',
      sourceRange: 'A22:H22; P&L 2026 (май–июль)!A5:F5',
    }]
    input.quarantine = []
    input.issues = []
    input.summary = { acceptedRows: 1, quarantinedRows: 0, skippedRows: 0 }
    input.sheets = [{
      sheetName: 'Динамика по месяцам',
      detectedKind: 'management_period',
      headerRows: [4],
      columnCount: 8,
      candidateRows: 1,
      acceptedRows: 1,
      quarantinedRows: 0,
      skippedRows: 0,
    }]

    expect(toStoreImportPreviewTransport(input).totals).toMatchObject({
      'Периодов': 1,
      'Выручка периодов, KZT': 120000,
      'Себестоимость периодов, KZT': 70000,
      'Валовая прибыль (расчёт), KZT': 50000,
      'P&L валовая прибыль, KZT': 49999.71,
      'Расходы периода, KZT': 65000,
      'EBITDA, KZT': -15000.29,
    })
  })
})
