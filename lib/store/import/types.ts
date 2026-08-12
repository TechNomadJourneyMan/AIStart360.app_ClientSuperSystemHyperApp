export type StoreImportFormat = 'xls' | 'xlsx' | 'csv'

export type StoreImportKind = 'prices' | 'inventory' | 'sales'

export type StoreImportChannel =
  | 'retail_store'
  | 'kaspi'
  | 'wholesale'
  | 'other'

export interface StorePriceImportRow {
  sku: string
  name: string
  purchasePrice: number | null
  retailPrice: number | null
  consignmentPrice: number | null
  wholesale25Price: number | null
  wholesale30Price: number | null
}

export interface StoreInventoryImportRow {
  sku: string
  name: string
  warehouseCode: string
  warehouseName: string
  quantityAvailable: number
  /** ISO calendar date. Null means the source did not contain an as-of date. */
  snapshotDate: string | null
}

export interface StoreSalesImportRow {
  externalLineId: string
  sku: string
  name: string
  warehouseCode: string
  warehouseName: string
  channel: StoreImportChannel
  occurredOn: string
  quantity: number
  listAmount: number
  netRevenue: number
  costAmount: number
  discountAmount: number
}

export type StoreImportQuarantineReason =
  | 'formula_cell'
  | 'error_cell'
  | 'missing_required_value'
  | 'invalid_number'
  | 'invalid_date'
  | 'duplicate_key'
  | 'sign_mismatch'
  | 'amount_inconsistent'
  | 'value_too_long'
  | 'invalid_row'

export interface StoreImportQuarantineItem {
  sheetName: string
  /** One-based spreadsheet row number, as shown to the user. */
  rowNumber: number
  kind: StoreImportKind
  reasonCodes: StoreImportQuarantineReason[]
  /** Canonical field names affected by the quarantine decision. */
  fields: string[]
}

export interface StoreImportIssue {
  code:
    | 'snapshot_date_missing'
    | 'sheet_not_recognized'
    | 'derived_formula_sheet_skipped'
    | 'synthetic_sku_generated'
    | 'row_quarantined'
    | 'no_importable_rows'
  severity: 'warning' | 'error'
  message: string
  sheetName?: string
  rowNumber?: number
  field?: string
}

export interface StoreImportSheetPreview {
  sheetName: string
  detectedKind: StoreImportKind | null
  /** One-based spreadsheet row numbers used as headers. */
  headerRows: number[]
  columnCount: number
  candidateRows: number
  acceptedRows: number
  quarantinedRows: number
  skippedRows: number
}

export interface StoreImportPreview {
  file: {
    fileName: string
    format: StoreImportFormat
    sizeBytes: number
    sha256: string
  }
  detectedKinds: StoreImportKind[]
  data: {
    prices: StorePriceImportRow[]
    inventory: StoreInventoryImportRow[]
    sales: StoreSalesImportRow[]
  }
  quarantine: StoreImportQuarantineItem[]
  issues: StoreImportIssue[]
  sheets: StoreImportSheetPreview[]
  summary: {
    acceptedRows: number
    quarantinedRows: number
    skippedRows: number
  }
}
