import { describe, expect, it } from 'vitest'

import {
  createJourneyDemoScenarioState,
  journeyDemoIdentityStorageKey,
  parseJourneyDemoScenario,
} from '@/components/journey/demo-scenarios'
import { LOCAL_IDENTITY_KEY } from '@/components/journey/model'
import { journeyStateSchema } from '@/lib/journey/schema'

describe('Journey public demo scenarios', () => {
  it('only accepts the explicit, normalized HONOR scenario', () => {
    expect(parseJourneyDemoScenario(' HONOR ')).toBe('honor')
    expect(parseJourneyDemoScenario('myhonor')).toBe('honor')
    expect(parseJourneyDemoScenario('myhonor.shop')).toBe('honor')
    expect(parseJourneyDemoScenario(['honor'])).toBe('honor')
    expect(parseJourneyDemoScenario('tomato-shop')).toBeUndefined()
    expect(parseJourneyDemoScenario(['honor', 'tomato-shop'])).toBeUndefined()
    expect(parseJourneyDemoScenario(undefined)).toBeUndefined()
  })

  it('creates a schema-valid, confirmed A-to-B HONOR commerce journey', () => {
    const state = createJourneyDemoScenarioState('honor', 'demo-honor-workspace')

    expect(() => journeyStateSchema.parse(state)).not.toThrow()
    expect(state).toMatchObject({
      companyName: 'HONOR GROUP',
      phase: 'ready',
      provider: { mode: 'demo', label: 'Демо-логика' },
      persistence: { mode: 'local', label: 'Сохранение на устройстве' },
    })
    expect(state.facts).not.toHaveLength(0)
    expect(state.facts.every((fact) => fact.status === 'confirmed')).toBe(true)
    expect(state.goals.at(-1)).toMatchObject({
      title: 'Тестовая гипотеза для демонстрации: увеличить выручку на 20% за 6 месяцев',
      metric: 'Выручка',
      target: '20%',
      deadline: '6 месяцев',
      status: 'confirmed',
    })
    expect(state.roadmap).toHaveLength(5)
    expect(state.widgets.map((widget) => widget.kind)).toEqual(expect.arrayContaining([
      'business_passport',
      'point_b_goals',
      'roadmap_actions',
      'domain_metrics',
      'domain_process',
    ]))
  })

  it('keeps unknown commerce KPIs unknown instead of inventing current revenue', () => {
    const state = createJourneyDemoScenarioState('honor', 'demo-honor-workspace')
    const metrics = state.widgets.find((widget) => widget.kind === 'domain_metrics')

    expect(state.facts.some((fact) => fact.label === 'Выручка')).toBe(false)
    expect(state.facts.some((fact) => fact.value.includes('88 товаров'))).toBe(true)
    expect(state.facts.some((fact) => fact.value.includes('3 магазина'))).toBe(true)
    expect(metrics?.kind).toBe('domain_metrics')
    if (!metrics || metrics.kind !== 'domain_metrics') {
      throw new Error('Commerce metrics widget missing')
    }
    expect(metrics.data.metrics.every((metric) => (
      metric.status === 'unknown' && metric.value === undefined
    ))).toBe(true)
  })

  it('uses a scenario-specific identity key, isolated from the regular Journey identity', () => {
    const key = journeyDemoIdentityStorageKey('honor')

    expect(key).toBe('aistart360:journey:demo:identity:v1:honor')
    expect(key).toContain(':honor')
    expect(key).not.toBe(LOCAL_IDENTITY_KEY)
  })
})
