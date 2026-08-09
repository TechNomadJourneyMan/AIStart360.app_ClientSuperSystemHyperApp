import { createEmptyJourneyState } from './demo'
import {
  journeyStateSchema,
  journeyWidgetSchema,
  type JourneyFact,
  type JourneyState,
  type JourneyWidget,
} from './schema'
import { createServiceClient } from '@/lib/supabase-service'
import { JourneyPersistenceUnavailableError } from './persistence'

type FactDefinition = Pick<JourneyFact, 'label' | 'category'>

const FACT_DEFINITIONS: Record<string, FactDefinition> = {
  s1_company_name: { label: 'Название компании', category: 'business' },
  s1_industry: { label: 'Отрасль', category: 'business' },
  s1_founded_at: { label: 'Год основания', category: 'business' },
  s1_stage: { label: 'Стадия развития', category: 'business' },
  s1_employee_count: { label: 'Количество сотрудников', category: 'team' },
  s1_regions: { label: 'География присутствия', category: 'operations' },
  s1_business_model: { label: 'Бизнес-модель', category: 'business' },
  s1_years_on_market: { label: 'Лет на рынке', category: 'business' },
  s1_website: { label: 'Сайт компании', category: 'business' },
  s1_products_list: { label: 'Продукты и услуги', category: 'product' },
  s3_has_crm: { label: 'CRM-система', category: 'sales' },
  s3_products_description: { label: 'Описание продуктов', category: 'product' },
  s3_product_count: { label: 'Количество продуктов', category: 'product' },
  s3_flagship_product: { label: 'Продукт-локомотив', category: 'product' },
  s3_has_loyalty: { label: 'Программа лояльности', category: 'clients' },
  s5_target_audience: { label: 'Целевая аудитория', category: 'clients' },
  s5_top_regions: { label: 'Топ-регионы', category: 'marketing' },
  s5_marketing_channels: { label: 'Каналы маркетинга', category: 'marketing' },
  s5_usp: { label: 'Уникальное предложение', category: 'product' },
  ec_website: { label: 'Сайт магазина', category: 'business' },
  ec_total_sku: { label: 'Товаров в каталоге', category: 'product' },
  ec_geo_regions: { label: 'Регионы доставки', category: 'operations' },
}

interface JourneyOnboardingCompany {
  name?: unknown
  industry?: unknown
  business_model?: unknown
}

export interface JourneyOnboardingSurveyRow {
  question_key: string
  answer: unknown
}

export interface JourneyOnboardingSeedInput {
  workspaceId: string
  company?: JourneyOnboardingCompany | null
  surveyRows?: JourneyOnboardingSurveyRow[] | null
  now?: string
}

export async function loadJourneyStateFromOnboarding(
  userId: string,
  workspaceId: string,
): Promise<JourneyState> {
  const client = createServiceClient()
  const [companyResult, surveyResult] = await Promise.all([
    client
      .from('companies')
      .select('name,industry,business_model')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle(),
    client
      .from('survey_answers')
      .select('question_key,answer')
      .eq('user_id', userId)
      .order('answered_at', { ascending: true }),
  ])

  if (companyResult.error || surveyResult.error) {
    throw new JourneyPersistenceUnavailableError(
      'Не удалось подготовить Journey из данных анкеты.',
    )
  }

  return buildJourneyStateFromOnboarding({
    workspaceId,
    company: companyResult.data,
    surveyRows: (surveyResult.data ?? []) as JourneyOnboardingSurveyRow[],
  })
}

/**
 * Builds a first authenticated Journey board only from attributable onboarding
 * facts. Financial and commerce KPIs stay explicitly unknown until a source is
 * connected; owner goals are never inferred from a demo scenario.
 */
export function buildJourneyStateFromOnboarding(
  input: JourneyOnboardingSeedInput,
): JourneyState {
  const now = input.now ?? new Date().toISOString()
  const factsByKey = new Map<string, JourneyFact>()

  for (const row of input.surveyRows ?? []) {
    const definition = FACT_DEFINITIONS[row.question_key]
    if (!definition) continue
    const value = formatFactValue(unwrapAnswer(row.answer))
    if (!value) continue
    factsByKey.set(row.question_key, {
      id: `fact:survey:${safeIdPart(row.question_key)}`,
      label: definition.label,
      value,
      category: definition.category,
      sourceLabel: sourceLabel(row.answer),
      confidence: 1,
      status: 'confirmed',
    })
  }

  addCompanyFallback(
    factsByKey,
    's1_company_name',
    input.company?.name,
  )
  addCompanyFallback(
    factsByKey,
    's1_industry',
    input.company?.industry,
  )
  addCompanyFallback(
    factsByKey,
    's1_business_model',
    input.company?.business_model,
  )

  const facts = [...factsByKey.values()]
  const companyName =
    factsByKey.get('s1_company_name')?.value ??
    formatFactValue(input.company?.name) ??
    ''
  const businessDescription = buildDescription(factsByKey, companyName)
  const commerce = isCommerceBusiness(factsByKey)
  const widgets: JourneyWidget[] = facts.length
    ? [
        journeyWidgetSchema.parse({
          id: 'widget-business-passport',
          kind: 'business_passport',
          title: 'Паспорт бизнеса',
          priority: 100,
          collapsed: false,
          hidden: false,
          focused: false,
          position: { x: 100, y: 620 },
          data: { facts: facts.slice(0, 16) },
        }),
        ...(commerce ? [commerceMetricsWidget()] : []),
      ]
    : []
  const evidenceFactIds = facts.slice(0, 12).map((fact) => fact.id)
  const base = createEmptyJourneyState(input.workspaceId)

  return journeyStateSchema.parse({
    ...base,
    phase: facts.length ? 'partial' : 'empty',
    companyName,
    businessDescription,
    messages: facts.length
      ? [
          {
            id: 'message-onboarding-import',
            role: 'assistant',
            text: `Я загрузил ${facts.length} подтверждённых фактов из вашей анкеты в Точку A. Неизвестные показатели оставлены без значений.`,
            createdAt: now,
          },
          {
            id: 'message-onboarding-goal',
            role: 'assistant',
            text: 'Сформулируйте реальную измеримую Точку B: какой показатель должен измениться, до какого значения и к какому сроку?',
            createdAt: now,
          },
        ]
      : base.messages,
    facts,
    goals: [],
    roadmap: [],
    widgets,
    widgetDecisions: widgets.map((widget) => ({
      widgetId: widget.id,
      kind: widget.kind,
      action: 'create' as const,
      reason: widget.kind === 'business_passport'
        ? 'Анкета содержит подтверждённые факты о текущем бизнесе.'
        : 'Для retail/e-commerce ключевые KPI показаны как неизвестные до подключения источника.',
      evidenceFactIds,
    })),
    manualWidgetIds: [],
    widgetOrder: widgets.map((widget) => widget.id),
    suggestions: facts.length
      ? [
          {
            id: 'define-real-goal',
            label: 'Задать Точку B',
            value: 'Хочу сформулировать измеримую цель и срок.',
            target: 'point-b',
            status: 'active',
          },
          {
            id: 'add-source-data',
            label: 'Добавить данные',
            value: 'Загружу файл с фактическими показателями.',
            target: 'chat',
            status: 'active',
          },
        ]
      : base.suggestions,
    persistence: {
      mode: 'database',
      label: 'Сохранено в AIStart360',
    },
    serverRevision: 0,
    updatedAt: now,
  })
}

function commerceMetricsWidget(): JourneyWidget {
  return journeyWidgetSchema.parse({
    id: 'widget-domain-metrics',
    kind: 'domain_metrics',
    title: 'Продажи, ассортимент и наличие',
    priority: 92,
    collapsed: false,
    hidden: false,
    focused: false,
    position: { x: 420, y: 620 },
    data: {
      domain: 'Интернет-магазин и розничная торговля',
      purpose: 'Собрать подтверждённую базу продаж, маржи и наличия до выбора рычага роста.',
      metrics: [
        { label: 'Выручка', status: 'unknown' },
        { label: 'Валовая маржа', status: 'unknown' },
        { label: 'Средний чек', status: 'unknown' },
        { label: 'Конверсия заказа', status: 'unknown' },
        { label: 'Доля отсутствующих товаров', status: 'unknown' },
        { label: 'Оборачиваемость запасов', status: 'unknown' },
      ],
      guidance: [
        {
          title: 'Нужен исходный факт',
          detail: 'Подтвердите выручку, заказы, валовую маржу и наличие товаров за один сопоставимый период.',
          status: 'question',
        },
      ],
    },
  })
}

function addCompanyFallback(
  factsByKey: Map<string, JourneyFact>,
  key: keyof typeof FACT_DEFINITIONS,
  rawValue: unknown,
): void {
  if (factsByKey.has(key)) return
  const definition = FACT_DEFINITIONS[key]
  const value = formatFactValue(rawValue)
  if (!definition || !value) return
  factsByKey.set(key, {
    id: `fact:company:${safeIdPart(key)}`,
    label: definition.label,
    value,
    category: definition.category,
    sourceLabel: 'Профиль компании',
    confidence: 1,
    status: 'confirmed',
  })
}

function buildDescription(
  facts: Map<string, JourneyFact>,
  companyName: string,
): string {
  const industry = facts.get('s1_industry')?.value
  const model = facts.get('s1_business_model')?.value
  const geography =
    facts.get('s1_regions')?.value ??
    facts.get('ec_geo_regions')?.value
  return [
    companyName,
    industry ? `отрасль: ${industry}` : '',
    model ? `бизнес-модель: ${model}` : '',
    geography ? `география: ${geography}` : '',
  ].filter(Boolean).join(' · ').slice(0, 4_000)
}

function isCommerceBusiness(facts: Map<string, JourneyFact>): boolean {
  const description = [
    facts.get('s1_industry')?.value,
    facts.get('s1_business_model')?.value,
    facts.get('ec_website')?.value,
    facts.get('ec_total_sku')?.value,
  ].filter(Boolean).join(' ')
  return /e-?commerce|ритейл|розниц|магазин|d2c|sku/i.test(description)
}

function unwrapAnswer(answer: unknown): unknown {
  if (answer && typeof answer === 'object' && !Array.isArray(answer) && 'value' in answer) {
    return (answer as { value?: unknown }).value
  }
  return answer
}

function sourceLabel(answer: unknown): string {
  if (answer && typeof answer === 'object' && !Array.isArray(answer)) {
    const record = answer as Record<string, unknown>
    if (record.provenance === 'public_web') return 'Анкета · публичный источник'
  }
  return 'Анкета AIStart360'
}

function formatFactValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim()
    return normalized ? normalized.slice(0, 1_000) : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  if (Array.isArray(value)) {
    const items = value
      .map(formatFactValue)
      .filter((item): item is string => Boolean(item))
    return items.length ? items.join(', ').slice(0, 1_000) : null
  }
  return null
}

function safeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9:_-]/g, '-').slice(0, 90)
}
