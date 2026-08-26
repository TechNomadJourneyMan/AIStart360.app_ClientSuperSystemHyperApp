import { describe, expect, it } from 'vitest'

import {
  parseLatestStorePendingPeriod,
  parseStoreMonthlyRevenue,
  russianMonthPeriodLabel,
  selectGrowthRevenue,
} from '@/lib/dashboard/growth-snapshot-source'

function monthlySlice(
  month: string,
  revenue: number,
  coverage: 'complete' | 'partial' = 'complete',
) {
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return {
    key: `month:${month}`,
    coverage,
    period: { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` },
    scopeKey: `month:${month}`,
    source: 'financial_report',
    metrics: { revenue },
    publishedAt: `${month}-28T10:00:00.000Z`,
  }
}

function overview(
  latestPublished: unknown,
  history: unknown[] = [],
  currentDate?: string,
) {
  return {
    ok: true,
    data: {
      analytics: {
        schemaVersion: 2,
        ...(currentDate ? { currentDate } : {}),
        windows: { latestPublished },
        history,
      },
    },
  }
}

describe('Growth Snapshot Store revenue source', () => {
  it('uses the exact latest closed Store month without dividing it by 12', () => {
    const august = monthlySlice('2026-08', 31_000_000)
    const payload = overview(
      august,
      [monthlySlice('2026-07', 28_053_253), august],
      '2026-09-01',
    )
    const fact = parseStoreMonthlyRevenue(
      payload,
      new Date('2026-09-01T00:00:00+05:00'),
    )

    expect(fact).toMatchObject({
      kind: 'store_monthly',
      monthlyRevenue: 31_000_000,
      annualRunRate: 372_000_000,
      periodLabel: 'Август 2026',
      scopeKey: 'month:2026-08',
    })
    expect(selectGrowthRevenue(payload, 86_700_000)).toMatchObject({
      kind: 'store_monthly',
      monthlyRevenue: 31_000_000,
      annualRunRate: 372_000_000,
    })
  })

  it('never treats a not-yet-closed month as complete and falls back to the prior closed Store month', () => {
    const august = monthlySlice('2026-08', 31_000_000)
    const july = monthlySlice('2026-07', 28_053_253)

    expect(parseStoreMonthlyRevenue(
      overview(august, [july, august]),
      new Date('2026-08-26T12:00:00+05:00'),
    )).toMatchObject({
      monthlyRevenue: 28_053_253,
      periodLabel: 'Июль 2026',
    })
  })

  it('trusts the server analytics date over a browser clock that is already in September', () => {
    const august = monthlySlice('2026-08', 31_000_000)
    const july = monthlySlice('2026-07', 28_053_253)
    expect(parseStoreMonthlyRevenue(
      overview(august, [july, august], '2026-08-26'),
      new Date('2026-09-10T00:00:00+05:00'),
    )).toMatchObject({ scopeKey: 'month:2026-07' })
  })

  it('skips a provisional latest month but still uses an older complete Store fact', () => {
    const august = monthlySlice('2026-08', 31_000_000, 'partial')
    const july = monthlySlice('2026-07', 28_053_253)

    expect(parseStoreMonthlyRevenue(
      overview(august, [july, august]),
      new Date('2026-09-01T00:00:00+05:00'),
    )).toMatchObject({ scopeKey: 'month:2026-07' })
    expect(parseLatestStorePendingPeriod(overview(august, [july, august])))
      .toMatchObject({ periodLabel: 'Август 2026', scopeKey: 'month:2026-08' })
  })

  it('uses the clearly-labelled annual average only when Store has no eligible month', () => {
    expect(selectGrowthRevenue(overview(monthlySlice('2026-08', 31_000_000, 'partial')), 120_000_000))
      .toEqual({
        kind: 'annual_average',
        annualRevenue: 120_000_000,
        monthlyRevenue: 10_000_000,
      })
  })

  it('rejects malformed period/scope data and accepts a real zero-revenue month', () => {
    const malformed = {
      ...monthlySlice('2026-07', 5_000_000),
      scopeKey: 'month:2026-06',
    }
    expect(parseStoreMonthlyRevenue(
      overview(malformed),
      new Date('2026-08-01T00:00:00+05:00'),
    )).toBeNull()
    expect(parseStoreMonthlyRevenue(
      overview(monthlySlice('2026-07', 0)),
      new Date('2026-08-01T00:00:00+05:00'),
    )?.monthlyRevenue).toBe(0)
    expect(russianMonthPeriodLabel('2026-02-01', '2026-02-28')).toBe('Февраль 2026')
  })
})
