import { describe, expect, it } from 'vitest'

import {
  afterFactsConfirmed,
  runLocalTurn,
} from '@/components/journey/demo-machine'
import { createEmptyWorkspace } from '@/components/journey/model'

describe('HONOR browser-local commerce fallback', () => {
  it('keeps commerce KPIs unknown and builds an order-to-repeat-purchase path for a revenue goal', () => {
    const description = 'HONOR — интернет-магазин outdoor-одежды для охоты, рыбалки и outdoor в Казахстане'
    const discovered = runLocalTurn(
      createEmptyWorkspace('honor-local-fallback'),
      description,
    )

    expect(discovered.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Описание бизнеса', value: description, status: 'pending' }),
      expect.objectContaining({ label: 'Формат бизнеса', value: 'Розничная торговля', status: 'pending' }),
      expect.objectContaining({ label: 'Канал продаж', value: 'Интернет-магазин', status: 'pending' }),
    ]))

    const discoveryMetrics = discovered.widgets.find((widget) => widget.kind === 'domain_metrics')
    expect(discoveryMetrics?.kind).toBe('domain_metrics')
    if (!discoveryMetrics || discoveryMetrics.kind !== 'domain_metrics') {
      throw new Error('Commerce metrics widget missing')
    }

    expect(discoveryMetrics.data.domain).toBe('Интернет-магазин и розничная торговля')
    expect(discoveryMetrics.data.metrics.map((metric) => metric.label)).toEqual([
      'Выручка',
      'Валовая маржа',
      'Средний чек',
      'Конверсия заказа',
      'Доля отсутствующих товаров',
      'Оборачиваемость запасов',
    ])
    expect(discoveryMetrics.data.metrics.every((metric) =>
      metric.status === 'unknown' && metric.value === undefined,
    )).toBe(true)

    const confirmed = afterFactsConfirmed({
      ...discovered,
      facts: discovered.facts.map((fact) => ({ ...fact, status: 'confirmed' as const })),
    })
    const goal = 'Хочу увеличить выручку до 50 млн ₸ за 6 месяцев'
    const planned = runLocalTurn(confirmed, goal)

    expect(planned.phase).toBe('ready')
    expect(planned.goals[0]).toMatchObject({
      title: goal,
      metric: 'Выручка',
      target: '50 млн ₸',
      deadline: '6 месяцев',
      status: 'confirmed',
    })
    expect(planned.roadmap.map((item) => item.title)).toEqual([
      'Подтвердить базу продаж и маржи',
      'Разобрать ассортимент и наличие',
      'Проверить путь заказа до доставки',
      'Запустить один проверяемый рычаг роста',
      'Сверить фактический результат с Точкой B',
    ])

    const plannedMetrics = planned.widgets.find((widget) => widget.kind === 'domain_metrics')
    expect(plannedMetrics?.kind).toBe('domain_metrics')
    if (!plannedMetrics || plannedMetrics.kind !== 'domain_metrics') {
      throw new Error('Commerce metrics widget missing after goal')
    }
    expect(plannedMetrics.data.metrics.every((metric) =>
      metric.status === 'unknown' && metric.value === undefined,
    )).toBe(true)

    const process = planned.widgets.find((widget) => widget.kind === 'domain_process')
    expect(process?.kind).toBe('domain_process')
    if (!process || process.kind !== 'domain_process') {
      throw new Error('Commerce process widget missing')
    }
    expect(process.data.stages.map((stage) => stage.name)).toEqual([
      'Заказ',
      'Наличие и резерв',
      'Сборка и отгрузка',
      'Доставка и возврат',
      'Повторная покупка',
    ])
    expect(process.data.stages.every((stage) => stage.status === 'unknown')).toBe(true)
  })
})
