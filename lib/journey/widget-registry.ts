import type { JourneyWidgetKind } from './schema'

export interface JourneyWidgetDefinition {
  label: string
  purpose: string
  selectionRule: string
  requiresSource: boolean
}

/**
 * The only UI capabilities an AI response may request. This registry is data,
 * not executable code; the frontend maps every key to a reviewed presenter.
 */
export const JOURNEY_WIDGET_REGISTRY: Record<JourneyWidgetKind, JourneyWidgetDefinition> = {
  business_passport: {
    label: 'Паспорт бизнеса',
    purpose: 'Confirmed and pending facts describing the current business.',
    selectionRule: 'Use after at least one literal business fact is available.',
    requiresSource: false,
  },
  business_health: {
    label: 'Здоровье бизнеса',
    purpose: 'Evidence-based maturity/health dimensions; unknown is allowed.',
    selectionRule: 'Use only when several dimensions can be assessed or explicitly marked unknown.',
    requiresSource: false,
  },
  point_b_goals: {
    label: 'Точка B',
    purpose: 'User-authored measurable target state.',
    selectionRule: 'Use only after the user states or confirms a goal.',
    requiresSource: false,
  },
  roadmap_actions: {
    label: 'Дорожная карта',
    purpose: 'Priorities, dependencies, milestones and next actions from A to B.',
    selectionRule: 'Use after Point A has confirmed facts and Point B has a goal.',
    requiresSource: false,
  },
  crm_readiness: {
    label: 'CRM readiness',
    purpose: 'Whether CRM is needed, present and connected, plus honest next step.',
    selectionRule: 'Ask whether CRM exists before recommendations; omit when irrelevant to the model.',
    requiresSource: false,
  },
  sales_funnel: {
    label: 'Продажи и KPI',
    purpose: 'Sales stages and known KPIs.',
    selectionRule: 'Use when the business has a meaningful sales pipeline.',
    requiresSource: false,
  },
  marketing_growth: {
    label: 'Маркетинг и рост',
    purpose: 'Known acquisition channels and evidence-based opportunities.',
    selectionRule: 'Use when channels or a growth question are relevant.',
    requiresSource: false,
  },
  finance_cashflow: {
    label: 'Финансы',
    purpose: 'Cash flow and financial metrics from user data or files.',
    selectionRule: 'Use only with explicit values, a file, or clear unknown placeholders.',
    requiresSource: false,
  },
  operations_team: {
    label: 'Процессы и команда',
    purpose: 'Operating constraints, roles and bottlenecks.',
    selectionRule: 'Use when scaling depends on repeatable operations or staffing.',
    requiresSource: false,
  },
  risks_opportunities: {
    label: 'Риски и возможности',
    purpose: 'Traceable risks and opportunities, never invented market claims.',
    selectionRule: 'Use after enough context exists to explain the basis.',
    requiresSource: false,
  },
  news_digest: {
    label: 'Новости',
    purpose: 'Verified recent items from a connected news source.',
    selectionRule: 'With no connected source, render an empty connection state only.',
    requiresSource: true,
  },
  tasks_reminders: {
    label: 'Задачи',
    purpose: 'User actions and reminders tied to the roadmap.',
    selectionRule: 'Use for concrete actions with an owner/time expectation.',
    requiresSource: false,
  },
  learning_resources: {
    label: 'Материалы',
    purpose: 'Verified resources with real HTTPS links.',
    selectionRule: 'With no verified catalogue, render an empty connection state only.',
    requiresSource: true,
  },
  knowledge_base: {
    label: 'База знаний',
    purpose: 'Uploaded files and their analysis states.',
    selectionRule: 'Use after an upload or when asking for a supporting file.',
    requiresSource: false,
  },
  external_sources: {
    label: 'Источники данных',
    purpose: 'Connected/available/unavailable external data sources.',
    selectionRule: 'Use when better evidence requires an integration.',
    requiresSource: false,
  },
  domain_metrics: {
    label: 'Отраслевые метрики',
    purpose: 'Domain-specific metrics such as retail waste or insurance loss ratio.',
    selectionRule: 'Adapt labels to the business model; unknown metrics must stay unknown.',
    requiresSource: false,
  },
  domain_process: {
    label: 'Отраслевой процесс',
    purpose: 'Domain-specific operational flow such as store opening or claims handling.',
    selectionRule: 'Use when the transformation depends on a repeatable domain workflow.',
    requiresSource: false,
  },
}

export const JOURNEY_WIDGET_KINDS = Object.freeze(
  Object.keys(JOURNEY_WIDGET_REGISTRY) as JourneyWidgetKind[],
)

export function describeJourneyWidgetRegistry(): string {
  return JOURNEY_WIDGET_KINDS.map((kind) => {
    const item = JOURNEY_WIDGET_REGISTRY[kind]
    return `- ${kind}: ${item.purpose} Rule: ${item.selectionRule}`
  }).join('\n')
}
