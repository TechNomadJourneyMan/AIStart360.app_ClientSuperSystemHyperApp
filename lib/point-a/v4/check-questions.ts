/**
 * lib/point-a/v4/check-questions.ts — the questionnaire questions that answer
 * a Point A check: the editor window of the Point A page (PO 2026-11-02) asks
 * exactly them, in place, instead of sending the owner back to the wizard.
 *
 * Current wizard keys only (legacy keys are read by the engine but never
 * asked again), the one to ask first. Tables stay in the list — the shared
 * field shows them as «Заполнить в полной анкете». No engine import: safe for
 * client components.
 */
import { surveyQuestion, type SurveyQuestion } from '@/lib/survey/questions'
import { editKindOf } from '@/lib/survey/answers-view'
import type { BlockKey } from './config'

export const CHECK_QUESTION_KEYS: Readonly<Record<BlockKey, Readonly<Record<string, readonly string[]>>>> = {
  finance: {
    growth: ['s9n_revenue_2024', 's9n_change_vs_2023', 's8n_metrics_table'],
    margin: ['s9n_net_margin'],
    ltv_cac: ['s8n_metrics_table'],
    breakeven: ['s9n_breakeven_point'],
    debt: ['s9n_debts_amount'],
    revenue_trend: ['s1_current_revenue_month'],
  },
  sales: {
    crm: ['s12_crm_tool'],
    deal_cycle: ['s3_deal_cycle_days'],
    repeat_share: ['s8n_metrics_table'],
    pipeline: ['s3_deals_2025', 's3_deals_2024'],
    refusals: ['s3_rejections_2025', 's3_rejections_2024'],
  },
  operations: {
    org_chart: ['s4_has_org_chart'],
    dept_kpi: ['s4m_control_method', 's4n_staffing_table'],
    meetings: ['s4_has_regular_meetings'],
    reporting: ['s4m_report_automated'],
    task_manager: ['s12_project_mgmt'],
    management_method: ['s4m_control_method'],
  },
  marketing: {
    budget: ['s5_marketing_budget_pct'],
    channels: ['s5_marketing_channels'],
    audience: ['s3n_client_portrait'],
    competitors: ['s5_has_competitor_analysis', 's7n_competitor_1_analysis'],
    usp: ['s3n_competitor_why_us'],
  },
  strategy: {
    goal_3y: ['s2n_goal_3y_what', 's1_goal_3y_revenue_month'],
    goal_12m: ['s2n_goal_12m_what', 's1_goal_12m_revenue_month'],
    main_pain: ['s6_main_pain'],
    growth_blockers: ['s6_growth_blockers'],
  },
  team: {
    structure_matches: ['s4n_structure_matches'],
    delegation: ['s4m_delegation_readiness'],
    owner_ops_hours: ['s4m_hours_on_ops'],
    planning: ['s4m_planning_team_or_solo'],
    staffing: ['s4n_staffing_table'],
    multi_roles: ['s4n_multi_roles'],
    team_size: ['s1_employee_count'],
  },
  product: {
    product_line: ['s3_product_count'],
    locomotive: ['s5n_product_locomotive'],
    entry_product: ['s5n_entry_product'],
    most_marginal: ['s5n_most_marginal'],
    moat: ['s3n_cannot_copy'],
    nps: ['s7_nps_score'],
    upsell: ['s5n_upsell_crosssell'],
    measurable_results: ['s3n_measurable_results'],
  },
}

/** Questions of the given checks of a block — registered, editable, each once, in check order. */
export function questionsForChecks(block: BlockKey, checkIds: readonly string[]): SurveyQuestion[] {
  const seen = new Set<string>()
  const out: SurveyQuestion[] = []
  for (const id of checkIds) {
    for (const key of CHECK_QUESTION_KEYS[block]?.[id] ?? []) {
      if (seen.has(key)) continue
      seen.add(key)
      const q = surveyQuestion(key)
      if (q && editKindOf(q) !== 'none') out.push(q)
    }
  }
  return out
}
