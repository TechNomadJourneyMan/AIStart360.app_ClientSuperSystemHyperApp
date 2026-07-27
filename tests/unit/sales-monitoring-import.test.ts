import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { profileWorkbook } from '@/lib/sales-monitoring/import-service'

function workbookBuffer(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Продажи')
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

describe('sales workbook profiler', () => {
  it('maps Russian Excel headers and preserves source row lineage', () => {
    const result = profileWorkbook(workbookBuffer([
      ['Дата', 'Регион', 'Артикул', 'Количество', 'Выручка'],
      ['2026-03-06', 'Астана', '3007-1', 2, 68000],
    ]), 'sales')

    expect(result.summary).toEqual({ total: 1, valid: 1, warnings: 0, errors: 0 })
    expect(result.rows[0]).toMatchObject({
      sheetName: 'Продажи',
      sourceRow: 2,
      status: 'valid',
      normalized: {
        region: 'Астана',
        sku: '3007-1',
        quantity: '2',
        revenue: '68000',
      },
    })
  })

  it('rejects rows without stable product identity', () => {
    const result = profileWorkbook(workbookBuffer([
      ['Дата', 'Регион', 'Количество', 'Выручка'],
      ['2026-03-06', 'Астана', 1, 10000],
    ]), 'sales')

    expect(result.summary.errors).toBe(1)
    expect(result.rows[0].errors).toContainEqual(expect.objectContaining({
      code: 'PRODUCT_ID_REQUIRED',
    }))
  })

  it('produces deterministic fingerprints for duplicate detection', () => {
    const buffer = workbookBuffer([
      ['Дата', 'Артикул', 'Количество', 'Выручка'],
      ['2026-03-06', 'SKU-1', 1, 10000],
    ])
    expect(profileWorkbook(buffer, 'sales').rows[0].fingerprint)
      .toBe(profileWorkbook(buffer, 'sales').rows[0].fingerprint)
  })
})
