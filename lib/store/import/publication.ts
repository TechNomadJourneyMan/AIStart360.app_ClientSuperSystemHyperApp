import { createHash } from 'node:crypto'
import type {
  StoreImportKind,
  StoreImportPreview,
  StoreInventoryImportRow,
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

export type StorePublishRow =
  | StorePublishPriceRow
  | StorePublishInventoryRow
  | StorePublishSalesRow

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
