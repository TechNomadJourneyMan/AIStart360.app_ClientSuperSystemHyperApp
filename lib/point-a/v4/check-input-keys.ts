/**
 * lib/point-a/v4/check-input-keys.ts — which questionnaire keys answer which
 * Point A v4 check (the table behind `isAnswered`, lib/point-a/v4/check-inputs.ts).
 *
 * No runtime imports: the questionnaire wizard derives «Минимум для Точки А»
 * from this table in the browser (lib/survey/point-a-minimum.ts) without
 * pulling the engine in.
 */
import type { PointAResolvedInputs } from '@/lib/point-a-engine'
import type { BlockKey } from './config'

export interface CheckInput {
  keys: readonly string[]
  /**
   * Number fields the form writes as 0 when cleared (`Number(v) || 0`): only
   * a positive number is an answer.
   */
  positive?: readonly string[]
  /** Form toggle / slider with a default: a saved step counts as an answer. */
  toggle?: boolean
  resolved?: ReadonlyArray<keyof PointAResolvedInputs>
}

export const GOAL_3Y = ['s6_goal_3years', 's2n_goal_3y_what', 's2n_goal_3y_metrics', 's1_goal_3y_revenue_year', 's1_goal_3y_revenue_month']
export const GOAL_12M = ['s6_goal_12months', 's2n_goal_12m_what', 's2n_goal_12m_metrics', 's1_goal_12m_revenue_year', 's1_goal_12m_revenue_month']

export const CHECK_INPUTS: Partial<Record<BlockKey, Record<string, CheckInput>>> = {
  sales: {
    loyalty: { keys: ['s3_has_loyalty'] },
  },
  finance: {
    breakeven: { keys: ['s2_knows_breakeven', 's9n_breakeven_point'] },
    revenue_trend: { keys: [] },
  },
  operations: {
    org_chart: { keys: ['s4_has_org_chart'], toggle: true },
    dept_kpi: { keys: ['s4_has_dept_kpi', 's4n_staffing_table', 's4m_control_method'], toggle: true },
    meetings: { keys: ['s4_has_regular_meetings'], toggle: true },
    reporting: { keys: ['s4_reporting_tool', 's4m_report_automated'] },
    task_manager: { keys: ['s4_task_manager', 's12_project_mgmt'] },
  },
  marketing: {
    budget: { keys: ['s5_marketing_budget_pct'], positive: ['s5_marketing_budget_pct'] },
    channels: { keys: ['s5_marketing_channels', 's3_promo_channels'] },
    audience: { keys: ['s5_target_audience', 's3n_client_portrait'] },
    competitors: { keys: ['s5_has_competitor_analysis', 's7n_competitor_1_analysis', 's7n_competitor_2_analysis', 's7n_competitor_3_analysis'], toggle: true },
    usp: { keys: ['s5_usp', 's3n_competitor_why_us'] },
    loyalty: { keys: ['s3_has_loyalty'] },
  },
  strategy: {
    goal_3y: { keys: GOAL_3Y, positive: GOAL_3Y.filter((k) => k.startsWith('s1_')) },
    goal_12m: { keys: GOAL_12M, positive: GOAL_12M.filter((k) => k.startsWith('s1_')) },
    main_pain: { keys: ['s6_main_pain'] },
    growth_blockers: { keys: ['s6_growth_blockers', 's2n_what_blocks_growth'] },
  },
}
