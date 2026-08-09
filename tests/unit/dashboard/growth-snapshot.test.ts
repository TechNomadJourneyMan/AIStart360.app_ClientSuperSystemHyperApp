import { describe, expect, it, vi } from 'vitest'
import {
  annualRevenueTargetToMonthly,
  deriveGrowthSnapshotValues,
  extractMonthlyRevenue,
  patchDashboardResource,
} from '@/lib/dashboard/growth-snapshot'

describe('growth snapshot data integrity', () => {
  it('does not manufacture current revenue from a target', () => {
    expect(deriveGrowthSnapshotValues(null, 10_000_000, 25_000_000)).toEqual({
      currentMonthly: null,
      runRate12: null,
      progressToPlan: null,
      progressTo12: null,
      progressTo3y: null,
      gap12: null,
      gap3y: null,
    })
  })

  it('derives run-rate and gaps from a real monthly value', () => {
    expect(deriveGrowthSnapshotValues(5_000_000, 10_000_000, 25_000_000)).toEqual({
      currentMonthly: 5_000_000,
      runRate12: 60_000_000,
      progressToPlan: 50,
      progressTo12: 50,
      progressTo3y: 20,
      gap12: -5_000_000,
      gap3y: -20_000_000,
    })
  })

  it('treats both stored targets as annual revenue values', () => {
    expect(annualRevenueTargetToMonthly(120_000_000)).toBe(10_000_000)
    expect(annualRevenueTargetToMonthly(300_000_000)).toBe(25_000_000)
    expect(annualRevenueTargetToMonthly(null)).toBeNull()
  })

  it('reads the current MetricSummary envelope', () => {
    expect(extractMonthlyRevenue({
      source: 'database',
      data: [
        { id: 'margin', rawValue: 42 },
        { id: 'monthly_revenue', rawValue: 7_500_000 },
      ],
    })).toBe(7_500_000)
  })

  it('keeps compatibility with the former items envelope', () => {
    expect(extractMonthlyRevenue({
      ok: true,
      data: {
        items: [{ id: 'revenue_monthly', value: 3_200_000 }],
      },
    })).toBe(3_200_000)
  })

  it('ignores unnamed or non-finite values', () => {
    expect(extractMonthlyRevenue({
      data: [
        { id: 'orders', rawValue: 99_000_000 },
        { id: 'monthly_revenue', rawValue: Number.NaN },
      ],
    })).toBeNull()
  })

  it('does not treat an unsuccessful PATCH as saved', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ ok: false, error: 'RLS rejected update' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    ))
    await expect(patchDashboardResource(
      '/api/v1/companies/targets',
      { target_revenue_12m_kzt: 120_000_000 },
      fetchImpl as typeof fetch,
    )).rejects.toThrow('RLS rejected update')
  })

  it('accepts only an explicit successful PATCH envelope', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ ok: true, data: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    await expect(patchDashboardResource(
      '/api/v1/companies/targets',
      { target_revenue_12m_kzt: 120_000_000 },
      fetchImpl as typeof fetch,
    )).resolves.toMatchObject({ ok: true })
  })
})
