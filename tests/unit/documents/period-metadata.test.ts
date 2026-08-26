import { describe, expect, it } from 'vitest'

import { validateDocumentPeriodMetadata } from '@/lib/documents/period-metadata'

describe('document period metadata', () => {
  it('accepts only an annual P&L for the Point A annual resolver', () => {
    expect(validateDocumentPeriodMetadata('pl_report', 2026, null)).toEqual({
      ok: true,
      value: { docType: 'pl_report', periodYear: 2026, periodQuarter: null },
    })
    expect(validateDocumentPeriodMetadata('pl_report', 2026, 'Q3')).toMatchObject({
      ok: false,
      code: 'pl_report_must_be_annual',
    })
    expect(validateDocumentPeriodMetadata('pl_report', null, null)).toMatchObject({
      ok: false,
      code: 'pl_report_year_required',
    })
  })

  it('validates quarterly metadata for non-P&L documents', () => {
    expect(validateDocumentPeriodMetadata('marketing_report', '2026', 'q3')).toEqual({
      ok: true,
      value: { docType: 'marketing_report', periodYear: 2026, periodQuarter: 'Q3' },
    })
    expect(validateDocumentPeriodMetadata('marketing_report', null, 'Q3')).toMatchObject({
      ok: false,
      code: 'quarter_year_required',
    })
    expect(validateDocumentPeriodMetadata('sales_report', 2026, 'Q3')).toEqual({
      ok: true,
      value: { docType: 'sales_report', periodYear: 2026, periodQuarter: 'Q3' },
    })
    expect(validateDocumentPeriodMetadata('patient_base', 2026, null)).toEqual({
      ok: true,
      value: { docType: 'patient_base', periodYear: 2026, periodQuarter: null },
    })
  })
})
