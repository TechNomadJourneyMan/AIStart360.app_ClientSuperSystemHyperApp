import { describe, expect, it } from 'vitest'

import { dispatch, listExtractors } from '@/lib/ai/extractors'
import type { ExtractorContext } from '@/lib/ai/extractors/types'

const ctx = (vertical: 'generic' | 'medical'): ExtractorContext => ({
  userId: 'u',
  companyId: 'c',
  runId: 'r',
  vertical,
})

describe('extractor registry', () => {
  it('lists registered extractors', () => {
    const all = listExtractors()
    expect(all.length).toBeGreaterThan(0)
    expect(all.some((e) => e.name === 'generic.sales-report')).toBe(true)
    expect(all.some((e) => e.name === 'medical.patient-base')).toBe(true)
  })

  it('dispatches survey in both verticals', () => {
    expect(dispatch(ctx('generic'), 'survey')?.name).toBe('survey')
    expect(dispatch(ctx('medical'), 'survey')?.name).toBe('survey')
  })

  it('dispatches medical patient_base only in medical vertical', () => {
    const med = dispatch(ctx('medical'), 'patient_base')
    expect(med?.name).toBe('medical.patient-base')
  })

  it('falls back to generic for unknown medical doc_type', () => {
    const fallback = dispatch(ctx('medical'), 'sales_report')
    expect(fallback?.name).toBe('generic.sales-report')
  })

  it('returns null when nothing matches', () => {
    expect(dispatch(ctx('generic'), 'totally_unknown_type')).toBeNull()
  })

  it('all 4 generic extractors registered', () => {
    for (const type of ['sales_report', 'crm_export', 'financial_pdf', 'pricelist', 'brand_guide']) {
      expect(dispatch(ctx('generic'), type), `generic.${type}`).not.toBeNull()
    }
  })
})
