/**
 * Human-readable labels for onboarding survey question keys.
 * Used in Giga Panel (admin view) and client "My Data" page.
 */

import { stepForQuestionKey } from '@/lib/survey/steps'

export const SURVEY_STEP_LABELS: Record<number, string> = {
  1: 'О компании',
  2: 'Цели',
  3: 'Позиционирование',
  4: 'Орг. структура',
  5: 'Работа с базой',
  6: 'CJM',
  7: 'Маркетинг',
  8: 'Ключевые метрики',
  9: 'Финансы',
  10: 'Личные вопросы',
  11: 'Карта влияния',
  12: 'Системы и инструменты',
}

export const SURVEY_LABELS: Record<string, string> = {
  // ── Step 1 — О компании ──────────────────────────────────────────────────
  s1_company_name: 'Название компании',
  s1_founded_at: 'Дата основания',
  s1_industry: 'Отрасль',
  s1_stage: 'Стадия развития',
  s1_employee_count: 'Количество сотрудников',
  s1_regions: 'География присутствия',
  s1_business_model: 'Бизнес-модель',
  s1_contact_name: 'Контактное лицо (ФИО)',
  s1_contact_position: 'Должность',
  s1_contact_phone: 'Телефон',
  s1_contact_email: 'Email контакта',
  s1_years_on_market: 'Лет на рынке',
  s1_website: 'Сайт компании',
  s1_social_media: 'Соцсети компании',
  s1_products_list: 'Список продуктов/услуг',
  s1_competitors_list: 'Основные конкуренты',

  // ── Step 2 (old finance fields, kept for backward compat) ───────────────
  s2_revenue_2023: 'Выручка 2023 (₸)',
  s2_revenue_2024: 'Выручка 2024 (₸)',
  s2_revenue_2025: 'Выручка 2025 (₸)',
  s2_new_clients_2023: 'Новых клиентов 2023',
  s2_new_clients_2024: 'Новых клиентов 2024',
  s2_new_clients_2025: 'Новых клиентов 2025',
  s2_repeat_clients_2023: 'Повторных клиентов 2023',
  s2_repeat_clients_2024: 'Повторных клиентов 2024',
  s2_repeat_clients_2025: 'Повторных клиентов 2025',
  s2_avg_check: 'Средний чек (₸)',
  s2_gross_margin: 'Маржинальность (%)',
  s2_cac: 'CAC — стоимость клиента (₸)',
  s2_ltv: 'LTV — ценность клиента (₸)',
  s2_debt_load: 'Долговая нагрузка',
  s2_knows_breakeven: 'Знает точку безубыточности',

  // ── Step 2 new — Цели ───────────────────────────────────────────────────
  s2n_goal_12m_what: 'Цель на 12 месяцев — что',
  s2n_goal_12m_metrics: 'Цель на 12 месяцев — метрики',
  s2n_goal_3y_what: 'Цель на 3 года — что',
  s2n_goal_3y_metrics: 'Цель на 3 года — метрики',
  s2n_tried_for_growth: 'Что уже пробовали для роста',
  s2n_what_blocks_growth: 'Что мешает расти',

  // ── Step 3 (old sales/CRM) ─────────────────────────────────────────────
  s3_has_crm: 'CRM-система',
  s3_products_description: 'Описание продуктов/услуг',
  s3_product_count: 'Количество продуктов',
  s3_flagship_product: 'Продукт-локомотив',
  s3_deals_2023: 'Завершённых сделок 2023',
  s3_deals_2024: 'Завершённых сделок 2024',
  s3_deals_2025: 'Завершённых сделок 2025',
  s3_rejections_2023: 'Отказов 2023',
  s3_rejections_2024: 'Отказов 2024',
  s3_rejections_2025: 'Отказов 2025',
  s3_deal_cycle_days: 'Цикл сделки (дней)',
  s3_promo_channels: 'Каналы продвижения',
  s3_has_loyalty: 'Программа лояльности',

  // ── Step 3 new — Позиционирование ──────────────────────────────────────
  s3n_client_portrait: 'Портрет клиента',
  s3n_price_segment: 'Ценовой сегмент',
  s3n_decision_maker: 'Лицо, принимающее решение',
  s3n_purchase_participants: 'Участники процесса покупки',
  s3n_client_problem: 'Проблема клиента',
  s3n_problem_impact: 'Влияние проблемы',
  s3n_current_solution: 'Текущее решение клиента',
  s3n_if_unsolved: 'Если проблему не решать',
  s3n_life_after_solution: 'Жизнь после решения',
  s3n_measurable_results: 'Измеримые результаты',
  s3n_short_wins: 'Быстрые победы',
  s3n_competitor_why_us: 'Почему выбирают нас, а не конкурентов',
  s3n_cannot_copy: 'Что нельзя скопировать',
  s3n_competitors_better: 'В чём конкуренты лучше',
  s3n_industry_standard: 'Отраслевой стандарт',

  // ── Step 4 — Орг. структура (old) ──────────────────────────────────────
  s4_dept_count: 'Количество отделов',
  s4_has_org_chart: 'Есть оргструктура',
  s4_management_method: 'Метод управления',
  s4_has_regular_meetings: 'Регулярные совещания',
  s4_reporting_tool: 'Инструмент отчётности',
  s4_task_manager: 'Таск-менеджер',
  s4_has_dept_kpi: 'KPI по отделам',

  // ── Step 4 new — Орг. структура ────────────────────────────────────────
  s4n_staffing_table: 'Штатное расписание',
  s4n_structure_matches: 'Структура соответствует задачам',
  s4n_open_vacancies: 'Открытые вакансии',
  s4n_multi_roles: 'Совмещение ролей',
  s4n_team_fit_12m: 'Команда подходит на 12 мес.',
  s4n_team_fit_3y: 'Команда подходит на 3 года',

  // ── Step 4 management — Управление ─────────────────────────────────────
  s4m_strategic_planning: 'Стратегическое планирование',
  s4m_planning_team_or_solo: 'Планирование — команда или один',
  s4m_dept_sync: 'Синхронизация отделов',
  s4m_control_method: 'Метод контроля',
  s4m_communication: 'Коммуникация',
  s4m_dept_regulations: 'Регламенты отделов',
  s4m_cross_functional: 'Кросс-функциональное взаимодействие',
  s4m_feedback_culture: 'Культура обратной связи',
  s4m_meeting_structure: 'Структура совещаний',
  s4m_meeting_efficiency: 'Эффективность совещаний',
  s4m_report_types: 'Типы отчётов',
  s4m_report_automated: 'Отчёты автоматизированы',
  s4m_report_frequency: 'Частота отчётности',
  s4m_hours_on_ops: 'Часов на операционку',
  s4m_delegation_readiness: 'Готовность к делегированию',

  // ── Step 5 — Маркетинг (old) ───────────────────────────────────────────
  s5_target_audience: 'Целевая аудитория',
  s5_audience_segments: 'Сегменты аудитории',
  s5_top_regions: 'Топ-регионы',
  s5_marketing_channels: 'Каналы маркетинга',
  s5_marketing_budget_pct: 'Бюджет маркетинга (% выручки)',
  s5_has_competitor_analysis: 'Есть анализ конкурентов',
  s5_competitor_1: 'Конкурент 1',
  s5_competitor_2: 'Конкурент 2',
  s5_competitor_3: 'Конкурент 3',
  s5_usp: 'УТП (уникальное предложение)',

  // ── Step 5 new — Работа с базой ────────────────────────────────────────
  s5n_funnel_lead_to_call: 'Конверсия лид → звонок',
  s5n_funnel_call_to_meeting: 'Конверсия звонок → встреча',
  s5n_funnel_call_to_kp: 'Конверсия звонок → КП',
  s5n_funnel_meeting_to_kp: 'Конверсия встреча → КП',
  s5n_funnel_call_to_sale: 'Конверсия звонок → продажа',
  s5n_funnel_meeting_to_sale: 'Конверсия встреча → продажа',
  s5n_funnel_kp_to_sale: 'Конверсия КП → продажа',
  s5n_funnel_lead_to_sale: 'Конверсия лид → продажа',
  s5n_abc_analysis: 'ABC-анализ клиентов',
  s5n_rfm_analysis: 'RFM-анализ',
  s5n_product_locomotive: 'Продукт-локомотив',
  s5n_most_marginal: 'Самый маржинальный продукт',
  s5n_entry_product: 'Входной продукт',
  s5n_client_list_table: 'Таблица клиентов',
  s5n_why_bought: 'Почему купили',
  s5n_deciding_factor: 'Решающий фактор',
  s5n_compared_with: 'С кем сравнивали',
  s5n_barriers: 'Барьеры покупки',
  s5n_how_found_us: 'Как нашли нас',
  s5n_intermediate_steps: 'Промежуточные шаги',
  s5n_will_return_nps: 'Вернутся ли (NPS)',
  s5n_improve_suggestions: 'Предложения по улучшению',
  s5n_top_questions: 'Топ-вопросы клиентов',
  s5n_upsell_crosssell: 'Допродажи (upsell / cross-sell)',

  // ── Step 6 — Цели и боли (old) ─────────────────────────────────────────
  s6_main_pain: 'Главная боль бизнеса',
  s6_goal_12months: 'Цель на 12 месяцев',
  s6_goal_3years: 'Цель на 3 года',
  s6_growth_blockers: 'Барьеры роста',
  s6_expectations: 'Ожидания от платформы',

  // ── Step 6 new — CJM ───────────────────────────────────────────────────
  s6n_journey_table: 'Таблица пути клиента (CJM)',
  s6n_weak_funnel_points: 'Слабые точки воронки',
  s6n_post_sale_touchpoints: 'Точки касания после продажи',
  s6n_script_first_contact: 'Скрипт первого контакта',
  s6n_script_meeting: 'Скрипт встречи',
  s6n_script_proposal: 'Скрипт отправки КП',

  // ── Step 7 new — Маркетинг ─────────────────────────────────────────────
  s7n_channels_table: 'Таблица каналов маркетинга',
  s7n_content_strategy: 'Контент-стратегия',
  s7n_competitor_1_analysis: 'Анализ конкурента 1',
  s7n_competitor_2_analysis: 'Анализ конкурента 2',
  s7n_competitor_3_analysis: 'Анализ конкурента 3',

  // ── Step 7 — Funnel & AI-comms signals (loss-map inputs) ───────────────
  s7_leads_per_month: 'Лидов в месяц (входящие)',
  s7_no_show_rate: 'Доля no-show (%)',
  s7_missed_calls_rate: 'Доля пропущенных звонков (%)',
  s7_avg_check_target_kzt: 'Целевой средний чек (₸)',
  s7_repeat_freq_days: 'Частота повторной покупки (дни)',
  s7_nps_score: 'Текущий NPS',

  // ── Step 8 — Ключевые метрики ──────────────────────────────────────────
  s8n_metrics_table: 'Таблица ключевых метрик',

  // ── Step 9 — Финансы ───────────────────────────────────────────────────
  s9n_revenue_2024: 'Выручка 2024',
  s9n_change_vs_2023: 'Изменение к 2023',
  s9n_net_profit: 'Чистая прибыль',
  s9n_net_margin: 'Чистая маржа',
  s9n_revenue_sources: 'Источники выручки',
  s9n_seasonality: 'Сезонность',
  s9n_breakeven_point: 'Точка безубыточности',
  s9n_dividend_policy: 'Дивидендная политика',
  s9n_expense_cogs: 'Расходы: себестоимость',
  s9n_expense_marketing: 'Расходы: маркетинг',
  s9n_expense_rent: 'Расходы: аренда',
  s9n_expense_other: 'Расходы: прочие',
  s9n_accounting_method: 'Метод учёта',
  s9n_planning_frequency: 'Периодичность планирования',
  s9n_analysis_frequency: 'Периодичность анализа',
  s9n_responsible_person: 'Ответственный за финансы',
  s9n_tracked_kpis: 'Отслеживаемые KPI',
  s9n_debtor_days: 'Дни дебиторки',
  s9n_debts_amount: 'Сумма задолженностей',
  s9n_tax_system: 'Система налогообложения',
  s9n_transparency_pct: 'Прозрачность бизнеса (%)',
  s9n_tax_audits: 'Налоговые проверки',
  s9n_audit_preparedness: 'Готовность к аудиту',
  s9n_financial_blockers: 'Финансовые блокеры',

  // ── Step 10 — Личные вопросы ───────────────────────────────────────────
  s10_why_opened: 'Почему открыли бизнес',
  s10_best_result_2y: 'Лучший результат за 2 года',
  s10_best_result_5y: 'Лучший результат за 5 лет',
  s10_best_result_10y: 'Лучший результат за 10 лет',
  s10_company_vision_2y: 'Видение компании на 2 года',
  s10_company_vision_5y: 'Видение компании на 5 лет',
  s10_company_vision_10y: 'Видение компании на 10 лет',
  s10_problems_faced: 'С какими проблемами столкнулись',
  s10_who_to_blame: 'Кто виноват',
  s10_dept_assessment: 'Оценка отделов',
  s10_what_depts_lack: 'Чего не хватает отделам',
  s10_competitor_comparison: 'Сравнение с конкурентами',
  s10_self_comparison: 'Самооценка',
  s10_brand_perception: 'Как воспринимают бренд',
  s10_when_they_buy: 'Когда у вас покупают',
  s10_hours_on_ops: 'Часов в день на операционку',
  s10_delegation_ready: 'Готовность делегировать (1-10)',
  s10_what_stops_delegating: 'Что мешает делегировать',

  // ── Step 11 — Карта влияния ────────────────────────────────────────────
  s11_influence_map: 'Карта влияния',

  // ── Step 12 — Системы и инструменты ────────────────────────────────────
  s12_crm_tool: 'CRM-система',
  s12_edm: 'EDM (электронный документооборот)',
  s12_erp: 'ERP-система',
  s12_bi_tool: 'BI-инструмент',
  s12_messengers: 'Мессенджеры',
  s12_telephony: 'Телефония',
  s12_project_mgmt: 'Управление проектами',
  s12_marketing_platforms: 'Маркетинговые платформы',
  s12_automation_details: 'Детали автоматизации',
  s12_it_support: 'IT-поддержка',
}

/**
 * Get the wizard step for a question key (e.g. "s2n_goal_12m_what" → 2).
 * Uses the generated key→step table (lib/survey/steps.ts): the prefix is NOT
 * reliable (step 5 writes `s3_*`, step 7 writes `s5_*`, and `s2n_`-style keys
 * never matched the old `^s(\d+)_` regex, so «Мои данные» silently dropped
 * whole sections). Falls back to the prefix for keys outside the table.
 */
export function getStepFromKey(key: string): number {
  const mapped = stepForQuestionKey(key)
  if (mapped !== null) return mapped
  const match = key.match(/^s(\d+)n?_/)
  return match ? parseInt(match[1], 10) : 0
}

/**
 * Render a table-style answer (array of row objects, e.g. «Карта влияния» /
 * «Каналы») as readable text instead of "[object Object], [object Object]".
 * Rows that only carry a pre-filled label (no user input) are skipped.
 */
export function formatSurveyTableRows(rows: ReadonlyArray<Record<string, unknown>>): string {
  const MAX_ROWS = 20
  const lines: string[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const keys = Object.keys(row)
    const cells = keys
      .map((k) => row[k])
      .filter((v) => v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === ''))
      .map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v).trim()))
    if (cells.length === 0) continue
    // A prefilled template row (only the first column, e.g. the category) is not an answer.
    if (keys.length >= 2 && cells.length === 1) continue
    lines.push(cells.join(' — '))
    if (lines.length >= MAX_ROWS) break
  }
  return lines.length ? lines.join('; ') : '—'
}

/** Format a survey value for display */
export function formatSurveyValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—'
  // Unwrap Supabase JSONB {value: ...} wrapper
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'value' in value) {
    return formatSurveyValue(key, (value as Record<string, unknown>).value)
  }
  // Handle plain objects (shouldn't reach here after unwrap, but safety net)
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    try { return JSON.stringify(value) } catch { return '—' }
  }
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    // Table answers (DynamicTable rows) → one line per filled row.
    if (value.every((v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !('value' in (v as object)))) {
      return formatSurveyTableRows(value as Record<string, unknown>[])
    }
    return value.map(v => typeof v === 'object' && v !== null && 'value' in v ? (v as any).value : v).join(', ')
  }
  if (typeof value === 'number') {
    if (key.includes('revenue') || key.includes('avg_check') || key.includes('cac') || key.includes('ltv')
        || key.includes('net_profit') || key.includes('debts_amount') || key.includes('breakeven_point')) {
      return new Intl.NumberFormat('ru-KZ').format(value) + ' ₸'
    }
    if (key.includes('margin') || key.includes('budget_pct') || key.includes('transparency_pct')) {
      return value + '%'
    }
    if (key.includes('funnel_')) {
      return value + '%'
    }
    return String(value)
  }

  // ── Enum formatters ─────────────────────────────────────────────────────
  if (key === 's2_debt_load') {
    const map: Record<string, string> = { none: 'Нет', moderate: 'Умеренная', high: 'Высокая' }
    return map[String(value)] || String(value)
  }
  if (key === 's3_has_crm' || key === 's12_crm_tool') {
    const map: Record<string, string> = { none: 'Нет', excel: 'Excel', amocrm: 'AmoCRM', bitrix24: 'Bitrix24', '1c': '1C', other: 'Другая' }
    return map[String(value)] || String(value)
  }
  if (key === 's4_management_method') {
    const map: Record<string, string> = { manual: 'Ручное', kpi: 'По KPI', okr: 'OKR', hybrid: 'Гибридное' }
    return map[String(value)] || String(value)
  }
  if (key === 's4_reporting_tool') {
    const map: Record<string, string> = { excel: 'Excel', bi: 'BI-система', crm: 'CRM', none: 'Нет' }
    return map[String(value)] || String(value)
  }
  if (key === 's4_task_manager') {
    const map: Record<string, string> = { none: 'Нет', trello: 'Trello', jira: 'Jira', notion: 'Notion', other: 'Другой' }
    return map[String(value)] || String(value)
  }
  if (key === 's3n_price_segment') {
    const map: Record<string, string> = { economy: 'Эконом', medium: 'Средний', premium: 'Премиум' }
    return map[String(value)] || String(value)
  }
  if (key === 's9n_planning_frequency' || key === 's9n_analysis_frequency') {
    const map: Record<string, string> = { weekly: 'Еженедельно', monthly: 'Ежемесячно', quarterly: 'Ежеквартально', yearly: 'Ежегодно', never: 'Не ведётся' }
    return map[String(value)] || String(value)
  }
  if (key === 's4m_report_frequency') {
    const map: Record<string, string> = { daily: 'Ежедневно', weekly: 'Еженедельно', monthly: 'Ежемесячно', quarterly: 'Ежеквартально', never: 'Не ведётся' }
    return map[String(value)] || String(value)
  }
  if (key === 's9n_accounting_method') {
    const map: Record<string, string> = { cash: 'Кассовый', accrual: 'Начисления', hybrid: 'Смешанный', none: 'Не ведётся' }
    return map[String(value)] || String(value)
  }
  if (key === 's9n_tax_system') {
    const map: Record<string, string> = { simplified: 'Упрощённый', general: 'Общий', patent: 'Патент', other: 'Другое' }
    return map[String(value)] || String(value)
  }
  if (key === 's12_edm' || key === 's12_erp' || key === 's12_bi_tool'
      || key === 's12_telephony' || key === 's12_project_mgmt' || key === 's12_marketing_platforms') {
    const map: Record<string, string> = { none: 'Нет', other: 'Другое' }
    return map[String(value)] || String(value)
  }
  return String(value)
}
