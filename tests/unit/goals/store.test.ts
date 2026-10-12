import { describe, it, expect } from 'vitest'
import { deleteGoal, loadGoals, REVENUE_GOAL_METRIC, syncRevenueGoal, upsertGoal } from '@/lib/goals/store'
import { evaluateGoals } from '@/lib/goals/current'
import { memoryClient } from '../data-layer/memory-client'

const company = () => memoryClient({ companies: [{ id: 'co', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null }], metric_targets: [] })

describe('goals store', () => {
  it('a goal on any metric, with its baseline; one per metric and period', async () => {
    const m = company()
    const g = await upsertGoal(m.client, 'co', { metricId: 'biz.finansy.valovaya_marzha', targetValue: 40, periodLabel: '12m', label: 'Маржа 40 %' }, { actorId: 'u', baseline: { value: 25, period: '2026' } })
    expect(g).toMatchObject({ metricId: 'biz.finansy.valovaya_marzha', targetValue: 40, unit: '%', label: 'Маржа 40 %', baselineValue: 25, baselinePeriod: '2026' })
    await upsertGoal(m.client, 'co', { metricId: 'biz.finansy.valovaya_marzha', targetValue: 45, periodLabel: '12m' }, { actorId: 'u' })
    expect(m.db.metric_targets).toHaveLength(1)
    expect(m.db.metric_targets[0].target_value).toBe(45)
  })

  it('a revenue goal is mirrored into companies.target_revenue_* and back', async () => {
    const m = company()
    const g = await upsertGoal(m.client, 'co', { metricId: REVENUE_GOAL_METRIC, targetValue: 120_000_000, periodLabel: '12m' }, { actorId: 'u' })
    expect(m.db.companies[0].target_revenue_12m_kzt).toBe(120_000_000)
    await deleteGoal(m.client, 'co', g.id)
    expect(m.db.companies[0].target_revenue_12m_kzt).toBeNull()
    await syncRevenueGoal(m.client, 'co', '3y', 500_000_000, 'u')
    expect(m.db.metric_targets[0]).toMatchObject({ metric_key: REVENUE_GOAL_METRIC, period_label: '3y', target_value: 500_000_000 })
  })

  it('a revenue column without a goal row still shows as a goal', async () => {
    const m = memoryClient({ companies: [{ id: 'co', target_revenue_12m_kzt: 90_000_000 }], metric_targets: [] })
    const goals = await loadGoals(m.client, 'co')
    expect(goals).toHaveLength(1)
    expect(goals[0]).toMatchObject({ id: 'company-12m', metricId: REVENUE_GOAL_METRIC, targetValue: 90_000_000, source: 'survey' })
  })

  it('unknown metrics are refused', async () => {
    await expect(upsertGoal(company().client, 'co', { metricId: 'nope', targetValue: 1, periodLabel: '12m' }, { actorId: 'u' })).rejects.toThrow(/unknown metric/)
  })

  it('evaluation uses the current metric value and its period', async () => {
    const m = company()
    await upsertGoal(m.client, 'co', { metricId: REVENUE_GOAL_METRIC, targetValue: 120_000_000, periodLabel: '12m' }, { actorId: 'u' })
    const goals = await loadGoals(m.client, 'co')
    const metrics = new Map([[REVENUE_GOAL_METRIC, { metricId: REVENUE_GOAL_METRIC, label: 'Выручка (год)', value: 60_000_000, unit: '₸', source: 'survey', confidence: 0.9, computedAt: null, periodYear: null, periodQuarter: null, provenance: { period: { year: 2026, month: 10 } } }]])
    const [e] = evaluateGoals(goals, metrics, new Date('2026-10-12T00:00:00Z'))
    expect(e.evaluation).toMatchObject({ current: 60_000_000, currentPeriod: '2026-10' })
    expect(e.evaluation.realism).not.toBe('unknown')
  })
})
