import type {
  StoreImportIssue,
  StoreImportKind,
  StoreImportPreview,
} from './types'
import {
  buildStorePreviewDigest,
  STORE_IMPORT_SCHEMA_VERSION,
} from './publication'

const MAX_VISIBLE_ROWS = 12
const MAX_VISIBLE_ISSUES = 20

export interface StoreImportPreviewTransport {
  ready: boolean
  schemaVersion: number
  normalizedSha256: string
  fileName: string
  sha256: string
  kind: string
  sheetName: string | null
  rowCount: number
  acceptedRows: number
  quarantinedRows: number
  headers: string[]
  detectedColumns: Record<string, string>
  totals: Record<string, number>
  warnings: string[]
  errors: string[]
  previewRows: Array<Record<string, unknown>>
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function messages(issues: StoreImportIssue[], severity: StoreImportIssue['severity']): string[] {
  const matching = issues.filter((issue) => issue.severity === severity)
  const visible = matching.slice(0, MAX_VISIBLE_ISSUES).map((issue) => issue.message)
  if (matching.length > visible.length) {
    visible.push(`Ещё замечаний: ${matching.length - visible.length}`)
  }
  return visible
}

function quarantineWarnings(preview: StoreImportPreview): string[] {
  if (preview.quarantine.length === 0) return []
  const counts = new Map<string, number>()
  for (const row of preview.quarantine) {
    counts.set(row.sheetName, (counts.get(row.sheetName) ?? 0) + 1)
  }
  return Array.from(counts, ([sheetName, count]) =>
    `Лист «${sheetName}»: ${count.toLocaleString('ru-RU')} строк в карантине`,
  ).slice(0, 10)
}

function kindRows(preview: StoreImportPreview, kind: StoreImportKind): Array<Record<string, unknown>> {
  return preview.data[kind] as unknown as Array<Record<string, unknown>>
}

function previewTotals(preview: StoreImportPreview): Record<string, number> {
  const totals: Record<string, number> = {}
  if (preview.data.prices.length > 0) {
    totals['Товаров в прайсе'] = preview.data.prices.length
    totals['С закупочной ценой'] = preview.data.prices.filter(
      (row) => row.purchasePrice !== null,
    ).length
  }
  if (preview.data.inventory.length > 0) {
    totals['Остаток, ед.'] = roundMoney(preview.data.inventory.reduce(
      (sum, row) => sum + row.quantityAvailable,
      0,
    ))
  }
  if (preview.data.sales.length > 0) {
    totals['Выручка, KZT'] = roundMoney(preview.data.sales.reduce(
      (sum, row) => sum + row.netRevenue,
      0,
    ))
    totals['Себестоимость, KZT'] = roundMoney(preview.data.sales.reduce(
      (sum, row) => sum + row.costAmount,
      0,
    ))
    totals['Скидка, KZT'] = roundMoney(preview.data.sales.reduce(
      (sum, row) => sum + row.discountAmount,
      0,
    ))
    totals['Количество, ед.'] = roundMoney(preview.data.sales.reduce(
      (sum, row) => sum + row.quantity,
      0,
    ))
  }
  return totals
}

/**
 * Converts the full normalized parser result into a bounded browser DTO.
 * Accepted facts remain server-side; only a small sample and aggregate totals
 * are returned to the page.
 */
export function toStoreImportPreviewTransport(
  preview: StoreImportPreview,
): StoreImportPreviewTransport {
  const primaryKind = preview.detectedKinds[0] ?? null
  const primaryRows = primaryKind ? kindRows(preview, primaryKind) : []
  const previewRows = primaryRows.slice(0, MAX_VISIBLE_ROWS)
  const headers = previewRows[0] ? Object.keys(previewRows[0]) : []
  const recognizedSheets = preview.sheets.filter((sheet) => sheet.detectedKind !== null)

  return {
    ready: preview.summary.acceptedRows > 0
      && !preview.issues.some((issue) => issue.severity === 'error'),
    schemaVersion: STORE_IMPORT_SCHEMA_VERSION,
    normalizedSha256: buildStorePreviewDigest(preview),
    fileName: preview.file.fileName,
    sha256: preview.file.sha256,
    kind: preview.detectedKinds.length > 0 ? preview.detectedKinds.join(' + ') : 'unknown',
    sheetName: recognizedSheets.length > 0
      ? recognizedSheets.map((sheet) => sheet.sheetName).join(', ')
      : null,
    rowCount: preview.sheets.reduce((sum, sheet) => sum + sheet.candidateRows, 0),
    acceptedRows: preview.summary.acceptedRows,
    quarantinedRows: preview.summary.quarantinedRows,
    headers,
    detectedColumns: Object.fromEntries(preview.sheets.map((sheet) => [
      sheet.sheetName,
      sheet.detectedKind
        ? `${sheet.detectedKind} · заголовок ${sheet.headerRows.join(' + ') || '—'}`
        : 'не распознан',
    ])),
    totals: previewTotals(preview),
    warnings: [
      ...quarantineWarnings(preview),
      ...messages(preview.issues, 'warning'),
    ].slice(0, MAX_VISIBLE_ISSUES),
    errors: messages(preview.issues, 'error'),
    previewRows,
  }
}
