import { describe, it, expect } from 'vitest'

import {
  parseMetricValue,
  REVENUE_YEAR_METRIC_ID,
} from '@/components/dashboard/_metric-value'
import { getMetricById } from '@/lib/metrics/registry'

const fmt = (n: number) => `${n} ₸`

/** Envelope shaped exactly like GET /api/v1/metrics/:id/value. */
function envelope(opts: {
  value: number | null
  picked?: Record<string, unknown> | null
  considered?: Array<Record<string, unknown>>
}) {
  return {
    ok: true,
    data: {
      metric_id: REVENUE_YEAR_METRIC_ID,
      label: 'Выручка (год)',
      unit: '₸',
      value: opts.value,
      period: { year: null, quarter: null },
      source: 'live',
      confidence: 0.86,
      provenance: {
        picked: opts.picked ?? null,
        considered: opts.considered ?? [],
        notes: undefined,
        raw_value: opts.value,
      },
      computed_at: '2026-08-08T09:00:00.000Z',
      fresh: true,
    },
  }
}

describe('hero revenue metric id', () => {
  it('resolves against the real registry', () => {
    const entry = getMetricById(REVENUE_YEAR_METRIC_ID)
    expect(entry).toBeTruthy()
    expect(entry!.unit).toBe('₸')
  })
})

describe('parseMetricValue', () => {
  it('returns null for a non-ok envelope so callers show an error, not "no data"', () => {
    expect(parseMetricValue({ ok: false, error: 'boom' }, fmt)).toBeNull()
    expect(parseMetricValue({ source: 'empty', data: [] }, fmt)).toBeNull()
    expect(parseMetricValue(null, fmt)).toBeNull()
  })

  it('reads the value and marks which source it came from', () => {
    const picked = { type: 'survey', step: 9, key: 's9n_revenue_2024', label: 'Выручка 2024' }
    const parsed = parseMetricValue(
      envelope({
        value: 84_200_000,
        picked,
        considered: [
          { source: picked, status: 'hit', numeric: 84_200_000, confidence: 0.9 },
          {
            source: { type: 'document', doc_type: 'pl_report', field: 'revenue' },
            status: 'miss',
            reason: 'no parsed document',
          },
        ],
      }),
      fmt,
    )

    expect(parsed).toBeTruthy()
    expect(parsed!.value).toBe(84_200_000)
    // Year is read off the winning source's own label, never from the clock.
    expect(parsed!.pickedYear).toBe(2024)
    expect(parsed!.pickedLabel).toBe('Выручка 2024')

    const hit = parsed!.sources.find((s) => s.picked)
    expect(hit?.type).toBe('survey')
    expect(hit?.detail).toContain('шаг 9')
    expect(hit?.detail).toContain('s9n_revenue_2024')

    // The unfilled document is listed as an actionable gap.
    expect(parsed!.missing.join(' ')).toContain('pl_report')
  })

  it('keeps value null when nothing resolved and lists what to fill in', () => {
    const parsed = parseMetricValue(
      envelope({
        value: null,
        picked: null,
        considered: [
          {
            source: { type: 'survey', step: 2, key: 's2_revenue_2025', label: 'Выручка 2025 (₸)' },
            status: 'miss',
            reason: 'survey key "s2_revenue_2025" not answered',
          },
          {
            source: { type: 'document', doc_type: 'pl_report', field: 'revenue' },
            status: 'miss',
          },
        ],
      }),
      fmt,
    )

    expect(parsed!.value).toBeNull()
    expect(parsed!.pickedYear).toBeNull()
    expect(parsed!.missing).toHaveLength(2)
    expect(parsed!.missing[0]).toContain('Выручка 2025')
    expect(parsed!.sources.every((s) => !s.picked)).toBe(true)
  })

  it('refuses to present a percent-change answer as an absolute ₸ figure', () => {
    // `s9n_change_vs_2023` is declared as a source of the ₸ revenue metric and
    // sits in the same priority bucket as the two absolute fields, so it can
    // win when they are blank. It holds "+25" (percent), not a sum.
    const picked = {
      type: 'survey',
      step: 9,
      key: 's9n_change_vs_2023',
      label: 'Изменение к 2023',
    }
    const parsed = parseMetricValue(
      envelope({
        value: 25,
        picked,
        considered: [{ source: picked, status: 'hit', numeric: 25, confidence: 0.9 }],
      }),
      fmt,
    )

    expect(parsed!.value).toBeNull()
    expect(parsed!.missing[0]).toContain('изменение в процентах')
    // The finding is still visible in the provenance list — hidden, not deleted.
    expect(parsed!.sources[0].status).toBe('hit')
  })
})
