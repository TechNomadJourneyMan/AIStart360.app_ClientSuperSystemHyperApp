import {
  journeyStateSchema,
  journeyWidgetSchema,
  type JourneyFact,
  type JourneyState,
  type JourneyWidget,
} from './schema'

/** Server-owned invariants applied to model output and client PATCH state. */
export function enforceJourneyStatePolicy(input: JourneyState): JourneyState {
  const state = journeyStateSchema.parse(input)
  const confirmed = state.facts.filter((fact) => fact.status === 'confirmed')
  const hasMeasurableGoal = state.goals.some(
    (goal) => goal.status === 'confirmed' && goal.metric && goal.target && goal.deadline,
  )
  let expanded = 0
  const widgets = [...state.widgets]
    .sort((a, b) => b.priority - a.priority)
    .map((widget) => sanitizeWidget(widget, confirmed, state))
    .map((widget) => {
      if (widget.hidden || widget.collapsed) return widget
      expanded += 1
      return expanded <= 4 ? widget : journeyWidgetSchema.parse({ ...widget, collapsed: true })
    })

  const widgetKinds = new Map(widgets.map((widget) => [widget.id, widget.kind]))
  const usableFactIds = new Set(
    state.facts.filter((fact) => fact.status !== 'rejected').map((fact) => fact.id),
  )
  const widgetDecisions = (state.widgetDecisions ?? []).filter(
    (decision) =>
      widgetKinds.get(decision.widgetId) === decision.kind &&
      decision.evidenceFactIds.every((factId) => usableFactIds.has(factId)),
  )
  const ready = confirmed.length > 0 && hasMeasurableGoal && state.roadmap.length > 0
  return journeyStateSchema.parse({
    ...state,
    phase: state.phase === 'ready' && !ready ? (state.facts.length ? 'partial' : 'empty') : state.phase,
    widgets,
    widgetDecisions: state.widgetDecisions ? widgetDecisions : undefined,
  })
}

function sanitizeWidget(
  widget: JourneyWidget,
  confirmed: JourneyFact[],
  state: JourneyState,
): JourneyWidget {
  switch (widget.kind) {
    case 'business_passport':
      return journeyWidgetSchema.parse({
        ...widget,
        data: { facts: state.facts.filter((fact) => fact.status !== 'rejected').slice(0, 16) },
      })
    case 'point_b_goals':
      return journeyWidgetSchema.parse({ ...widget, data: { goals: state.goals.slice(0, 10) } })
    case 'roadmap_actions':
      return journeyWidgetSchema.parse({ ...widget, data: { items: state.roadmap.slice(0, 20) } })
    case 'news_digest':
      return journeyWidgetSchema.parse({
        ...widget,
        data: { connected: false, statusText: 'Источник новостей не подключён', items: [] },
      })
    case 'learning_resources':
      return journeyWidgetSchema.parse({
        ...widget,
        data: { connected: false, statusText: 'Проверенный каталог материалов не подключён', items: [] },
      })
    case 'external_sources':
      return journeyWidgetSchema.parse({
        ...widget,
        data: {
          sources: widget.data.sources.map((source) => ({
            ...source,
            status: source.status === 'connected' ? 'not_connected' : source.status,
          })),
        },
      })
    case 'crm_readiness':
      return journeyWidgetSchema.parse({
        ...widget,
        data: {
          ...widget.data,
          connectionStatus: widget.data.connectionStatus === 'connected'
            ? 'not_connected'
            : widget.data.connectionStatus,
        },
      })
    case 'business_health':
      return journeyWidgetSchema.parse({
        ...widget,
        data: {
          dimensions: widget.data.dimensions.map((dimension) => ({
            ...dimension,
            score: null,
            status: 'unknown',
            basis: dimension.basis || 'Нужен подтверждённый источник.',
          })),
        },
      })
    case 'domain_metrics':
      return journeyWidgetSchema.parse({
        ...widget,
        data: { ...widget.data, metrics: sanitizeMetricArray(widget.data.metrics, confirmed) },
      })
    case 'sales_funnel':
      return journeyWidgetSchema.parse({
        ...widget,
        data: { ...widget.data, metrics: sanitizeMetricArray(widget.data.metrics, confirmed) },
      })
    case 'marketing_growth':
      return journeyWidgetSchema.parse({
        ...widget,
        data: { ...widget.data, channels: sanitizeMetricArray(widget.data.channels, confirmed) },
      })
    case 'finance_cashflow':
      return journeyWidgetSchema.parse({
        ...widget,
        data: { ...widget.data, metrics: sanitizeMetricArray(widget.data.metrics, confirmed) },
      })
    default:
      return widget
  }
}

interface PolicyMetric {
  label: string
  value?: string
  status: 'known' | 'unknown' | 'assumption'
  sourceLabel?: string
}

function sanitizeMetricArray(
  metrics: PolicyMetric[],
  confirmed: JourneyFact[],
): PolicyMetric[] {
  return metrics.map((metric) => {
    if (metric.status !== 'known') return metric
    const grounded = confirmed.some((fact) => {
      const labelsMatch = fact.label.toLowerCase().includes(metric.label.toLowerCase()) ||
        metric.label.toLowerCase().includes(fact.label.toLowerCase())
      return labelsMatch && (!metric.value || fact.value === metric.value)
    })
    return grounded
      ? metric
      : { label: metric.label, status: 'unknown' as const, sourceLabel: 'Нужен подтверждённый источник' }
  })
}
