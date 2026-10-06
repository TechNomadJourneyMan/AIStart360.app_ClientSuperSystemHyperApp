/**
 * Realistic survey answer sets for Point A engine tests (flat
 * question_key → value, as the recalculate route builds them).
 *
 * CURRENT_* use only keys of the current 12-step wizard (lib/survey/steps.ts);
 * LEGACY_* use the first-generation keys (s2_ltv, s2_revenue_2023, …).
 */

const metricsTable = (rows: Record<string, Partial<Record<'y2023' | 'y2024' | 'y2025' | 'plan_2026' | 'fact_2026', number>>>) =>
  Object.entries(rows).map(([metric_name, v]) => ({
    metric_name, y2023: 0, y2024: 0, y2025: 0, plan_2026: 0, fact_2026: 0, completion_pct: 0, ...v,
  }))

/** A well-run B2B services company that filled every step of the current wizard. */
export const CURRENT_FULL_STRONG: Record<string, unknown> = {
  s1_company_name: 'ТОО «Северный ветер»',
  s1_industry: 'B2B услуги',
  s1_employee_count: 42,
  s1_current_revenue_year: 540_000_000,
  s1_goal_12m_revenue_year: 700_000_000,
  s1_goal_3y_revenue_year: 1_500_000_000,
  s1_website: 'https://veter.kz',
  s1_social_media: 'instagram.com/veter',
  s2n_goal_12m_what: 'Выйти на 700 млн выручки',
  s2n_goal_3y_what: 'Стать №1 в регионе по B2B-обслуживанию',
  s2n_what_blocks_growth: 'Не хватает менеджеров по продажам',
  s6_main_pain: 'Долго нанимаем и вводим в работу продавцов',
  s6_growth_blockers: ['Найм', 'Процессы'],
  s3n_client_portrait: 'Производственные компании 50–500 сотрудников, решение принимает финдиректор',
  s3n_competitor_why_us: 'Выезд инженера за 4 часа и фиксированная цена',
  s5_usp: 'Обслуживание под ключ с SLA 4 часа',
  s4_has_org_chart: true,
  s4_has_regular_meetings: true,
  s4m_control_method: 'kpi',
  s4m_report_automated: 'bi',
  s4n_staffing_table: [{ department: 'Продажи', head: 'Ирина', manager_count: 6, dept_goals: 'План 60 млн/мес', kpi: 'Выручка, конверсия' }],
  s3_deal_cycle_days: 21,
  s3_deals_2023: 520,
  s3_deals_2024: 610,
  s3_deals_2025: 700,
  s3_rejections_2023: 90,
  s3_rejections_2024: 80,
  s3_flagship_product: 'Сервисный контракт',
  s5_marketing_channels: ['SEO', 'Контекстная реклама', 'Email-рассылка', 'SMM (соцсети)'],
  s5_marketing_budget_pct: 6,
  s5_has_competitor_analysis: true,
  s7_nps_score: 52,
  s8n_metrics_table: metricsTable({
    'Сумма продаж': { y2023: 380_000_000, y2024: 470_000_000, y2025: 540_000_000 },
    'Кол-во новых продаж': { y2024: 380, y2025: 410 },
    'Кол-во повторных': { y2024: 230, y2025: 290 },
    CAC: { y2025: 120_000 },
    LTV: { y2025: 520_000 },
  }),
  s9n_revenue_2024: 470_000_000,
  s9n_change_vs_2023: '+24%',
  s9n_net_margin: 34,
  s9n_breakeven_point: '28 млн ₸ в месяц',
  s9n_debts_amount: 0,
  s12_crm_tool: 'bitrix24',
  s12_project_mgmt: 'jira',
  s12_bi_tool: 'power_bi',
}

/** A typical current-wizard client: steps 1, 2, 4, 9 and 12 filled, nothing on the metrics table. */
export const CURRENT_TYPICAL: Record<string, unknown> = {
  s1_company_name: 'ИП «Кофейня у дома»',
  s1_industry: 'HoReCa',
  s1_current_revenue_year: 96_000_000,
  s1_goal_12m_revenue_year: 120_000_000,
  s2n_goal_12m_what: 'Открыть вторую точку',
  s2n_goal_3y_what: 'Сеть из пяти кофеен',
  s6_main_pain: 'Нет системы, всё держится на мне',
  s4_has_org_chart: false,
  s4_has_regular_meetings: true,
  s4m_control_method: 'fire_fighting',
  s4m_report_automated: 'excel',
  s9n_revenue_2024: 88_000_000,
  s9n_change_vs_2023: '+10%',
  s9n_net_margin: 12,
  s9n_breakeven_point: 'не знаю',
  s9n_debts_amount: 15_000_000,
  s12_crm_tool: 'none',
  s12_project_mgmt: 'none',
}

/** First-generation answers of a strong company (legacy keys only). */
export const LEGACY_STRONG: Record<string, unknown> = {
  s2_revenue_2023: 200_000_000,
  s2_revenue_2024: 260_000_000,
  s2_revenue_2025: 300_000_000,
  s2_gross_margin: 42,
  s2_ltv: 900_000,
  s2_cac: 150_000,
  s2_knows_breakeven: true,
  s2_debt_load: 'none',
  s2_new_clients_2024: 300,
  s2_repeat_clients_2024: 200,
  s3_has_crm: 'amocrm',
  s3_deal_cycle_days: 14,
  s3_deals_2024: 500,
  s3_rejections_2024: 60,
  s3_has_loyalty: true,
  s4_has_org_chart: true,
  s4_has_dept_kpi: true,
  s4_has_regular_meetings: true,
  s4_reporting_tool: 'bi',
  s4_task_manager: 'notion',
  s4_management_method: 'okr',
  s5_marketing_budget_pct: 8,
  s5_marketing_channels: ['SEO', 'SMM (соцсети)', 'Контекстная реклама'],
  s5_target_audience: 'Семьи с детьми 25–40 лет в Алматы и Астане',
  s5_has_competitor_analysis: true,
  s5_usp: 'Доставка за 30 минут',
  s6_goal_3years: 'Выручка 1 млрд ₸ и 10 филиалов',
  s6_goal_12months: 'Выручка 400 млн ₸',
  s6_main_pain: 'Не хватает управленцев среднего звена',
  s6_growth_blockers: ['Кадры'],
}

/** First-generation answers of a weak company. */
export const LEGACY_WEAK: Record<string, unknown> = {
  s2_revenue_2023: 50_000_000,
  s2_revenue_2024: 45_000_000,
  s2_gross_margin: 12,
  s2_ltv: 60_000,
  s2_cac: 40_000,
  s2_debt_load: 'high',
  s3_has_crm: 'none',
  s3_deal_cycle_days: 75,
  s3_deals_2024: 15,
  s3_rejections_2024: 20,
  s4_reporting_tool: 'excel',
  s4_management_method: 'manual',
  s5_marketing_channels: ['SMM (соцсети)'],
  s6_goal_12months: 'Расти',
  s6_main_pain: 'Мало клиентов, высокая конкуренция',
}
