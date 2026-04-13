/**
 * Human-readable labels for onboarding survey question keys.
 * Used in Giga Panel (admin view) and client "My Data" page.
 */

export const SURVEY_STEP_LABELS: Record<number, string> = {
  1: 'Компания',
  2: 'Финансы',
  3: 'Продажи и CRM',
  4: 'Операции',
  5: 'Маркетинг',
  6: 'Цели и боли',
}

export const SURVEY_LABELS: Record<string, string> = {
  // Step 1 — Company
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

  // Step 2 — Finance
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

  // Step 3 — Sales & CRM
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

  // Step 4 — Operations
  s4_dept_count: 'Количество отделов',
  s4_has_org_chart: 'Есть оргструктура',
  s4_management_method: 'Метод управления',
  s4_has_regular_meetings: 'Регулярные совещания',
  s4_reporting_tool: 'Инструмент отчётности',
  s4_task_manager: 'Таск-менеджер',
  s4_has_dept_kpi: 'KPI по отделам',

  // Step 5 — Marketing
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

  // Step 6 — Goals & Pain Points
  s6_main_pain: 'Главная боль бизнеса',
  s6_goal_12months: 'Цель на 12 месяцев',
  s6_goal_3years: 'Цель на 3 года',
  s6_growth_blockers: 'Барьеры роста',
  s6_expectations: 'Ожидания от платформы',
}

/** Get the step number from a question key (e.g. "s2_revenue_2023" → 2) */
export function getStepFromKey(key: string): number {
  const match = key.match(/^s(\d)_/)
  return match ? parseInt(match[1], 10) : 0
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
  if (Array.isArray(value)) return value.map(v => typeof v === 'object' && v !== null && 'value' in v ? (v as any).value : v).join(', ')
  if (typeof value === 'number') {
    if (key.includes('revenue') || key.includes('avg_check') || key.includes('cac') || key.includes('ltv')) {
      return new Intl.NumberFormat('ru-KZ').format(value) + ' ₸'
    }
    if (key.includes('margin') || key.includes('budget_pct')) {
      return value + '%'
    }
    return String(value)
  }
  if (key === 's2_debt_load') {
    const map: Record<string, string> = { none: 'Нет', moderate: 'Умеренная', high: 'Высокая' }
    return map[String(value)] || String(value)
  }
  if (key === 's3_has_crm') {
    const map: Record<string, string> = { none: 'Нет', excel: 'Excel', amocrm: 'AmoCRM', bitrix24: 'Bitrix24', other: 'Другая' }
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
  return String(value)
}
