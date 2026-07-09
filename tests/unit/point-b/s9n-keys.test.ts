import { describe, it, expect } from 'vitest'
import type { PointA } from '@/types/onboarding'
import { calculatePointB } from '@/lib/point-b-engine'
import { calculatePointBV2 } from '@/lib/point-b/engine'

// Mirrors the fixture used by tests/unit/point-b/engine.test.ts.
function makePointA(overrides: Partial<PointA> = {}): PointA {
  return {
    overall_score: 55,
    health_index: 50,
    stage: 'growth',
    blocks: {
      finance:    { score: 45, status: 'weak',    top_issues: [], recommendations: [] },
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

const kpi = (pb: ReturnType<typeof calculatePointB>, label: string) =>
  pb.target_kpis.find((k) => k.label === label)!

// ─── Old engine (lib/point-b-engine.ts) — full s9n gap ───────────────────────
// Live surface: app/api/clients/[id]/analysis/point-b/route.ts. A client who
// filled the current 12-step finance form (s9n_*) must not get 0-valued KPIs.

describe('calculatePointB — s9n finance-form keys (was s2_* only)', () => {
  it('reads current revenue from s9n_revenue_2024 when legacy s2_* is absent', () => {
    const pb = calculatePointB(makePointA(), { s9n_revenue_2024: 60_000_000 })
    expect(kpi(pb, 'Выручка').current).toBe('60.0M ₸')
  })

  it('coerces formatted revenue strings robustly (e.g. "84 200 000")', () => {
    const pb = calculatePointB(makePointA(), { s9n_revenue_2024: '84 200 000' })
    expect(kpi(pb, 'Выручка').current).toBe('84.2M ₸')
  })

  it('reads margin from s9n_net_margin when legacy s2_gross_margin is absent', () => {
    const pb = calculatePointB(makePointA(), { s9n_net_margin: 25 })
    expect(kpi(pb, 'Маржа').current).toBe('25.0%')
  })

  it('reads 12m / 3y goal text from the s2n_goal_* aliases', () => {
    const pb = calculatePointB(makePointA(), {
      s2n_goal_12m_what: 'Удвоить выручку',
      s2n_goal_3y_what: 'Стать лидером ниши',
    })
    expect(pb.user_goals.goal_12months).toBe('Удвоить выручку')
    expect(pb.user_goals.goal_3years).toBe('Стать лидером ниши')
  })

  it('still prefers legacy s2_* when both are present (no regression)', () => {
    const pb = calculatePointB(makePointA(), {
      s2_revenue_2024: 50_000_000,
      s9n_revenue_2024: 99_000_000,
    })
    expect(kpi(pb, 'Выручка').current).toBe('50.0M ₸')
  })
})

// ─── V2 engine (lib/point-b/engine.ts) — partial gap: margin only ────────────
// Revenue already aliases s9n_revenue_2024; margin still read s2_gross_margin only.

describe('calculatePointBV2 — margin lever s9n alias', () => {
  it('reads the margin lever from s9n_net_margin when s2_gross_margin is absent', () => {
    const pb = calculatePointBV2(makePointA(), { s9n_net_margin: 30 })
    const marginLever = pb.levers.find((l) => l.key === 'margin')!
    expect(marginLever.current).toBe(30)
    expect(marginLever.data_available).toBe(true)
  })
})
