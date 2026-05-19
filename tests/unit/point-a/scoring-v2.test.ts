import { describe, it, expect } from 'vitest'
import { scoreV2, classifyMetricToBlock } from '@/lib/point-a/scoring-v2'
import type { PointA, BlockScore } from '@/types/onboarding'
import type { MetricValue } from '@/lib/metrics/types'

// ─── Test fixtures ──────────────────────────────────────────

function makeBlockScore(score: number): BlockScore {
  return {
    score,
    status:
      score >= 80 ? 'excellent'
      : score >= 65 ? 'strong'
      : score >= 50 ? 'average'
      : score >= 35 ? 'weak'
      : 'critical',
    top_issues: [],
    recommendations: [],
  }
}

function makeBasePointA(opts?: Partial<Record<'finance' | 'sales' | 'operations' | 'marketing' | 'strategy', number>>): PointA {
  const f = opts?.finance ?? 70
  const s = opts?.sales ?? 60
  const o = opts?.operations ?? 55
  const m = opts?.marketing ?? 50
  const st = opts?.strategy ?? 45
  // hardcoded 30/25/20/15/10 base aggregate
  const overall = Math.round(f * 0.30 + s * 0.25 + o * 0.20 + m * 0.15 + st * 0.10)
  return {
    overall_score: overall,
    health_index: overall,
    stage: 'growth',
    blocks: {
      finance: makeBlockScore(f),
      sales: makeBlockScore(s),
      operations: makeBlockScore(o),
      marketing: makeBlockScore(m),
      strategy: makeBlockScore(st),
    },
    risks: [],
    insights: [],
    quick_wins: [],
    data_gaps: [],
  }
}

function makeMetric(id: string, confidence: number, pickedType: 'survey' | 'document' | 'prisma' | 'external' | 'manual' = 'survey'): MetricValue {
  return {
    metricId: id,
    value: 100,
    numeric: 100,
    unit: '₸',
    confidence,
    picked: { type: pickedType },
    considered: [],
    periodYear: 2025,
    periodQuarter: null,
    computedAt: '2026-05-19T00:00:00.000Z',
  }
}

// ─── Tests ──────────────────────────────────────────────────

describe('scoreV2', () => {
  it('1. base PointA + no metrics + no industry → coherent result with default weights', () => {
    const base = makeBasePointA()
    const result = scoreV2({ base })

    expect(result.weight_profile.industry).toBe('default')
    expect(result.weight_profile.stage).toBe('all')
    expect(result.overall_score_v2).toBeGreaterThan(0)
    expect(result.overall_score_v2).toBeLessThanOrEqual(100)
    // default weights match the base aggregate within rounding
    expect(Math.abs(result.overall_score_v2 - base.overall_score)).toBeLessThan(1.5)
    // every block has rationale + confidence + percentile fields
    for (const b of ['finance', 'sales', 'operations', 'marketing', 'strategy'] as const) {
      expect(result.blocks_v2[b]).toBeDefined()
      expect(result.blocks_v2[b].confidence).toBeGreaterThanOrEqual(0)
      expect(result.blocks_v2[b].confidence).toBeLessThanOrEqual(1)
      expect(result.blocks_v2[b].rationale.length).toBeGreaterThan(0)
    }
  })

  it("2. industry='retail' → profile changes, overall_score_v2 != base.overall_score (with skewed input)", () => {
    // Retail weight profile is finance-heavy (35%), so a finance-strong company
    // should score *higher* than the base default aggregate.
    const base = makeBasePointA({ finance: 90, sales: 50, operations: 50, marketing: 50, strategy: 50 })
    const result = scoreV2({ base, industry: 'retail' })

    expect(result.weight_profile.industry).toBe('retail')
    // Retail aggregate = 90*.35 + 50*.25 + 50*.20 + 50*.10 + 50*.10 = 31.5+12.5+10+5+5 = 64
    expect(result.overall_score_v2).toBeCloseTo(64, 0)
    expect(result.overall_score_v2).not.toBe(base.overall_score)
  })

  it("3. industry='b2b_saas', stage='seed' → picks the seed-specific profile", () => {
    const base = makeBasePointA()
    const result = scoreV2({ base, industry: 'b2b_saas', stage: 'seed' })
    expect(result.weight_profile.industry).toBe('b2b_saas')
    expect(result.weight_profile.stage).toBe('seed')
    // The seed profile has strategy 25%, much higher than 'all' which is 15%.
    expect(result.weight_profile.weights.strategy).toBeCloseTo(0.25, 5)
  })

  it('4. block confidence: 5 high-confidence finance metrics → finance.confidence ≈ 0.85', () => {
    const base = makeBasePointA()
    const metrics: MetricValue[] = [
      makeMetric('biz.finansy.vyruchka_god', 0.85),
      makeMetric('biz.finansy.pribyl', 0.85),
      makeMetric('biz.finansy.marzha', 0.85),
      makeMetric('biz.finansy.cash_flow', 0.85),
      makeMetric('biz.finansy.kredit', 0.85),
    ]
    const result = scoreV2({ base, resolvedMetrics: metrics })
    expect(result.blocks_v2.finance.confidence).toBeCloseTo(0.85, 2)
  })

  it('5. no metrics for marketing → marketing.confidence = 0.5 (rule-based fallback)', () => {
    const base = makeBasePointA()
    const metrics: MetricValue[] = [
      makeMetric('biz.finansy.vyruchka_god', 0.9),
      makeMetric('biz.prodazhi.deal_count', 0.7),
    ]
    const result = scoreV2({ base, resolvedMetrics: metrics })
    expect(result.blocks_v2.marketing.confidence).toBe(0.5)
  })

  it('6. percentileVsBenchmark: base finance 80 vs industry ~58 (Розничная торговля) → percentile > 60', () => {
    const base = makeBasePointA({ finance: 80 })
    const result = scoreV2({ base, industry: 'retail' })
    const pct = result.blocks_v2.finance.percentileVsBenchmark
    expect(pct).not.toBeNull()
    expect(pct as number).toBeGreaterThan(60)
    expect(result.blocks_v2.finance.benchmarkRating).not.toBeNull()
  })

  it('7. percentileVsBenchmark: benchmark not found (industry=default) → null', () => {
    const base = makeBasePointA()
    const result = scoreV2({ base, industry: 'default' })
    for (const b of ['finance', 'sales', 'operations', 'marketing', 'strategy'] as const) {
      expect(result.blocks_v2[b].percentileVsBenchmark).toBeNull()
      expect(result.blocks_v2[b].benchmarkRating).toBeNull()
      expect(result.blocks_v2[b].rationale).toContain('Бенчмарк недоступен')
    }
  })

  it('8. overall_score_calibrated: very low confidence (avg < 0.4) → 10% discount applied', () => {
    const base = makeBasePointA()
    const metrics: MetricValue[] = [
      // 5 metrics across 5 blocks, all very low confidence
      makeMetric('biz.finansy.vyruchka_god', 0.1),
      makeMetric('biz.prodazhi.x', 0.1),
      makeMetric('biz.operatsii.x', 0.1),
      makeMetric('biz.marketing.x', 0.1),
      makeMetric('gri.biznes_model', 0.1),
    ]
    const result = scoreV2({ base, resolvedMetrics: metrics })
    expect(result.overall_score_calibrated).toBeLessThan(result.overall_score_v2)
    expect(result.overall_score_calibrated).toBeCloseTo(result.overall_score_v2 * 0.9, 1)
  })

  it('9. overall_score_calibrated: very high confidence (avg > 0.8) → ~5% lift', () => {
    const base = makeBasePointA({ finance: 50, sales: 50, operations: 50, marketing: 50, strategy: 50 })
    // 5 metrics, one per block, all 0.95 confidence
    const metrics: MetricValue[] = [
      makeMetric('biz.finansy.vyruchka_god', 0.95),
      makeMetric('biz.prodazhi.deal_count', 0.95),
      makeMetric('biz.operatsii.cycle', 0.95),
      makeMetric('biz.marketing.cac', 0.95),
      makeMetric('gri.biznes_model', 0.95),
    ]
    const result = scoreV2({ base, resolvedMetrics: metrics })
    expect(result.overall_score_calibrated).toBeGreaterThan(result.overall_score_v2)
    expect(result.overall_score_calibrated).toBeCloseTo(result.overall_score_v2 * 1.05, 1)
  })

  it('10. metric_to_block maps biz.finansy.* → finance, kpi.cac → marketing, gri.komanda → operations, goal → strategy', () => {
    const base = makeBasePointA()
    const metrics: MetricValue[] = [
      makeMetric('biz.finansy.vyruchka_god', 0.8),
      makeMetric('biz.prodazhi.deal_count', 0.8),
      makeMetric('biz.marketing.cac', 0.8),
      makeMetric('biz.operatsii.cycle', 0.8),
      makeMetric('kpi.roe', 0.7),
      makeMetric('kpi.cac', 0.7),
      makeMetric('gri.komanda', 0.7),
      makeMetric('gri.kassa', 0.7),
      makeMetric('goal.01.strategy_alignment', 0.7),
    ]
    const result = scoreV2({ base, resolvedMetrics: metrics })

    expect(result.metric_to_block['biz.finansy.vyruchka_god']).toBe('finance')
    expect(result.metric_to_block['biz.prodazhi.deal_count']).toBe('sales')
    expect(result.metric_to_block['biz.marketing.cac']).toBe('marketing')
    expect(result.metric_to_block['biz.operatsii.cycle']).toBe('operations')
    expect(result.metric_to_block['kpi.roe']).toBe('finance')
    expect(result.metric_to_block['kpi.cac']).toBe('marketing')
    expect(result.metric_to_block['gri.komanda']).toBe('operations')
    expect(result.metric_to_block['gri.kassa']).toBe('finance')
    expect(result.metric_to_block['goal.01.strategy_alignment']).toBe('strategy')

    // classifier behaves as a pure function too
    expect(classifyMetricToBlock('biz.finansy.foo')).toBe('finance')
    expect(classifyMetricToBlock('kpi.roi_marketing')).toBe('marketing')
    expect(classifyMetricToBlock('gri.produkt_i_spros')).toBe('sales')
    expect(classifyMetricToBlock('not_a_metric')).toBeNull()
  })

  it('11. Russian rationale strings non-empty and contain "%" sign', () => {
    const base = makeBasePointA()
    const result = scoreV2({ base, industry: 'retail' })
    const cyrillic = /[А-Яа-яЁё]/
    for (const b of ['finance', 'sales', 'operations', 'marketing', 'strategy'] as const) {
      const r = result.blocks_v2[b].rationale
      expect(r.length).toBeGreaterThan(0)
      expect(r).toContain('%')
      expect(cyrillic.test(r)).toBe(true)
    }
  })

  it('12. top-level notes mention picked industry + stage and key weights', () => {
    const base = makeBasePointA()
    const result = scoreV2({ base, industry: 'b2b_saas', stage: 'seed' })
    expect(result.notes).toContain('b2b_saas')
    expect(result.notes).toContain('seed')
    // mentions all 5 blocks
    expect(result.notes).toContain('финансов')
    expect(result.notes).toContain('продаж')
    expect(result.notes).toContain('операций')
    expect(result.notes).toContain('маркетинга')
    expect(result.notes).toContain('стратегии')
  })

  it('13. unknown industry string degrades to default (no benchmark, default weights)', () => {
    const base = makeBasePointA()
    const result = scoreV2({ base, industry: 'cryptokangaroo', stage: 'plasma' })
    expect(result.weight_profile.industry).toBe('default')
    expect(result.weight_profile.stage).toBe('all')
    expect(result.blocks_v2.finance.percentileVsBenchmark).toBeNull()
  })

  it('14. example: retail company finance=70, sales=60 — base.overall vs v2 delta is reasonable', () => {
    const base = makeBasePointA({ finance: 70, sales: 60, operations: 55, marketing: 50, strategy: 45 })
    // base: 70*.30 + 60*.25 + 55*.20 + 50*.15 + 45*.10 = 21+15+11+7.5+4.5 = 59
    expect(base.overall_score).toBe(59)
    const result = scoreV2({ base, industry: 'retail' })
    // retail: 70*.35 + 60*.25 + 55*.20 + 50*.10 + 45*.10 = 24.5+15+11+5+4.5 = 60
    expect(result.overall_score_v2).toBeCloseTo(60, 0)
    // benchmark for Розничная торговля (all): finance 58 → 70 is above → > 50 percentile
    expect(result.blocks_v2.finance.percentileVsBenchmark as number).toBeGreaterThan(50)
  })
})
