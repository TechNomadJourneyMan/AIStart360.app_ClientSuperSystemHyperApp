/**
 * Shared in-memory data for the Point B route tests: one client with a current
 * diagnostic, a v4 snapshot and revenue 2024 in the metrics registry (a STALE base on 2026-10-18).
 */
import { commDb, type Row } from '../comm/_db'

export const REVENUE = 'biz.finansy.vyruchka_god'
export const CLIENT = 'cccccccc-0000-4000-8000-000000000001'
export const OTHER_CLIENT = 'cccccccc-0000-4000-8000-000000000002'
export const EXPERT = 'eeeeeeee-0000-4000-8000-000000000001'
export const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
export const COMPANY = 'company-1'

const block = (score: number) => ({ score, status: 'average', top_issues: [], recommendations: [] })

export function pointBSeed(extra: Record<string, Row[]> = {}) {
  return commDb({
    diagnostics: [{
      id: 'diag-1', user_id: CLIENT, company_id: COMPANY, is_current: true, calculated_at: '2026-10-01T00:00:00Z',
      overall_score: 55, health_index: 50, stage: 'growth',
      finance_score: block(60), sales_score: block(50), operations_score: block(55), marketing_score: block(45), strategy_score: block(40),
    }],
    companies: [{ id: COMPANY, user_id: CLIENT, name: 'Ромашка', industry: null, stage: null, target_revenue_12m_kzt: 120_000_000, target_revenue_3y_kzt: 600_000_000 }],
    point_a_snapshots: [{
      id: 'snap-1', company_id: COMPANY, engine: 'v4', confidence: 0.6, coverage: 0.7, created_at: '2026-10-10T00:00:00Z',
      blocks: [{ key: 'finance', score: 60 }],
      inputs: { metrics: { [REVENUE]: { value: 60_000_000, source: 'survey', period: '2024' } } },
    }],
    metrics: [{ company_id: COMPANY, metric_key: REVENUE, metric_value: 60_000_000, source: 'survey', period_year: 2024, computed_at: '2026-10-01T00:00:00Z' }],
    metric_targets: [],
    survey_answers: [],
    gri_assessments: [],
    user_assignments: [],
    point_b_versions: [],
    point_b_analysis: [],
    ...extra,
  })
}
