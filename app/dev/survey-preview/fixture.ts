// Fixture answers for the dev-only questionnaire preview (/dev/survey-preview).
// A made-up company — no real client data. Values match the option lists of
// the step forms (components/onboarding/steps/*) so selects show a value.
import type { AnswerAttribution } from '@/lib/survey/attribution-label'
import type { ValidationIssue } from '@/lib/assistant/types'
import { SURVEY_KEY_STEP } from '@/lib/survey/steps'

export const SURVEY_PREVIEW_VARIANTS = ['empty', 'half', 'filled', 'ai', 'authors'] as const
export type SurveyPreviewVariant = (typeof SURVEY_PREVIEW_VARIANTS)[number]

export const SURVEY_PREVIEW_VARIANT_LABEL: Record<SurveyPreviewVariant, string> = {
  empty: 'Пустая',
  half: 'Наполовину',
  filled: 'Заполнена',
  ai: 'С подсказками ИИ',
  authors: 'С авторами ответов',
}

export function isSurveyPreviewVariant(v: unknown): v is SurveyPreviewVariant {
  return typeof v === 'string' && (SURVEY_PREVIEW_VARIANTS as readonly string[]).includes(v)
}

/** Every question of the 12 steps answered, as a typical owner would. */
const FILLED: Record<string, unknown> = {
  // Step 1 — О компании
  s1_company_name: 'ТОО «Пример Сервис»',
  s1_industry: 'Консалтинг / Услуги B2B',
  s1_employee_count: 18,
  s1_business_model: 'B2B',
  s1_years_on_market: 6,
  s1_website: 'https://example.kz',
  s1_social_media: 'instagram.com/example, t.me/example',
  s1_regions: ['Алматы', 'Астана'],
  s1_current_revenue_month: 5_500_000,
  s1_current_revenue_year: 66_000_000,
  s1_goal_12m_revenue_month: 9_000_000,
  s1_goal_12m_revenue_year: 108_000_000,
  s1_goal_3y_revenue_month: 25_000_000,
  s1_goal_3y_revenue_year: 300_000_000,
  s1_products_list: 'Аутсорсинг бухгалтерии; кадровый учёт; налоговые консультации',
  s1_competitors_list: 'Компания А, Компания Б, фрилансеры',
  s1_contact_name: 'Иван Пример',
  s1_contact_position: 'Директор',
  s1_contact_phone: '+7 700 000 00 00',
  s1_contact_email: 'owner@example.kz',
  // Step 2 — Цели
  s2n_goal_12m_what: 'Выйти на 9 млн ₸ в месяц, открыть направление для среднего бизнеса',
  s2n_goal_12m_metrics: 'Выручка в месяц, число клиентов на абонементе, отток',
  s2n_goal_3y_what: 'Лидер аутсорсинга в Алматы и Астане, 25 млн ₸ в месяц',
  s2n_goal_3y_metrics: 'Выручка, доля рынка, маржа 25 %',
  s2n_tried_for_growth: 'Таргет в Instagram, партнёрство с банком, скидки за год вперёд',
  s2n_what_blocks_growth: 'Всё держится на собственнике, нет отдела продаж',
  s6_main_pain: 'Не хватает времени на развитие — тушу пожары',
  s6_growth_blockers: ['Команда / Кадры', 'Маркетинг / Продажи'],
  s6_expectations: 'Понять, где теряем деньги, и получить план на год',
  // Step 3 — Позиционирование
  s5_target_audience: 'Малый и средний бизнес, 5–50 сотрудников',
  s3n_client_portrait: 'Собственник ТОО, 35–50 лет, сам ведёт финансы, боится налоговой',
  s3n_price_segment: 'medium',
  s3n_decision_maker: 'Собственник',
  s3n_purchase_participants: 'Главный бухгалтер, иногда юрист',
  s5_usp: 'Фиксированная цена и ответственность за штрафы',
  s3n_client_problem: 'Нет своего бухгалтера или он не справляется',
  s3n_problem_impact: 'Штрафы, блокировка счёта, нервы',
  s3n_current_solution: 'Бухгалтер на полставки или фрилансер',
  s3n_if_unsolved: 'Штрафы и потеря времени собственника',
  s3n_life_after_solution: 'Собственник не думает об отчётности',
  s3n_measurable_results: '0 штрафов за год, отчёты в срок',
  s3n_short_wins: 'Аудит учёта за 2 недели',
  s3n_competitor_why_us: 'Отвечаем в течение часа, один менеджер на клиента',
  s3n_cannot_copy: 'База знаний по отраслям, 6 лет практики',
  s3n_competitors_better: 'Крупные — бренд, фрилансеры — цена',
  s3n_industry_standard: 'Ответ в течение дня, цена от объёма операций',
  // Step 4 — Орг. структура
  s4_dept_count: 3,
  s4_has_org_chart: true,
  s4n_staffing_table: [
    { department: 'Бухгалтерия', head: 'Главбух', manager_count: 10, dept_goals: 'Отчёты в срок', kpi: '0 штрафов' },
    { department: 'Продажи', head: 'Собственник', manager_count: 1, dept_goals: 'Новые клиенты', kpi: '8 договоров в месяц' },
  ],
  s4n_structure_matches: false,
  s4n_open_vacancies: true,
  s4n_multi_roles: true,
  s4m_strategic_planning: 'Раз в год сам, в Excel',
  s4m_planning_team_or_solo: 'one_person',
  s4m_control_method: 'fire_fighting',
  s4m_communication: 'Telegram, WhatsApp',
  s4m_dept_sync: false,
  s4_has_regular_meetings: true,
  s4m_meeting_structure: false,
  s4m_meeting_efficiency: 'Средняя',
  s4m_report_types: 'Финансовые',
  s4m_report_automated: 'excel',
  s4m_report_frequency: 'monthly',
  s4m_hours_on_ops: 9,
  s4m_delegation_readiness: 4,
  // Step 5 — Работа с базой
  s3_has_crm: 'Bitrix24',
  s3_deal_cycle_days: 14,
  s3_deals_2023: 61,
  s3_deals_2024: 74,
  s3_deals_2025: 88,
  s3_rejections_2023: 120,
  s3_rejections_2024: 140,
  s3_rejections_2025: 150,
  s3_promo_channels: 'Instagram, рекомендации, партнёры',
  s3_product_count: 3,
  s3_flagship_product: 'Аутсорсинг бухгалтерии',
  s5n_funnel_lead_to_call: 80,
  s5n_funnel_call_to_meeting: 40,
  s5n_funnel_meeting_to_proposal: 70,
  s5n_funnel_proposal_to_negotiation: 60,
  s5n_funnel_negotiation_to_contract: 50,
  s5n_funnel_contract_to_payment: 95,
  s5n_funnel_payment_to_delivery: 100,
  s5n_funnel_lead_to_sale: 9,
  s5n_abc_analysis: 'A — 12 клиентов дают 60 % выручки',
  s5n_rfm_analysis: 'Не делали',
  s5n_product_locomotive: 'Аутсорсинг бухгалтерии',
  s5n_most_marginal: 'Налоговые консультации',
  s5n_entry_product: 'Аудит учёта',
  s5n_why_bought: 'Рекомендации, скорость ответа',
  s5n_deciding_factor: 'Цена и отзывы',
  s5n_compared_with: 'Фрилансеры и крупные фирмы',
  s5n_barriers: 'Страх сменить бухгалтера посреди года',
  s5n_how_found_us: 'Рекомендации — 60 %, Instagram — 25 %',
  s5n_will_return_nps: 'Большинство продлевают, NPS не считали',
  s5n_improve_suggestions: 'Личный кабинет с отчётами',
  s5n_upsell_crosssell: 'Кадровый учёт к бухгалтерии',
  // Step 6 — CJM
  s6n_journey_table: [
    { stage_name: 'Заявка', goal: 'Ответить за час', actions: 'Пишет в WhatsApp', barriers: 'Ночью никто не отвечает', materials: 'Прайс' },
    { stage_name: 'Встреча', goal: 'Аудит учёта', actions: 'Присылает выписки', barriers: 'Долго собирает документы', materials: 'Чек-лист' },
  ],
  s6n_weak_funnel_points: 'Между звонком и встречей теряем больше половины',
  s6n_post_sale_touchpoints: 'Ежемесячный отчёт, звонок перед сдачей налоговой',
  // Step 7 — Маркетинг
  s5_marketing_channels: ['SMM (соцсети)', 'Партнёрский маркетинг'],
  s5_marketing_budget_pct: 3,
  s5_has_competitor_analysis: false,
  s7n_channels_table: [
    { channel: 'Instagram', budget_monthly: 150_000, effectiveness_pct: 2, sales_monthly: 2, roi: 1.5 },
    { channel: 'Партнёры', budget_monthly: 0, effectiveness_pct: 30, sales_monthly: 3, roi: 0 },
  ],
  s7n_content_strategy: '2 поста в неделю, сторис с разбором налоговых новостей',
  s7_leads_per_month: 60,
  s7_no_show_rate: 20,
  s7_missed_calls_rate: 10,
  s7_avg_check_target_kzt: 120_000,
  s7_repeat_freq_days: 30,
  s7_nps_score: 40,
  s5_competitor_1: 'Компания А',
  s7n_competitor_1_analysis: 'Сильный бренд, цена выше на 30 %',
  s5_competitor_2: 'Компания Б',
  s7n_competitor_2_analysis: 'Дешевле, но медленно отвечают',
  s5_competitor_3: 'Фрилансеры',
  s7n_competitor_3_analysis: 'Самые дешёвые, нет ответственности',
  // Step 8 — Ключевые метрики
  s8n_metrics_table: [
    { metric_name: 'Сумма продаж', y2023: 41_000_000, y2024: 52_000_000, y2025: 66_000_000, plan_2026: 90_000_000, fact_2026: 58_000_000, completion_pct: 64 },
    { metric_name: 'Количество продаж', y2023: 61, y2024: 74, y2025: 88, plan_2026: 110, fact_2026: 70, completion_pct: 64 },
    { metric_name: 'Средний чек', y2023: 95_000, y2024: 105_000, y2025: 115_000, plan_2026: 120_000, fact_2026: 118_000, completion_pct: 98 },
    { metric_name: 'CAC', y2023: 0, y2024: 30_000, y2025: 27_000, plan_2026: 25_000, fact_2026: 26_000, completion_pct: 96 },
  ],
  // Step 9 — Финансы
  s9n_revenue_2024: 52_000_000,
  s9n_change_vs_2023: '+27%',
  s9n_net_profit: 7_800_000,
  s9n_net_margin: 15,
  s9n_revenue_sources: 'Абонементы на бухгалтерию — 80 %',
  s9n_seasonality: 'Пик в марте и сентябре (отчётность), провал летом',
  s9n_breakeven_point: '3 800 000 в месяц',
  s9n_dividend_policy: 'Забираю остаток в конце месяца',
  s9n_expense_cogs: 'около 60 %',
  s9n_expense_marketing: '150 000 в месяц',
  s9n_expense_rent: '400 000',
  s9n_expense_other: 'не считал',
  s9n_accounting_method: '1С + Excel',
  s9n_planning_frequency: 'yearly',
  s9n_analysis_frequency: 'monthly',
  s9n_responsible_person: 'Собственник',
  s9n_tracked_kpis: 'Выручка, число клиентов',
  s9n_debtor_days: 20,
  s9n_debts_amount: 3_000_000,
  s9n_tax_system: 'Упрощённая декларация',
  s9n_transparency_pct: 100,
  s9n_tax_audits: 'Нет',
  s9n_audit_preparedness: 'Готовы',
  s9n_financial_blockers: 'Нет управленческого учёта по направлениям',
  // Step 10 — Личные вопросы
  s10_why_opened: 'Работал главбухом, видел, как клиенты платят штрафы',
  s10_best_result_2y: 'Вырос с 10 до 18 человек',
  s10_best_result_5y: 'Ни одного штрафа у клиентов за 3 года',
  s10_best_result_10y: 'Компания с нуля',
  s10_company_vision_2y: 'Второй офис в Астане',
  s10_company_vision_5y: 'Сервис с личным кабинетом, 500 клиентов',
  s10_company_vision_10y: 'Продал или передал управление',
  s10_problems_faced: 'Уход ключевых бухгалтеров',
  s10_who_to_blame: 'Сам — не выстроил систему',
  s10_dept_assessment: 'Бухгалтерия — 8/10, продажи — 3/10',
  s10_what_depts_lack: 'Продажам — человека',
  s10_competitor_comparison: 'Сильнее в сервисе, слабее в маркетинге',
  s10_brand_perception: 'Надёжные, но маленькие',
  s10_when_they_buy: 'Перед сдачей отчётности или после штрафа',
  s10_hours_on_ops: 9,
  s10_delegation_ready: 5,
  s10_what_stops_delegating: 'Некому, боюсь ошибок',
  // Step 11 — Карта влияния
  s11_influence_map: [
    { category: 'Партнёры', name_or_link: 'Банк-партнёр', status: 'есть контакт' },
    { category: 'Государственные органы', name_or_link: 'Палата предпринимателей', status: 'в работе' },
    { category: 'Лидеры мнения', name_or_link: '', status: 'нет' },
  ],
  // Step 12 — Системы и инструменты
  s12_crm_tool: 'bitrix24',
  s12_edm: '1c_doc',
  s12_erp: 'none',
  s12_bi_tool: 'excel',
  s12_messengers: 'whatsapp',
  s12_telephony: 'none',
  s12_project_mgmt: 'bitrix24',
  s12_marketing_platforms: 'meta_ads',
  s12_automation_details: 'Банк-клиент выгружается в 1С, остальное руками',
  s12_it_support: false,
}

/** What a typical owner leaves after one sitting: step 1 and goals, then a few numbers. */
const HALF_KEYS = [
  's1_company_name', 's1_industry', 's1_employee_count', 's1_business_model', 's1_regions', 's1_website',
  's1_current_revenue_month', 's1_current_revenue_year', 's1_goal_12m_revenue_month', 's1_goal_12m_revenue_year',
  's1_contact_name', 's1_contact_phone', 's1_contact_email',
  's2n_goal_12m_what', 's6_main_pain', 's6_growth_blockers',
  's5_target_audience', 's5_usp',
  's4_has_org_chart', 's4_has_regular_meetings', 's4_dept_count',
  's3_has_crm', 's3_deals_2025',
  's5_marketing_channels', 's5_marketing_budget_pct',
]

function pick(keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of keys) if (k in FILLED) out[k] = FILLED[k]
  return out
}

export function previewAnswers(variant: SurveyPreviewVariant): Record<string, unknown> {
  if (variant === 'empty') return {}
  if (variant === 'half' || variant === 'ai') return pick(HALF_KEYS)
  return { ...FILLED }
}

const AT = '2026-10-20T09:30:00.000Z'
const EXPERT_KEYS = new Set(['s2n_goal_12m_metrics', 's9n_net_margin', 's9n_breakeven_point', 's5n_funnel_lead_to_sale', 's4m_control_method'])
const ADMIN_KEYS = new Set(['s1_industry', 's12_crm_tool'])
const AI_KEYS = new Set(['s1_current_revenue_month', 's9n_revenue_2024', 's9n_net_profit', 's3_deals_2025', 's7_leads_per_month', 's9n_debtor_days'])
const LEGACY_KEYS = new Set(['s1_years_on_market', 's10_why_opened'])

/** The line under each answered field («Заполнил: вы · 20.10.2026», …). */
export function previewAttribution(variant: SurveyPreviewVariant, answers: Record<string, unknown>): Record<string, AnswerAttribution> {
  if (variant !== 'authors' && variant !== 'ai') return {}
  const out: Record<string, AnswerAttribution> = {}
  for (const key of Object.keys(answers)) {
    if (!(key in SURVEY_KEY_STEP)) continue
    let a: AnswerAttribution = { updatedBy: 'preview-owner', updatedByRole: 'user', updatedAt: AT, updatedByName: null }
    if (variant === 'authors') {
      if (EXPERT_KEYS.has(key)) a = { updatedBy: 'preview-expert', updatedByRole: 'expert', updatedAt: '2026-10-21T12:00:00.000Z', updatedByName: 'Анна Ким' }
      else if (ADMIN_KEYS.has(key)) a = { updatedBy: 'preview-admin', updatedByRole: 'admin', updatedAt: '2026-10-21T15:00:00.000Z', updatedByName: 'Администратор' }
      else if (AI_KEYS.has(key)) a = { updatedBy: null, updatedByRole: 'ai', updatedAt: '2026-10-19T08:00:00.000Z', updatedByName: null }
      else if (LEGACY_KEYS.has(key)) a = { updatedBy: null, updatedByRole: null, updatedAt: null, updatedByName: null, legacy: true }
    }
    out[key] = a
  }
  return out
}

export interface PreviewSuggestion {
  id: string
  question_key: string
  value: unknown
  label: string | null
  document_name: string | null
  step: number | null
}

/** Values «found in documents» for questions the half-filled owner left empty. */
export function previewSuggestions(variant: SurveyPreviewVariant): PreviewSuggestion[] {
  if (variant !== 'ai') return []
  const s = (id: string, key: string, value: unknown, label: string, doc: string): PreviewSuggestion => ({
    id, question_key: key, value, label, document_name: doc, step: SURVEY_KEY_STEP[key] ?? null,
  })
  return [
    s('sg-1', 's1_goal_3y_revenue_month', 25_000_000, 'Цель через 3 года, выручка / месяц', 'Стратегия 2029.pdf'),
    s('sg-2', 's1_years_on_market', 6, 'Лет на рынке', 'Устав.pdf'),
    s('sg-3', 's3_deals_2024', 74, 'Сделок 2024', 'Отчёт по продажам.xlsx'),
    s('sg-4', 's3_deal_cycle_days', 14, 'Цикл сделки (дней)', 'Выгрузка CRM.xlsx'),
    s('sg-5', 's7_leads_per_month', 60, 'Лидов в месяц', 'Выгрузка CRM.xlsx'),
    s('sg-6', 's9n_revenue_2024', 52_000_000, 'Годовая выручка 2024', 'ОСВ 2024.xlsx'),
    s('sg-7', 's9n_net_profit', 7_800_000, 'Чистая прибыль 2024', 'ОПиУ 2024.xlsx'),
    s('sg-8', 's9n_debtor_days', 20, 'Средний срок оплаты, дней', 'ОСВ 2024.xlsx'),
  ]
}

/**
 * What the assistant's /validate returns for a section (a fixture copy of the
 * deterministic layer's wording) — so the preview shows the hint block too.
 */
export function previewIssues(variant: SurveyPreviewVariant, section: string): ValidationIssue[] {
  const issue = (id: string, severity: ValidationIssue['severity'], field: string | undefined, message_ru: string, hint_ru?: string): ValidationIssue => ({
    id, severity, section, field, code: id, message_ru, hint_ru, source: 'deterministic',
  })
  if (variant === 'empty') {
    if (section === 'company') return [issue('req-name', 'error', 's1_company_name', 'Не заполнено обязательное поле «Название компании».')]
    if (section === 'goals') return [issue('req-goal', 'error', 's2n_goal_12m_what', 'Не заполнено обязательное поле «Цель на 12 месяцев».')]
    return []
  }
  if (variant === 'half' || variant === 'ai') {
    if (section === 'goals') return [issue('goal-3y', 'error', 's2n_goal_3y_what', 'Не заполнено обязательное поле «Цель на 3 года».', 'Опишите цель хотя бы в одном предложении.')]
    if (section === 'finance') return [issue('req-rev', 'error', 's9n_revenue_2024', 'Не заполнено обязательное поле «Выручка 2024».')]
    return []
  }
  if (section === 'goals') {
    return [issue('growth', 'warning', undefined, 'Цель выглядит труднодостижимой при текущих ресурсах (aggressive).', 'Пересмотрите цель или усильте слабые блоки: продажи, операционка')]
  }
  return []
}
