import { getMetricById } from '@/lib/metrics/registry'
import { SURVEY_LABELS } from '@/lib/survey-labels'

export const POINT_A_MAPPING_VERSION = 3

/**
 * Only direct 1:1 mappings belong here.
 *
 * Registry `sources` describe every input needed to derive a metric, not an
 * assignment from a survey answer to that metric. For example, s9n_net_profit
 * is an input to EBITDA and ROA, but its value is neither EBITDA nor ROA.
 * Building this map mechanically from registry sources corrupts the canonical
 * model, so formula inputs remain under their stable `survey.*` field until a
 * dedicated computed-value producer derives the target metric.
 */
const DIRECT_SURVEY_TO_FIELDS: Readonly<Record<string, readonly string[]>> = {
  s1_company_name: ['company.name'],
  s1_industry: ['company.industry'],
  s1_products_list: ['company.products_services'],
  s1_employee_count: ['company.employee_count'],
  s2_revenue_2023: ['biz.finansy.vyruchka_god'],
  s2_revenue_2024: ['biz.finansy.vyruchka_god'],
  s2_revenue_2025: ['biz.finansy.vyruchka_god'],
  s9n_revenue_2024: ['biz.finansy.vyruchka_god'],
  s9n_expense_cogs: ['finance.cost_of_goods'],
  s9n_net_profit: ['finance.net_profit'],
  s2_gross_margin: ['biz.finansy.valovaya_marzha'],
  s2_avg_check: ['biz.prodazhi.sredniy_chek'],
  s2_cac: ['biz.marketing.cac'],
  s3_deal_cycle_days: ['biz.prodazhi.tsikl_zakrytiya_sdelki'],
  s3_deals_2025: ['sales.deals_completed'],
  s5_target_audience: ['customers.target_audience'],
  s5_audience_segments: ['customers.segments'],
  s5_marketing_channels: ['marketing.channels'],
  s7n_content_strategy: ['marketing.strategy'],
  s5n_funnel_lead_to_sale: ['sales.funnel.lead_to_sale'],
  s4_management_method: ['operations.management_method'],
  s12_automation_details: ['operations.automation'],
  s6_main_pain: ['strategy.key_problems'],
  s2n_what_blocks_growth: ['strategy.constraints'],
  s6_growth_blockers: ['strategy.constraints'],
  s2n_goal_12m_what: ['strategy.goal_12m'],
  s2n_tried_for_growth: ['strategy.current_initiatives'],
  s3n_competitor_why_us: ['strategy.strengths'],
  s3n_competitors_better: ['strategy.weaknesses'],
  s10_delegation_ready: ['owner.readiness'],
}

const EXCLUDED_LEGACY_SURVEY_KEYS = new Set([
  's1_business_model',
  's6_expectations',
])

const CANONICAL_FIELD_LABELS: Readonly<Record<string, string>> = {
  'company.name': 'Название компании',
  'company.industry': 'Отрасль',
  'company.business_model': 'Бизнес-модель',
  'company.products_services': 'Продукты и услуги',
  'company.employee_count': 'Количество сотрудников',
  'customers.target_audience': 'Целевая аудитория',
  'customers.segments': 'Сегменты клиентов',
  'finance.cost_of_goods': 'Себестоимость',
  'finance.total_expenses': 'Расходы',
  'finance.net_profit': 'Чистая прибыль',
  'finance.cash_flow': 'Денежный поток',
  'sales.deals_completed': 'Количество сделок',
  'sales.funnel.lead_to_sale': 'Конверсия лид → продажа',
  'marketing.strategy': 'Маркетинговая стратегия',
  'marketing.channels': 'Каналы привлечения',
  'operations.management_method': 'Метод управления',
  'operations.automation': 'Автоматизация процессов',
  'strategy.key_problems': 'Ключевые проблемы',
  'strategy.constraints': 'Ограничения роста',
  'strategy.available_resources': 'Доступные ресурсы',
  'strategy.key_risks': 'Ключевые риски',
  'strategy.goal_12m': 'Цель на 12 месяцев',
  'strategy.current_initiatives': 'Текущие инициативы',
  'strategy.strengths': 'Сильные стороны',
  'strategy.weaknesses': 'Слабые стороны',
  'strategy.conclusions': 'Выводы',
  'strategy.growth_zones': 'Зоны роста',
  'owner.readiness': 'Готовность собственника',
}

const REQUIRED_FIELDS = [
  ['company.name', 'Название компании', 'Профиль компании'],
  ['company.industry', 'Отрасль', 'Профиль компании'],
  ['company.business_model', 'Бизнес-модель', 'Профиль компании'],
  ['company.products_services', 'Продукты и услуги', 'Продукты и услуги'],
  ['customers.target_audience', 'Целевая аудитория', 'Клиенты и сегменты'],
  ['customers.segments', 'Сегменты клиентов', 'Клиенты и сегменты'],
  ['biz.finansy.vyruchka_god', 'Выручка', 'Финансы'],
  ['finance.cost_of_goods', 'Себестоимость', 'Финансы'],
  ['finance.total_expenses', 'Расходы', 'Финансы'],
  ['finance.net_profit', 'Чистая прибыль', 'Финансы'],
  ['biz.finansy.valovaya_marzha', 'Маржинальность', 'Финансы'],
  ['finance.cash_flow', 'Денежный поток', 'Финансы'],
  ['company.employee_count', 'Количество сотрудников', 'Команда'],
  ['sales.deals_completed', 'Количество сделок', 'Продажи'],
  ['biz.prodazhi.sredniy_chek', 'Средний чек', 'Продажи'],
  ['marketing.strategy', 'Маркетинговая стратегия', 'Маркетинг'],
  ['marketing.channels', 'Каналы привлечения', 'Маркетинг'],
  ['sales.funnel.lead_to_sale', 'Конверсия лид → продажа', 'Воронка'],
  ['operations.management_method', 'Метод управления', 'Операции и процессы'],
  ['operations.automation', 'Автоматизация процессов', 'Операции и процессы'],
  ['strategy.key_problems', 'Ключевые проблемы', 'Проблемы и ограничения'],
  ['strategy.constraints', 'Ограничения роста', 'Проблемы и ограничения'],
  ['strategy.available_resources', 'Доступные ресурсы', 'Ресурсы'],
  ['strategy.key_risks', 'Ключевые риски', 'Риски'],
  ['strategy.goal_12m', 'Цель на 12 месяцев', 'Цели'],
  ['strategy.current_initiatives', 'Текущие инициативы', 'Инициативы'],
  ['strategy.strengths', 'Сильные стороны', 'Сильные и слабые стороны'],
  ['strategy.weaknesses', 'Слабые стороны', 'Сильные и слабые стороны'],
  ['strategy.conclusions', 'Выводы', 'Выводы и зоны роста'],
  ['strategy.growth_zones', 'Зоны роста', 'Выводы и зоны роста'],
  ['owner.readiness', 'Готовность собственника', 'Команда'],
] as const

export function pointAFieldKeysForSurvey(questionKey: string): string[] {
  if (EXCLUDED_LEGACY_SURVEY_KEYS.has(questionKey)) return []
  const fields = DIRECT_SURVEY_TO_FIELDS[questionKey] ?? []
  return fields.length ? [...fields] : [`survey.${questionKey}`]
}

export function pointAFieldKeyForDocument(input: {
  key: string
  label?: string | null
  targetParameter?: string | null
  metricId?: string | null
}): string {
  const probe = [input.key, input.label, input.targetParameter]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/ё/g, 'е')

  const mappings: Array<[RegExp, string]> = [
    [/(company.?name|названи[ея].*компан)/, 'company.name'],
    [/(industry|отрасл)/, 'company.industry'],
    [/(business.?model|бизнес.?модел)/, 'company.business_model'],
    [/(products?.?(services?)?|продукт|услуг)/, 'company.products_services'],
    [/(target.?audience|целевая аудитория|портрет клиент)/, 'customers.target_audience'],
    [/(audience.?segments?|customer.?segments?|сегмент.*клиент|сегмент.*аудитор)/, 'customers.segments'],
    [/(revenue|выруч)/, 'biz.finansy.vyruchka_god'],
    [/(net.?profit|чистая прибыль)/, 'finance.net_profit'],
    [/(total.?expenses?|operating.?expenses?|общ.*расход|расход.*всего)/, 'finance.total_expenses'],
    [/(cash.?flow|денежн.*поток|движени[ея].*денег)/, 'finance.cash_flow'],
    [/(cogs|cost.?of.?goods|себестоимост)/, 'finance.cost_of_goods'],
    [/(margin.?percent|gross.?margin|маржинальност)/, 'biz.finansy.valovaya_marzha'],
    [/(average.?(deal.?price|check)|avg.?check|средн.*чек)/, 'biz.prodazhi.sredniy_chek'],
    [/(customer.?acquisition.?cost|\bcac\b)/, 'biz.marketing.cac'],
    [/(employee.?count|staff.?count|количеств.*сотруд|численност.*штат)/, 'company.employee_count'],
    [/(deals?.?completed|количеств.*сдел|завершенн.*сдел)/, 'sales.deals_completed'],
    [/(marketing.?channels?|канал.*привлеч|канал.*маркет)/, 'marketing.channels'],
    [/(marketing.?strategy|контент.?стратег|маркетингов.*стратег)/, 'marketing.strategy'],
    [/(lead.?to.?sale|лид.*продаж|конверси.*лид)/, 'sales.funnel.lead_to_sale'],
    [/(management.?method|метод.*управлен)/, 'operations.management_method'],
    [/(automation|автоматизац)/, 'operations.automation'],
    [/(key.?problems?|main.?pain|ключев.*проблем|главн.*бол)/, 'strategy.key_problems'],
    [/(constraints?|growth.?blockers?|ограничен|барьер.*рост|мешает.*раст)/, 'strategy.constraints'],
    [/(resources?|ресурс)/, 'strategy.available_resources'],
    [/(key.?risks?|риски?)/, 'strategy.key_risks'],
    [/(goal.?12|цель.*12)/, 'strategy.goal_12m'],
    [/(current.?initiatives?|инициатив|пробовал.*рост)/, 'strategy.current_initiatives'],
    [/(strengths?|сильн.*сторон|почему.*выбира)/, 'strategy.strengths'],
    [/(weaknesses?|слаб.*сторон|конкурент.*лучше)/, 'strategy.weaknesses'],
    [/(conclusions?|вывод)/, 'strategy.conclusions'],
    [/(growth.?zones?|зон.*рост)/, 'strategy.growth_zones'],
    [/(owner.?readiness|готовност.*собствен|готовност.*делег)/, 'owner.readiness'],
  ]
  const direct = mappings.find(([pattern]) => pattern.test(probe))?.[1]
  if (direct) return direct
  if (input.metricId) return input.metricId
  return `document.${String(input.key || input.label || 'field')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/giu, '_')
    .replace(/^_|_$/g, '')}`
}

export function pointAFieldLabel(fieldKey: string): string {
  if (CANONICAL_FIELD_LABELS[fieldKey]) return CANONICAL_FIELD_LABELS[fieldKey]
  const metric = getMetricById(fieldKey)
  if (metric) return metric.label
  const surveyKey = fieldKey.startsWith('survey.')
    ? fieldKey.slice('survey.'.length)
    : fieldKey
  return SURVEY_LABELS[surveyKey] ?? surveyKey.replace(/[._-]+/g, ' ')
}

export function pointAFieldSection(fieldKey: string): string {
  const metric = getMetricById(fieldKey)
  if (metric?.department) return metric.department
  const key = fieldKey.toLowerCase()
  if (key.startsWith('company.products_')) return 'Продукты и услуги'
  if (key.startsWith('company.employee_') || key.startsWith('owner.')) return 'Команда'
  if (key.startsWith('company.')) return 'Профиль компании'
  if (key.startsWith('customers.')) return 'Клиенты и сегменты'
  if (key.startsWith('finance.')) return 'Финансы'
  if (key.startsWith('sales.funnel.')) return 'Воронка'
  if (key.startsWith('sales.')) return 'Продажи'
  if (key.startsWith('marketing.')) return 'Маркетинг'
  if (key.startsWith('operations.')) return 'Операции и процессы'
  if (/strategy\.(strengths|weaknesses)/.test(key)) return 'Сильные и слабые стороны'
  if (/strategy\.(conclusions|growth_zones)/.test(key)) return 'Выводы и зоны роста'
  if (/strategy\.(key_problems|constraints)/.test(key)) return 'Проблемы и ограничения'
  if (key === 'strategy.available_resources') return 'Ресурсы'
  if (key === 'strategy.key_risks') return 'Риски'
  if (key.startsWith('strategy.')) return 'Цели и инициативы'
  if (/product|service|продукт|услуг/.test(key)) return 'Продукты и услуги'
  if (/team|employee|owner|staff|delegat|survey\.s10|команд/.test(key)) return 'Команда'
  if (/company|industry|name|legal|survey\.s1/.test(key)) return 'Профиль компании'
  if (/revenue|profit|margin|expense|cash|финанс|vyruch|pribyl/.test(key)) return 'Финансы'
  if (/audience|customer|client|survey\.s5_target/.test(key)) return 'Клиенты'
  if (/funnel|conversion|ворон|конверс/.test(key)) return 'Воронка'
  if (/sale|deal|check|prodazh|sdel/.test(key)) return 'Продажи'
  if (/marketing|channel|lead|cac|маркет/.test(key)) return 'Маркетинг'
  if (/risk|problem|constraint|риск|проблем/.test(key)) return 'Риски и ограничения'
  if (/strength|weakness|competitor_why|competitors_better/.test(key)) return 'Сильные и слабые стороны'
  if (/growth.zone|зон.*рост/.test(key)) return 'Зоны роста'
  if (/goal|initiative|resource|цель|ресурс/.test(key)) return 'Цели и ресурсы'
  if (/process|automation|management|operation|survey\.s4|survey\.s12/.test(key)) return 'Операции и процессы'
  return 'Операционные показатели'
}

export function requiredPointAFields(): Array<{
  fieldKey: string
  label: string
  section: string
}> {
  return REQUIRED_FIELDS.map(([fieldKey, label, section]) => ({
    fieldKey,
    label,
    section,
  }))
}
