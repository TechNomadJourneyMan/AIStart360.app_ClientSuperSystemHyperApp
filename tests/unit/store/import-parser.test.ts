import { createHash } from 'node:crypto'
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'

import {
  parseStoreImport,
  STORE_IMPORT_MAX_COLUMNS,
  STORE_IMPORT_MAX_FILE_BYTES,
  STORE_IMPORT_MAX_ROWS,
  StoreImportError,
} from '@/lib/store/import/parser'
import managementControl from '../../fixtures/store-imports/honor-management-period-control.json'

function workbookBuffer(
  sheets: Array<{ name: string; sheet: XLSX.WorkSheet }>,
  bookType: 'xlsx' | 'biff8' = 'xlsx',
): Buffer {
  const workbook = XLSX.utils.book_new()
  for (const { name, sheet } of sheets) XLSX.utils.book_append_sheet(workbook, sheet, name)
  return XLSX.write(workbook, { type: 'buffer', bookType }) as Buffer
}

const MANAGEMENT_BASE_ROWS: unknown[][] = [
  [2025, 'Январь', 23_632_877, 13_999_526, null],
  [2025, 'Февраль', 10_988_705, 5_342_278, null],
  [2025, 'Март', 15_397_078, 7_579_166, null],
  [2025, 'Апрель', 17_387_198, 8_722_163, null],
  [2025, 'Май', 7_406_078, 3_691_530, null],
  [2025, 'Июнь', 14_583_499, 8_235_577, null],
  [2025, 'Июль', 27_659_924, 17_278_217, null],
  [2025, 'Август', 17_258_004, 7_949_103, null],
  [2025, 'Сентябрь', 3_880_840, 1_890_218, 'лист заполнен частично'],
  [2025, 'Октябрь', 4_283_220, 2_290_880, 'лист заполнен частично'],
  [2025, 'Ноябрь', 49_964_999, 26_437_002, null],
  [2025, 'Декабрь', 38_227_746, 17_988_152, null],
  [2026, 'Январь', 33_371_046, 15_058_996, null],
  [2026, 'Февраль', 20_281_666, 10_291_714, null],
  [2026, 'Март', 77_095_966, 52_945_481, 'оптовая волна'],
  [2026, 'Апрель', 23_709_501, 15_935_292, 'опт, маржа ниже'],
  [2026, 'Май', 9_440_240, 4_185_398, 'управленческий отчет'],
  [2026, 'Июнь', 10_173_402, 3_945_902, 'управленческий отчет'],
  [2026, 'Июль', 28_053_253, 17_139_974, 'управленческий отчет'],
]

function makeManagementWorkbook(options: {
  formulaRevenueRow?: number
  formulaPnlExpenseRow?: number
} = {}): Buffer {
  const base = XLSX.utils.aoa_to_sheet([
    ['HONOR · ДИНАМИКА ПРОДАЖ ПО МЕСЯЦАМ · 2025–2026'],
    ['Синие ячейки — данные; чёрные — формулы'],
    [],
    ['Год', 'Месяц', 'Выручка', 'Закуп (себест.)', 'Вал. прибыль', 'Маржа', 'Δ м/м', 'Примечание'],
    ...MANAGEMENT_BASE_ROWS.map(([year, month, revenue, cost, note]) => [
      year, month, revenue, cost, null, null, null, note,
    ]),
    [null, 'ИТОГО 2025'],
    [null, 'ИТОГО 2026 (7 мес)'],
  ])
  for (let row = 5; row <= 23; row += 1) {
    base[`E${row}`] = { t: 'n', f: `C${row}-D${row}`, v: 987_654_321 }
    base[`F${row}`] = { t: 'n', f: `E${row}/C${row}`, v: 999 }
    base[`G${row}`] = { t: 'n', f: `C${row}/C${row - 1}-1`, v: 999 }
  }
  if (options.formulaRevenueRow) {
    const address = `C${options.formulaRevenueRow}`
    base[address] = { t: 'n', f: 'UNTRUSTED()', v: Number(base[address]?.v ?? 0) }
  }

  const pnl = XLSX.utils.aoa_to_sheet([
    ['HONOR · ПОЛНЫЙ P&L · МАЙ–ИЮЛЬ 2026'],
    [],
    ['Месяц', 'Выручка', 'Вал. прибыль', 'Расходы периода', 'в т.ч. бонусы', 'в т.ч. списание', 'EBITDA', 'EBITDA %'],
    ['Май', 9_440_240, 5_254_842, 10_394_024.2, 980_808.2, 1_184_845],
    ['Июнь', 10_173_402, 6_227_499.71, 8_467_124.69, 872_035.44, 1_578_282.33],
    ['Июль', 28_053_253, 10_913_278.54, 14_594_824.45, 2_324_862.25, 579_056.5],
    ['ИТОГО'],
  ])
  for (let row = 4; row <= 6; row += 1) {
    pnl[`G${row}`] = { t: 'n', f: `C${row}-D${row}`, v: 123_456_789 }
    pnl[`H${row}`] = { t: 'n', f: `G${row}/B${row}`, v: 999 }
  }
  if (options.formulaPnlExpenseRow) {
    const address = `D${options.formulaPnlExpenseRow}`
    pnl[address] = { t: 'n', f: 'UNTRUSTED()', v: Number(pnl[address]?.v ?? 0) }
  }

  const byYear = XLSX.utils.aoa_to_sheet([
    ['HONOR · СРАВНЕНИЕ ПО ГОДАМ'],
    [],
    ['Месяц', 'Выручка 2025', 'Выручка 2026'],
    ['Январь', null, null],
  ])
  byYear.B4 = { t: 'n', f: "'Динамика по месяцам'!C5", v: 999_999_999 }
  byYear.C4 = { t: 'n', f: "'Динамика по месяцам'!C17", v: 999_999_999 }
  return workbookBuffer([
    { name: 'Динамика по месяцам', sheet: base },
    { name: 'По годам', sheet: byYear },
    { name: 'P&L 2026 (май–июль)', sheet: pnl },
  ])
}

describe('parseStoreImport — HONOR management periods', () => {
  it('keeps 19 monthly facts, exact base controls and independently reported P&L controls', () => {
    const preview = parseStoreImport(makeManagementWorkbook(), 'HONOR динамика 2025-2026.xlsx')
    const rows2025 = preview.data.management_period.filter((row) => row.periodStart.startsWith('2025-'))
    const rows2026 = preview.data.management_period.filter((row) => row.periodStart.startsWith('2026-'))
    const pnlRows = rows2026.filter((row) => row.reportedGrossProfit !== null)
    const sum = (rows: typeof rows2025, field: keyof (typeof rows2025)[number]) =>
      Math.round(rows.reduce((total, row) => total + Number(row[field] ?? 0), 0) * 100) / 100

    expect(preview.detectedKinds).toEqual(['management_period'])
    expect(preview.data.sales).toEqual([])
    expect(preview.data.management_period).toHaveLength(managementControl.coverage.uniqueMonths)
    expect(sum(rows2025, 'revenue')).toBe(managementControl.baseControls['2025'].revenue)
    expect(sum(rows2025, 'costOfGoods')).toBe(managementControl.baseControls['2025'].costOfGoods)
    expect(sum(rows2025, 'grossProfit')).toBe(managementControl.baseControls['2025'].derivedGrossProfit)
    expect(sum(rows2026, 'revenue')).toBe(managementControl.baseControls['2026-01..07'].revenue)
    expect(sum(rows2026, 'costOfGoods')).toBe(managementControl.baseControls['2026-01..07'].costOfGoods)
    expect(sum(rows2026, 'grossProfit')).toBe(managementControl.baseControls['2026-01..07'].derivedGrossProfit)
    expect(sum(pnlRows, 'reportedGrossProfit')).toBe(managementControl.pnlControls['2026-05..07'].reportedGrossProfit)
    expect(sum(pnlRows, 'periodExpenses')).toBe(managementControl.pnlControls['2026-05..07'].periodExpenses)
    expect(sum(pnlRows, 'bonusExpense')).toBe(managementControl.pnlControls['2026-05..07'].bonuses)
    expect(sum(pnlRows, 'writeOffExpense')).toBe(managementControl.pnlControls['2026-05..07'].writeOffs)
    expect(sum(pnlRows, 'ebitda')).toBe(managementControl.pnlControls['2026-05..07'].ebitda)
    expect(sum(pnlRows, 'grossProfitReconciliationDelta')).toBe(-0.75)
  })

  it('derives GP and EBITDA instead of trusting cached formula results', () => {
    const preview = parseStoreImport(makeManagementWorkbook(), 'HONOR динамика 2025-2026.xlsx')
    const may = preview.data.management_period.find((row) => row.periodStart === '2026-05-01')

    expect(may).toMatchObject({
      revenue: 9_440_240,
      costOfGoods: 4_185_398,
      grossProfit: 5_254_842,
      reportedGrossProfit: 5_254_842,
      grossProfitReconciliationDelta: 0,
      periodExpenses: 10_394_024.2,
      ebitda: -5_139_182.2,
    })
    expect(may?.grossProfit).not.toBe(987_654_321)
    expect(may?.ebitda).not.toBe(123_456_789)
    expect(preview.issues).toContainEqual(expect.objectContaining({
      code: 'derived_formula_sheet_skipped',
      sheetName: 'По годам',
    }))
  })

  it('marks the two source-declared partial months and requires warning acknowledgement downstream', () => {
    const preview = parseStoreImport(makeManagementWorkbook(), 'HONOR динамика 2025-2026.xlsx')
    const partial = preview.data.management_period
      .filter((row) => row.completeness === 'partial')
      .map((row) => row.periodStart)

    expect(partial).toEqual(managementControl.coverage.partialMonths)
    expect(preview.issues.filter((issue) => issue.code === 'management_period_partial')).toHaveLength(2)
  })

  it('quarantines a formula in canonical revenue even when it has a cached number', () => {
    const preview = parseStoreImport(
      makeManagementWorkbook({ formulaRevenueRow: 5 }),
      'HONOR динамика 2025-2026.xlsx',
    )
    expect(preview.data.management_period).toHaveLength(18)
    expect(preview.quarantine).toContainEqual(expect.objectContaining({
      sheetName: 'Динамика по месяцам',
      rowNumber: 5,
      reasonCodes: expect.arrayContaining(['formula_cell']),
      fields: expect.arrayContaining(['revenue']),
    }))
  })

  it('ignores an unsafe P&L enrichment row without discarding its canonical base month', () => {
    const preview = parseStoreImport(
      makeManagementWorkbook({ formulaPnlExpenseRow: 4 }),
      'HONOR динамика 2025-2026.xlsx',
    )
    const may = preview.data.management_period.find((row) => row.periodStart === '2026-05-01')
    expect(preview.data.management_period).toHaveLength(19)
    expect(may).toMatchObject({ grossProfit: 5_254_842, reportedGrossProfit: null, ebitda: null })
    expect(preview.issues).toContainEqual(expect.objectContaining({
      code: 'management_period_pnl_ignored',
      rowNumber: 4,
    }))
  })
})

function makeHonorPriceSheet(): XLSX.WorkSheet {
  const rows: unknown[][] = [
    [
      'Артикул', 'Товар',
      'Закупочная', '',
      'РЕАЛИЗАЦИЯ МАГАЗИН', '',
      'КОНСЕГНАЦИЯ - 20%', '',
      'РЕАЛИЗАЦИЯ ОПТОМ - 25%', '',
      'РЕАЛИЗАЦИЯ ОПТОМ - 30%', '',
    ],
    ['', '', 'Старая цена', 'Цена', 'Старая цена', 'Цена', 'Старая цена', 'Цена', 'Старая цена', 'Цена', 'Старая цена', 'Цена'],
    ['', 'HONOR Alpha Black', null, 18_500, null, 40_000, null, 32_000, null, 30_000, null, 28_000],
    ['', 'HONOR Bravo Blue', null, 20_000, null, 45_000, null, 36_000, null, 33_750, null, 31_500],
    ['HONOR-X8', 'HONOR X8 размер S', null, 10_000, null, 20_000],
    ['HONOR-X8', 'HONOR X8 размер M', null, 10_000, null, 20_000],
    ['HONOR-X8', 'HONOR X8 размер L', null, 10_000, null, 20_000],
    ['HONOR-X8', 'HONOR X8 размер XL', null, 10_000, null, 20_000],
    ['HONOR-X8', 'HONOR X8 размер XXL', null, 10_000, null, 20_000],
    ['BAD-FORMULA', 'Опасная формула', null, 10_000, null, 20_000],
    ['BAD-ERROR', 'Ошибка источника', null, 10_000, null, 20_000],
  ]
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!merges'] = [
    { s: { r: 0, c: 2 }, e: { r: 0, c: 3 } },
    { s: { r: 0, c: 4 }, e: { r: 0, c: 5 } },
    { s: { r: 0, c: 6 }, e: { r: 0, c: 7 } },
    { s: { r: 0, c: 8 }, e: { r: 0, c: 9 } },
    { s: { r: 0, c: 10 }, e: { r: 0, c: 11 } },
  ]
  sheet.D10 = { t: 'n', f: '1+1', v: 2 }
  sheet.F11 = { t: 'e', v: 15, w: '#VALUE!' }
  return sheet
}

describe('parseStoreImport — HONOR price lists', () => {
  it('normalizes the two-row Russian price header without collapsing product variants', () => {
    const buffer = workbookBuffer([{ name: 'Лист_1', sheet: makeHonorPriceSheet() }])
    const preview = parseStoreImport(buffer, 'price_2026_08_07.xlsx')

    expect(preview.file).toEqual({
      fileName: 'price_2026_08_07.xlsx',
      format: 'xlsx',
      sizeBytes: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    })
    expect(preview.detectedKinds).toEqual(['prices'])
    expect(preview.data.prices).toHaveLength(7)
    expect(preview.data.prices[0]).toEqual({
      sku: expect.stringMatching(/^name:[a-f0-9]{24}$/),
      name: 'HONOR Alpha Black',
      purchasePrice: 18_500,
      retailPrice: 40_000,
      consignmentPrice: 32_000,
      wholesale25Price: 30_000,
      wholesale30Price: 28_000,
    })
    expect(preview.data.prices[0].sku).not.toBe(preview.data.prices[1].sku)
    expect(preview.data.prices.filter((row) => row.sku === 'HONOR-X8')).toHaveLength(5)
    expect(preview.quarantine).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCodes: expect.arrayContaining(['formula_cell']) }),
      expect.objectContaining({ reasonCodes: expect.arrayContaining(['error_cell']) }),
    ]))
  })

  it('supports legacy XLS files through the same synchronous entrypoint', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Артикул', 'Наименование', 'Закупочная цена', 'Розничная цена'],
      ['A-1', 'HONOR Legacy', 100, 200],
    ])
    const preview = parseStoreImport(
      workbookBuffer([{ name: 'Прайс', sheet }], 'biff8'),
      'legacy.xls',
    )

    expect(preview.file.format).toBe('xls')
    expect(preview.data.prices).toEqual([expect.objectContaining({
      sku: 'A-1',
      purchasePrice: 100,
      retailPrice: 200,
    })])
  })

  it('quantizes prices to NUMERIC(18,2) and rejects values unsafe for exact minor units', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Артикул', 'Наименование', 'Закупочная цена', 'Розничная цена'],
      ['SAFE', 'HONOR Safe', 1.005, 2.675],
      ['OVERFLOW', 'HONOR Overflow', 100_000_000_000_000, 200],
    ])
    const preview = parseStoreImport(
      workbookBuffer([{ name: 'Прайс', sheet }]),
      'prices.xlsx',
    )

    expect(preview.data.prices).toEqual([expect.objectContaining({
      sku: 'SAFE',
      purchasePrice: 1.01,
      retailPrice: 2.68,
    })])
    expect(preview.quarantine).toContainEqual(expect.objectContaining({
      reasonCodes: expect.arrayContaining(['invalid_number']),
      fields: expect.arrayContaining(['purchasePrice']),
    }))
  })
})

describe('parseStoreImport — inventory', () => {
  it('keeps five sizes of one article, sanitizes warehouse code, and quarantines invalid rows', () => {
    const rows: unknown[][] = [
      ['Остатки и доступность товаров'],
      ['Артикул', 'Номенклатура', 'Код склада', 'Склад', 'Доступно', 'Дата снимка'],
      ...['S', 'M', 'L', 'XL', 'XXL'].map((size) => [
        'HONOR-SET', `HONOR Set размер ${size}`, 'Склад № 1', '2 Магазин Астана', 3, '07.08.2026 г.',
      ]),
      ['HONOR-SET', 'HONOR Set размер S', 'Склад № 1', '2 Магазин Астана', 3, '07.08.2026 г.'],
      ['NEGATIVE', 'HONOR Negative', 'Склад № 1', '2 Магазин Астана', -1, '07.08.2026 г.'],
    ]
    const buffer = workbookBuffer([{ name: 'Лист_1', sheet: XLSX.utils.aoa_to_sheet(rows) }])
    const preview = parseStoreImport(buffer, 'inventory_astana.xlsx')

    expect(preview.detectedKinds).toEqual(['inventory'])
    expect(preview.data.inventory).toHaveLength(5)
    expect(new Set(preview.data.inventory.map((row) => row.name)).size).toBe(5)
    expect(preview.data.inventory[0]).toMatchObject({
      sku: 'HONOR-SET',
      warehouseCode: 'sklad_1',
      warehouseName: '2 Магазин Астана',
      quantityAvailable: 3,
      snapshotDate: '2026-08-07',
    })
    expect(preview.data.inventory[0].warehouseCode).toMatch(/^[A-Za-z0-9._:-]+$/)
    expect(preview.quarantine).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCodes: expect.arrayContaining(['duplicate_key']) }),
      expect.objectContaining({
        reasonCodes: expect.arrayContaining(['invalid_number']),
        fields: expect.arrayContaining(['quantityAvailable']),
      }),
    ]))
  })

  it('leaves snapshotDate null, with provenance warning, when source has no date', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Артикул', 'Номенклатура', 'Склад', 'Доступно'],
      ['A-1', 'HONOR Item', '1 Центральный склад 2', 4],
    ])
    const preview = parseStoreImport(workbookBuffer([{ name: 'Остатки', sheet }]), 'inventory.xlsx')

    expect(preview.data.inventory[0].snapshotDate).toBeNull()
    expect(preview.issues).toContainEqual(expect.objectContaining({
      code: 'snapshot_date_missing',
      field: 'snapshotDate',
    }))
  })

  it('quantizes stock to NUMERIC(18,3) and rejects negative or unsafe quantities', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Артикул', 'Номенклатура', 'Склад', 'Доступно'],
      ['SAFE', 'HONOR Safe', '1 Центральный склад 2', 0.0005],
      ['NEGATIVE', 'HONOR Negative', '1 Центральный склад 2', -0.0004],
      ['OVERFLOW', 'HONOR Overflow', '1 Центральный склад 2', 10_000_000_000_000],
    ])
    const preview = parseStoreImport(
      workbookBuffer([{ name: 'Остатки', sheet }]),
      'inventory_2026_08_07.xlsx',
    )

    expect(preview.data.inventory).toEqual([expect.objectContaining({
      sku: 'SAFE',
      quantityAvailable: 0.001,
    })])
    expect(preview.quarantine).toHaveLength(2)
    for (const row of preview.quarantine) {
      expect(row.reasonCodes).toContain('invalid_number')
      expect(row.fields).toContain('quantityAvailable')
    }
  })
})

describe('parseStoreImport — sales', () => {
  it('detects sales before inventory and preserves signed returns in UTF-8 CSV', () => {
    const csv = [
      'ID строки;Дата;Артикул;Наименование;Количество;Стоимость;Скидка;Стоимость со скидкой;Себест/ед;Склад;Канал',
      'sale-1;01.07.2026 г.;X8-BLK;HONOR X8 Black;2;82,000 ₸;25;61,500 ₸;50,000 ₸;2 Магазин Астана;Магазин',
      'return-1;31.07.26;X8-BLK;HONOR X8 Black;-1;82,000 ₸;25;61,500 ₸;50,000 ₸;Каспий магазин Астана;Kaspi',
      'sale-1;02.07.2026;X8-BLU;HONOR X8 Blue;1;100;0;100;50;2 Магазин Астана;Магазин',
    ].join('\n')
    const preview = parseStoreImport(Buffer.from(csv, 'utf8'), 'Продажи_июль_2026.csv')

    expect(preview.detectedKinds).toEqual(['sales'])
    expect(preview.data.inventory).toEqual([])
    expect(preview.data.sales).toEqual([
      {
        externalLineId: 'sale-1',
        sku: 'X8-BLK',
        name: 'HONOR X8 Black',
        warehouseCode: 'astana_store',
        warehouseName: '2 Магазин Астана',
        channel: 'retail_store',
        occurredOn: '2026-07-01',
        quantity: 2,
        listAmount: 164_000,
        netRevenue: 123_000,
        costAmount: 100_000,
        discountAmount: 41_000,
      },
      {
        externalLineId: 'return-1',
        sku: 'X8-BLK',
        name: 'HONOR X8 Black',
        warehouseCode: 'astana_kaspi',
        warehouseName: 'Каспий магазин Астана',
        channel: 'kaspi',
        occurredOn: '2026-07-31',
        quantity: -1,
        listAmount: -82_000,
        netRevenue: -61_500,
        costAmount: -50_000,
        discountAmount: -20_500,
      },
    ])
    expect(preview.quarantine).toContainEqual(expect.objectContaining({
      reasonCodes: expect.arrayContaining(['duplicate_key']),
      fields: expect.arrayContaining(['externalLineId']),
    }))
  })

  it('quarantines amount sign mismatches and overlong IDs, but accepts documented markup', () => {
    const csv = [
      'ID строки;Дата;Артикул;Наименование;Количество;Сумма без скидки;Выручка;Себестоимость;Склад;Канал',
      'bad-sign;01.07.2026;A;HONOR A;1;-100;-80;-50;2 Магазин Астана;Магазин',
      'bad-net;01.07.2026;B;HONOR B;1;100;120;50;2 Магазин Астана;Магазин',
      `${'x'.repeat(201)};01.07.2026;C;HONOR C;1;100;80;50;2 Магазин Астана;Магазин`,
    ].join('\n')
    const preview = parseStoreImport(Buffer.from(csv, 'utf8'), 'sales.csv')

    expect(preview.data.sales).toEqual([expect.objectContaining({
      externalLineId: 'bad-net',
      listAmount: 100,
      netRevenue: 120,
      discountAmount: -20,
    })])
    expect(preview.quarantine).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCodes: expect.arrayContaining(['sign_mismatch']) }),
      expect.objectContaining({ reasonCodes: expect.arrayContaining(['value_too_long']) }),
    ]))
  })

  it('skips a formula-derived sales sheet without consuming quarantine budget', () => {
    const authoritative = XLSX.utils.aoa_to_sheet([
      ['Дата', 'Артикул', 'Наименование', 'Кол-во', 'Стоимость (прайс)', 'Стоимость со скидкой', 'Себест/ед', 'Склад'],
      ['01.07.2026', 'A-1', 'HONOR A', 1, 100, 80, 50, '2 Магазин Астана'],
    ])
    const derived = XLSX.utils.aoa_to_sheet([
      ['Дата', 'Артикул', 'Наименование', 'Кол-во', 'Стоимость (прайс)', 'Стоимость со скидкой', 'Себест/ед', 'Склад'],
      ['01.07.2026', 'A-1', 'HONOR A', 1, 100, 80, 50, '2 Магазин Астана'],
      ['02.07.2026', 'A-2', 'HONOR B', 1, 100, 80, 50, '2 Магазин Астана'],
    ])
    for (const address of ['A2', 'B2', 'C2', 'D2', 'A3', 'B3', 'C3', 'D3']) {
      derived[address] = { ...derived[address], f: `'Продажи по складам'!${address}` }
    }
    const preview = parseStoreImport(workbookBuffer([
      { name: 'Продажи по складам', sheet: authoritative },
      { name: 'Продажи · бонусы', sheet: derived },
    ]), 'sales_2026.xlsx')

    expect(preview.data.sales).toHaveLength(1)
    expect(preview.quarantine).toEqual([])
    expect(preview.issues).toContainEqual(expect.objectContaining({
      code: 'derived_formula_sheet_skipped',
      sheetName: 'Продажи · бонусы',
    }))
  })

  it('never uses a cached formula value as sales section context', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['2 Магазин Астана'],
      ['Дата', 'Артикул', 'Наименование', 'Кол-во', 'Стоимость (прайс)', 'Стоимость со скидкой', 'Себест/ед'],
      ['01.07.2026', 'A-1', 'HONOR A', 1, 100, 80, 50],
    ])
    sheet.A1 = { t: 's', f: 'UNTRUSTED()', v: '2 Магазин Астана' }
    const preview = parseStoreImport(workbookBuffer([{ name: 'Продажи', sheet }]), 'sales_2026.xlsx')

    expect(preview.data.sales).toEqual([])
    expect(preview.quarantine[0]).toMatchObject({
      reasonCodes: expect.arrayContaining(['missing_required_value']),
      fields: expect.arrayContaining(['warehouseName']),
    })
  })

  it.each([0.4, '40%', 40])('normalizes discount % value %p to one rate', (discount) => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Дата', 'Артикул', 'Наименование', 'Кол-во', 'Стоимость (прайс)', 'Скидка', 'Себест/ед', 'Склад'],
      ['01.07.2026', 'A-1', 'HONOR A', 1, 1_000, discount, 500, '2 Магазин Астана'],
    ])
    const preview = parseStoreImport(workbookBuffer([{ name: 'Продажи', sheet }]), 'sales_2026.xlsx')

    expect(preview.data.sales[0]).toMatchObject({
      listAmount: 1_000,
      netRevenue: 600,
      discountAmount: 400,
    })
  })

  it('accepts the exact HONOR repeat-header typo «Соимось» as list unit price', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['АСТАНА · МАГАЗИН'],
      ['Дата', 'Артикул', 'Наименование', 'Кол-во', 'Соимось', 'Стоимость со скидкой', 'Себест/ед'],
      ['01.07.2026', 'A-1', 'HONOR A', 2, 1_000, 750, 500],
    ])
    const preview = parseStoreImport(workbookBuffer([{ name: 'Продажи по складам', sheet }]), 'sales_2026.xlsx')

    expect(preview.data.sales).toEqual([expect.objectContaining({
      quantity: 2,
      listAmount: 2_000,
      netRevenue: 1_500,
      costAmount: 1_000,
      discountAmount: 500,
    })])
    expect(preview.quarantine).toEqual([])
  })

  it('ignores unsafe cached parallel amounts when an independent unit source is valid', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      [
        'ID строки', 'Дата', 'Артикул', 'Наименование', 'Количество',
        'Стоимость', 'Сумма без скидки', 'Стоимость со скидкой', 'Выручка',
        'Себест/ед', 'Себестоимость сумма', 'Склад',
      ],
      ['FORMULA', '01.07.2026', 'A', 'HONOR A', 1, 100, 100, 80, 80, 50, 50, '2 Магазин Астана'],
      ['ERROR', '01.07.2026', 'B', 'HONOR B', 1, 100, 100, 80, 80, 50, 50, '2 Магазин Астана'],
    ])
    sheet.G2 = { t: 'n', f: 'E2*F2', v: 100 }
    sheet.I3 = { t: 'e', v: 15, w: '#VALUE!' }

    const preview = parseStoreImport(
      workbookBuffer([{ name: 'Продажи', sheet }]),
      'sales_2026.xlsx',
    )

    expect(preview.data.sales).toEqual([
      expect.objectContaining({
        externalLineId: 'FORMULA',
        listAmount: 100,
        netRevenue: 80,
        costAmount: 50,
      }),
      expect.objectContaining({
        externalLineId: 'ERROR',
        listAmount: 100,
        netRevenue: 80,
        costAmount: 50,
      }),
    ])
    expect(preview.quarantine).toEqual([])
  })

  it('accepts a one-cent extended-amount tolerance and quarantines larger inconsistencies', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      [
        'ID строки', 'Дата', 'Артикул', 'Наименование', 'Количество',
        'Стоимость', 'Сумма без скидки', 'Стоимость со скидкой', 'Выручка',
        'Себест/ед', 'Себестоимость сумма', 'Склад',
      ],
      ['TOLERATED', '01.07.2026', 'A', 'HONOR A', 3, 333.33, 1_000, 300, 900, 200, 600, '2 Магазин Астана'],
      ['BAD', '01.07.2026', 'B', 'HONOR B', 3, 333.33, 1_000.02, 300, 900, 200, 600, '2 Магазин Астана'],
    ])
    const preview = parseStoreImport(
      workbookBuffer([{ name: 'Продажи', sheet }]),
      'sales_2026.xlsx',
    )

    expect(preview.data.sales).toEqual([expect.objectContaining({
      externalLineId: 'TOLERATED',
      listAmount: 1_000,
      netRevenue: 900,
      costAmount: 600,
      discountAmount: 100,
    })])
    expect(preview.quarantine).toContainEqual(expect.objectContaining({
      rowNumber: 3,
      reasonCodes: expect.arrayContaining(['amount_inconsistent']),
      fields: expect.arrayContaining(['listAmount']),
    }))
  })

  it('rounds half cents away from zero and preserves sale/return mirrors', () => {
    const halfCentValues = [1.005, 10.075, 1_234.565]
    const rows: unknown[][] = [[
      'ID строки', 'Дата', 'Артикул', 'Наименование', 'Количество',
      'Стоимость', 'Стоимость со скидкой', 'Себест/ед', 'Склад',
    ]]
    halfCentValues.forEach((value, index) => {
      rows.push([
        `SALE-${index}`, '01.07.2026', `SKU-${index}`, `HONOR ${index}`, 1,
        value, value, value, '2 Магазин Астана',
      ])
      rows.push([
        `RETURN-${index}`, '02.07.2026', `SKU-${index}`, `HONOR ${index}`, -1,
        value, value, value, '2 Магазин Астана',
      ])
    })

    const preview = parseStoreImport(
      workbookBuffer([{ name: 'Продажи', sheet: XLSX.utils.aoa_to_sheet(rows) }]),
      'sales_2026.xlsx',
    )

    expect(preview.quarantine).toEqual([])
    expect(preview.data.sales).toHaveLength(halfCentValues.length * 2)
    const expectedRounded = [1.01, 10.08, 1_234.57]
    expectedRounded.forEach((expected, index) => {
      const sale = preview.data.sales.find((row) => row.externalLineId === `SALE-${index}`)!
      const returned = preview.data.sales.find((row) => row.externalLineId === `RETURN-${index}`)!
      expect(sale.listAmount).toBe(expected)
      expect(returned.listAmount).toBe(-expected)
      expect(returned.netRevenue).toBe(-sale.netRevenue)
      expect(returned.costAmount).toBe(-sale.costAmount)
      expect(returned.discountAmount + sale.discountAmount).toBe(0)
    })
  })

  it('quantizes sales quantity before amount math and rejects zero/unsafe NUMERIC values', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['ID строки', 'Дата', 'Артикул', 'Наименование', 'Количество', 'Стоимость', 'Стоимость со скидкой', 'Себест/ед', 'Склад'],
      ['SAFE', '01.07.2026', 'A', 'HONOR A', 0.0005, 100, 80, 50, '2 Магазин Астана'],
      ['ZERO', '01.07.2026', 'B', 'HONOR B', 0.0004, 100, 80, 50, '2 Магазин Астана'],
      ['QTY-OVERFLOW', '01.07.2026', 'C', 'HONOR C', 10_000_000_000_000, 100, 80, 50, '2 Магазин Астана'],
      ['MONEY-OVERFLOW', '01.07.2026', 'D', 'HONOR D', 1, 100_000_000_000_000, 80, 50, '2 Магазин Астана'],
    ])
    const preview = parseStoreImport(
      workbookBuffer([{ name: 'Продажи', sheet }]),
      'sales_2026.xlsx',
    )

    expect(preview.data.sales).toEqual([expect.objectContaining({
      externalLineId: 'SAFE',
      quantity: 0.001,
      listAmount: 0.1,
      netRevenue: 0.08,
      costAmount: 0.05,
    })])
    expect(preview.quarantine).toHaveLength(3)
    for (const row of preview.quarantine) {
      expect(row.reasonCodes).toContain('invalid_number')
    }
  })
})

describe('parseStoreImport — safety limits', () => {
  it('rejects unsupported extensions and files larger than 10 MB before parsing', () => {
    expect(() => parseStoreImport(Buffer.from('x'), 'store.json')).toThrowError(StoreImportError)
    expect(() => parseStoreImport(Buffer.alloc(STORE_IMPORT_MAX_FILE_BYTES + 1), 'store.xlsx'))
      .toThrowError(expect.objectContaining({ code: 'file_too_large' }))
  })

  it('rejects XLSX ZIP bytes renamed to XLS instead of bypassing ZIP policy', () => {
    const buffer = workbookBuffer([{ name: 'Sheet', sheet: XLSX.utils.aoa_to_sheet([['x']]) }])
    expect(() => parseStoreImport(buffer, 'renamed.xls'))
      .toThrowError(expect.objectContaining({ code: 'file_type_mismatch' }))
  })

  it('rejects sheets wider than 64 columns', () => {
    const sheet = XLSX.utils.aoa_to_sheet([Array.from({ length: STORE_IMPORT_MAX_COLUMNS + 1 }, (_, i) => `C${i}`)])
    const buffer = workbookBuffer([{ name: 'Wide', sheet }])

    expect(() => parseStoreImport(buffer, 'wide.xlsx'))
      .toThrowError(expect.objectContaining({ code: 'column_limit_exceeded' }))
  })

  it('rejects more than 10,000 data rows', () => {
    const lines = ['Артикул;Номенклатура;Склад;Доступно']
    for (let index = 0; index <= STORE_IMPORT_MAX_ROWS; index += 1) {
      lines.push(`SKU-${index};HONOR ${index};1 Центральный склад 2;1`)
    }

    expect(() => parseStoreImport(Buffer.from(lines.join('\n')), 'inventory.csv'))
      .toThrowError(expect.objectContaining({ code: 'row_limit_exceeded' }))
  })

  it('does not silently truncate the row limit after a report preamble', () => {
    const lines = [
      'Отчёт по остаткам',
      'Компания HONOR',
      'Период 2026',
      '',
      'Валюта KZT',
      '',
      'Артикул;Номенклатура;Склад;Доступно',
    ]
    for (let index = 0; index <= STORE_IMPORT_MAX_ROWS; index += 1) {
      lines.push(`SKU-${index};HONOR ${index};1 Центральный склад 2;1`)
    }

    expect(() => parseStoreImport(Buffer.from(lines.join('\n')), 'inventory.csv'))
      .toThrowError(expect.objectContaining({ code: 'row_limit_exceeded' }))
  })
})
