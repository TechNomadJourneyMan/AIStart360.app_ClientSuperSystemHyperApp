import { describe, it, expect } from 'vitest'
import { calculatePointA } from '@/lib/point-a-engine'
import { pointAFromDiagnosticRow } from '@/lib/point-a/from-row'
import { CURRENT_TYPICAL } from '../point-a/fixtures/answer-sets'

describe('pointAFromDiagnosticRow', () => {
  it('round-trips the stored columns', () => {
    const pa = calculatePointA(CURRENT_TYPICAL)
    const row = {
      overall_score: String(pa.overall_score), health_index: pa.health_index, stage: pa.stage,
      finance_score: pa.blocks.finance, marketing_score: pa.blocks.marketing, operations_score: pa.blocks.operations,
      strategy_score: pa.blocks.strategy, sales_score: pa.blocks.sales,
      risks: pa.risks, insights: pa.insights, quick_wins: pa.quick_wins, data_gaps: pa.data_gaps,
    }
    expect(pointAFromDiagnosticRow(row)).toEqual(pa)
  })

  it('a row without a score or blocks is no Point A', () => {
    expect(pointAFromDiagnosticRow(null)).toBeNull()
    expect(pointAFromDiagnosticRow({ overall_score: null })).toBeNull()
    expect(pointAFromDiagnosticRow({ overall_score: 50, finance_score: null })).toBeNull()
  })
})
