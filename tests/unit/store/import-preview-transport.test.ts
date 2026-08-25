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
      revenue: 10_173_402,
      costOfGoods: 3_945_902,
      grossProfit: 6_227_500,
      grossMarginPct: 61.2135,
      reportedGrossProfit: 6_227_499.71,
      grossProfitReconciliationDelta: -0.29,
      periodExpenses: 8_467_124.69,
      bonusExpense: 872_035.44,
      writeOffExpense: 1_578_282.33,
      ebitda: -2_239_624.98,
      ebitdaMarginPct: -22.0145,
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
      'Выручка периодов, KZT': 10_173_402,
      'Себестоимость периодов, KZT': 3_945_902,
      'Валовая прибыль (расчёт), KZT': 6_227_500,
      'P&L валовая прибыль, KZT': 6_227_499.71,
      'Расходы периода, KZT': 8_467_124.69,
      'EBITDA, KZT': -2_239_624.98,
    })
  })
})
