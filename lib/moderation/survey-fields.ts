/**
 * lib/moderation/survey-fields.ts — какие ответы анкеты проверяет фильтр контента.
 *
 * Проверяются только СВОБОДНЫЕ тексты: поля <input type="text"> / <textarea>,
 * таблицы и блоки конкурентов, где пользователь пишет сам. Числа, выбор из
 * списка, переключатели и файлы не проверяются — там нечего фильтровать, а
 * ложное срабатывание заблокировало бы сохранение всей анкеты.
 *
 * Список составлен по формам components/onboarding/steps/Step*.tsx (те же,
 * из которых сгенерирован SURVEY_KEY_STEP в lib/survey/steps.ts);
 * tests/unit/moderation/survey-fields.test.ts следит, что каждый ключ
 * существует в анкете.
 */
import { SURVEY_KEY_STEP } from '@/lib/survey/steps'
import { SURVEY_LABELS } from '@/lib/survey-labels'
import type { ModerationField } from './guard'

/** Имена собственные: дополнительно запрещены ссылки и @-ники (kind 'name'). */
export const SURVEY_NAME_KEYS: ReadonlySet<string> = new Set([
  's1_company_name',
  's1_contact_name',
  's1_contact_position',
])

/** Ключи мастера анкеты со свободным текстом. */
export const SURVEY_FREE_TEXT_KEYS: ReadonlySet<string> = new Set([
  // Шаг 1 — О компании
  's1_company_name', 's1_contact_name', 's1_contact_position', 's1_competitors_list', 's1_products_list',
  's1_social_media', 's1_website',
  // Шаг 2 — Цели
  's2n_goal_12m_metrics', 's2n_goal_12m_what', 's2n_goal_3y_metrics', 's2n_goal_3y_what',
  's2n_tried_for_growth', 's2n_what_blocks_growth', 's6_expectations', 's6_main_pain',
  // Шаг 3 — Позиционирование
  's5_target_audience', 's5_usp',
  's3n_cannot_copy', 's3n_client_portrait', 's3n_client_problem', 's3n_competitor_why_us', 's3n_competitors_better',
  's3n_current_solution', 's3n_decision_maker', 's3n_if_unsolved', 's3n_industry_standard', 's3n_life_after_solution',
  's3n_measurable_results', 's3n_problem_impact', 's3n_purchase_participants', 's3n_short_wins',
  // Шаг 4 — Орг. структура
  's4m_communication', 's4m_meeting_efficiency', 's4m_report_types', 's4m_strategic_planning', 's4n_staffing_table',
  // Шаг 5 — Работа с базой
  's3_flagship_product', 's3_has_crm', 's3_promo_channels',
  's5n_abc_analysis', 's5n_barriers', 's5n_compared_with', 's5n_deciding_factor', 's5n_entry_product', 's5n_how_found_us',
  's5n_improve_suggestions', 's5n_most_marginal', 's5n_product_locomotive', 's5n_rfm_analysis', 's5n_upsell_crosssell',
  's5n_why_bought', 's5n_will_return_nps',
  // Шаг 6 — CJM
  's6n_journey_table', 's6n_post_sale_touchpoints', 's6n_weak_funnel_points',
  // Шаг 7 — Маркетинг
  's5_competitor_1', 's5_competitor_2', 's5_competitor_3',
  's7n_channels_table', 's7n_competitor_1_analysis', 's7n_competitor_2_analysis', 's7n_competitor_3_analysis', 's7n_content_strategy',
  // Шаг 8 — Метрики
  's8n_metrics_table',
  // Шаг 9 — Финансы
  's9n_change_vs_2023', 's9n_revenue_sources', 's9n_seasonality', 's9n_breakeven_point', 's9n_dividend_policy',
  's9n_expense_cogs', 's9n_expense_marketing', 's9n_expense_rent', 's9n_expense_other', 's9n_accounting_method',
  's9n_responsible_person', 's9n_tracked_kpis', 's9n_tax_system', 's9n_tax_audits', 's9n_audit_preparedness',
  's9n_financial_blockers',
  // Шаг 10 — Личные вопросы
  's10_best_result_10y', 's10_best_result_2y', 's10_best_result_5y', 's10_brand_perception',
  's10_company_vision_10y', 's10_company_vision_2y', 's10_company_vision_5y', 's10_competitor_comparison',
  's10_dept_assessment', 's10_problems_faced', 's10_what_depts_lack', 's10_what_stops_delegating',
  's10_when_they_buy', 's10_who_to_blame', 's10_why_opened',
  // Шаг 11 — Карта влияния
  's11_influence_map',
  // Шаг 12 — Системы
  's12_automation_details',
])

/** Проверять ли ответ: свободный текст мастера или строковый ответ вне мастера (другие анкеты). */
export function isModeratedSurveyKey(key: string): boolean {
  if (SURVEY_FREE_TEXT_KEYS.has(key)) return true
  return !(key in SURVEY_KEY_STEP)
}

function unwrap(answer: unknown): unknown {
  return answer !== null && typeof answer === 'object' && !Array.isArray(answer) && 'value' in (answer as object)
    ? (answer as { value: unknown }).value
    : answer
}

/**
 * Поля для moderateFields из тела сохранения анкеты (answers: { key: { value } }).
 * Ответы вне мастера проверяются, только если это строка (не числа и не выбор).
 */
export function surveyModerationFields(answers: Record<string, unknown>): ModerationField[] {
  const out: ModerationField[] = []
  for (const [key, answer] of Object.entries(answers)) {
    if (!isModeratedSurveyKey(key)) continue
    const value = unwrap(answer)
    if (value == null || typeof value === 'number' || typeof value === 'boolean') continue
    if (!(key in SURVEY_KEY_STEP) && typeof value !== 'string') continue
    out.push({
      field: key,
      label: SURVEY_LABELS[key] ?? key,
      value,
      kind: SURVEY_NAME_KEYS.has(key) ? 'name' : 'text',
    })
  }
  return out
}
