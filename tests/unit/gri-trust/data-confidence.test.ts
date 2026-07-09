import { describe, it, expect } from 'vitest'
import { computeDataConfidence, type TrustSignals } from '@/lib/gri/trust'

function signals(over: Partial<TrustSignals> = {}): TrustSignals {
  return {
    surveyCompletion: null,
    hasFinancials: false,
    financialsConsistent: null,
    documentsCount: 0,
    hasCrm: false,
    hasMetrics: false,
    griHistoryCount: 0,
    dataFreshnessDays: null,
    marketConfirmedCount: 0,
    ...over,
  }
}

describe('computeDataConfidence — honest null when too little data', () => {
  it('returns null when fewer than 3 signals are present (no faked precision)', () => {
    expect(computeDataConfidence(signals())).toBeNull()
    expect(computeDataConfidence(signals({ surveyCompletion: 0.5, hasFinancials: true }))).toBeNull()
  })
})

describe('computeDataConfidence — scoring', () => {
  it('scores a fully-evidenced business at 100 / high with nothing missing', () => {
    const r = computeDataConfidence(signals({
      surveyCompletion: 1,
      hasFinancials: true,
      financialsConsistent: true,
      documentsCount: 3,
      hasCrm: true,
      hasMetrics: true,
      griHistoryCount: 3,
      dataFreshnessDays: 10,
      marketConfirmedCount: 5,
    }))
    expect(r).not.toBeNull()
    expect(r!.score).toBe(100)
    expect(r!.level).toBe('high')
    expect(r!.missing).toHaveLength(0)
  })

  it('computes a partial score and names what is missing', () => {
    const r = computeDataConfidence(signals({
      surveyCompletion: 0.5, // .15
      hasFinancials: true,   // .20
      hasCrm: true,          // .10
    }))
    expect(r).not.toBeNull()
    expect(r!.score).toBe(45)
    expect(r!.level).toBe('medium')
    expect(r!.missing).toContain('Документы')
    expect(r!.missing).not.toContain('CRM')
  })

  it('labels a low-confidence profile accordingly', () => {
    const r = computeDataConfidence(signals({
      surveyCompletion: 0.3, // .09
      documentsCount: 1,     // min(1/3,1)*.10 ≈ .0333
      hasCrm: true,          // .10
    }))
    expect(r).not.toBeNull()
    expect(r!.level).toBe('low')
  })
})
