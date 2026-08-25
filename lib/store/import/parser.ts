import { createHash } from 'node:crypto'
import * as XLSX from 'xlsx'

import type {
  StoreImportChannel,
  StoreImportFormat,
  StoreImportIssue,
  StoreImportKind,
  StoreImportPreview,
  StoreImportQuarantineItem,
  StoreImportQuarantineReason,
  StoreImportSheetPreview,
  StoreInventoryImportRow,
  StoreManagementPeriodCompleteness,
  StoreManagementPeriodImportRow,
  StorePriceImportRow,
  StoreSalesImportRow,
} from './types'

export const STORE_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024
export const STORE_IMPORT_MAX_ROWS = 10_000
export const STORE_IMPORT_MAX_COLUMNS = 64
export const STORE_IMPORT_MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
const STORE_IMPORT_HEADER_SCAN_ROWS = 100
const STORE_IMPORT_SHEET_ROW_SENTINEL = STORE_IMPORT_MAX_ROWS + STORE_IMPORT_HEADER_SCAN_ROWS + 2

export type StoreImportErrorCode =
  | 'unsupported_file_type'
  | 'file_type_mismatch'
  | 'file_too_large'
  | 'row_limit_exceeded'
  | 'column_limit_exceeded'
  | 'archive_limit_exceeded'
  | 'unreadable_file'

export class StoreImportError extends Error {
  constructor(
    public readonly code: StoreImportErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'StoreImportError'
  }
}

interface ColumnHeader {
  column: number
  top: string
  bottom: string
  normalizedTop: string
  normalizedBottom: string
  normalizedPath: string
}

interface PriceColumns {
  sku?: number
  name?: number
  purchasePrice?: number
  retailPrice?: number
  consignmentPrice?: number
  wholesale25Price?: number
  wholesale30Price?: number
}

interface InventoryColumns {
  sku?: number
  name?: number
  warehouseCode?: number
  warehouseName?: number
  quantityAvailable?: number
  snapshotDate?: number
}

interface SalesColumns {
  externalLineId?: number
  occurredOn?: number
  sku?: number
  name?: number
  warehouseCode?: number
  warehouseName?: number
  channel?: number
  quantity?: number
  listUnitPrice?: number
  listAmount?: number
  discountPercent?: number
  netUnitPrice?: number
  netRevenue?: number
  costUnitPrice?: number
  costAmount?: number
}

interface HeaderMatch<T> {
  row: number
  headerRows: number[]
  columns: T
  score: number
}

interface ParsedSheet<T> {
  rows: T[]
  quarantine: StoreImportQuarantineItem[]
  issues: StoreImportIssue[]
  preview: StoreImportSheetPreview
}

interface ParsedManagementWorkbook {
  rows: StoreManagementPeriodImportRow[]
  quarantine: StoreImportQuarantineItem[]
  issues: StoreImportIssue[]
  sheets: StoreImportSheetPreview[]
}

interface ManagementHeader {
  row: number
  kind: 'base' | 'pnl'
}

interface CandidateBudget {
  rows: number
}

interface ImportKeys {
  prices: Set<string>
  inventory: Set<string>
  sales: Set<string>
}

interface CellInspection {
  present: boolean
  value: unknown
  unsafeReason?: Extract<StoreImportQuarantineReason, 'formula_cell' | 'error_cell'>
}

const SPREADSHEET_ERROR_RE = /^(?:#REF!|#NAME\?|#DIV\/0!|#VALUE!|#N\/A|#NUM!|#NULL!)$/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MONEY_SCALE = 2
const QUANTITY_SCALE = 3
const NUMERIC_18_2_MAX = 9_999_999_999_999_999.99
const NUMERIC_18_3_MAX = 999_999_999_999_999.999
const AMOUNT_CONSISTENCY_TOLERANCE_MINOR_UNITS = 1

/**
 * Parse and normalize a store import without persisting it.
 *
 * SheetJS is used only as a file decoder. Formula cells are never evaluated or
 * trusted: a formula in a canonical source field quarantines that row.
 */
export function parseStoreImport(buffer: Buffer, fileName: string): StoreImportPreview {
  const format = getFormat(fileName)

  if (buffer.length > STORE_IMPORT_MAX_FILE_BYTES) {
    throw new StoreImportError(
      'file_too_large',
      `Файл превышает лимит ${STORE_IMPORT_MAX_FILE_BYTES} байт`,
    )
  }

  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const workbook = readWorkbook(buffer, format)
  const budget: CandidateBudget = { rows: 0 }

  const managementPeriod = parseManagementPeriodWorkbook(workbook, budget)
  if (managementPeriod) {
    const acceptedRows = managementPeriod.rows.length
    const quarantinedRows = managementPeriod.quarantine.length
    const skippedRows = managementPeriod.sheets.reduce(
      (sum, sheet) => sum + sheet.skippedRows,
      0,
    )
    const issues = [...managementPeriod.issues]
    if (acceptedRows === 0) {
      issues.push({
        code: 'no_importable_rows',
        severity: 'error',
        message: 'В файле не найдено ни одного безопасного управленческого периода',
      })
    }
    return {
      file: { fileName, format, sizeBytes: buffer.length, sha256 },
      detectedKinds: ['management_period'],
      data: {
        prices: [],
        inventory: [],
        sales: [],
        management_period: managementPeriod.rows,
      },
      quarantine: managementPeriod.quarantine,
      issues,
      sheets: managementPeriod.sheets,
      summary: { acceptedRows, quarantinedRows, skippedRows },
    }
  }

  const keys: ImportKeys = {
    prices: new Set<string>(),
    inventory: new Set<string>(),
    sales: new Set<string>(),
  }
  const issues: StoreImportIssue[] = []
  const sheets: StoreImportSheetPreview[] = []
  const quarantine: StoreImportQuarantineItem[] = []
  const prices: StorePriceImportRow[] = []
  const inventory: StoreInventoryImportRow[] = []
  const sales: StoreSalesImportRow[] = []
  const managementPeriodRows: StoreManagementPeriodImportRow[] = []
  const detectedKinds = new Set<StoreImportKind>()

  workbook.SheetNames.forEach((sheetName, sheetIndex) => {
    const sheet = workbook.Sheets[sheetName]
    const range = getUsedRange(sheet)
    const columnCount = range ? range.e.c - range.s.c + 1 : 0

    if (columnCount > STORE_IMPORT_MAX_COLUMNS) {
      throw new StoreImportError(
        'column_limit_exceeded',
        `Лист «${sheetName}» содержит ${columnCount} колонок; лимит — ${STORE_IMPORT_MAX_COLUMNS}`,
      )
    }

    if (!range) {
      sheets.push(emptySheetPreview(sheetName, columnCount))
      return
    }

    const inventoryHeader = findInventoryHeader(sheet, range)
    const salesHeader = findSalesHeader(sheet, range)
    const priceHeader = findPriceHeader(sheet, range)

    let parsed:
      | ParsedSheet<StorePriceImportRow>
      | ParsedSheet<StoreInventoryImportRow>
      | ParsedSheet<StoreSalesImportRow>
      | null = null

    // Inventory and sales signatures are more specific than a generic price
    // table, so they deliberately win if a sheet contains price-like columns.
    if (salesHeader && salesHeader.score >= 5) {
      parsed = parseSalesSheet(
        sheet,
        sheetName,
        sheetIndex,
        range,
        fileName,
        budget,
        keys.sales,
      )
      sales.push(...parsed.rows)
      detectedKinds.add('sales')
    } else if (inventoryHeader && inventoryHeader.score >= 3) {
      parsed = parseInventorySheet(
        sheet,
        sheetName,
        range,
        inventoryHeader,
        fileName,
        budget,
        keys.inventory,
      )
      inventory.push(...parsed.rows)
      detectedKinds.add('inventory')
    } else if (priceHeader && priceHeader.score >= 3) {
      parsed = parsePriceSheet(sheet, sheetName, range, priceHeader, budget, keys.prices)
      prices.push(...parsed.rows)
      detectedKinds.add('prices')
    }

    if (parsed) {
      quarantine.push(...parsed.quarantine)
      issues.push(...parsed.issues)
      sheets.push(parsed.preview)
      return
    }

    issues.push({
      code: 'sheet_not_recognized',
      severity: 'warning',
      message: `Лист «${sheetName}» не похож на прайс, остатки или продажи и был пропущен`,
      sheetName,
    })
    sheets.push(emptySheetPreview(sheetName, columnCount))
  })

  const acceptedRows = prices.length + inventory.length + sales.length
  const quarantinedRows = quarantine.length
  const skippedRows = sheets.reduce((sum, sheet) => sum + sheet.skippedRows, 0)

  if (acceptedRows === 0) {
    issues.push({
      code: 'no_importable_rows',
      severity: 'error',
      message: 'В файле не найдено ни одной безопасной строки для импорта',
    })
  }

  return {
    file: {
      fileName,
      format,
      sizeBytes: buffer.length,
      sha256,
    },
    detectedKinds: Array.from(detectedKinds),
    data: { prices, inventory, sales, management_period: managementPeriodRows },
    quarantine,
    issues,
    sheets,
    summary: { acceptedRows, quarantinedRows, skippedRows },
  }
}

function getFormat(fileName: string): StoreImportFormat {
  const match = /\.([^.]+)$/.exec(fileName.trim().toLowerCase())
  const extension = match?.[1]

  if (extension === 'xls' || extension === 'xlsx' || extension === 'csv') {
    return extension
  }

  throw new StoreImportError(
    'unsupported_file_type',
    'Поддерживаются только файлы XLS, XLSX и CSV',
  )
}

function readWorkbook(buffer: Buffer, format: StoreImportFormat): XLSX.WorkBook {
  try {
    const isZip = hasZipMagic(buffer)
    if (isZip) inspectZipEnvelope(buffer)
    if ((format === 'xlsx') !== isZip) {
      throw new StoreImportError(
        'file_type_mismatch',
        `Содержимое файла не соответствует расширению .${format}`,
      )
    }

    if (format === 'csv') {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '')
      return XLSX.read(text, {
        type: 'string',
        raw: true,
        cellDates: true,
        cellFormula: true,
        sheetRows: STORE_IMPORT_SHEET_ROW_SENTINEL,
      })
    }

    return XLSX.read(buffer, {
      type: 'buffer',
      raw: true,
      cellDates: true,
      cellFormula: true,
      sheetRows: STORE_IMPORT_SHEET_ROW_SENTINEL,
    })
  } catch (error) {
    if (error instanceof StoreImportError) throw error

    throw new StoreImportError(
      'unreadable_file',
      `Не удалось прочитать таблицу: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`,
    )
  }
}

function hasZipMagic(buffer: Buffer): boolean {
  if (buffer.length < 4) return false
  const signature = buffer.readUInt32LE(0)
  return signature === 0x04034b50 || signature === 0x06054b50 || signature === 0x08074b50
}

/** Reject obvious decompression bombs before SheetJS inflates XLSX XML parts. */
function inspectZipEnvelope(buffer: Buffer): void {
  const eocdSignature = 0x06054b50
  const centralSignature = 0x02014b50
  const firstSearchOffset = Math.max(0, buffer.length - 65_557)
  let eocdOffset = -1

  for (let offset = buffer.length - 22; offset >= firstSearchOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset
      break
    }
  }

  if (eocdOffset < 0 || eocdOffset + 22 > buffer.length) {
    throw new StoreImportError('unreadable_file', 'XLSX не содержит корректного ZIP-каталога')
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  const directoryOffset = buffer.readUInt32LE(eocdOffset + 16)
  if (entryCount === 0xffff || directoryOffset === 0xffffffff || entryCount > 16_384) {
    throw new StoreImportError('archive_limit_exceeded', 'XLSX содержит слишком много ZIP-записей')
  }

  let offset = directoryOffset
  let totalUncompressedBytes = 0
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== centralSignature) {
      throw new StoreImportError('unreadable_file', 'XLSX содержит повреждённый ZIP-каталог')
    }

    const compressedBytes = buffer.readUInt32LE(offset + 20)
    const uncompressedBytes = buffer.readUInt32LE(offset + 24)
    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    totalUncompressedBytes += uncompressedBytes

    const suspiciousRatio =
      uncompressedBytes > 4 * 1024 * 1024 &&
      (compressedBytes === 0 || uncompressedBytes / compressedBytes > 250)
    if (totalUncompressedBytes > STORE_IMPORT_MAX_UNCOMPRESSED_BYTES || suspiciousRatio) {
      throw new StoreImportError(
        'archive_limit_exceeded',
        `Распакованный XLSX превышает безопасный лимит ${STORE_IMPORT_MAX_UNCOMPRESSED_BYTES} байт`,
      )
    }

    offset += 46 + fileNameLength + extraLength + commentLength
  }
}

function getUsedRange(sheet: XLSX.WorkSheet): XLSX.Range | null {
  if (!sheet['!ref']) return null

  try {
    return XLSX.utils.decode_range(sheet['!ref'])
  } catch {
    throw new StoreImportError('unreadable_file', 'Таблица содержит некорректный диапазон ячеек')
  }
}

function emptySheetPreview(sheetName: string, columnCount: number): StoreImportSheetPreview {
  return {
    sheetName,
    detectedKind: null,
    headerRows: [],
    columnCount,
    candidateRows: 0,
    acceptedRows: 0,
    quarantinedRows: 0,
    skippedRows: 0,
  }
}

const MANAGEMENT_MONTHS = new Map<string, number>([
  ['январь', 1],
  ['февраль', 2],
  ['март', 3],
  ['апрель', 4],
  ['май', 5],
  ['июнь', 6],
  ['июль', 7],
  ['август', 8],
  ['сентябрь', 9],
  ['октябрь', 10],
  ['ноябрь', 11],
  ['декабрь', 12],
])

function findManagementHeader(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
): ManagementHeader | null {
  const lastRow = Math.min(range.e.r, range.s.r + 20)
  for (let row = range.s.r; row <= lastRow; row += 1) {
    const values = Array.from({ length: 8 }, (_, column) =>
      normalizeText(cellText(resolveMergedCell(sheet, row, column))),
    )
    if (
      values[0] === 'год'
      && values[1] === 'месяц'
      && /выручк/.test(values[2])
      && /(?:себест|закуп)/.test(values[3])
    ) return { row, kind: 'base' }

    if (
      values[0] === 'месяц'
      && /выручк/.test(values[1])
      && /(?:вал прибыль|gross profit)/.test(values[2])
      && /расходы периода/.test(values[3])
      && /бонус/.test(values[4])
      && /списан/.test(values[5])
    ) return { row, kind: 'pnl' }
  }
  return null
}

function managementPeriodBounds(year: number, month: number): { start: string; end: string } {
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { start: `${prefix}-01`, end: `${prefix}-${String(lastDay).padStart(2, '0')}` }
}

function managementCompleteness(note: string): StoreManagementPeriodCompleteness {
  const normalized = normalizeText(note)
  if (/частич/.test(normalized)) return 'partial'
  if (/предвар|чернов|provisional/.test(normalized)) return 'provisional'
  return 'complete'
}

function managementPercent(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null
  return quantizeNumeric((numerator / denominator) * 100, 4, 999_999.9999)
}

function managementIssue(
  code: Extract<StoreImportIssue['code'],
    | 'management_period_partial'
    | 'management_period_provisional'
    | 'management_period_pnl_ignored'
    | 'management_period_pnl_mismatch'>,
  message: string,
  sheetName: string,
  rowNumber: number,
): StoreImportIssue {
  return { code, severity: 'warning', message, sheetName, rowNumber }
}

/**
 * Parses the HONOR management workbook as period aggregates. It is purposely
 * exclusive: no monthly aggregate is ever converted into a synthetic sale.
 * Base revenue/cost remain canonical; P&L gross profit is retained separately
 * as an independently reported reconciliation value.
 */
function parseManagementPeriodWorkbook(
  workbook: XLSX.WorkBook,
  budget: CandidateBudget,
): ParsedManagementWorkbook | null {
  let baseSheetName: string | null = null
  let baseHeader: ManagementHeader | null = null

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const range = getUsedRange(sheet)
    if (!range) continue
    const header = findManagementHeader(sheet, range)
    if (header?.kind === 'base') {
      baseSheetName = sheetName
      baseHeader = header
      break
    }
  }
  if (!baseSheetName || !baseHeader) return null

  const rows: StoreManagementPeriodImportRow[] = []
  const quarantine: StoreImportQuarantineItem[] = []
  const issues: StoreImportIssue[] = []
  const sheets: StoreImportSheetPreview[] = []
  const byPeriod = new Map<string, StoreManagementPeriodImportRow>()
  const baseSheet = workbook.Sheets[baseSheetName]
  const baseRange = getUsedRange(baseSheet)!
  const baseColumnCount = baseRange.e.c - baseRange.s.c + 1
  if (baseColumnCount > STORE_IMPORT_MAX_COLUMNS) {
    throw new StoreImportError(
      'column_limit_exceeded',
      `Лист «${baseSheetName}» содержит ${baseColumnCount} колонок; лимит — ${STORE_IMPORT_MAX_COLUMNS}`,
    )
  }
  assertSheetRowLimit(baseSheetName, baseRange.e.r - baseHeader.row)

  let baseSkipped = 0
  for (let row = baseHeader.row + 1; row <= baseRange.e.r; row += 1) {
    if (!hasAnyCellValue(baseSheet, row, [0, 1, 2, 3, 7])) {
      baseSkipped += 1
      continue
    }

    const monthText = cleanText(inspectCell(baseSheet, row, 1).value)
    if (isTotalText(monthText)) {
      baseSkipped += 1
      continue
    }
    const month = MANAGEMENT_MONTHS.get(normalizeText(monthText))
    const hasFinancialCells = hasAnyCellValue(baseSheet, row, [2, 3])
    if (!month && !hasFinancialCells) {
      baseSkipped += 1
      continue
    }

    assertCandidateBudget(budget)
    const failures = new RowFailures()
    const yearCell = inspectCell(baseSheet, row, 0)
    const monthCell = inspectCell(baseSheet, row, 1)
    const revenueCell = inspectCell(baseSheet, row, 2)
    const costCell = inspectCell(baseSheet, row, 3)
    const noteCell = inspectCell(baseSheet, row, 7)
    failures.addUnsafe('year', yearCell)
    failures.addUnsafe('month', monthCell)
    failures.addUnsafe('revenue', revenueCell)
    failures.addUnsafe('costOfGoods', costCell)
    failures.addUnsafe('qualityNote', noteCell)

    const parsedYear = parseNumber(yearCell.value)
    const year = parsedYear !== null && Number.isInteger(parsedYear) ? parsedYear : null
    if (year === null || year < 2000 || year > 2100) failures.add('invalid_date', 'year')
    if (!month) failures.add('invalid_date', 'month')

    const rawRevenue = revenueCell.unsafeReason ? null : parseNumber(revenueCell.value)
    const rawCost = costCell.unsafeReason ? null : parseNumber(costCell.value)
    const revenue = rawRevenue === null ? null : quantizeMoney(rawRevenue)
    const costOfGoods = rawCost === null ? null : quantizeMoney(rawCost)
    if (rawRevenue === null || rawRevenue < 0 || revenue === null) {
      failures.add('invalid_number', 'revenue')
    }
    if (rawCost === null || rawCost < 0 || costOfGoods === null) {
      failures.add('invalid_number', 'costOfGoods')
    }

    const qualityNote = cleanText(noteCell.value) || null
    if (qualityNote && qualityNote.length > 500) failures.add('value_too_long', 'qualityNote')

    const periodKey = year !== null && month
      ? `${year}-${String(month).padStart(2, '0')}`
      : ''
    if (periodKey && byPeriod.has(periodKey)) failures.add('duplicate_key', 'periodStart')

    if (failures.any || year === null || !month || revenue === null || costOfGoods === null) {
      quarantine.push(failures.toQuarantine(baseSheetName, row, 'management_period'))
      continue
    }

    const bounds = managementPeriodBounds(year, month)
    const grossProfit = quantizeMoney(revenue - costOfGoods)!
    const completeness = managementCompleteness(qualityNote ?? '')
    const parsedRow: StoreManagementPeriodImportRow = {
      periodStart: bounds.start,
      periodEnd: bounds.end,
      granularity: 'month',
      currency: 'KZT',
      revenueBasis: 'net_after_discounts_returns',
      revenue,
      costOfGoods,
      grossProfit,
      grossMarginPct: managementPercent(grossProfit, revenue),
      reportedGrossProfit: null,
      grossProfitReconciliationDelta: null,
      periodExpenses: null,
      bonusExpense: null,
      writeOffExpense: null,
      ebitda: null,
      ebitdaMarginPct: null,
      completeness,
      qualityNote,
      sourceSheet: baseSheetName,
      sourceRange: `A${row + 1}:H${row + 1}`,
    }
    rows.push(parsedRow)
    byPeriod.set(periodKey, parsedRow)

    if (completeness === 'partial') {
      issues.push(managementIssue(
        'management_period_partial',
        `Период ${periodKey} помечен источником как частичный`,
        baseSheetName,
        row + 1,
      ))
    } else if (completeness === 'provisional') {
      issues.push(managementIssue(
        'management_period_provisional',
        `Период ${periodKey} помечен источником как предварительный`,
        baseSheetName,
        row + 1,
      ))
    }
  }

  sheets.push({
    sheetName: baseSheetName,
    detectedKind: 'management_period',
    headerRows: [baseHeader.row + 1],
    columnCount: baseColumnCount,
    candidateRows: rows.length + quarantine.length,
    acceptedRows: rows.length,
    quarantinedRows: quarantine.length,
    skippedRows: baseSkipped,
  })

  for (const sheetName of workbook.SheetNames) {
    if (sheetName === baseSheetName) continue
    const sheet = workbook.Sheets[sheetName]
    const range = getUsedRange(sheet)
    const columnCount = range ? range.e.c - range.s.c + 1 : 0
    if (columnCount > STORE_IMPORT_MAX_COLUMNS) {
      throw new StoreImportError(
        'column_limit_exceeded',
        `Лист «${sheetName}» содержит ${columnCount} колонок; лимит — ${STORE_IMPORT_MAX_COLUMNS}`,
      )
    }
    if (!range) {
      sheets.push(emptySheetPreview(sheetName, columnCount))
      continue
    }

    const header = findManagementHeader(sheet, range)
    if (header?.kind !== 'pnl') {
      const derived = /(?:по годам|сравнение по годам)/.test(normalizeText(sheetName))
      issues.push({
        code: derived ? 'derived_formula_sheet_skipped' : 'sheet_not_recognized',
        severity: 'warning',
        message: derived
          ? `Расчётный лист «${sheetName}» пропущен: формулы и их кэш не являются источником фактов`
          : `Лист «${sheetName}» не относится к управленческим периодам и был пропущен`,
        sheetName,
      })
      sheets.push(emptySheetPreview(sheetName, columnCount))
      continue
    }

    assertSheetRowLimit(sheetName, range.e.r - header.row)
    const pnlYear = inferYear(sheetName)
    let pnlAccepted = 0
    let pnlQuarantined = 0
    let pnlSkipped = 0
    for (let row = header.row + 1; row <= range.e.r; row += 1) {
      if (!hasAnyCellValue(sheet, row, [0, 1, 2, 3, 4, 5])) {
        pnlSkipped += 1
        continue
      }
      const monthCell = inspectCell(sheet, row, 0)
      const monthText = cleanText(monthCell.value)
      if (isTotalText(monthText)) {
        pnlSkipped += 1
        continue
      }
      const month = MANAGEMENT_MONTHS.get(normalizeText(monthText))
      if (!month && !hasAnyCellValue(sheet, row, [1, 2, 3, 4, 5])) {
        pnlSkipped += 1
        continue
      }

      assertCandidateBudget(budget)
      const failures = new RowFailures()
      failures.addUnsafe('month', monthCell)
      const fields = [
        ['revenue', 1],
        ['reportedGrossProfit', 2],
        ['periodExpenses', 3],
        ['bonusExpense', 4],
        ['writeOffExpense', 5],
      ] as const
      const values = new Map<(typeof fields)[number][0], number>()
      for (const [field, column] of fields) {
        const cell = inspectCell(sheet, row, column)
        failures.addUnsafe(field, cell)
        const raw = cell.unsafeReason ? null : parseNumber(cell.value)
        const value = raw === null ? null : quantizeMoney(raw)
        if (raw === null || value === null || (field !== 'reportedGrossProfit' && raw < 0)) {
          failures.add('invalid_number', field)
        } else {
          values.set(field, value)
        }
      }
      if (!pnlYear || !month) failures.add('invalid_date', 'month')

      const periodKey = pnlYear && month
        ? `${pnlYear}-${String(month).padStart(2, '0')}`
        : ''
      const target = periodKey ? byPeriod.get(periodKey) : undefined
      if (!target) failures.add('missing_required_value', 'periodStart')

      if (failures.any || !target) {
        quarantine.push(failures.toQuarantine(sheetName, row, 'management_period'))
        pnlQuarantined += 1
        issues.push(managementIssue(
          'management_period_pnl_ignored',
          `Строка P&L ${row + 1} не использована: независимые B–F должны быть безопасными числами`,
          sheetName,
          row + 1,
        ))
        continue
      }

      const pnlRevenue = values.get('revenue')!
      const reportedGrossProfit = values.get('reportedGrossProfit')!
      const reconciliationDelta = quantizeMoney(reportedGrossProfit - target.grossProfit)!
      if (
        !amountsAreConsistent(pnlRevenue, target.revenue)
        || Math.abs(reconciliationDelta) > 1
      ) {
        const mismatch = new RowFailures()
        mismatch.add('amount_inconsistent',
          !amountsAreConsistent(pnlRevenue, target.revenue) ? 'revenue' : 'reportedGrossProfit')
        quarantine.push(mismatch.toQuarantine(sheetName, row, 'management_period'))
        pnlQuarantined += 1
        issues.push(managementIssue(
          'management_period_pnl_mismatch',
          `Строка P&L ${periodKey} расходится с базовым управленческим периодом более чем на допустимое округление`,
          sheetName,
          row + 1,
        ))
        continue
      }

      const periodExpenses = values.get('periodExpenses')!
      const bonusExpense = values.get('bonusExpense')!
      const writeOffExpense = values.get('writeOffExpense')!
      if (bonusExpense > periodExpenses || writeOffExpense > periodExpenses) {
        const inconsistent = new RowFailures()
        inconsistent.add('amount_inconsistent', 'periodExpenses')
        quarantine.push(inconsistent.toQuarantine(sheetName, row, 'management_period'))
        pnlQuarantined += 1
        issues.push(managementIssue(
          'management_period_pnl_mismatch',
          `Строка P&L ${periodKey} содержит компонент расходов больше расходов периода`,
          sheetName,
          row + 1,
        ))
        continue
      }

      const ebitda = quantizeMoney(reportedGrossProfit - periodExpenses)!
      target.reportedGrossProfit = reportedGrossProfit
      target.grossProfitReconciliationDelta = reconciliationDelta
      target.periodExpenses = periodExpenses
      target.bonusExpense = bonusExpense
      target.writeOffExpense = writeOffExpense
      target.ebitda = ebitda
      target.ebitdaMarginPct = managementPercent(ebitda, target.revenue)
      target.sourceRange = `${target.sourceRange}; ${sheetName}!A${row + 1}:F${row + 1}`
      if (reconciliationDelta !== 0) {
        target.qualityNote = [
          target.qualityNote,
          'округление между management sheets',
        ].filter(Boolean).join('; ')
      }
      pnlAccepted += 1
    }

    sheets.push({
      sheetName,
      detectedKind: 'management_period',
      headerRows: [header.row + 1],
      columnCount,
      candidateRows: pnlAccepted + pnlQuarantined,
      acceptedRows: pnlAccepted,
      quarantinedRows: pnlQuarantined,
      skippedRows: pnlSkipped,
    })
  }

  rows.sort((left, right) => left.periodStart.localeCompare(right.periodStart))
  return { rows, quarantine, issues, sheets }
}

function findPriceHeader(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
): HeaderMatch<PriceColumns> | null {
  let best: HeaderMatch<PriceColumns> | null = null
  const lastHeaderCandidate = Math.min(range.e.r, range.s.r + 39)

  for (let row = range.s.r; row <= lastHeaderCandidate; row += 1) {
    const oneRowHeaders = buildHeaders(sheet, range, row)
    const oneRowColumns = mapPriceColumns(oneRowHeaders)
    const oneRowScore = scorePriceColumns(oneRowColumns)
    if (oneRowScore > (best?.score ?? 0)) {
      best = { row, headerRows: [row + 1], columns: oneRowColumns, score: oneRowScore }
    }

    if (row < range.e.r) {
      const twoRowHeaders = buildHeaders(sheet, range, row, row + 1)
      const twoRowColumns = mapPriceColumns(twoRowHeaders)
      const twoRowScore = scorePriceColumns(twoRowColumns)
      if (twoRowScore > (best?.score ?? 0)) {
        best = {
          row: row + 1,
          headerRows: [row + 1, row + 2],
          columns: twoRowColumns,
          score: twoRowScore,
        }
      }
    }
  }

  return best && best.columns.name !== undefined ? best : null
}

function findInventoryHeader(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
): HeaderMatch<InventoryColumns> | null {
  let best: HeaderMatch<InventoryColumns> | null = null
  const lastHeaderCandidate = Math.min(range.e.r, range.s.r + 49)

  for (let row = range.s.r; row <= lastHeaderCandidate; row += 1) {
    const columns = mapInventoryColumns(buildHeaders(sheet, range, row))
    const score = scoreInventoryColumns(columns)
    if (score > (best?.score ?? 0)) {
      best = { row, headerRows: [row + 1], columns, score }
    }
  }

  return best
}

function findSalesHeader(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
): HeaderMatch<SalesColumns> | null {
  let best: HeaderMatch<SalesColumns> | null = null
  const lastHeaderCandidate = Math.min(range.e.r, range.s.r + 99)

  for (let row = range.s.r; row <= lastHeaderCandidate; row += 1) {
    const columns = mapSalesColumns(buildHeaders(sheet, range, row))
    const score = scoreSalesColumns(columns)
    if (score > (best?.score ?? 0)) {
      best = { row, headerRows: [row + 1], columns, score }
    }
  }

  return best
}

function buildHeaders(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
  topRow: number,
  bottomRow?: number,
): ColumnHeader[] {
  const headers: ColumnHeader[] = []

  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const top = cellText(resolveMergedCell(sheet, topRow, column))
    const bottom = bottomRow === undefined
      ? ''
      : cellText(resolveMergedCell(sheet, bottomRow, column))
    const path = [top, bottom]
      .filter((value, index, values) => value && values.indexOf(value) === index)
      .join(' ')

    headers.push({
      column,
      top,
      bottom,
      normalizedTop: normalizeText(top),
      normalizedBottom: normalizeText(bottom),
      normalizedPath: normalizeText(path),
    })
  }

  return headers
}

function resolveMergedCell(sheet: XLSX.WorkSheet, row: number, column: number): XLSX.CellObject | undefined {
  const direct = sheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined
  if (direct && cellText(direct)) return direct

  const merge = sheet['!merges']?.find(
    (candidate) =>
      row >= candidate.s.r &&
      row <= candidate.e.r &&
      column >= candidate.s.c &&
      column <= candidate.e.c,
  )

  if (!merge) return undefined
  return sheet[XLSX.utils.encode_cell(merge.s)] as XLSX.CellObject | undefined
}

function mapPriceColumns(headers: ColumnHeader[]): PriceColumns {
  const columns: PriceColumns = {}

  columns.sku = findColumn(headers, (header) =>
    /^(?:артикул|sku|код товара|код номенклатуры)$/.test(header.normalizedPath),
  )
  columns.name = findColumn(headers, (header) =>
    /^(?:товар|номенклатура|наименование|name|product)$/.test(header.normalizedPath),
  )

  const currentPrice = (header: ColumnHeader) => {
    if (/старая|изменение/.test(header.normalizedPath)) return false
    if (header.normalizedBottom) return /^(?:цена|price)$/.test(header.normalizedBottom)
    return /(?:цена|price)/.test(header.normalizedPath)
  }

  columns.purchasePrice = findColumn(headers, (header) =>
    currentPrice(header) && /закупоч|purchase/.test(header.normalizedPath),
  )
  columns.retailPrice = findColumn(headers, (header) =>
    currentPrice(header) && /рознич|retail|реализац.*магазин/.test(header.normalizedPath),
  )
  columns.consignmentPrice = findColumn(headers, (header) =>
    currentPrice(header) && /конс[еи]гнац|консигнац|consignment/.test(header.normalizedPath),
  )
  columns.wholesale25Price = findColumn(headers, (header) =>
    currentPrice(header) && /(?:опт|wholesale)/.test(header.normalizedPath) && /25/.test(header.normalizedPath),
  )
  columns.wholesale30Price = findColumn(headers, (header) =>
    currentPrice(header) && /(?:опт|wholesale)/.test(header.normalizedPath) && /30/.test(header.normalizedPath),
  )

  return columns
}

function mapInventoryColumns(headers: ColumnHeader[]): InventoryColumns {
  return {
    sku: findColumn(headers, (header) =>
      /^(?:артикул|sku|код товара|код номенклатуры)$/.test(header.normalizedPath),
    ),
    name: findColumn(headers, (header) =>
      /^(?:товар|номенклатура|наименование|name|product)$/.test(header.normalizedPath),
    ),
    warehouseCode: findColumn(headers, (header) =>
      /^(?:код склада|warehouse code)$/.test(header.normalizedPath),
    ),
    warehouseName: findColumn(headers, (header) =>
      /^(?:склад|наименование склада|warehouse|warehouse name)$/.test(header.normalizedPath),
    ),
    quantityAvailable: findColumn(headers, (header) =>
      /^(?:доступно|количество доступно|доступный остаток|quantity available|available quantity)$/.test(header.normalizedPath),
    ) ?? findColumn(headers, (header) =>
      /^(?:остаток|количество|quantity|qty)$/.test(header.normalizedPath),
    ),
    snapshotDate: findColumn(headers, (header) =>
      /^(?:дата остатков|дата снимка|на дату|snapshot date|as of)$/.test(header.normalizedPath),
    ),
  }
}

function mapSalesColumns(headers: ColumnHeader[]): SalesColumns {
  const exact = (header: ColumnHeader, values: string[]) => values.includes(header.normalizedPath)

  return {
    externalLineId: findColumn(headers, (header) => exact(header, [
      'ид строки', 'id строки', 'external line id',
    ])),
    occurredOn: findColumn(headers, (header) => exact(header, [
      'дата', 'дата продажи', 'occurred on', 'sale date',
    ])),
    sku: findColumn(headers, (header) => exact(header, [
      'артикул', 'sku', 'код товара', 'код номенклатуры',
    ])),
    name: findColumn(headers, (header) => exact(header, [
      'товар', 'номенклатура', 'наименование', 'name', 'product',
    ])),
    warehouseCode: findColumn(headers, (header) => exact(header, [
      'код склада', 'warehouse code',
    ])),
    warehouseName: findColumn(headers, (header) => exact(header, [
      'склад', 'наименование склада', 'warehouse', 'warehouse name',
    ])),
    channel: findColumn(headers, (header) => exact(header, [
      'канал', 'канал продаж', 'channel',
    ])),
    quantity: findColumn(headers, (header) => exact(header, [
      'кол во', 'количество', 'quantity', 'qty',
    ])),
    listUnitPrice: findColumn(headers, (header) => exact(header, [
      'стоимость', 'соимось', 'стоимость прайс', 'цена', 'цена до скидки', 'цена по прайсу', 'list unit price',
    ])),
    listAmount: findColumn(headers, (header) => exact(header, [
      'сумма без скидки', 'общая сумма по прайсу', 'list amount',
    ])),
    discountPercent: findColumn(headers, (header) => exact(header, [
      'скидка', 'скидка %', 'процент скидки', 'discount', 'discount percent',
    ])),
    netUnitPrice: findColumn(headers, (header) => exact(header, [
      'стоимость со скидкой', 'цена со скидкой', 'net unit price',
    ])),
    netRevenue: findColumn(headers, (header) => exact(header, [
      'общаясумма', 'общая сумма', 'выручка', 'сумма со скидкой', 'чистая выручка', 'net revenue',
    ])),
    costUnitPrice: findColumn(headers, (header) => exact(header, [
      'себест ед', 'себестоимость ед', 'себестоимость за единицу', 'cost unit price',
    ])),
    costAmount: findColumn(headers, (header) => exact(header, [
      'себест сумма', 'себестоимость сумма', 'себестоимость', 'cost amount',
    ])),
  }
}

function findColumn(headers: ColumnHeader[], predicate: (header: ColumnHeader) => boolean): number | undefined {
  return headers.find(predicate)?.column
}

function scorePriceColumns(columns: PriceColumns): number {
  if (columns.name === undefined) return 0
  return 1 + [
    columns.purchasePrice,
    columns.retailPrice,
    columns.consignmentPrice,
    columns.wholesale25Price,
    columns.wholesale30Price,
  ].filter((column) => column !== undefined).length
}

function scoreInventoryColumns(columns: InventoryColumns): number {
  return [columns.sku, columns.name, columns.quantityAvailable]
    .filter((column) => column !== undefined).length
}

function scoreSalesColumns(columns: SalesColumns): number {
  let score = [columns.occurredOn, columns.name, columns.quantity]
    .filter((column) => column !== undefined).length

  if (columns.listUnitPrice !== undefined || columns.listAmount !== undefined) score += 1
  if (
    columns.netUnitPrice !== undefined ||
    columns.netRevenue !== undefined ||
    columns.discountPercent !== undefined
  ) score += 1
  if (columns.costUnitPrice !== undefined || columns.costAmount !== undefined) score += 1
  return score
}

function parsePriceSheet(
  sheet: XLSX.WorkSheet,
  sheetName: string,
  range: XLSX.Range,
  header: HeaderMatch<PriceColumns>,
  budget: CandidateBudget,
  seenKeys: Set<string>,
): ParsedSheet<StorePriceImportRow> {
  assertSheetRowLimit(sheetName, range.e.r - header.row)

  const rows: StorePriceImportRow[] = []
  const quarantine: StoreImportQuarantineItem[] = []
  const issues: StoreImportIssue[] = []
  let skippedRows = 0
  let warnedSyntheticSku = false

  for (let row = header.row + 1; row <= range.e.r; row += 1) {
    const candidateColumns = Object.values(header.columns).filter(
      (column): column is number => column !== undefined,
    )
    if (!hasAnyCellValue(sheet, row, candidateColumns)) {
      skippedRows += 1
      continue
    }

    assertCandidateBudget(budget)
    const nameCell = inspectCell(sheet, row, header.columns.name)
    const skuCell = inspectCell(sheet, row, header.columns.sku)
    const name = cleanText(nameCell.value)

    if (isTotalText(name)) {
      skippedRows += 1
      budget.rows -= 1
      continue
    }

    const failures = new RowFailures()
    failures.addUnsafe('name', nameCell)
    failures.addUnsafe('sku', skuCell)
    if (!name) failures.add('missing_required_value', 'name')

    const priceFields = [
      ['purchasePrice', header.columns.purchasePrice],
      ['retailPrice', header.columns.retailPrice],
      ['consignmentPrice', header.columns.consignmentPrice],
      ['wholesale25Price', header.columns.wholesale25Price],
      ['wholesale30Price', header.columns.wholesale30Price],
    ] as const
    const parsedPrices: Record<(typeof priceFields)[number][0], number | null> = {
      purchasePrice: null,
      retailPrice: null,
      consignmentPrice: null,
      wholesale25Price: null,
      wholesale30Price: null,
    }

    for (const [field, column] of priceFields) {
      const cell = inspectCell(sheet, row, column)
      failures.addUnsafe(field, cell)
      if (!cell.present || cell.unsafeReason) continue

      const sourceValue = parseNumber(cell.value)
      const value = sourceValue === null ? null : quantizeMoney(sourceValue)
      if (sourceValue === null || sourceValue < 0 || value === null) {
        failures.add('invalid_number', field)
      } else {
        parsedPrices[field] = value
      }
    }

    if (Object.values(parsedPrices).every((value) => value === null)) {
      failures.add('missing_required_value', 'prices')
    }

    const sku = cleanText(skuCell.value) || deriveSku(name)
    if (!sku) failures.add('missing_required_value', 'sku')
    if (sku.startsWith('name:') && !warnedSyntheticSku) {
      issues.push(syntheticSkuIssue(sheetName))
      warnedSyntheticSku = true
    }
    validateLength(failures, 'sku', sku, 160)
    validateLength(failures, 'name', name, 300)

    // A supplier article can intentionally span several size/color variants.
    // Full normalized name is therefore part of the file-local identity.
    const dedupKey = `${canonicalKey(sku)}\u0000${canonicalKey(name)}`
    if (dedupKey && seenKeys.has(dedupKey)) failures.add('duplicate_key', 'sku')

    if (failures.any) {
      quarantine.push(failures.toQuarantine(sheetName, row, 'prices'))
      continue
    }

    seenKeys.add(dedupKey)
    rows.push({ sku, name, ...parsedPrices })
  }

  return {
    rows,
    quarantine,
    issues,
    preview: {
      sheetName,
      detectedKind: 'prices',
      headerRows: header.headerRows,
      columnCount: range.e.c - range.s.c + 1,
      candidateRows: rows.length + quarantine.length,
      acceptedRows: rows.length,
      quarantinedRows: quarantine.length,
      skippedRows,
    },
  }
}

function parseInventorySheet(
  sheet: XLSX.WorkSheet,
  sheetName: string,
  range: XLSX.Range,
  header: HeaderMatch<InventoryColumns>,
  fileName: string,
  budget: CandidateBudget,
  seenKeys: Set<string>,
): ParsedSheet<StoreInventoryImportRow> {
  assertSheetRowLimit(sheetName, range.e.r - header.row)

  const rows: StoreInventoryImportRow[] = []
  const quarantine: StoreImportQuarantineItem[] = []
  const issues: StoreImportIssue[] = []
  let skippedRows = 0
  const inferredSnapshotDate = inferDateFromText(`${fileName} ${sheetName}`)
  const contextWarehouse = findInventoryWarehouseContext(sheet, range, header.row)
  let warnedMissingDate = false
  let warnedSyntheticSku = false

  for (let row = header.row + 1; row <= range.e.r; row += 1) {
    const columns = header.columns
    const candidateColumns = [columns.sku, columns.name, columns.quantityAvailable]
      .filter((column): column is number => column !== undefined)
    if (!hasAnyCellValue(sheet, row, candidateColumns)) {
      skippedRows += 1
      continue
    }

    const nameCell = inspectCell(sheet, row, columns.name)
    const skuCell = inspectCell(sheet, row, columns.sku)
    const quantityCell = inspectCell(sheet, row, columns.quantityAvailable)
    const name = cleanText(nameCell.value)

    if (isTotalText(name) || (!name && !cleanText(skuCell.value) && !quantityCell.present)) {
      skippedRows += 1
      continue
    }

    assertCandidateBudget(budget)
    const failures = new RowFailures()
    failures.addUnsafe('name', nameCell)
    failures.addUnsafe('sku', skuCell)
    failures.addUnsafe('quantityAvailable', quantityCell)
    if (!name) failures.add('missing_required_value', 'name')

    const sku = cleanText(skuCell.value) || deriveSku(name)
    if (!sku) failures.add('missing_required_value', 'sku')
    if (sku.startsWith('name:') && !warnedSyntheticSku) {
      issues.push(syntheticSkuIssue(sheetName))
      warnedSyntheticSku = true
    }

    const sourceQuantityAvailable = quantityCell.unsafeReason
      ? null
      : parseNumber(quantityCell.value)
    const quantityAvailable = sourceQuantityAvailable === null
      ? null
      : quantizeQuantity(sourceQuantityAvailable)
    if (
      sourceQuantityAvailable === null
      || sourceQuantityAvailable < 0
      || quantityAvailable === null
    ) {
      failures.add('invalid_number', 'quantityAvailable')
    }

    const warehouseNameCell = inspectCell(sheet, row, columns.warehouseName)
    const warehouseCodeCell = inspectCell(sheet, row, columns.warehouseCode)
    failures.addUnsafe('warehouseName', warehouseNameCell)
    failures.addUnsafe('warehouseCode', warehouseCodeCell)

    const sourceWarehouseName = cleanText(warehouseNameCell.value) || contextWarehouse
    const warehouse = resolveWarehouse(sourceWarehouseName, cleanText(warehouseCodeCell.value))
    if (!sourceWarehouseName) failures.add('missing_required_value', 'warehouseName')
    validateLength(failures, 'sku', sku, 160)
    validateLength(failures, 'name', name, 300)
    validateLength(failures, 'warehouseCode', warehouse.code, 80)
    validateLength(failures, 'warehouseName', warehouse.name, 200)

    const dateCell = inspectCell(sheet, row, columns.snapshotDate)
    failures.addUnsafe('snapshotDate', dateCell)
    let snapshotDate = inferredSnapshotDate
    if (dateCell.present && !dateCell.unsafeReason) {
      snapshotDate = parseDate(dateCell.value, inferYear(`${fileName} ${sheetName}`))
      if (!snapshotDate) failures.add('invalid_date', 'snapshotDate')
    }

    if (!snapshotDate && !warnedMissingDate) {
      issues.push({
        code: 'snapshot_date_missing',
        severity: 'warning',
        message: `Лист «${sheetName}» не содержит дату снимка остатков; snapshotDate оставлен null`,
        sheetName,
        field: 'snapshotDate',
      })
      warnedMissingDate = true
    }

    const dedupKey = [canonicalKey(sku), canonicalKey(name), canonicalKey(warehouse.code)].join('\u0000')
    if (seenKeys.has(dedupKey)) failures.add('duplicate_key', 'sku')

    if (failures.any || quantityAvailable === null || quantityAvailable < 0) {
      quarantine.push(failures.toQuarantine(sheetName, row, 'inventory'))
      continue
    }

    seenKeys.add(dedupKey)
    rows.push({
      sku,
      name,
      warehouseCode: warehouse.code,
      warehouseName: warehouse.name,
      quantityAvailable,
      snapshotDate,
    })
  }

  return {
    rows,
    quarantine,
    issues,
    preview: {
      sheetName,
      detectedKind: 'inventory',
      headerRows: header.headerRows,
      columnCount: range.e.c - range.s.c + 1,
      candidateRows: rows.length + quarantine.length,
      acceptedRows: rows.length,
      quarantinedRows: quarantine.length,
      skippedRows,
    },
  }
}

function parseSalesSheet(
  sheet: XLSX.WorkSheet,
  sheetName: string,
  sheetIndex: number,
  range: XLSX.Range,
  fileName: string,
  budget: CandidateBudget,
  seenKeys: Set<string>,
): ParsedSheet<StoreSalesImportRow> {
  assertSheetRowLimit(sheetName, range.e.r - range.s.r + 1)

  const rows: StoreSalesImportRow[] = []
  const quarantine: StoreImportQuarantineItem[] = []
  const issues: StoreImportIssue[] = []
  let skippedRows = 0
  let activeColumns: SalesColumns | null = null
  let activeHeaderRows: number[] = []
  let firstHeaderRows: number[] = []
  let sectionTitle = ''
  let warnedSyntheticSku = false
  const inferredYear = inferYear(`${fileName} ${sheetName} ${sheetText(sheet, range, range.s.r, Math.min(range.e.r, range.s.r + 15))}`)

  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const possibleHeader = mapSalesColumns(buildHeaders(sheet, range, row))
    if (scoreSalesColumns(possibleHeader) >= 5) {
      if (salesBlockIsFormulaDerived(sheet, range, row, possibleHeader)) {
        issues.push({
          code: 'derived_formula_sheet_skipped',
          severity: 'warning',
          message: `Формульный лист «${sheetName}» является производным и был целиком пропущен`,
          sheetName,
        })
        return {
          rows,
          quarantine,
          issues,
          preview: {
            sheetName,
            detectedKind: null,
            headerRows: [row + 1],
            columnCount: range.e.c - range.s.c + 1,
            candidateRows: 0,
            acceptedRows: 0,
            quarantinedRows: 0,
            skippedRows: range.e.r - range.s.r + 1,
          },
        }
      }
      activeColumns = possibleHeader
      activeHeaderRows = [row + 1]
      if (firstHeaderRows.length === 0) firstHeaderRows = activeHeaderRows
      sectionTitle = findSalesSectionTitle(sheet, range, row)
      skippedRows += 1
      continue
    }

    if (!activeColumns) {
      skippedRows += 1
      continue
    }

    const rowLabel = rowText(sheet, range, row)
    if (isTotalText(rowLabel)) {
      activeColumns = null
      activeHeaderRows = []
      skippedRows += 1
      continue
    }

    const candidateColumns = [
      activeColumns.occurredOn,
      activeColumns.sku,
      activeColumns.name,
      activeColumns.quantity,
      activeColumns.listUnitPrice,
      activeColumns.listAmount,
      activeColumns.netUnitPrice,
      activeColumns.netRevenue,
      activeColumns.costUnitPrice,
      activeColumns.costAmount,
    ].filter((column): column is number => column !== undefined)

    if (!hasAnyCellValue(sheet, row, candidateColumns, true)) {
      skippedRows += 1
      continue
    }

    const nameCell = inspectCell(sheet, row, activeColumns.name)
    const skuCell = inspectCell(sheet, row, activeColumns.sku)
    const quantityCell = inspectCell(sheet, row, activeColumns.quantity)
    const dateCell = inspectCell(sheet, row, activeColumns.occurredOn)
    const name = cleanText(nameCell.value)

    // Template rows often contain formulas only in derived amount columns. No
    // identity/date/quantity means they are blank templates, not bad imports.
    if (!name && !cleanText(skuCell.value) && !quantityCell.present && !dateCell.present) {
      skippedRows += 1
      continue
    }

    assertCandidateBudget(budget)
    const failures = new RowFailures()
    failures.addUnsafe('name', nameCell)
    failures.addUnsafe('sku', skuCell)
    failures.addUnsafe('quantity', quantityCell)
    failures.addUnsafe('occurredOn', dateCell)
    if (!name) failures.add('missing_required_value', 'name')

    const sku = cleanText(skuCell.value) || deriveSku(name)
    if (!sku) failures.add('missing_required_value', 'sku')
    if (sku.startsWith('name:') && !warnedSyntheticSku) {
      issues.push(syntheticSkuIssue(sheetName))
      warnedSyntheticSku = true
    }

    const sourceQuantity = quantityCell.unsafeReason ? null : parseNumber(quantityCell.value)
    const quantity = sourceQuantity === null ? null : quantizeQuantity(sourceQuantity)
    if (quantity === null || quantity === 0) failures.add('invalid_number', 'quantity')

    const occurredOn = dateCell.unsafeReason ? null : parseDate(dateCell.value, inferredYear)
    if (!occurredOn) failures.add('invalid_date', 'occurredOn')

    const list = readAmountSource(
      sheet,
      row,
      quantity,
      activeColumns.listUnitPrice,
      activeColumns.listAmount,
      'listAmount',
      failures,
    )

    let net = readAmountSource(
      sheet,
      row,
      quantity,
      activeColumns.netUnitPrice,
      activeColumns.netRevenue,
      'netRevenue',
      failures,
      false,
    )

    if (net === null && list !== null) {
      const discountCell = inspectCell(sheet, row, activeColumns.discountPercent)
      failures.addUnsafe('discountAmount', discountCell)
      if (discountCell.present && !discountCell.unsafeReason) {
        const discountRate = parseDiscountRate(discountCell.value)
        if (discountRate === null) {
          failures.add('invalid_number', 'discountAmount')
        } else {
          net = quantizeMoney(list * (1 - discountRate))
          if (net === null) failures.add('invalid_number', 'netRevenue')
        }
      } else if (activeColumns.netUnitPrice === undefined && activeColumns.netRevenue === undefined) {
        net = list
      }
    }

    const cost = readAmountSource(
      sheet,
      row,
      quantity,
      activeColumns.costUnitPrice,
      activeColumns.costAmount,
      'costAmount',
      failures,
    )

    if (list === null) failures.add('missing_required_value', 'listAmount')
    if (net === null) failures.add('missing_required_value', 'netRevenue')
    if (cost === null) failures.add('missing_required_value', 'costAmount')

    const warehouseNameCell = inspectCell(sheet, row, activeColumns.warehouseName)
    const warehouseCodeCell = inspectCell(sheet, row, activeColumns.warehouseCode)
    const channelCell = inspectCell(sheet, row, activeColumns.channel)
    failures.addUnsafe('warehouseName', warehouseNameCell)
    failures.addUnsafe('warehouseCode', warehouseCodeCell)
    failures.addUnsafe('channel', channelCell)

    const sourceWarehouseName = cleanText(warehouseNameCell.value) || sectionTitle
    const warehouse = resolveWarehouse(sourceWarehouseName, cleanText(warehouseCodeCell.value))
    const channel = resolveChannel(cleanText(channelCell.value) || sectionTitle)
    if (!sourceWarehouseName) failures.add('missing_required_value', 'warehouseName')

    const lineIdCell = inspectCell(sheet, row, activeColumns.externalLineId)
    failures.addUnsafe('externalLineId', lineIdCell)
    const externalLineId = cleanText(lineIdCell.value) || `sales:${sheetIndex + 1}:${row + 1}`
    validateLength(failures, 'externalLineId', externalLineId, 200)
    validateLength(failures, 'sku', sku, 160)
    validateLength(failures, 'name', name, 300)
    validateLength(failures, 'warehouseCode', warehouse.code, 80)
    validateLength(failures, 'warehouseName', warehouse.name, 200)

    const discount = list !== null && net !== null
      ? quantizeMoney(list - net)
      : null
    if (list !== null && net !== null && discount === null) {
      failures.add('invalid_number', 'discountAmount')
    }

    if (quantity !== null && list !== null && net !== null && cost !== null) {
      const amounts = [list, net, cost]
      const hasSignMismatch = quantity > 0
        ? amounts.some((amount) => amount < 0)
        : amounts.some((amount) => amount > 0)
      if (hasSignMismatch) failures.add('sign_mismatch', 'amounts')
    }

    const dedupKey = canonicalKey(externalLineId)
    if (dedupKey && seenKeys.has(dedupKey)) failures.add('duplicate_key', 'externalLineId')

    if (
      failures.any ||
      quantity === null ||
      occurredOn === null ||
      list === null ||
      net === null ||
      cost === null ||
      discount === null
    ) {
      quarantine.push(failures.toQuarantine(sheetName, row, 'sales'))
      continue
    }

    seenKeys.add(dedupKey)
    rows.push({
      externalLineId,
      sku,
      name,
      warehouseCode: warehouse.code,
      warehouseName: warehouse.name,
      channel,
      occurredOn,
      quantity,
      listAmount: list,
      netRevenue: net,
      costAmount: cost,
      discountAmount: discount,
    })
  }

  return {
    rows,
    quarantine,
    issues,
    preview: {
      sheetName,
      detectedKind: 'sales',
      headerRows: firstHeaderRows,
      columnCount: range.e.c - range.s.c + 1,
      candidateRows: rows.length + quarantine.length,
      acceptedRows: rows.length,
      quarantinedRows: quarantine.length,
      skippedRows,
    },
  }
}

function parseDiscountRate(value: unknown): number | null {
  const parsed = parseNumber(value)
  if (parsed === null) return null

  const isExplicitPercent = typeof value === 'string' && value.includes('%')
  const rate = isExplicitPercent || Math.abs(parsed) > 1 ? parsed / 100 : parsed
  return rate >= -1 && rate <= 1 ? rate : null
}

function salesBlockIsFormulaDerived(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
  headerRow: number,
  columns: SalesColumns,
): boolean {
  const identityColumns = [columns.occurredOn, columns.name, columns.quantity]
    .filter((column): column is number => column !== undefined)
  let populatedRows = 0
  let formulaIdentityRows = 0

  for (let row = headerRow + 1; row <= Math.min(range.e.r, headerRow + 25); row += 1) {
    const cells = identityColumns.map((column) =>
      sheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined,
    )
    if (cells.every((cell) => !cell || (cell.v === undefined && !cell.f))) continue
    populatedRows += 1
    if (cells.filter(Boolean).every((cell) => Boolean(cell?.f))) formulaIdentityRows += 1
  }

  return populatedRows >= 2 && formulaIdentityRows === populatedRows
}

function readAmountSource(
  sheet: XLSX.WorkSheet,
  row: number,
  quantity: number | null,
  unitColumn: number | undefined,
  amountColumn: number | undefined,
  field: string,
  failures: RowFailures,
  required = true,
): number | null {
  const unitCell = inspectCell(sheet, row, unitColumn)
  const amountCell = inspectCell(sheet, row, amountColumn)

  // Inspect both mapped sources, but never consume a cached formula/error.
  // Real HONOR templates intentionally keep derived formula totals beside raw
  // unit values. A safe independent source wins; an unsafe cell becomes a row
  // failure only when it is the sole available source.
  const hasSafeUnit = unitCell.present && !unitCell.unsafeReason
  const hasSafeAmount = amountCell.present && !amountCell.unsafeReason
  if (!hasSafeUnit && !hasSafeAmount) {
    failures.addUnsafe(field, unitCell)
    failures.addUnsafe(field, amountCell)
    if (required && !unitCell.present && !amountCell.present) {
      failures.add('missing_required_value', field)
    }
    return null
  }

  let fromUnit: number | null = null
  let fromAmount: number | null = null
  let invalid = false

  if (hasSafeUnit) {
    const unitValue = parseNumber(unitCell.value)
    fromUnit = unitValue === null || quantity === null
      ? null
      : quantizeMoney(quantity * unitValue)
    if (fromUnit === null) invalid = true
  }

  if (hasSafeAmount) {
    const amountValue = parseNumber(amountCell.value)
    fromAmount = amountValue === null ? null : quantizeMoney(amountValue)
    if (fromAmount === null) invalid = true
  }

  if (invalid) {
    failures.add('invalid_number', field)
    return null
  }

  if (fromUnit !== null && fromAmount !== null) {
    if (!amountsAreConsistent(fromUnit, fromAmount)) {
      failures.add('amount_inconsistent', field)
      return null
    }
    // The explicit line amount preserves source control totals. A one-minor-unit
    // difference is allowed for templates that round the extended amount once.
    return fromAmount
  }

  if (fromUnit !== null) return fromUnit
  if (fromAmount !== null) return fromAmount

  if (required) failures.add('missing_required_value', field)
  return null
}

class RowFailures {
  private readonly reasons = new Set<StoreImportQuarantineReason>()
  private readonly fields = new Set<string>()

  get any(): boolean {
    return this.reasons.size > 0
  }

  add(reason: StoreImportQuarantineReason, field: string): void {
    this.reasons.add(reason)
    this.fields.add(field)
  }

  addUnsafe(field: string, inspection: CellInspection): void {
    if (inspection.unsafeReason) this.add(inspection.unsafeReason, field)
  }

  toQuarantine(sheetName: string, zeroBasedRow: number, kind: StoreImportKind): StoreImportQuarantineItem {
    if (!this.any) this.add('invalid_row', 'row')
    return {
      sheetName,
      rowNumber: zeroBasedRow + 1,
      kind,
      reasonCodes: Array.from(this.reasons),
      fields: Array.from(this.fields),
    }
  }
}

function inspectCell(
  sheet: XLSX.WorkSheet,
  row: number,
  column: number | undefined,
): CellInspection {
  if (column === undefined) return { present: false, value: null }

  const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined
  if (!cell || cell.v === undefined || cell.v === null || cleanText(cell.v) === '') {
    // A formula is present even when it has no cached result.
    if (cell?.f) return { present: true, value: cell.v, unsafeReason: 'formula_cell' }
    return { present: false, value: null }
  }

  if (cell.f) return { present: true, value: cell.v, unsafeReason: 'formula_cell' }
  if (cell.t === 'e') return { present: true, value: cell.v, unsafeReason: 'error_cell' }

  if (typeof cell.v === 'string') {
    const value = cell.v.trim()
    if (SPREADSHEET_ERROR_RE.test(value)) {
      return { present: true, value, unsafeReason: 'error_cell' }
    }
    if (looksLikeFormulaText(value)) {
      return { present: true, value, unsafeReason: 'formula_cell' }
    }
  }

  return { present: true, value: cell.v }
}

function looksLikeFormulaText(value: string): boolean {
  if (/^[=+@]/.test(value)) return true
  if (!value.startsWith('-')) return false
  return parseNumber(value) === null
}

function hasAnyCellValue(
  sheet: XLSX.WorkSheet,
  row: number,
  columns: number[],
  ignoreFormulaOnly = false,
): boolean {
  return columns.some((column) => {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined
    if (!cell) return false
    if (ignoreFormulaOnly && cell.f && (cell.v === undefined || cell.v === null || cell.v === '')) return false
    return cell.f !== undefined || (cell.v !== undefined && cell.v !== null && cleanText(cell.v) !== '')
  })
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null

  let source = value
    .trim()
    .replace(/\u2212/g, '-')
    .replace(/(?:₸|тенге|kzt|\$|€|£|%)/gi, '')
    .replace(/[\s\u00A0\u202F']/g, '')

  if (!source) return null
  const negativeInParentheses = /^\(.*\)$/.test(source)
  if (negativeInParentheses) source = `-${source.slice(1, -1)}`
  if (!/^-?[\d.,]+$/.test(source)) return null

  const sign = source.startsWith('-') ? '-' : ''
  const unsigned = sign ? source.slice(1) : source
  const commaCount = (unsigned.match(/,/g) ?? []).length
  const dotCount = (unsigned.match(/\./g) ?? []).length
  let normalized = unsigned

  if (commaCount > 0 && dotCount > 0) {
    const lastComma = unsigned.lastIndexOf(',')
    const lastDot = unsigned.lastIndexOf('.')
    const decimalSeparator = lastComma > lastDot ? ',' : '.'
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ','
    normalized = unsigned.split(thousandsSeparator).join('').replace(decimalSeparator, '.')
  } else if (commaCount > 0) {
    normalized = normalizeSingleSeparator(unsigned, ',')
  } else if (dotCount > 0) {
    normalized = normalizeSingleSeparator(unsigned, '.')
  }

  const parsed = Number(`${sign}${normalized}`)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeSingleSeparator(value: string, separator: ',' | '.'): string {
  const pieces = value.split(separator)
  if (pieces.length === 1) return value

  const finalDigits = pieces.at(-1)?.length ?? 0
  if (pieces.length > 2) {
    if (finalDigits === 1 || finalDigits === 2) {
      return `${pieces.slice(0, -1).join('')}.${pieces.at(-1)}`
    }
    return pieces.join('')
  }

  if (finalDigits === 3) return pieces.join('')
  return `${pieces[0]}.${pieces[1]}`
}

function parseDate(value: unknown, inferredYear: number | null): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const decoded = XLSX.SSF.parse_date_code(value)
    if (!decoded) return null
    return formatDate(decoded.y, decoded.m, decoded.d)
  }

  if (typeof value !== 'string') return null
  const source = value.trim().replace(/\s*г\.?$/i, '')
  if (!source) return null

  if (ISO_DATE_RE.test(source)) {
    const [year, month, day] = source.split('-').map(Number)
    return formatDate(year, month, day)
  }

  const dmy = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/.exec(source)
  if (!dmy) return null

  const day = Number(dmy[1])
  const month = Number(dmy[2])
  let year = dmy[3] ? Number(dmy[3]) : inferredYear
  if (year !== null && year < 100) year += 2000
  if (year === null) return null
  return formatDate(year, month, day)
}

function formatDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function inferDateFromText(text: string): string | null {
  const normalized = text.replace(/\\/g, '/')
  const ymd = /(?:^|\D)(20\d{2})[_.-](\d{1,2})[_.-](\d{1,2})(?:\D|$)/.exec(normalized)
  if (ymd) return formatDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]))

  const dmy = /(?:^|\D)(\d{1,2})[_.-](\d{1,2})[_.-](20\d{2})(?:\D|$)/.exec(normalized)
  if (dmy) return formatDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]))
  return null
}

function inferYear(text: string): number | null {
  const match = /(?:^|\D)(20\d{2})(?:\D|$)/.exec(text)
  return match ? Number(match[1]) : null
}

function deriveSku(name: string): string {
  const normalizedName = normalizeText(name)
  if (!normalizedName) return ''
  const firstToken = cleanText(name).split(/\s+/)[0]?.replace(/^[,;:]+|[,;:]+$/g, '') ?? ''
  if (
    firstToken.length <= 64 &&
    /\d/.test(firstToken) &&
    /^[A-Za-zА-Яа-яЁё0-9._/-]+$/.test(firstToken)
  ) return firstToken
  const digest = createHash('sha256').update(normalizedName, 'utf8').digest('hex').slice(0, 24)
  return `name:${digest}`
}

function syntheticSkuIssue(sheetName: string): StoreImportIssue {
  return {
    code: 'synthetic_sku_generated',
    severity: 'warning',
    message: `На листе «${sheetName}» часть SKU получена из хеша полного названия; перед публикацией требуется сверка вариантов между источниками`,
    sheetName,
    field: 'sku',
  }
}

function resolveWarehouse(sourceName: string, explicitCode = ''): { code: string; name: string } {
  const normalized = normalizeText(`${sourceName} ${explicitCode}`)
  const safeExplicitCode = explicitCode ? sanitizeWarehouseCode(explicitCode) : ''

  if (/(?:усть камен|устькамен|ука)/.test(normalized) && /касп/.test(normalized)) {
    return { code: safeExplicitCode || 'ust_k_kaspi', name: sourceName || 'Kaspi Усть-Каменогорск' }
  }
  if (/астан/.test(normalized) && /касп/.test(normalized)) {
    return { code: safeExplicitCode || 'astana_kaspi', name: sourceName || 'Kaspi Астана' }
  }
  if (/(?:усть камен|устькамен|ука)/.test(normalized)) {
    return { code: safeExplicitCode || 'ust_k_store', name: sourceName || 'Магазин Усть-Каменогорск' }
  }
  if (/астан/.test(normalized)) {
    return { code: safeExplicitCode || 'astana_store', name: sourceName || 'Магазин Астана' }
  }
  if (/центральн|main warehouse/.test(normalized)) {
    return { code: safeExplicitCode || 'main_warehouse', name: sourceName || 'Центральный склад' }
  }

  const fallback = sourceName ? `warehouse:${stableDigest(sourceName)}` : 'unknown'
  return { code: safeExplicitCode || fallback, name: sourceName || 'Не указан' }
}

function resolveChannel(source: string): StoreImportChannel {
  const normalized = normalizeText(source)
  if (/касп|kaspi/.test(normalized)) return 'kaspi'
  if (/опт|wholesale/.test(normalized)) return 'wholesale'
  if (/магазин|retail/.test(normalized)) return 'retail_store'
  return 'other'
}

function findInventoryWarehouseContext(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
  headerRow: number,
): string {
  const before = sheetText(sheet, range, Math.max(range.s.r, headerRow - 8), headerRow - 1)
  const after = sheetText(sheet, range, headerRow + 1, Math.min(range.e.r, headerRow + 3))
  const combined = `${before} ${after}`
  const known = extractKnownWarehouseName(combined)
  if (known) return known

  for (let row = headerRow + 1; row <= Math.min(range.e.r, headerRow + 3); row += 1) {
    const values = rowValues(sheet, range, row)
    if (values.length === 1 && /склад|магазин|kaspi|касп/i.test(values[0])) return values[0]
  }
  return ''
}

function extractKnownWarehouseName(text: string): string {
  const patterns = [
    /1\s+Центральный склад\s*2/i,
    /2\s+Магазин Астана/i,
    /Касп(?:ий|и)? магазин Астана/i,
    /3\s+склад г\.?\s*Усть-Каменогорск/i,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match) return match[0]
  }
  return ''
}

function findSalesSectionTitle(sheet: XLSX.WorkSheet, range: XLSX.Range, headerRow: number): string {
  for (let row = headerRow - 1; row >= Math.max(range.s.r, headerRow - 8); row -= 1) {
    const values = rowValues(sheet, range, row)
    if (values.length === 0) continue
    const joined = values.join(' · ')
    if (isTotalText(joined)) continue
    if (/магазин|касп|kaspi|опт|астан|усть|ука/i.test(joined)) return joined
  }
  return ''
}

function sheetText(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
  startRow: number,
  endRow: number,
): string {
  const parts: string[] = []
  for (let row = startRow; row <= endRow; row += 1) parts.push(...rowValues(sheet, range, row))
  return parts.join(' ')
}

function rowText(sheet: XLSX.WorkSheet, range: XLSX.Range, row: number): string {
  return rowValues(sheet, range, row).join(' ')
}

function rowValues(sheet: XLSX.WorkSheet, range: XLSX.Range, row: number): string[] {
  const values: string[] = []
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined
    const value = cellText(cell)
    if (value) values.push(value)
  }
  return values
}

function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.f || cell.t === 'e' || cell.v === undefined || cell.v === null) return ''
  if (typeof cell.v === 'string' && (SPREADSHEET_ERROR_RE.test(cell.v.trim()) || looksLikeFormulaText(cell.v.trim()))) {
    return ''
  }
  return cleanText(cell.v)
}

function cleanText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value).replace(/[\u00A0\u202F]/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeText(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[_–—·:;()[\]{}]+/g, ' ')
    .replace(/[.,/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isTotalText(value: string): boolean {
  return /(?:^|\s)(?:итого|всего)(?:\s|$)/i.test(normalizeText(value))
}

function sanitizeWarehouseCode(value: string): string {
  if (/^[A-Za-z0-9._:-]+$/.test(value)) return value

  const transliteration: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's',
    т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
    ы: 'y', э: 'e', ю: 'yu', я: 'ya', ъ: '', ь: '',
  }
  return normalizeText(value)
    .split('')
    .map((letter) => transliteration[letter] ?? letter)
    .join('')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function stableDigest(value: string): string {
  return createHash('sha256').update(normalizeText(value), 'utf8').digest('hex').slice(0, 24)
}

function canonicalKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ru-RU')
}

function validateLength(
  failures: RowFailures,
  field: string,
  value: string,
  maximum: number,
): void {
  if (value.length > maximum) failures.add('value_too_long', field)
}

function quantizeMoney(value: number): number | null {
  return quantizeNumeric(value, MONEY_SCALE, NUMERIC_18_2_MAX)
}

function quantizeQuantity(value: number): number | null {
  return quantizeNumeric(value, QUANTITY_SCALE, NUMERIC_18_3_MAX)
}

/**
 * Quantize with an explicit half-away-from-zero rule. PostgreSQL NUMERIC can
 * represent more precision than a JavaScript number; values whose scaled minor
 * units are not safe integers are rejected rather than silently corrupted.
 */
function quantizeNumeric(value: number, scale: number, maximum: number): number | null {
  if (!Number.isFinite(value) || Math.abs(value) > maximum) return null

  const factor = 10 ** scale
  const scaled = Math.abs(value) * factor
  if (!Number.isFinite(scaled)) return null

  const lower = Math.floor(scaled)
  const fraction = scaled - lower
  const halfTolerance = Math.min(
    1e-7,
    Number.EPSILON * Math.max(1, scaled) * 8,
  )
  const roundUp = fraction > 0.5 || Math.abs(fraction - 0.5) <= halfTolerance
  const absoluteMinorUnits = lower + (roundUp ? 1 : 0)
  if (!Number.isSafeInteger(absoluteMinorUnits)) return null

  if (absoluteMinorUnits === 0) return 0
  return Math.sign(value) * absoluteMinorUnits / factor
}

function amountsAreConsistent(left: number, right: number): boolean {
  const factor = 10 ** MONEY_SCALE
  const leftMinorUnits = Math.round(left * factor)
  const rightMinorUnits = Math.round(right * factor)
  return Math.abs(leftMinorUnits - rightMinorUnits) <= AMOUNT_CONSISTENCY_TOLERANCE_MINOR_UNITS
}

function assertSheetRowLimit(sheetName: string, rows: number): void {
  if (rows > STORE_IMPORT_MAX_ROWS) {
    throw new StoreImportError(
      'row_limit_exceeded',
      `Лист «${sheetName}» содержит ${rows} строк данных; лимит — ${STORE_IMPORT_MAX_ROWS}`,
    )
  }
}

function assertCandidateBudget(budget: CandidateBudget): void {
  budget.rows += 1
  if (budget.rows > STORE_IMPORT_MAX_ROWS) {
    throw new StoreImportError(
      'row_limit_exceeded',
      `Файл содержит больше ${STORE_IMPORT_MAX_ROWS} строк данных`,
    )
  }
}
