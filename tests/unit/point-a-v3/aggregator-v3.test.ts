import { describe, it, expect } from 'vitest'
import {
  aggregatePointAV3,
  type AggregatorV3Input,
} from '@/lib/point-a/v3/aggregator-v3'
import { scoreV3, V3_DEFAULT_WEIGHTS } from '@/lib/point-a/v3/scoring'
import { V3_BLOCKS, blockIdForMetric } from '@/lib/point-a/v3/blocks'
import {
  calcBEP,
  calcROMI,
  calcRetRate,
  calcCR2,
  median,
} from '@/lib/point-a/v3/formulas'

// ─── Fixtures ───────────────────────────────────────────────

const NOW = new Date('2026-05-20T12:00:00.000Z')

function fullMinimumPackInput(): AggregatorV3Input {
  return {
    now: NOW,
    company: { industry: 'retail', stage: 'growth', business_model: 'B2C' },
    surveyAnswers: {
      s2_revenue_2025: 120_000_000,
      s2_avg_check: 12_000,
      s2_new_clients_2025: 800,
      s2_repeat_clients_2025: 1_200,
      s2_gross_margin: 45,
      s2_cac: 8_000,
      s2_ltv: 48_000,
      s3_deals_2025: 2_000,
    },
    documents: {
      sales_count: 2_000,
      revenue_total: 120_000_000,
      new_clients_count: 800,
      revenue_from_new: 40_000_000,
      repeat_purchases_count: 1_200,
      revenue_from_repeat: 80_000_000,
      total_clients: 1_800,
      active_last_12mo: 1_400,
      new_last_12mo: 800,
      sleeping_clients: 200,
      avg_purchases_per_client: 4,
      median_interval_days: 60,
      marketing_budget: 6_400_000,
      leads_count: 2_500,
      opt_in_clients: 1_400,
      first_response_seconds: 50,
      missed_count: 30,
      total_incoming: 1_000,
      no_show_count: 80,
      appointments_count: 1_000,
      cogs: 70_000_000,
      payroll: 30_000_000,
      ebitda: 25_000_000,
      net_profit: 15_000_000,
      depreciation: 3_000_000,
      taxes: 4_000_000,
      interest: 1_000_000,
      fixed_costs: 30_000_000,
      variable_costs: 60_000_000,
    },
  }
}

// ─── Smoke / structure tests ────────────────────────────────

describe('aggregatePointAV3 — structure', () => {
  it('returns all six blocks in spec order', () => {
    const out = aggregatePointAV3({ now: NOW })
    expect(Object.keys(out.blocks)).toEqual([
      'sales',
      'client',
      'retention',
      'finance',
      'funnel',
      'ai_comms',
    ])
    expect(out.computed_at).toBe(NOW.toISOString())
  })

  it('V3_BLOCKS exposes the six blocks in spec order with Russian labels', () => {
    expect(V3_BLOCKS.map((b) => b.id)).toEqual([
      'sales',
      'client',
      'retention',
      'finance',
      'funnel',
      'ai_comms',
    ])
    for (const b of V3_BLOCKS) {
      expect(b.label_ru.length).toBeGreaterThan(0)
      expect(b.label_en.length).toBeGreaterThan(0)
      expect(b.metric_keys.length).toBeGreaterThan(0)
    }
  })

  it('blockIdForMetric maps known metric keys back to their block', () => {
    expect(blockIdForMetric('AOV')).toBe('sales')
    expect(blockIdForMetric('LTV')).toBe('client')
    expect(blockIdForMetric('Churn')).toBe('retention')
    expect(blockIdForMetric('EBITDA')).toBe('finance')
    expect(blockIdForMetric('CR1')).toBe('funnel')
    expect(blockIdForMetric('NPS')).toBe('ai_comms')
    expect(blockIdForMetric('nonexistent')).toBeNull()
  })
})

// ─── Empty input → all no_data ──────────────────────────────

describe('aggregatePointAV3 — empty input', () => {
  it('returns no_data status for every metric in every block', () => {
    const out = aggregatePointAV3({ now: NOW })
    for (const block of Object.values(out.blocks)) {
      for (const metric of Object.values(block) as Array<{ value: number | null; status: string }>) {
        expect(metric.value).toBeNull()
        expect(metric.status).toBe('no_data')
      }
    }
  })

  it('scoreV3 of empty payload yields zero score and no_data for every block', () => {
    const out = aggregatePointAV3({ now: NOW })
    const s = scoreV3(out)
    expect(s.overall_score).toBe(0)
    for (const b of Object.values(s.blocks)) {
      expect(b.status).toBe('no_data')
      expect(b.score).toBe(0)
    }
  })

  it('scoreV3 weights normalise to sum to ~1', () => {
    const out = aggregatePointAV3({ now: NOW })
    const s = scoreV3(out)
    const sum = Object.values(s.weights).reduce((a, b) => a + b, 0)
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9)
  })
})

// ─── Full minimum pack → finite values, AI-comms still null ─

describe('aggregatePointAV3 — full minimum pack', () => {
  it('every non-AI-comms metric has a finite value', () => {
    const out = aggregatePointAV3(fullMinimumPackInput())

    const collect = (block: object) =>
      (Object.values(block) as Array<{ value: number | null }>).map((m) => m.value)

    const sales = collect(out.blocks.sales)
    const client = collect(out.blocks.client)
    const retention = collect(out.blocks.retention)
    const finance = collect(out.blocks.finance)
    const funnel = collect(out.blocks.funnel)

    for (const v of [...sales, ...client, ...retention, ...finance, ...funnel]) {
      expect(v).not.toBeNull()
      expect(Number.isFinite(v as number)).toBe(true)
    }

    // AI-comms — all null since no AI-comms data was supplied.
    for (const metric of Object.values(out.blocks.ai_comms)) {
      expect(metric.value).toBeNull()
      expect(metric.status).toBe('no_data')
    }
  })

  it('computes AOV = Rev / N', () => {
    const out = aggregatePointAV3(fullMinimumPackInput())
    expect(out.blocks.sales.AOV.value).toBe(120_000_000 / 2_000)
    expect(out.blocks.sales.Rev.value).toBe(120_000_000)
    expect(out.blocks.sales.N.value).toBe(2_000)
  })

  it('scoreV3 produces a finite overall score in [0, 10]', () => {
    const out = aggregatePointAV3(fullMinimumPackInput())
    const s = scoreV3(out)
    expect(s.overall_score).toBeGreaterThan(0)
    expect(s.overall_score).toBeLessThanOrEqual(10)
    // AI-comms should still register no_data
    expect(s.blocks.ai_comms.status).toBe('no_data')
  })
})

// ─── Repeat-customer math correctness ───────────────────────

describe('repeat-customer math', () => {
  it('RetRate = Ret / TotalC × 100', () => {
    // 1200 repeat / 1800 total = 66.66… %
    expect(calcRetRate(1200, 1800)).toBeCloseTo(66.6666, 3)
  })

  it('CR2 = repeat / new × 100', () => {
    // From full pack: 1200 repeat / 800 new = 150% → flagged but mathematically correct.
    expect(calcCR2(1200, 800)).toBe(150)
  })

  it('repeat revenue share is reported in the Ret/RevRet status', () => {
    const out = aggregatePointAV3(fullMinimumPackInput())
    // Ret share: 1200/2000 = 60% > 35% target → at least good
    expect(['good', 'excellent']).toContain(out.blocks.sales.Ret.status)
    // RevRet share: 80M / 120M = 66.6% > 40% target → at least good
    expect(['good', 'excellent']).toContain(out.blocks.sales.RevRet.status)
  })

  it('median helper handles even and odd arrays correctly', () => {
    expect(median([])).toBeNull()
    expect(median([10])).toBe(10)
    expect(median([1, 2, 3])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([3, 1, 2])).toBe(2) // sort-stable median
  })

  it('Churn = Sleep / TotalC × 100, classified as good when < 15%', () => {
    const out = aggregatePointAV3(fullMinimumPackInput())
    // 200 / 1800 = 11.11% → good
    expect(out.blocks.retention.Churn.value).toBeCloseTo(11.11, 1)
    expect(['good', 'excellent']).toContain(out.blocks.retention.Churn.status)
  })
})

// ─── BEP correctness with mock P&L ──────────────────────────

describe('BEP correctness', () => {
  it('BEP = fixed / (1 − variable / revenue)', () => {
    // fixed = 30M, variable = 60M, revenue = 120M
    // → 30M / (1 − 0.5) = 60M
    expect(calcBEP(30_000_000, 60_000_000, 120_000_000)).toBe(60_000_000)
  })

  it('BEP returns null when contribution ratio is non-positive', () => {
    expect(calcBEP(30_000_000, 200_000_000, 120_000_000)).toBeNull()
    expect(calcBEP(30_000_000, 120_000_000, 120_000_000)).toBeNull()
  })

  it('BEP returns null when revenue is zero or missing', () => {
    expect(calcBEP(30_000_000, 60_000_000, 0)).toBeNull()
    expect(calcBEP(30_000_000, 60_000_000, null)).toBeNull()
    expect(calcBEP(null, 60_000_000, 120_000_000)).toBeNull()
  })

  it('aggregator wires BEP correctly with full pack', () => {
    const out = aggregatePointAV3(fullMinimumPackInput())
    expect(out.blocks.finance.BEP.value).toBe(60_000_000)
    expect(out.blocks.finance.BEP.formula).toContain('Пост. расходы')
  })

  it('gross margin matches survey when not derivable from docs', () => {
    const out = aggregatePointAV3(fullMinimumPackInput())
    // GP = 120M - 70M = 50M; margin = 50/120 = 41.66%
    expect(out.blocks.finance.GrossMargin.value).toBeCloseTo(41.66, 1)
    expect(['good', 'excellent']).toContain(out.blocks.finance.GrossMargin.status)
  })
})

// ─── ROMI sanity check ─────────────────────────────────────

describe('ROMI math', () => {
  it('ROMI = (RevNew − CAC×New) / (CAC×New) × 100', () => {
    // RevNew = 40M, CAC = 8000, New = 800
    // spend = 8000 × 800 = 6.4M; (40M − 6.4M) / 6.4M = 5.25 → 525%
    expect(calcROMI(40_000_000, 8_000, 800)).toBeCloseTo(525, 2)
  })

  it('aggregator sets ROMI status to excellent when far above target', () => {
    const out = aggregatePointAV3(fullMinimumPackInput())
    expect(out.blocks.client.ROMI.value).toBeCloseTo(525, 0)
    expect(out.blocks.client.ROMI.status).toBe('excellent')
  })

  it('LTV:CAC ratio classifies correctly', () => {
    const out = aggregatePointAV3(fullMinimumPackInput())
    // LTV from survey = 48,000; CAC = 8,000 → 6:1 → excellent (≥5)
    expect(out.blocks.client.LTV_CAC.value).toBe(6)
    expect(out.blocks.client.LTV_CAC.status).toBe('excellent')
  })
})

// ─── Funnel sanity ─────────────────────────────────────────

describe('funnel block', () => {
  it('CR1 = New / Leads × 100, good when > 40%', () => {
    const out = aggregatePointAV3(fullMinimumPackInput())
    // 800 / 2500 = 32% → warning
    expect(out.blocks.funnel.CR1.value).toBe(32)
    expect(out.blocks.funnel.CR1.status).toBe('warning')
  })

  it('NoShow status critical when value > 13% (1.3× target=10%)', () => {
    const input = fullMinimumPackInput()
    input.documents!.no_show_count = 200
    input.documents!.appointments_count = 1000
    const out = aggregatePointAV3(input)
    expect(out.blocks.funnel.NoShow.value).toBe(20)
    expect(out.blocks.funnel.NoShow.status).toBe('critical')
  })
})

// ─── Weights sanity ────────────────────────────────────────

describe('V3 default weights', () => {
  it('sum to 1.0', () => {
    const sum = Object.values(V3_DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9)
  })
})
