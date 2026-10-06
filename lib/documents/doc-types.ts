/**
 * Allowed values of documents.doc_type — mirrors the CHECK constraint of
 * migration 089. API routes validate against this list so a bad value is a
 * 400 with a clear message instead of a constraint-violation 500.
 */
export const DOCUMENT_TYPES = [
  // generic
  'pl_report', 'balance_sheet', 'marketing_report', 'ops_report', 'crm_export',
  'audit', 'other', 'financial_report',
  // v3 Point A
  'sales_report', 'client_base',
  // medical
  'patient_base', 'pricelist', 'services_catalog', 'packages', 'scripts', 'brand_rules',
  // point-a FileArea
  'pl_statement', 'business_plan', 'presentation',
  // e-commerce exports
  'marketplace_report', 'ads_report', 'cart_funnel', 'inventory_csv', 'ga4_export',
  'ecommerce_customers',
] as const

export type DocumentTypeValue = (typeof DOCUMENT_TYPES)[number]

export function isDocumentType(value: unknown): value is DocumentTypeValue {
  return typeof value === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(value)
}

/** Sales-transaction feeds: row extraction produces parsed_data.raw_rows. */
export const SALES_LIKE_TYPES: ReadonlySet<string> = new Set([
  'sales_report', 'crm_export', 'marketplace_report', 'ads_report', 'cart_funnel', 'inventory_csv', 'ga4_export',
])

/** Client registries: row extraction produces parsed_data.client_rows. */
export const CLIENT_LIKE_TYPES: ReadonlySet<string> = new Set(['client_base', 'patient_base', 'ecommerce_customers'])
