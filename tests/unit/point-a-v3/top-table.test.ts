// ============================================================
// Unit tests for lib/point-a/v3/top-table.ts
//
// We test the pure compute layer (computeTopTableFromSeed +
// helpers) — no Supabase mock needed. Each test builds a
// hand-crafted seed (company + survey + documents) and asserts
// on the resulting TopTableResult.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  ROW_LABELS,
  aggregateRows,
  buildRows,
  classifyNewVsRepeat,
  computeTopTableFromSeed,
  discoverFiltersFromSeed,
  extractRawRows,
  type SalesRow,
  type TopTableMetricKey,
} from '@/lib/point-a/v3/top-table'

// ─── Fixtures ────────────────────────────────────────────────

const NOW = new Date(Date.UTC(2026, 4, 20)) // 20 May 2026

function mkDoc(rows: Partial<SalesRow>[], docType = 'sales_report'): {
  doc_type: string
  parsed_data: unknown
} {
  return {
    doc_type: docType,
    parsed_data: {
      summary: 'fixture',
      raw_rows: rows.map((r, i) => ({
        client_id: r.client_id ?? `c${i}`,
        manager_id: r.manager_id ?? null,
        product_id: r.product_id ?? null,
        amount: r.amount ?? 100_000,
        occurred_at: r.occurred_at ?? '2026-05-10',
      })),
    },
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function findRow(rows: ReturnType<typeof buildRows>, metric: TopTableMetricKey) {
  const r = rows.find((row) => row.metric === metric)
  if (!r) throw new Error(`row ${metric} missing`)
  return r
}

// ─── extractRawRows ──────────────────────────────────────────

describe('extractRawRows', () => {
  it('returns [] when parsed_data is missing', () => {
    expect(extractRawRows({ doc_type: 'sales_report', parsed_data: null })).toEqual([])
  })

  it('skips documents whose doc_type is unrelated', () => {
    const doc = mkDoc([{ amount: 100 }], 'brand_rules')
    expect(extractRawRows(doc)).toEqual([])
  })

  it('extracts rows + falls back to "rows" alias', () => {
    const doc = {
      doc_type: 'crm_export',
      parsed_data: {
        rows: [
          { client_id: 'c1', amount: 5000, occurred_at: '2026-01-01' },
        ],
      },
    }
    const rows = extractRawRows(doc)
    expect(rows).toHaveLength(1)
    expect(rows[0].client_id).toBe('c1')
  })

  it('drops invalid rows (missing client_id / amount / date)', () => {
    // Bypass mkDoc helper to inject literally invalid shapes.
    const doc = {
      doc_type: 'sales_report',
      parsed_data: {
        raw_rows: [
          { client_id: 'c1', amount: 100, occurred_at: '2026-01-01' },
          { amount: 100, occurred_at: '2026-01-01' }, // missing client_id
          { client_id: 'c2', amount: Number.NaN, occurred_at: '2026-01-01' },
          { client_id: 'c3', amount: 100 }, // missing occurred_at
        ],
      },
    }
    expect(extractRawRows(doc)).toHaveLength(1)
  })
})

// ─── classifyNewVsRepeat ─────────────────────────────────────

describe('classifyNewVsRepeat', () => {
  it('labels first row per client as "new" and rest as "repeat"', () => {
    const rows: SalesRow[] = [
      { client_id: 'c1', amount: 100, occurred_at: '2026-01-01' },
      { client_id: 'c1', amount: 200, occurred_at: '2026-02-01' },
      { client_id: 'c1', amount: 300, occurred_at: '2026-03-01' },
      { client_id: 'c2', amount: 50, occurred_at: '2026-02-15' },
    ]
    const cls = classifyNewVsRepeat(rows)
    expect(cls.get('c1|2026-01-01|100')).toBe('new')
    expect(cls.get('c1|2026-02-01|200')).toBe('repeat')
    expect(cls.get('c1|2026-03-01|300')).toBe('repeat')
    expect(cls.get('c2|2026-02-15|50')).toBe('new')
  })

  it('uses chronological order, not input order, to pick the first', () => {
    const rows: SalesRow[] = [
      { client_id: 'c1', amount: 200, occurred_at: '2026-02-01' },
      { client_id: 'c1', amount: 100, occurred_at: '2026-01-01' },
    ]
    const cls = classifyNewVsRepeat(rows)
    expect(cls.get('c1|2026-01-01|100')).toBe('new')
    expect(cls.get('c1|2026-02-01|200')).toBe('repeat')
  })
})

// ─── aggregateRows ───────────────────────────────────────────

describe('aggregateRows', () => {
  it('sums counts + amounts and splits new/repeat correctly', () => {
    const rows: SalesRow[] = [
      { client_id: 'c1', amount: 100, occurred_at: '2026-01-01' },
      { client_id: 'c1', amount: 200, occurred_at: '2026-02-01' },
      { client_id: 'c2', amount: 50, occurred_at: '2026-02-15' },
    ]
    const cls = classifyNewVsRepeat(rows)
    const agg = aggregateRows(rows, cls)
    expect(agg.count).toBe(3)
    expect(agg.amount).toBe(350)
    expect(agg.newCount).toBe(2)
    expect(agg.newAmount).toBe(150)
    expect(agg.repeatCount).toBe(1)
    expect(agg.repeatAmount).toBe(200)
  })
})

// ─── computeTopTableFromSeed: period grouping ────────────────

describe('computeTopTableFromSeed — period grouping', () => {
  // 3 sales in May 2026, 1 in Feb 2026 (Q1), 1 in Jan 2025.
  const baseDocs = [
    mkDoc([
      { client_id: 'c1', amount: 100_000, occurred_at: '2026-05-10' },
      { client_id: 'c2', amount: 200_000, occurred_at: '2026-05-15' },
      { client_id: 'c1', amount: 300_000, occurred_at: '2026-05-20' }, // repeat
      { client_id: 'c3', amount: 500_000, occurred_at: '2026-02-10' }, // Q1
      { client_id: 'c4', amount: 999_999, occurred_at: '2025-01-01' }, // not in year
    ]),
  ]
  const seed = { company: null, surveyAnswers: {}, documents: baseDocs }

  it('month bucket only includes May 2026 rows for factMonth', () => {
    const out = computeTopTableFromSeed(seed, { period: 'month', now: NOW })
    const sumRow = findRow(out.rows, 'sales_amount')
    // Year-to-date in 2026 = 100k + 200k + 300k + 500k = 1.1M
    expect(sumRow.factYear).toBe(1_100_000)
    // Month-to-date (May only) = 100k + 200k + 300k = 600k
    expect(sumRow.factMonth).toBe(600_000)
  })

  it('quarter bucket includes the active quarter (Q2 2026: Apr/May/Jun)', () => {
    const out = computeTopTableFromSeed(seed, { period: 'quarter', now: NOW })
    const sumRow = findRow(out.rows, 'sales_amount')
    expect(sumRow.factYear).toBe(1_100_000)
    // Q2 contains only the May rows (no Apr/Jun rows in fixture).
    expect(sumRow.factMonth).toBe(600_000)
  })

  it('year bucket has factMonth === factYear', () => {
    const out = computeTopTableFromSeed(seed, { period: 'year', now: NOW })
    const sumRow = findRow(out.rows, 'sales_amount')
    expect(sumRow.factMonth).toBe(sumRow.factYear)
  })
})

// ─── computeTopTableFromSeed: new-vs-repeat split ────────────

describe('computeTopTableFromSeed — new vs repeat', () => {
  it('classifies the first ever purchase per client as new', () => {
    const docs = [
      mkDoc([
        { client_id: 'c1', amount: 100_000, occurred_at: '2026-01-01' }, // new
        { client_id: 'c1', amount: 200_000, occurred_at: '2026-05-10' }, // repeat
        { client_id: 'c2', amount: 50_000, occurred_at: '2026-05-12' }, // new
      ]),
    ]
    const out = computeTopTableFromSeed(
      { company: null, surveyAnswers: {}, documents: docs },
      { period: 'year', now: NOW },
    )

    const newSum = findRow(out.rows, 'new_sales_amount')
    expect(newSum.factYear).toBe(150_000) // 100k + 50k

    const repeatSum = findRow(out.rows, 'repeat_sales_amount')
    expect(repeatSum.factYear).toBe(200_000)

    const newCount = findRow(out.rows, 'new_sales_count')
    expect(newCount.factYear).toBe(2)

    const repeatCount = findRow(out.rows, 'repeat_sales_count')
    expect(repeatCount.factYear).toBe(1)
  })

  it('avg_check rows compute from amount/count', () => {
    const docs = [
      mkDoc([
        { client_id: 'c1', amount: 100_000, occurred_at: '2026-05-10' },
        { client_id: 'c2', amount: 200_000, occurred_at: '2026-05-11' },
      ]),
    ]
    const out = computeTopTableFromSeed(
      { company: null, surveyAnswers: {}, documents: docs },
      { period: 'year', now: NOW },
    )
    const avg = findRow(out.rows, 'avg_check')
    expect(avg.factYear).toBe(150_000)
  })
})

// ─── % calculation edge cases ────────────────────────────────

describe('computeTopTableFromSeed — pct edge cases', () => {
  it('returns pctYear=null when plan_year is zero/missing', () => {
    const docs = [
      mkDoc([
        { client_id: 'c1', amount: 100_000, occurred_at: '2026-05-10' },
      ]),
    ]
    const out = computeTopTableFromSeed(
      { company: null, surveyAnswers: {}, documents: docs },
      { period: 'month', now: NOW },
    )
    const sumRow = findRow(out.rows, 'sales_amount')
    expect(sumRow.planYear).toBeNull()
    expect(sumRow.pctYear).toBeNull()
    expect(sumRow.pct3y).toBeNull()
  })

  it('honors company.target_revenue_12m_kzt as planYear', () => {
    const docs = [
      mkDoc([
        { client_id: 'c1', amount: 100_000_000, occurred_at: '2026-05-10' },
      ]),
    ]
    const out = computeTopTableFromSeed(
      {
        company: { target_revenue_12m_kzt: 200_000_000, target_revenue_3y_kzt: 800_000_000 },
        surveyAnswers: {},
        documents: docs,
      },
      { period: 'month', now: NOW },
    )
    expect(out.planSource).toBe('company')
    const sumRow = findRow(out.rows, 'sales_amount')
    expect(sumRow.planYear).toBe(200_000_000)
    expect(sumRow.planMonth).toBe(Math.round(200_000_000 / 12))
    expect(sumRow.pctYear).toBe(50) // 100M / 200M = 50%
    expect(sumRow.pct3y).toBe(12.5) // 100M / 800M
  })

  it('falls back to survey-parsed plan when company targets are null', () => {
    const docs = [mkDoc([{ amount: 50_000_000, occurred_at: '2026-05-10' }])]
    const out = computeTopTableFromSeed(
      {
        company: null,
        surveyAnswers: {
          s6_goal_12months: '100 млн ₸',
          s6_goal_3years: '500 млн ₸',
        },
        documents: docs,
      },
      { period: 'month', now: NOW },
    )
    expect(out.planSource).toBe('survey')
    const sumRow = findRow(out.rows, 'sales_amount')
    expect(sumRow.planYear).toBe(100_000_000)
  })

  it('planSource = "default" when neither company nor survey have targets', () => {
    const out = computeTopTableFromSeed(
      { company: null, surveyAnswers: {}, documents: [] },
      { period: 'month', now: NOW },
    )
    expect(out.planSource).toBe('default')
    for (const row of out.rows) {
      expect(row.planYear).toBeNull()
      expect(row.factYear).toBeNull()
      expect(row.pctYear).toBeNull()
    }
  })
})

// ─── Filter by product / manager ─────────────────────────────

describe('computeTopTableFromSeed — dimension filters', () => {
  const docs = [
    mkDoc([
      { client_id: 'c1', product_id: 'p1', manager_id: 'm1', amount: 100_000, occurred_at: '2026-05-10' },
      { client_id: 'c2', product_id: 'p2', manager_id: 'm1', amount: 200_000, occurred_at: '2026-05-11' },
      { client_id: 'c3', product_id: 'p1', manager_id: 'm2', amount: 300_000, occurred_at: '2026-05-12' },
    ]),
  ]

  it('product filter reduces the row set', () => {
    const out = computeTopTableFromSeed(
      { company: null, surveyAnswers: {}, documents: docs },
      { period: 'year', productId: 'p1', now: NOW },
    )
    const sumRow = findRow(out.rows, 'sales_amount')
    expect(sumRow.factYear).toBe(400_000) // 100k + 300k
    expect(findRow(out.rows, 'sales_count').factYear).toBe(2)
    expect(out.filter.productId).toBe('p1')
  })

  it('manager filter reduces the row set', () => {
    const out = computeTopTableFromSeed(
      { company: null, surveyAnswers: {}, documents: docs },
      { period: 'year', managerId: 'm1', now: NOW },
    )
    const sumRow = findRow(out.rows, 'sales_amount')
    expect(sumRow.factYear).toBe(300_000) // 100k + 200k
    expect(out.filter.managerId).toBe('m1')
  })

  it('product + manager filters combine (AND semantics)', () => {
    const out = computeTopTableFromSeed(
      { company: null, surveyAnswers: {}, documents: docs },
      { period: 'year', productId: 'p1', managerId: 'm1', now: NOW },
    )
    const sumRow = findRow(out.rows, 'sales_amount')
    expect(sumRow.factYear).toBe(100_000)
  })
})

// ─── Empty / degraded states ─────────────────────────────────

describe('computeTopTableFromSeed — empty + degraded', () => {
  it('returns 8 null-filled rows when there are no documents', () => {
    const out = computeTopTableFromSeed(
      { company: null, surveyAnswers: {}, documents: [] },
      { period: 'month', now: NOW },
    )
    expect(out.rows).toHaveLength(8)
    for (const row of out.rows) {
      expect(row.factYear).toBeNull()
      expect(row.factMonth).toBeNull()
    }
    expect(out.dataCoverage).toBe(0)
  })

  it('preserves row order matching ROW_LABELS', () => {
    const out = computeTopTableFromSeed(
      { company: null, surveyAnswers: {}, documents: [] },
      { period: 'month', now: NOW },
    )
    const labels = out.rows.map((r) => r.label)
    expect(labels).toEqual([
      ROW_LABELS.sales_count,
      ROW_LABELS.sales_amount,
      ROW_LABELS.avg_check,
      ROW_LABELS.new_sales_count,
      ROW_LABELS.new_sales_amount,
      ROW_LABELS.new_avg_check,
      ROW_LABELS.repeat_sales_count,
      ROW_LABELS.repeat_sales_amount,
    ])
  })

  it('never throws when parsed_data is malformed', () => {
    const malformedDocs = [
      { doc_type: 'sales_report', parsed_data: 'not-an-object' as unknown },
      { doc_type: 'sales_report', parsed_data: { raw_rows: 'oops' as unknown } },
      { doc_type: 'sales_report', parsed_data: { raw_rows: [{ broken: true }] } },
    ]
    expect(() =>
      computeTopTableFromSeed(
        { company: null, surveyAnswers: {}, documents: malformedDocs },
        { period: 'month', now: NOW },
      ),
    ).not.toThrow()
  })
})

// ─── Filter discovery ────────────────────────────────────────

describe('discoverFiltersFromSeed', () => {
  it('returns distinct product + manager ids from sales rows', () => {
    const docs = [
      mkDoc([
        { client_id: 'c1', product_id: 'p1', manager_id: 'm1', occurred_at: '2026-05-10' },
        { client_id: 'c2', product_id: 'p2', manager_id: 'm1', occurred_at: '2026-05-11' },
        { client_id: 'c3', product_id: 'p1', manager_id: 'm2', occurred_at: '2026-05-12' },
      ]),
    ]
    const out = discoverFiltersFromSeed({ company: null, surveyAnswers: {}, documents: docs })
    const productIds = out.products.map((p) => p.id).sort()
    const managerIds = out.managers.map((m) => m.id).sort()
    expect(productIds).toEqual(['p1', 'p2'])
    expect(managerIds).toEqual(['m1', 'm2'])
  })

  it('reads optional product / manager name dictionaries from parsed_data', () => {
    const docs = [
      {
        doc_type: 'sales_report',
        parsed_data: {
          products: [{ id: 'p1', name: 'Консультация' }],
          managers: [{ id: 'm1', name: 'Айгерим' }],
          raw_rows: [],
        },
      },
    ]
    const out = discoverFiltersFromSeed({ company: null, surveyAnswers: {}, documents: docs })
    expect(out.products[0]).toEqual({ id: 'p1', name: 'Консультация' })
    expect(out.managers[0]).toEqual({ id: 'm1', name: 'Айгерим' })
  })
})
