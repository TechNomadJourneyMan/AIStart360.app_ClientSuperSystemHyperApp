import { createHash } from 'node:crypto'
import type {
  StoreImportKind,
  StoreImportPreview,
  StoreInventoryImportRow,
  StoreManagementPeriodImportRow,
  StorePriceImportRow,
  StoreSalesImportRow,
} from './types'

export const STORE_IMPORT_PUBLISH_MAX_ROWS = 10_000
export const STORE_IMPORT_SCHEMA_VERSION = 1

export type StoreWarehouseKind =
  | 'store'
  | 'warehouse'
  | 'marketplace'
  | 'wholesale'
  | 'other'

interface StorePublishVariantFields {
  variantKey: string
  sku: string
  name: string
  normalizedName: string
}

export interface StorePublishPriceRow extends StorePublishVariantFields {
  snapshotDate: string
  purchasePrice: number | null
  retailPrice: number | null
  consignmentPrice: number | null
  wholesale25Price: number | null
  wholesale30Price: number | null
}

export interface StorePublishInventoryRow extends StorePublishVariantFields {
  snapshotDate: string
  warehouseCode: string
  warehouseName: string
  warehouseKind: StoreWarehouseKind
  quantityAvailable: number
  quantityReserved: number
}

export interface StorePublishSalesRow extends StorePublishVariantFields {
  externalLineId: string
  warehouseCode: string
  warehouseName: string
  warehouseKind: StoreWarehouseKind
  channel: StoreSalesImportRow['channel']
  occurredOn: string
  quantity: number
  listAmount: number
  netRevenue: number
  costAmount: number
  discountAmount: number
}

export interface StorePublishManagementPeriodRow {
  scopeKey: string
  periodStart: string
  periodEnd: string
  granularity: 'month'
  currency: 'KZT'
  revenueBasis: 'net_after_discounts_returns'
  revenue: number
  costAmount: number
  grossProfit: number
  grossMarginPct: number | null
  reportedGrossProfit: number | null
  grossProfitReconciliationDelta: number | null
  periodExpenses: number | null
  bonuses: number | null
  writeOffs: number | null
  ebitda: number | null
  ebitdaMarginPct: number | null
  completeness: StoreManagementPeriodImportRow['completeness']
  note: string | null
  sourceSheet: string
  sourceRange: string
}

export type StorePublishRow =
  | StorePublishPriceRow
  | StorePublishInventoryRow
  | StorePublishSalesRow
  | StorePublishManagementPeriodRow

export interface StorePublishPayload {
  importKind: StoreImportKind
  scopeKey: string
  effectiveDate: string | null
  periodStart: string | null
  periodEnd: string | null
  rowCount: number
  warningCount: number
  quarantinedCount: number
  rows: StorePublishRow[]
}

interface StorePublishManifestInput {
  sourceSha256: string
  sourceSizeBytes: number
  payload: StorePublishPayload
}

export type StorePublishValidationCode =
  | 'preview_not_ready'
  | 'mixed_import_kinds'
  | 'publish_row_limit_exceeded'
  | 'effective_date_required'
  | 'effective_date_invalid'
  | 'snapshot_date_mismatch'
  | 'inventory_scope_ambiguous'
  | 'sales_period_ambiguous'
  | 'variant_identity_invalid'
  | 'management_period_invalid'
  | 'management_period_duplicate'
  | 'management_period_inconsistent'

export class StorePublishValidationError extends Error {
  constructor(
    public readonly code: StorePublishValidationCode,
    message: string,
  ) {
    super(message)
    this.name = 'StorePublishValidationError'
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`
}

export function buildStorePublishManifestSha256({
  sourceSha256,
  sourceSizeBytes,
  payload,
}: StorePublishManifestInput): string {
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) {
    throw new StorePublishValidationError(
      'preview_not_ready',
      'SHA-256 исходного файла имеет неверный формат',
    )
  }
  return createHash('sha256').update(stableJson({
    sourceSha256,
    sourceSizeBytes,
    schemaVersion: STORE_IMPORT_SCHEMA_VERSION,
    payload,
  }), 'utf8').digest('hex')
}

/**
 * Binds the browser-visible preview to the complete normalized server result.
 * The digest contains no raw cells and is re-computed from the file on publish.
 */
export function buildStorePreviewDigest(preview: StoreImportPreview): string {
  return createHash('sha256').update(stableJson({
    schemaVersion: STORE_IMPORT_SCHEMA_VERSION,
    file: preview.file,
    detectedKinds: preview.detectedKinds,
    data: preview.data,
    quarantine: preview.quarantine,
    issues: preview.issues,
    sheets: preview.sheets,
    summary: preview.summary,
  }), 'utf8').digest('hex')
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function requireEffectiveDate(value: string | null | undefined): string {
  if (!value) {
    throw new StorePublishValidationError(
      'effective_date_required',
      'Для прайса или остатков нужна дата снимка',
    )
  }
  if (!isIsoDate(value)) {
    throw new StorePublishValidationError(
      'effective_date_invalid',
      'Дата снимка должна быть календарной датой ISO',
    )
  }
  return value
}

export function normalizeStoreVariantName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .match(/[\p{L}\p{N}]+/gu)
    ?.join(' ')
    .trim()
    .replace(/\s+/g, ' ') ?? ''
}

export function deriveStoreVariantKey(name: string): string {
  const normalized = normalizeStoreVariantName(name)
  if (!normalized || normalized.length > 300) {
    throw new StorePublishValidationError(
      'variant_identity_invalid',
      'Не удалось сформировать устойчивый ключ варианта',
    )
  }
  return `name-v1:${createHash('sha256').update(normalized, 'utf8').digest('hex')}`
}

function variantFields(row: { sku: string; name: string }): StorePublishVariantFields {
  const normalizedName = normalizeStoreVariantName(row.name)
  return {
    variantKey: deriveStoreVariantKey(row.name),
    sku: row.sku,
    name: row.name,
    normalizedName,
  }
}

function warehouseKind(code: string, name: string, channel?: StoreSalesImportRow['channel']): StoreWarehouseKind {
  const identity = `${code} ${name}`.toLocaleLowerCase('ru-RU')
  if (channel === 'kaspi' || identity.includes('kaspi') || identity.includes('каспи')) {
    return 'marketplace'
  }
  if (channel === 'wholesale' || identity.includes('опт')) return 'wholesale'
  if (identity.includes('магазин') || identity.includes('бутик')) return 'store'
  return 'warehouse'
}

function priceRow(row: StorePriceImportRow, snapshotDate: string): StorePublishPriceRow {
  return {
    ...variantFields(row),
    snapshotDate,
    purchasePrice: row.purchasePrice,
    retailPrice: row.retailPrice,
    consignmentPrice: row.consignmentPrice,
    wholesale25Price: row.wholesale25Price,
    wholesale30Price: row.wholesale30Price,
  }
}

function inventoryRow(
  row: StoreInventoryImportRow,
  snapshotDate: string,
): StorePublishInventoryRow {
  if (row.snapshotDate && row.snapshotDate !== snapshotDate) {
    throw new StorePublishValidationError(
      'snapshot_date_mismatch',
      'Дата в файле не совпадает с подтверждённой датой снимка',
    )
  }
  return {
    ...variantFields(row),
    snapshotDate,
    warehouseCode: row.warehouseCode,
    warehouseName: row.warehouseName,
    warehouseKind: warehouseKind(row.warehouseCode, row.warehouseName),
    quantityAvailable: row.quantityAvailable,
    quantityReserved: 0,
  }
}

function salesRow(row: StoreSalesImportRow): StorePublishSalesRow {
  return {
    ...variantFields(row),
    externalLineId: row.externalLineId,
    warehouseCode: row.warehouseCode,
    warehouseName: row.warehouseName,
    warehouseKind: warehouseKind(row.warehouseCode, row.warehouseName, row.channel),
    channel: row.channel,
    occurredOn: row.occurredOn,
    quantity: row.quantity,
    listAmount: row.listAmount,
    netRevenue: row.netRevenue,
    costAmount: row.costAmount,
    discountAmount: row.discountAmount,
  }
}

function salesPeriod(rows: StoreSalesImportRow[]): { start: string; end: string } {
  const dates = rows.map((row) => row.occurredOn).sort()
  const months = new Set(dates.map((date) => date.slice(0, 7)))
  if (months.size !== 1) {
    throw new StorePublishValidationError(
      'sales_period_ambiguous',
      'Один файл продаж должен относиться к одному календарному месяцу',
    )
  }
  return { start: dates[0], end: dates.at(-1)! }
}

function roundScale(value: number, scale: number): number {
  const factor = 10 ** scale
  const absolute = Math.abs(value) * factor
  const rounded = Math.floor(absolute + 0.5 + Number.EPSILON)
  return Math.sign(value) * rounded / factor
}

function validScaledNumber(value: number, scale: number, allowNegative = true): boolean {
  if (!Number.isFinite(value) || Math.abs(value) > 9_999_999_999_999_999.99) return false
  if (!allowNegative && value < 0) return false
  const scaled = value * (10 ** scale)
  return Number.isSafeInteger(Math.round(scaled))
    && Math.abs(scaled - Math.round(scaled)) < 1e-6
}

function expectedMonthEnd(periodStart: string): string | null {
  if (!isIsoDate(periodStart) || !periodStart.endsWith('-01')) return null
  const [year, month] = periodStart.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${periodStart.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`
}

function nullableValuesAreAllNull(values: unknown[]): boolean {
  return values.every((value) => value === null)
}

function managementPeriodRow(row: StoreManagementPeriodImportRow): StorePublishManagementPeriodRow {
  const expectedEnd = expectedMonthEnd(row.periodStart)
  if (
    !expectedEnd
    || row.periodEnd !== expectedEnd
    || row.granularity !== 'month'
    || row.currency !== 'KZT'
    || row.revenueBasis !== 'net_after_discounts_returns'
    || !validScaledNumber(row.revenue, 2, false)
    || !validScaledNumber(row.costOfGoods, 2, false)
    || !validScaledNumber(row.grossProfit, 2)
    || !['complete', 'partial', 'provisional'].includes(row.completeness)
    || (row.qualityNote !== null && (row.qualityNote.length < 1 || row.qualityNote.length > 500))
    || row.sourceSheet.length < 1
    || row.sourceSheet.length > 200
    || row.sourceRange.length < 1
    || row.sourceRange.length > 500
  ) {
    throw new StorePublishValidationError(
      'management_period_invalid',
      `Период ${row.periodStart} имеет недопустимую форму или точность`,
    )
  }

  const derivedGrossProfit = roundScale(row.revenue - row.costOfGoods, 2)
  const derivedGrossMargin = row.revenue === 0
    ? null
    : roundScale((derivedGrossProfit / row.revenue) * 100, 4)
  if (
    row.grossProfit !== derivedGrossProfit
    || row.grossMarginPct !== derivedGrossMargin
    || (row.grossMarginPct !== null && !validScaledNumber(row.grossMarginPct, 4))
  ) {
    throw new StorePublishValidationError(
      'management_period_inconsistent',
      `Валовая прибыль периода ${row.periodStart} не равна выручке минус себестоимость`,
    )
  }

  const pnlValues = [
    row.reportedGrossProfit,
    row.grossProfitReconciliationDelta,
    row.periodExpenses,
    row.bonusExpense,
    row.writeOffExpense,
    row.ebitda,
    row.ebitdaMarginPct,
  ]
  if (!nullableValuesAreAllNull(pnlValues)) {
    if (
      pnlValues.some((value) => value === null)
      || !validScaledNumber(row.reportedGrossProfit!, 2)
      || !validScaledNumber(row.grossProfitReconciliationDelta!, 2)
      || !validScaledNumber(row.periodExpenses!, 2, false)
      || !validScaledNumber(row.bonusExpense!, 2, false)
      || !validScaledNumber(row.writeOffExpense!, 2, false)
      || !validScaledNumber(row.ebitda!, 2)
      || !validScaledNumber(row.ebitdaMarginPct!, 4)
    ) {
      throw new StorePublishValidationError(
        'management_period_invalid',
        `P&L периода ${row.periodStart} должен быть полным и иметь допустимую точность`,
      )
    }
    const expectedDelta = roundScale(row.reportedGrossProfit! - row.grossProfit, 2)
    const expectedEbitda = roundScale(row.reportedGrossProfit! - row.periodExpenses!, 2)
    const expectedEbitdaMargin = row.revenue === 0
      ? null
      : roundScale((expectedEbitda / row.revenue) * 100, 4)
    if (
      row.grossProfitReconciliationDelta !== expectedDelta
      || Math.abs(expectedDelta) > 1
      || row.ebitda !== expectedEbitda
      || row.ebitdaMarginPct !== expectedEbitdaMargin
      || row.bonusExpense! > row.periodExpenses!
      || row.writeOffExpense! > row.periodExpenses!
    ) {
      throw new StorePublishValidationError(
        'management_period_inconsistent',
        `P&L периода ${row.periodStart} не прошёл сверку прибыли и EBITDA`,
      )
    }
  }

  return {
    scopeKey: `month:${row.periodStart.slice(0, 7)}`,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    granularity: row.granularity,
    currency: row.currency,
    revenueBasis: row.revenueBasis,
    revenue: row.revenue,
    costAmount: row.costOfGoods,
    grossProfit: row.grossProfit,
    grossMarginPct: row.grossMarginPct,
    reportedGrossProfit: row.reportedGrossProfit,
    grossProfitReconciliationDelta: row.grossProfitReconciliationDelta,
    periodExpenses: row.periodExpenses,
    bonuses: row.bonusExpense,
    writeOffs: row.writeOffExpense,
    ebitda: row.ebitda,
    ebitdaMarginPct: row.ebitdaMarginPct,
    completeness: row.completeness,
    note: row.qualityNote,
    sourceSheet: row.sourceSheet,
    sourceRange: row.sourceRange,
  }
}

function managementPeriodPayloadRows(
  rows: StoreManagementPeriodImportRow[],
): StorePublishManagementPeriodRow[] {
  const normalized = rows.map(managementPeriodRow)
  const sorted = [...normalized].sort((left, right) => left.periodStart.localeCompare(right.periodStart))
  const periods = new Set<string>()
  for (const row of sorted) {
    if (periods.has(row.periodStart)) {
      throw new StorePublishValidationError(
        'management_period_duplicate',
        `Период ${row.periodStart} повторяется в публикации`,
      )
    }
    periods.add(row.periodStart)
  }
  return sorted
}

export function buildStorePublishPayload(
  preview: StoreImportPreview,
  effectiveDate?: string | null,
): StorePublishPayload {
  if (
    preview.summary.acceptedRows < 1
    || preview.issues.some((issue) => issue.severity === 'error')
  ) {
    throw new StorePublishValidationError(
      'preview_not_ready',
      'Предпросмотр содержит блокирующие ошибки',
    )
  }
  if (preview.detectedKinds.length !== 1) {
    throw new StorePublishValidationError(
      'mixed_import_kinds',
      'Один запуск публикации должен содержать один тип данных',
    )
  }
  if (preview.summary.acceptedRows > STORE_IMPORT_PUBLISH_MAX_ROWS) {
    throw new StorePublishValidationError(
      'publish_row_limit_exceeded',
      'Число публикуемых строк превышает безопасный лимит',
    )
  }

  const importKind = preview.detectedKinds[0]
  const warningCount = preview.issues.filter((issue) => issue.severity === 'warning').length
  const quarantinedCount = preview.summary.quarantinedRows

  if (importKind === 'prices') {
    const date = requireEffectiveDate(effectiveDate)
    return {
      importKind,
      scopeKey: 'global',
      effectiveDate: date,
      periodStart: date,
      periodEnd: date,
      rowCount: preview.data.prices.length,
      warningCount,
      quarantinedCount,
      rows: preview.data.prices.map((row) => priceRow(row, date)),
    }
  }

  if (importKind === 'inventory') {
    const date = requireEffectiveDate(effectiveDate)
    const warehouseCodes = new Set(preview.data.inventory.map((row) => row.warehouseCode))
    if (warehouseCodes.size !== 1) {
      throw new StorePublishValidationError(
        'inventory_scope_ambiguous',
        'Один файл остатков должен относиться ровно к одному складу',
      )
    }
    const warehouseCode = Array.from(warehouseCodes)[0]
    return {
      importKind,
      scopeKey: `warehouse:${warehouseCode.toLocaleLowerCase('en-US')}`,
      effectiveDate: date,
      periodStart: date,
      periodEnd: date,
      rowCount: preview.data.inventory.length,
      warningCount,
      quarantinedCount,
      rows: preview.data.inventory.map((row) => inventoryRow(row, date)),
    }
  }

  if (importKind === 'management_period') {
    const rows = managementPeriodPayloadRows(preview.data.management_period)
    if (rows.length === 0) {
      throw new StorePublishValidationError(
        'preview_not_ready',
        'В предпросмотре нет управленческих периодов',
      )
    }
    const first = rows[0]
    const last = rows.at(-1)!
    return {
      importKind,
      scopeKey: `management_period:${first.periodStart.slice(0, 7)}:${last.periodStart.slice(0, 7)}`,
      effectiveDate: null,
      periodStart: first.periodStart,
      periodEnd: last.periodEnd,
      rowCount: rows.length,
      warningCount,
      quarantinedCount,
      rows,
    }
  }

  const period = salesPeriod(preview.data.sales)
  return {
    importKind,
    scopeKey: `month:${period.start.slice(0, 7)}`,
    effectiveDate: null,
    periodStart: period.start,
    periodEnd: period.end,
    rowCount: preview.data.sales.length,
    warningCount,
    quarantinedCount,
    rows: preview.data.sales.map(salesRow),
  }
}
