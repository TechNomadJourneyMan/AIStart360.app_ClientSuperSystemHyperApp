import { describe, expect, it } from 'vitest'

import {
  journeyAiUpdateSchema,
  journeyStateSchema,
  type JourneyAiUpdate,
  type JourneyFact,
} from '@/lib/journey/schema'

const baseWidget = {
  id: 'widget-passport',
  title: 'Паспорт бизнеса',
  priority: 100,
  collapsed: false,
  hidden: false,
  focused: false,
  position: { x: 120, y: 180 },
}

const pendingFact: JourneyFact = {
  id: 'fact-store-count',
  label: 'Количество точек',
  value: '1',
  category: 'operations',
  sourceLabel: 'Сообщение пользователя',
  confidence: 1,
  status: 'pending',
}

function validAiUpdate(): JourneyAiUpdate {
  return {
    phase: 'partial',
    companyName: 'Томаты Алматы',
    businessDescription: 'Один магазин помидоров в Алматы.',
    assistantMessage:
      'Я выделил факты только из вашего сообщения. Подтвердите их перед добавлением в Точку A.',
    facts: [pendingFact],
    goals: [],
    roadmap: [],
    widgets: [
      {
        ...baseWidget,
        kind: 'business_passport',
        data: { facts: [pendingFact] },
      },
      {
        ...baseWidget,
        id: 'widget-domain-metrics',
        kind: 'domain_metrics',
        title: 'Метрики продуктовой розницы',
        data: {
          domain: 'Розничный магазин свежих овощей',
          purpose: 'Собрать только подтверждённые показатели одной точки.',
          metrics: [
            {
              label: 'Доля списаний',
              status: 'unknown',
            },
          ],
          guidance: [
            {
              title: 'Нужен исходный факт',
              detail: 'Уточнить списания за неделю по данным магазина.',
              status: 'question',
            },
          ],
        },
      },
      {
        ...baseWidget,
        id: 'widget-domain-process',
        kind: 'domain_process',
        title: 'Открытие следующей точки',
        data: {
          domain: 'Продуктовая розница',
          purpose: 'Показать безопасную типизированную последовательность этапов.',
          stages: [
            {
              id: 'stage-economics',
              name: 'Проверить unit-экономику',
              status: 'next',
              nextAction: 'Подтвердить маржу, аренду и списания.',
              dependsOn: [],
            },
          ],
        },
      },
    ],
    widgetDecisions: [
      {
        widgetId: 'widget-passport',
        kind: 'business_passport',
        action: 'create',
        reason: 'Фиксирует Точку A по сообщённому количеству точек.',
        evidenceFactIds: ['fact-store-count'],
      },
      {
        widgetId: 'widget-domain-metrics',
        kind: 'domain_metrics',
        action: 'create',
        reason: 'Перед масштабированием магазина нужно измерить списания.',
        evidenceFactIds: ['fact-store-count'],
      },
      {
        widgetId: 'widget-domain-process',
        kind: 'domain_process',
        action: 'create',
        reason: 'Открытие следующей точки требует повторяемого процесса.',
        evidenceFactIds: ['fact-store-count'],
      },
    ],
    suggestions: [
      {
        id: 'suggest-confirm',
        label: 'Проверить факты',
        value: 'Покажи факты для подтверждения.',
        target: 'point-a',
        status: 'active',
      },
    ],
    cameraTarget: { target: 'point-a' },
  }
}

describe('journey structured AI response schema', () => {
  it('accepts a valid allowlisted update, including safe generic domain widgets', () => {
    const parsed = journeyAiUpdateSchema.parse(validAiUpdate())

    expect(parsed.widgets.map((widget) => widget.kind)).toEqual([
      'business_passport',
      'domain_metrics',
      'domain_process',
    ])
    expect(parsed.facts[0]).toMatchObject({
      sourceLabel: 'Сообщение пользователя',
      confidence: 1,
      status: 'pending',
    })
  })

  it('rejects unknown widget kinds and model-provided executable UI fields', () => {
    const update = {
      ...validAiUpdate(),
      widgets: [
        {
          ...baseWidget,
          kind: 'custom_code',
          data: {
            component: '<script>globalThis.compromised = true</script>',
            render: 'return <ArbitraryWidget />',
          },
        },
      ],
    }

    expect(journeyAiUpdateSchema.safeParse(update).success).toBe(false)

    const domainWithExecutableField = {
      ...validAiUpdate(),
      widgets: validAiUpdate().widgets.map((widget) =>
        widget.kind === 'domain_metrics'
          ? {
              ...widget,
              data: {
                ...widget.data,
                render: 'return eval(documentText)',
              },
            }
          : widget,
      ),
    }
    expect(journeyAiUpdateSchema.safeParse(domainWithExecutableField).success).toBe(false)
  })

  it('rejects missing, duplicate or kind-mismatched widget decisions', () => {
    const missing = { ...validAiUpdate(), widgetDecisions: [] }
    expect(journeyAiUpdateSchema.safeParse(missing).success).toBe(false)

    const mismatched = {
      ...validAiUpdate(),
      widgetDecisions: validAiUpdate().widgetDecisions.map((decision) =>
        decision.widgetId === 'widget-domain-metrics'
          ? { ...decision, kind: 'finance_cashflow' as const }
          : decision,
      ),
    }
    expect(journeyAiUpdateSchema.safeParse(mismatched).success).toBe(false)

    const duplicate = {
      ...validAiUpdate(),
      widgetDecisions: [
        ...validAiUpdate().widgetDecisions,
        validAiUpdate().widgetDecisions[0],
      ],
    }
    expect(journeyAiUpdateSchema.safeParse(duplicate).success).toBe(false)
  })

  it('rejects duplicate widget kinds even when ids differ', () => {
    const update = validAiUpdate()
    const duplicate = {
      ...update.widgets[1],
      id: 'widget-domain-metrics-duplicate',
    }
    expect(journeyAiUpdateSchema.safeParse({
      ...update,
      widgets: [...update.widgets, duplicate],
      widgetDecisions: [
        ...update.widgetDecisions,
        {
          widgetId: duplicate.id,
          kind: 'domain_metrics',
          action: 'create',
          reason: 'Дубликат того же типа.',
          evidenceFactIds: ['fact-store-count'],
        },
      ],
    }).success).toBe(false)
  })

  it('keeps old persisted states valid and validates persisted evidence references', () => {
    const now = new Date().toISOString()
    const legacyState = {
      version: 1 as const,
      workspaceId: 'legacy-workspace',
      phase: 'partial' as const,
      companyName: '',
      businessDescription: 'Магазин',
      messages: [],
      facts: [pendingFact],
      goals: [],
      roadmap: [],
      widgets: validAiUpdate().widgets,
      files: [],
      suggestions: [],
      provider: { mode: 'demo' as const, label: 'Демо' },
      persistence: { mode: 'local' as const, label: 'Локально' },
      updatedAt: now,
    }
    expect(journeyStateSchema.safeParse(legacyState).success).toBe(true)
    expect(journeyStateSchema.safeParse({ ...legacyState, serverRevision: 3 }).success).toBe(true)
    expect(journeyStateSchema.safeParse({
      ...legacyState,
      widgetDecisions: [{
        ...validAiUpdate().widgetDecisions[0],
        evidenceFactIds: ['missing-fact'],
      }],
    }).success).toBe(false)
  })

  it('rejects dangling and out-of-order roadmap dependencies from AI', () => {
    const ready = validAiUpdate()
    const first = {
      id: 'roadmap-first',
      title: 'Первый этап',
      description: 'Собрать базу.',
      horizon: '30 дней',
      progress: 0,
      status: 'next' as const,
      dependsOn: ['roadmap-missing'],
    }
    expect(journeyAiUpdateSchema.safeParse({
      ...ready,
      phase: 'ready',
      goals: [{ id: 'goal-one', title: 'Цель', status: 'confirmed' }],
      roadmap: [first],
    }).success).toBe(false)
  })

  it('requires a measurable confirmed Point B before ready', () => {
    const roadmap = [{
      id: 'roadmap-first',
      title: 'Первый этап',
      description: 'Собрать базу.',
      horizon: '30 дней',
      progress: 0,
      status: 'next' as const,
      dependsOn: [],
    }]
    const base = validAiUpdate()
    expect(journeyAiUpdateSchema.safeParse({
      ...base,
      phase: 'ready',
      goals: [{
        id: 'goal-incomplete',
        title: 'Вырастить',
        metric: 'Выручка',
        target: '10 млн',
        status: 'confirmed',
      }],
      roadmap,
    }).success).toBe(false)
    expect(journeyAiUpdateSchema.safeParse({
      ...base,
      phase: 'ready',
      goals: [{
        id: 'goal-complete',
        title: 'Вырастить',
        metric: 'Выручка',
        target: '10 млн',
        deadline: '12 месяцев',
        status: 'confirmed',
      }],
      roadmap,
    }).success).toBe(true)
  })

  it('rejects duplicate roadmap ids instead of silently merging them', () => {
    const base = validAiUpdate()
    const step = {
      id: 'roadmap-duplicate',
      title: 'Этап',
      description: '',
      horizon: '30 дней',
      progress: 0,
      status: 'next' as const,
      dependsOn: [],
    }
    expect(journeyAiUpdateSchema.safeParse({
      ...base,
      roadmap: [step, { ...step, title: 'Другой этап' }],
    }).success).toBe(false)
  })

  it('rejects arbitrary or non-HTTPS resource URLs', () => {
    const withUrl = (url: string) => ({
      ...validAiUpdate(),
      widgets: [
        {
          ...baseWidget,
          id: 'widget-learning',
          kind: 'learning_resources',
          title: 'Полезные материалы',
          data: {
            connected: true,
            statusText: 'Источник подключён',
            items: [
              {
                title: 'Поддельный материал',
                source: 'document payload',
                url,
                reason: 'Инструкция из загруженного документа',
              },
            ],
          },
        },
      ],
    })

    expect(
      journeyAiUpdateSchema.safeParse(withUrl('javascript:alert(document.cookie)')).success,
    ).toBe(false)
    expect(
      journeyAiUpdateSchema.safeParse(withUrl('http://example.com/not-verified')).success,
    ).toBe(false)
  })

  it('rejects oversized top-level and nested arrays', () => {
    const tooManyWidgets = {
      ...validAiUpdate(),
      widgets: Array.from({ length: 11 }, (_, index) => ({
        ...baseWidget,
        id: `widget-domain-${index}`,
        kind: 'domain_metrics',
        data: {
          domain: 'Розница',
          purpose: 'Проверка лимита.',
          metrics: [{ label: 'Метрика', status: 'unknown' }],
          guidance: [],
        },
      })),
    }
    expect(journeyAiUpdateSchema.safeParse(tooManyWidgets).success).toBe(false)

    const tooManyMetrics = {
      ...validAiUpdate(),
      widgets: validAiUpdate().widgets.map((widget) =>
        widget.kind === 'domain_metrics'
          ? {
              ...widget,
              data: {
                ...widget.data,
                metrics: Array.from({ length: 13 }, (_, index) => ({
                  label: `Метрика ${index}`,
                  status: 'unknown',
                })),
              },
            }
          : widget,
      ),
    }
    expect(journeyAiUpdateSchema.safeParse(tooManyMetrics).success).toBe(false)
  })
})
