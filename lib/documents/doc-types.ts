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

/**
 * Document types that carry the same kind of facts. A metric source declares
 * one `doc_type` (lib/metrics/descriptions.ts); the resolver and the binder
 * accept every type of its family, so revenue of a «Финансовый отчёт»
 * (financial_report) or a «P&L» from Точка А (pl_statement) feeds the same
 * metric as a pl_report. `other` (an unclassified upload) is accepted by every
 * family; plans and presentations (business_plan, presentation) hold targets,
 * not facts, and never feed a metric.
 */
export const DOC_TYPE_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  pl_report: ['pl_report', 'pl_statement', 'financial_report', 'audit'],
  balance_sheet: ['balance_sheet', 'financial_report', 'audit', 'pl_report', 'pl_statement'],
  marketing_report: ['marketing_report', 'ads_report', 'ga4_export'],
  crm_export: ['crm_export', 'sales_report', 'client_base'],
  sales_report: ['sales_report', 'crm_export', 'marketplace_report'],
  client_base: ['client_base', 'crm_export', 'ecommerce_customers'],
  ops_report: ['ops_report', 'inventory_csv'],
  inventory_csv: ['inventory_csv', 'ops_report', 'marketplace_report'],
  marketplace_report: ['marketplace_report', 'sales_report', 'cart_funnel', 'ecommerce_customers'],
}

/** Types whose facts a source declaring `docType` accepts (no type = every document). */
export function docTypesFor(docType: string | null | undefined): readonly string[] | null {
  if (!docType) return null
  return [...(DOC_TYPE_FAMILIES[docType] ?? [docType]), 'other']
}

/** Plans / presentations: targets, not facts. */
export const NON_FACT_DOC_TYPES: ReadonlySet<string> = new Set(['business_plan', 'presentation', 'brand_rules', 'scripts'])

/** Does a document of type `actual` satisfy a source declared for `declared`? */
export function docTypeMatches(declared: string | null | undefined, actual: string): boolean {
  if (NON_FACT_DOC_TYPES.has(actual)) return false
  const accepted = docTypesFor(declared)
  return accepted === null || accepted.includes(actual)
}
