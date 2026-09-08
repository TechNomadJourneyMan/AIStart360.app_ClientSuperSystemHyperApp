/**
 * lib/survey/steps.ts — SINGLE source of truth for "which wizard step owns a
 * survey question key".
 *
 * WHY THIS EXISTS (E2E bug 2026-09, «прогресс анкеты застрял на 1/12»):
 * the onboarding page sends the WHOLE accumulated answer map on every save
 * with `step = currentStep`, and the upsert on (user_id, question_key)
 * overwrote the `step` column of EVERY row with whatever step the user was
 * standing on. After a reload the wizard starts on step 1, so the next save
 * stamped all 150+ rows with step=1 → dashboard/GRI/metrics/profile counted
 * exactly one distinct step ("1/12 · 8%") while the wizard itself (which
 * reads localStorage) still showed 12/12.
 *
 * Key prefixes can NOT be used to derive the step: several forms mix
 * generations (step 2 writes `s2n_*` AND legacy `s6_main_pain`, step 5 writes
 * `s5n_*` AND `s3_*`, step 7 writes `s5_*`/`s7_*`/`s7n_*`). So the table is
 * generated from the step forms in components/onboarding/steps/Step*.tsx and
 * guarded by tests/unit/survey/steps.test.ts, which re-scans those files.
 *
 * Readers (status API, dashboard, profile, Point A cards) and the writer
 * (POST /api/v1/onboarding/survey) all go through `stepForQuestionKey` /
 * `completedStepsFromRows`, so the DB column is only a fallback for keys
 * outside the 12-step wizard (medical/e-commerce intakes, period goals).
 */

export const SURVEY_TOTAL_STEPS = 12

/** question_key → wizard step (1..12). Generated from the step forms. */
export const SURVEY_KEY_STEP: Readonly<Record<string, number>> = {
  s10_best_result_10y: 10,
  s10_best_result_2y: 10,
  s10_best_result_5y: 10,
  s10_brand_perception: 10,
  s10_company_vision_10y: 10,
  s10_company_vision_2y: 10,
  s10_company_vision_5y: 10,
  s10_competitor_comparison: 10,
  s10_delegation_ready: 10,
  s10_dept_assessment: 10,
  s10_hours_on_ops: 10,
  s10_problems_faced: 10,
  s10_what_depts_lack: 10,
  s10_what_stops_delegating: 10,
  s10_when_they_buy: 10,
  s10_who_to_blame: 10,
  s10_why_opened: 10,
  s11_influence_map: 11,
  s12_automation_details: 12,
  s12_bi_tool: 12,
  s12_crm_tool: 12,
  s12_edm: 12,
  s12_erp: 12,
  s12_it_support: 12,
  s12_marketing_platforms: 12,
  s12_messengers: 12,
  s12_project_mgmt: 12,
  s12_telephony: 12,
  s1_business_model: 1,
  s1_company_name: 1,
  s1_competitors_list: 1,
  s1_contact_email: 1,
  s1_contact_name: 1,
  s1_contact_phone: 1,
  s1_contact_position: 1,
  s1_current_revenue_month: 1,
  s1_current_revenue_year: 1,
  s1_employee_count: 1,
  s1_goal_12m_revenue_month: 1,
  s1_goal_12m_revenue_year: 1,
  s1_goal_3y_revenue_month: 1,
  s1_goal_3y_revenue_year: 1,
  s1_industry: 1,
  s1_products_list: 1,
  s1_regions: 1,
  s1_social_media: 1,
  s1_uploaded_files: 1,
  s1_website: 1,
  s1_years_on_market: 1,
  s2n_goal_12m_metrics: 2,
  s2n_goal_12m_what: 2,
  s2n_goal_3y_metrics: 2,
  s2n_goal_3y_what: 2,
  s2n_tried_for_growth: 2,
  s2n_what_blocks_growth: 2,
  s3_deal_cycle_days: 5,
  s3_deals_2023: 5,
  s3_deals_2024: 5,
  s3_deals_2025: 5,
  s3_flagship_product: 5,
  s3_has_crm: 5,
  s3_product_count: 5,
  s3_promo_channels: 5,
  s3_rejections_2023: 5,
  s3_rejections_2024: 5,
  s3_rejections_2025: 5,
  s3n_cannot_copy: 3,
  s3n_client_portrait: 3,
  s3n_client_problem: 3,
  s3n_competitor_why_us: 3,
  s3n_competitors_better: 3,
  s3n_current_solution: 3,
  s3n_decision_maker: 3,
  s3n_if_unsolved: 3,
  s3n_industry_standard: 3,
  s3n_life_after_solution: 3,
  s3n_measurable_results: 3,
  s3n_price_segment: 3,
  s3n_problem_impact: 3,
  s3n_purchase_participants: 3,
  s3n_short_wins: 3,
  s4_dept_count: 4,
  s4_has_org_chart: 4,
  s4_has_regular_meetings: 4,
  s4n_multi_roles: 4,
  s4n_open_vacancies: 4,
  s4n_staffing_table: 4,
  s4n_structure_matches: 4,
  s5_has_competitor_analysis: 7,
  s5_marketing_budget_pct: 7,
  s5_marketing_channels: 7,
  s5_target_audience: 3,
  s5_usp: 3,
  s5n_abc_analysis: 5,
  s5n_barriers: 5,
  s5n_compared_with: 5,
  s5n_deciding_factor: 5,
  s5n_entry_product: 5,
  s5n_funnel_call_to_meeting: 5,
  s5n_funnel_contract_to_payment: 5,
  s5n_funnel_lead_to_call: 5,
  s5n_funnel_lead_to_sale: 5,
  s5n_funnel_meeting_to_proposal: 5,
  s5n_funnel_negotiation_to_contract: 5,
  s5n_funnel_payment_to_delivery: 5,
  s5n_funnel_proposal_to_negotiation: 5,
  s5n_how_found_us: 5,
  s5n_improve_suggestions: 5,
  s5n_most_marginal: 5,
  s5n_product_locomotive: 5,
  s5n_rfm_analysis: 5,
  s5n_upsell_crosssell: 5,
  s5n_why_bought: 5,
  s5n_will_return_nps: 5,
  s6_expectations: 2,
  s6_growth_blockers: 2,
  s6_main_pain: 2,
  s6n_journey_table: 6,
  s6n_post_sale_touchpoints: 6,
  s6n_script_first_contact: 6,
  s6n_script_meeting: 6,
  s6n_script_proposal: 6,
  s6n_weak_funnel_points: 6,
  s7_avg_check_target_kzt: 7,
  s7_leads_per_month: 7,
  s7_missed_calls_rate: 7,
  s7_no_show_rate: 7,
  s7_nps_score: 7,
  s7_repeat_freq_days: 7,
  s7n_channels_table: 7,
  s7n_content_strategy: 7,
  s8n_metrics_table: 8,
  s9n_accounting_method: 9,
  s9n_analysis_frequency: 9,
  s9n_audit_preparedness: 9,
  s9n_breakeven_point: 9,
  s9n_change_vs_2023: 9,
  s9n_debtor_days: 9,
  s9n_debts_amount: 9,
  s9n_dividend_policy: 9,
  s9n_expense_cogs: 9,
  s9n_expense_marketing: 9,
  s9n_expense_other: 9,
  s9n_expense_rent: 9,
  s9n_financial_blockers: 9,
  s9n_net_margin: 9,
  s9n_net_profit: 9,
  s9n_planning_frequency: 9,
  s9n_responsible_person: 9,
  s9n_revenue_2024: 9,
  s9n_revenue_sources: 9,
  s9n_seasonality: 9,
  s9n_tax_audits: 9,
  s9n_tax_system: 9,
  s9n_tracked_kpis: 9,
  s9n_transparency_pct: 9,
}

/**
 * Step (1..12) that owns `key`, or `fallback` when the key is not part of the
 * 12-step wizard (e.g. `ec_*`, medical intake, synthetic step-0 goals).
 */
export function stepForQuestionKey(key: string, fallback: number | null = null): number | null {
  const s = SURVEY_KEY_STEP[key]
  return typeof s === 'number' ? s : fallback
}

export interface SurveyStepRow {
  question_key: string
  step?: number | string | null
  answer?: unknown
}

function rowHasValue(answer: unknown): boolean {
  if (answer === null || answer === undefined) return false
  const v =
    typeof answer === 'object' && answer !== null && !Array.isArray(answer) && 'value' in answer
      ? (answer as { value: unknown }).value
      : answer
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

/**
 * Distinct wizard steps (1..12) that have at least one non-empty answer.
 * The stored `step` column is used only for keys the wizard map doesn't know
 * (and only when it is a real wizard step ≥ 1 — step 0 is synthetic metadata).
 */
export function completedStepsFromRows(rows: ReadonlyArray<SurveyStepRow>): number[] {
  const steps = new Set<number>()
  for (const r of rows) {
    if (!r || typeof r.question_key !== 'string') continue
    if (r.answer !== undefined && !rowHasValue(r.answer)) continue
    const stored = r.step === null || r.step === undefined ? null : Number(r.step)
    const fallback = stored !== null && Number.isFinite(stored) && stored >= 1 && stored <= SURVEY_TOTAL_STEPS ? stored : null
    const step = stepForQuestionKey(r.question_key, fallback)
    if (step !== null) steps.add(step)
  }
  return Array.from(steps).sort((a, b) => a - b)
}

/** Progress summary used by the status API and server components. */
export function surveyProgressFromRows(rows: ReadonlyArray<SurveyStepRow>): {
  completed_steps: number[]
  completed: number
  total_steps: number
  percent: number
  is_complete: boolean
} {
  const completed_steps = completedStepsFromRows(rows)
  const completed = completed_steps.length
  return {
    completed_steps,
    completed,
    total_steps: SURVEY_TOTAL_STEPS,
    percent: Math.round((completed / SURVEY_TOTAL_STEPS) * 100),
    is_complete: completed >= SURVEY_TOTAL_STEPS,
  }
}
