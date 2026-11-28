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
  // Keep the preview endpoint tolerant during rolling deploys: previews
  // produced by the pre-financial schema do not contain this collection.
  const managementPeriods = preview.data.management_period ?? []
  if (managementPeriods.length > 0) {
    const rows = managementPeriods
    const pnlRows = rows.filter((row) => row.reportedGrossProfit !== null)
    totals['Периодов'] = rows.length
    totals['Выручка периодов, KZT'] = roundMoney(rows.reduce(
      (sum, row) => sum + row.revenue,
      0,
    ))
    totals['Себестоимость периодов, KZT'] = roundMoney(rows.reduce(
      (sum, row) => sum + row.costOfGoods,
      0,
    ))
    totals['Валовая прибыль (расчёт), KZT'] = roundMoney(rows.reduce(
      (sum, row) => sum + row.grossProfit,
      0,
    ))
    if (pnlRows.length > 0) {
      totals['P&L валовая прибыль, KZT'] = roundMoney(pnlRows.reduce(
        (sum, row) => sum + (row.reportedGrossProfit ?? 0),
        0,
      ))
      totals['Расходы периода, KZT'] = roundMoney(pnlRows.reduce(
        (sum, row) => sum + (row.periodExpenses ?? 0),
        0,
      ))
      totals['Бонусы, KZT'] = roundMoney(pnlRows.reduce(
        (sum, row) => sum + (row.bonusExpense ?? 0),
        0,
      ))
      totals['Списания, KZT'] = roundMoney(pnlRows.reduce(
        (sum, row) => sum + (row.writeOffExpense ?? 0),
        0,
      ))
      totals['EBITDA, KZT'] = roundMoney(pnlRows.reduce(
        (sum, row) => sum + (row.ebitda ?? 0),
        0,
      ))
    }
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
