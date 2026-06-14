import { describe, it, expect } from 'vitest'
import type { PointA } from '@/types/onboarding'
import {
  parseGoals,
  computeGap,
  buildTrajectory,
  buildScenarios,
  assessRealism,
  dataSufficiency,
  calculatePointBV2,
} from '@/lib/point-b/engine'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makePointA(overrides: Partial<PointA> = {}): PointA {
  return {
    overall_score: 55,
    health_index: 50,
    stage: 'growth',
    blocks: {
      finance:    { score: 45, status: 'weak',    top_issues: ['Низкая маржа'], recommendations: [] },
      marketing:  { score: 50, status: 'average', top_issues: [], recommendations: [] },
      operations: { score: 60, status: 'average', top_issues: [], recommendations: [] },
      strategy:   { score: 55, status: 'average', top_issues: [], recommendations: [] },
      sales:      { score: 48, status: 'weak',    top_issues: [], recommendations: [] },
    },
    risks: [],
    insights: [],
    quick_wins: [],
    data_gaps: [],
    ...overrides,
  }
}

// A realistic survey answer set mirroring real DB keys (s1_goal_*, s2_revenue_*).
function answersWithGoals(): Record<string, unknown> {
  return {
    s2_revenue_2023: 40_000_000,
    s2_revenue_2024: 60_000_000,
    s2_revenue_2025: 0, // not yet filled — should fall back to 2024
    s1_goal_12m_revenue_year: 120_000_000,
    s1_goal_12m_revenue_month: 10_000_000,
    s1_goal_3y_revenue_year: 600_000_000,
    s1_goal_3y_revenue_month: 50_000_000,
    s2n_goal_12m_what: 'Удвоить выручку',
    s2n_goal_3y_what: 'Стать лидером ниши',
    s6_main_pain: 'Не хватает лидов',
    s6_growth_blockers: ['Маркетинг', 'Команда'],
    s7_avg_check_target_kzt: 250_000,
  }
}

// ─── parseGoals ──────────────────────────────────────────────────────────────

describe('parseGoals', () => {
  it('extracts numeric current revenue with fallback from latest filled year', () => {
    const g = parseGoals(answersWithGoals())
    // 2025 is 0 → fall back to 2024 = 60M
    expect(g.current_revenue_year).toBe(60_000_000)
  })

  it('extracts the user 12-month and 3-year numeric revenue goals (the real ТЗ promise)', () => {
    const g = parseGoals(answersWithGoals())
    expect(g.goal_12m_revenue_year).toBe(120_000_000)
    expect(g.goal_3y_revenue_year).toBe(600_000_000)
  })

  it('derives an annual goal from a monthly goal when the annual is absent', () => {
    const g = parseGoals({ s1_goal_3y_revenue_month: 50_000_000 })
    expect(g.goal_3y_revenue_year).toBe(600_000_000)
  })

  it('returns null (never fabricates) when no goal data exists', () => {
    const g = parseGoals({})
    expect(g.goal_12m_revenue_year).toBeNull()
    expect(g.goal_3y_revenue_year).toBeNull()
    expect(g.current_revenue_year).toBeNull()
  })

  it('captures qualitative goal text and growth blockers', () => {
    const g = parseGoals(answersWithGoals())
    expect(g.goal_3y_text).toContain('лидером')
    expect(g.growth_blockers).toEqual(['Маркетинг', 'Команда'])
  })
})

// ─── computeGap ──────────────────────────────────────────────────────────────

describe('computeGap', () => {
  it('computes a 2x 12-month gap: absolute, percent, multiplier, required growth rates', () => {
    const gap = computeGap(60_000_000, 120_000_000, 12)
    expect(gap.gap_absolute).toBe(60_000_000)
    expect(gap.gap_percent).toBeCloseTo(100, 5)
    expect(gap.multiplier).toBeCloseTo(2, 5)
    // 12m horizon = 1 year → CAGR equals the multiplier-1
    expect(gap.required_cagr).toBeCloseTo(100, 1)
    // monthly compounding: 2^(1/12)-1 ≈ 5.95%
    expect(gap.required_mom_growth).toBeCloseTo(5.946, 2)
    // quarterly compounding: 2^(1/4)-1 ≈ 18.92%
    expect(gap.required_qoq_growth).toBeCloseTo(18.921, 2)
    expect(gap.data_complete).toBe(true)
  })

  it('computes a 10x 3-year gap with annualized CAGR', () => {
    const gap = computeGap(60_000_000, 600_000_000, 36)
    expect(gap.multiplier).toBeCloseTo(10, 5)
    expect(gap.gap_percent).toBeCloseTo(900, 5)
    // 10^(1/3)-1 ≈ 115.44%
    expect(gap.required_cagr).toBeCloseTo(115.44, 1)
  })

  it('does not fabricate when current revenue is zero or missing', () => {
    const gap = computeGap(0, 600_000_000, 36)
    expect(gap.data_complete).toBe(false)
    expect(gap.required_cagr).toBeNull()
    expect(gap.multiplier).toBeNull()
  })
})

// ─── buildTrajectory ─────────────────────────────────────────────────────────

describe('buildTrajectory', () => {
  it('produces a smooth compounded ramp that starts above current and ends at target', () => {
    const t = buildTrajectory(60_000_000, 120_000_000, 12)
    expect(t).toHaveLength(12)
    expect(t[0].target_revenue).toBeGreaterThan(60_000_000)
    expect(t[11].target_revenue).toBeCloseTo(120_000_000, -3) // ends at target (±1k)
    // monotonic non-decreasing
    for (let i = 1; i < t.length; i++) {
      expect(t[i].target_revenue).toBeGreaterThanOrEqual(t[i - 1].target_revenue)
    }
  })

  it('returns an empty trajectory when inputs are insufficient', () => {
    expect(buildTrajectory(0, 120_000_000, 12)).toEqual([])
  })
})

// ─── buildScenarios ──────────────────────────────────────────────────────────

describe('buildScenarios', () => {
  it('builds base/aggressive/cautious around the user goal, base equals the stated goal', () => {
    const s = buildScenarios(60_000_000, 120_000_000, 600_000_000)
    const base = s.find((x) => x.key === 'base')!
    const cautious = s.find((x) => x.key === 'cautious')!
    const aggressive = s.find((x) => x.key === 'aggressive')!
    expect(base.target_revenue_12m).toBe(120_000_000)
    // cautious < base < aggressive
    expect(cautious.target_revenue_12m!).toBeLessThan(base.target_revenue_12m!)
    expect(aggressive.target_revenue_12m!).toBeGreaterThan(base.target_revenue_12m!)
    expect(base.assumptions.length).toBeGreaterThan(0)
  })

  it('marks low confidence and null targets when the goal is missing (no fabrication)', () => {
    const s = buildScenarios(60_000_000, null, null)
    const base = s.find((x) => x.key === 'base')!
    expect(base.target_revenue_12m).toBeNull()
    expect(base.confidence).toBe('low')
  })
})

// ─── assessRealism ───────────────────────────────────────────────────────────

describe('assessRealism', () => {
  it('flags a 10x-in-3-years goal with weak finance/sales as not realistic', () => {
    const gap3y = computeGap(60_000_000, 600_000_000, 36)
    const r = assessRealism(makePointA(), gap3y, ['finance', 'sales'])
    expect(['aggressive', 'unrealistic']).toContain(r.level)
    expect(r.rationale.length).toBeGreaterThan(0)
    expect(r.weak_blocks).toContain('finance')
  })

  it('flags a modest 1.3x-in-3-years goal with strong blocks as realistic', () => {
    const strong = makePointA({
      blocks: {
        finance:    { score: 80, status: 'strong', top_issues: [], recommendations: [] },
        marketing:  { score: 75, status: 'strong', top_issues: [], recommendations: [] },
        operations: { score: 78, status: 'strong', top_issues: [], recommendations: [] },
        strategy:   { score: 72, status: 'strong', top_issues: [], recommendations: [] },
        sales:      { score: 80, status: 'strong', top_issues: [], recommendations: [] },
      },
    })
    const gap3y = computeGap(100_000_000, 130_000_000, 36)
    const r = assessRealism(strong, gap3y, [])
    expect(r.level).toBe('realistic')
  })
})

// ─── dataSufficiency ─────────────────────────────────────────────────────────

describe('dataSufficiency', () => {
  it('is sufficient when current revenue, both goals and Point A exist', () => {
    const goals = parseGoals(answersWithGoals())
    const d = dataSufficiency(goals, makePointA())
    expect(d.sufficient).toBe(true)
    expect(d.confidence).toBeGreaterThanOrEqual(60)
  })

  it('is insufficient and names the missing goal when goals are absent', () => {
    const goals = parseGoals({ s2_revenue_2024: 60_000_000 })
    const d = dataSufficiency(goals, makePointA())
    expect(d.sufficient).toBe(false)
    expect(d.missing.join(' ')).toMatch(/цел/i) // mentions goal
  })
})

// ─── calculatePointBV2 (orchestrator) ────────────────────────────────────────

describe('calculatePointBV2', () => {
  it('produces a goal-driven Point B using the real stated goal, not a fabricated multiplier', () => {
    const pb = calculatePointBV2(makePointA(), answersWithGoals())
    const gap3y = pb.gap.find((g) => g.horizon === '3y')!
    // Target must equal the user's stated 3y goal (600M), NOT current × stage-multiplier.
    expect(gap3y.target_revenue).toBe(600_000_000)
    expect(gap3y.current_revenue).toBe(60_000_000)
    expect(gap3y.required_cagr).toBeCloseTo(115.44, 1)
  })

  it('exposes all five planning horizons (3y, 1y, quarter, month, week)', () => {
    const pb = calculatePointBV2(makePointA(), answersWithGoals())
    expect(pb.horizons.three_year).toBeDefined()
    expect(pb.horizons.one_year).toBeDefined()
    expect(pb.horizons.quarter).toBeDefined()
    expect(pb.horizons.month).toBeDefined()
    expect(pb.horizons.week).toBeDefined()
  })

  it('reports honest data sufficiency and emits no AI strategy without a key', () => {
    const pb = calculatePointBV2(makePointA(), answersWithGoals())
    expect(pb.data_sufficiency.sufficient).toBe(true)
    expect(pb.ai_status).toBe('none')
    expect(pb.ai_strategy).toBeNull()
  })

  it('degrades to an insufficient-data state instead of fabricating when goals are missing', () => {
    const pb = calculatePointBV2(makePointA(), { s2_revenue_2024: 60_000_000 })
    expect(pb.data_sufficiency.sufficient).toBe(false)
    const gap3y = pb.gap.find((g) => g.horizon === '3y')!
    expect(gap3y.target_revenue).toBeNull()
  })

  it('uses currentRevenueYear from the metrics layer when the survey lacks revenue', () => {
    // Newer survey (s1_*) captures goals but no current revenue → it must come
    // from public.metrics. The API supplies it via options.currentRevenueYear.
    const answers = {
      s1_goal_3y_revenue_year: 600_000_000,
      s1_goal_12m_revenue_year: 120_000_000,
    }
    const without = calculatePointBV2(makePointA(), answers)
    expect(without.gap.find((g) => g.horizon === '3y')!.data_complete).toBe(false)

    const withMetric = calculatePointBV2(makePointA(), answers, { currentRevenueYear: 60_000_000 })
    const gap3y = withMetric.gap.find((g) => g.horizon === '3y')!
    expect(gap3y.current_revenue).toBe(60_000_000)
    expect(gap3y.target_revenue).toBe(600_000_000)
    expect(gap3y.data_complete).toBe(true)
    expect(gap3y.required_cagr).toBeCloseTo(115.44, 1)
    expect(withMetric.data_sufficiency.sufficient).toBe(true)
  })
})
