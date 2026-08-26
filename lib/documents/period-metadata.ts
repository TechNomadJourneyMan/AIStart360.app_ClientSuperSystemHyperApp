export const DOCUMENT_TYPES = [
  'pl_report',
  'balance_sheet',
  'marketing_report',
  'ops_report',
  'crm_export',
  'audit',
  'other',
  'financial_report',
  'sales_report',
  'client_base',
  'patient_base',
  'pricelist',
  'services_catalog',
  'packages',
  'scripts',
  'brand_rules',
] as const

export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export type DocumentPeriodValidation =
  | {
      ok: true
      value: {
        docType: DocumentType
        periodYear: number | null
        periodQuarter: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null
      }
    }
  | { ok: false; code: string; message: string }

function reportYear(value: unknown): number | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d{4}$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN
  // Mirror the canonical documents table constraint (migration 019).
  return Number.isInteger(parsed) && parsed >= 2020 && parsed <= 2030
    ? parsed
    : 'invalid'
}

function reportQuarter(value: unknown): 'Q1' | 'Q2' | 'Q3' | 'Q4' | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return /^(Q1|Q2|Q3|Q4)$/.test(normalized)
    ? normalized as 'Q1' | 'Q2' | 'Q3' | 'Q4'
    : 'invalid'
}

/**
 * Generic Point A documents support annual/quarterly metadata, never a month.
 * P&L is intentionally annual because its revenue feeds the annual resolver;
 * monthly Store workbooks must use /store/imports instead.
 */
export function validateDocumentPeriodMetadata(
  docTypeValue: unknown,
  periodYearValue: unknown,
  periodQuarterValue: unknown,
): DocumentPeriodValidation {
  const docType = typeof docTypeValue === 'string' ? docTypeValue.trim() : ''
  if (!DOCUMENT_TYPES.includes(docType as DocumentType)) {
    return { ok: false, code: 'invalid_doc_type', message: 'Выберите поддерживаемый тип документа' }
  }

  const periodYear = reportYear(periodYearValue)
  if (periodYear === 'invalid') {
    return { ok: false, code: 'invalid_period_year', message: 'Укажите корректный отчётный год' }
  }
  const periodQuarter = reportQuarter(periodQuarterValue)
  if (periodQuarter === 'invalid') {
    return { ok: false, code: 'invalid_period_quarter', message: 'Квартал должен быть Q1, Q2, Q3 или Q4' }
  }

  if (docType === 'pl_report') {
    if (periodYear === null) {
      return { ok: false, code: 'pl_report_year_required', message: 'Для годового P&L укажите отчётный год' }
    }
    if (periodQuarter !== null) {
      return {
        ok: false,
        code: 'pl_report_must_be_annual',
        message: 'P&L Точки А должен быть годовым. Месячный отчёт загрузите через Магазин',
      }
    }
  } else if (periodQuarter !== null && periodYear === null) {
    return { ok: false, code: 'quarter_year_required', message: 'Для квартала укажите отчётный год' }
  }

  return {
    ok: true,
    value: {
      docType: docType as DocumentType,
      periodYear,
      periodQuarter,
    },
  }
}
