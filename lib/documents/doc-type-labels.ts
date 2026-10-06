/**
 * Russian labels for documents.doc_type and the grouped list offered in the
 * client upload pickers. Browser-safe (no server imports).
 *
 * The set of values is owned by lib/documents/doc-types.ts (DOCUMENT_TYPES);
 * `Record<DocumentTypeValue, …>` makes the compiler reject a missing or an
 * unknown key, so this map can never drift from the server's list.
 */
import type { DocumentTypeValue } from './doc-types'

export const DOCUMENT_TYPE_LABELS: Record<DocumentTypeValue, string> = {
  pl_report: 'P&L (отчёт о прибылях и убытках)',
  pl_statement: 'P&L (отчёт о прибылях и убытках)',
  financial_report: 'Финансовый отчёт',
  balance_sheet: 'Баланс',
  marketing_report: 'Маркетинговый отчёт',
  ops_report: 'Операционный отчёт',
  crm_export: 'Выгрузка из CRM',
  audit: 'Аудит',
  other: 'Другое',
  sales_report: 'Отчёт по продажам',
  client_base: 'База клиентов',
  patient_base: 'База пациентов',
  pricelist: 'Прайс-лист',
  services_catalog: 'Каталог услуг',
  packages: 'Пакеты услуг',
  scripts: 'Скрипты продаж',
  brand_rules: 'Брендбук / правила бренда',
  business_plan: 'Бизнес-план',
  presentation: 'Презентация',
  marketplace_report: 'Отчёт маркетплейса',
  ads_report: 'Отчёт по рекламе',
  cart_funnel: 'Воронка корзины',
  inventory_csv: 'Остатки склада',
  ga4_export: 'Выгрузка Google Analytics 4',
  ecommerce_customers: 'Покупатели интернет-магазина',
}

export function documentTypeLabel(value: string | null | undefined): string {
  if (!value) return 'Тип не указан'
  return (DOCUMENT_TYPE_LABELS as Record<string, string>)[value] ?? value
}

export interface DocumentTypeGroup {
  label: string
  types: readonly DocumentTypeValue[]
}

/**
 * What a client can pick when uploading. `pl_statement` is a legacy alias of
 * `pl_report` (still valid for old rows) and is not offered twice.
 */
export const DOCUMENT_TYPE_GROUPS: readonly DocumentTypeGroup[] = [
  { label: 'Финансы', types: ['pl_report', 'financial_report', 'balance_sheet'] },
  { label: 'Продажи и клиенты', types: ['sales_report', 'crm_export', 'client_base'] },
  { label: 'Маркетинг', types: ['marketing_report', 'ads_report'] },
  { label: 'Операции и стратегия', types: ['ops_report', 'audit', 'business_plan', 'presentation', 'scripts'] },
  {
    label: 'Интернет-магазин',
    types: ['marketplace_report', 'cart_funnel', 'inventory_csv', 'ga4_export', 'ecommerce_customers'],
  },
  {
    label: 'Медицина',
    types: ['patient_base', 'pricelist', 'services_catalog', 'packages', 'brand_rules'],
  },
  { label: 'Прочее', types: ['other'] },
]
