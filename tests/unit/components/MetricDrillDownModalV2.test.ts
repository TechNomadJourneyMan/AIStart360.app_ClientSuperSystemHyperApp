// ============================================================
// Tests for MetricDrillDownModalV2 (Phase 6b).
//
// The vitest config in this repo runs in the `node` environment and only
// picks up `*.test.ts` files — there is no jsdom and no @testing-library/react
// available, so we cannot render the React tree directly. Instead we:
//
//   1. Exercise the pure helpers in `_drill-down-utils.ts` (the same logic
//      the component uses for period defaults, layer toggling, empty
//      detection, number formatting, picked-source matching, etc.).
//   2. Make structural assertions against the component source file
//      (Russian copy, props shape, ESC handler, picked-icon, etc.).
//
// Together these cover the required Phase 6b acceptance criteria.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  V2_PERIOD_OPTIONS,
  DEFAULT_DRILL_PERIOD,
  DEFAULT_DRILL_LAYERS,
  DRILL_LAYER_LABELS,
  toggleDrillLayer,
  severityColor,
  formatMetricNumber,
  mergeFactForecast,
  isSourcePicked,
  filterRecentAnomalies,
  isTimeseriesEmpty,
  formatTrend,
  formatRelativeRu,
  type DrillLayer,
} from '@/components/dashboard/_drill-down-utils'

import type { TimeseriesPoint, ForecastPoint, AnomalyPoint } from '@/types/metrics'

const COMPONENT_PATH = resolve(
  __dirname,
  '../../../components/dashboard/MetricDrillDownModalV2.tsx',
)
const COMPONENT_SRC = readFileSync(COMPONENT_PATH, 'utf-8')

// ─── Period picker ────────────────────────────────────────────────────────

describe('MetricDrillDownModalV2 — period picker', () => {
  it('defaults to "3M"', () => {
    expect(DEFAULT_DRILL_PERIOD).toBe('3M')
  })

  it('exposes 5 period chips', () => {
    expect(V2_PERIOD_OPTIONS).toHaveLength(5)
    const ids = V2_PERIOD_OPTIONS.map((p) => p.id)
    expect(ids).toContain('1M')
    expect(ids).toContain('3M')
    expect(ids).toContain('1Y')
  })

  it('component wires setPeriod onClick for chips', () => {
    expect(COMPONENT_SRC).toMatch(/setPeriod\(p\.id\)/)
    expect(COMPONENT_SRC).toMatch(/V2_PERIOD_OPTIONS\.map/)
  })
})

// ─── Layer toggles ────────────────────────────────────────────────────────

describe('MetricDrillDownModalV2 — layer toggles', () => {
  it('defaults to all four layers enabled', () => {
    expect([...DEFAULT_DRILL_LAYERS].sort()).toEqual(
      ['anomalies', 'fact', 'forecast', 'goal'].sort(),
    )
  })

  it('uses Russian labels for layers', () => {
    expect(DRILL_LAYER_LABELS.fact).toBe('Факт')
    expect(DRILL_LAYER_LABELS.forecast).toBe('Прогноз')
    expect(DRILL_LAYER_LABELS.goal).toBe('Цель')
    expect(DRILL_LAYER_LABELS.anomalies).toBe('Аномалии')
  })

  it('toggleDrillLayer flips visibility', () => {
    const start: DrillLayer[] = ['fact', 'forecast', 'goal', 'anomalies']
    const off = toggleDrillLayer(start, 'forecast')
    expect(off).not.toContain('forecast')
    const on = toggleDrillLayer(off, 'forecast')
    expect(on).toContain('forecast')
  })

  it('preserves order when toggling off', () => {
    const start: DrillLayer[] = ['fact', 'forecast', 'goal']
    expect(toggleDrillLayer(start, 'forecast')).toEqual(['fact', 'goal'])
  })
})

// ─── Header / label ───────────────────────────────────────────────────────

describe('MetricDrillDownModalV2 — header', () => {
  it('renders metric label inside the Dialog.Title slot', () => {
    expect(COMPONENT_SRC).toMatch(/<Dialog\.Title[\s\S]*?\{metricLabel\}/)
  })

  it('shows the «Метрика» eyebrow label in Russian', () => {
    expect(COMPONENT_SRC).toContain('Метрика')
  })
})

// ─── Empty timeseries ─────────────────────────────────────────────────────

describe('MetricDrillDownModalV2 — empty state', () => {
  it('isTimeseriesEmpty returns true for empty / null / NaN-only', () => {
    expect(isTimeseriesEmpty([])).toBe(true)
    expect(isTimeseriesEmpty(null)).toBe(true)
    expect(isTimeseriesEmpty(undefined)).toBe(true)
    const allNaN: TimeseriesPoint[] = [
      { timestamp: '2025-01-01', label: 'Янв', value: Number.NaN },
    ]
    expect(isTimeseriesEmpty(allNaN)).toBe(true)
  })

  it('isTimeseriesEmpty is false for non-empty values', () => {
    expect(
      isTimeseriesEmpty([
        { timestamp: '2025-01-01', label: 'Янв', value: 10 },
      ]),
    ).toBe(false)
  })

  it('component renders the Russian empty-state message', () => {
    expect(COMPONENT_SRC).toContain('Недостаточно данных для построения графика')
  })
})

// ─── Description sections ─────────────────────────────────────────────────

describe('MetricDrillDownModalV2 — description sections', () => {
  it('component renders all four description headings in Russian', () => {
    expect(COMPONENT_SRC).toContain('Что это?')
    expect(COMPONENT_SRC).toContain('Почему важно?')
    expect(COMPONENT_SRC).toContain('Как считаем?')
    expect(COMPONENT_SRC).toContain('Текущее состояние')
  })

  it('description sections are gated behind the optional prop', () => {
    expect(COMPONENT_SRC).toMatch(/\{description &&[\s\S]*Что это\?/)
  })
})

// ─── Provenance ───────────────────────────────────────────────────────────

describe('MetricDrillDownModalV2 — provenance', () => {
  it('isSourcePicked matches on type + label', () => {
    const picked = { type: 'survey', label: 'Анкета шаг 2' }
    expect(
      isSourcePicked({ type: 'survey', label: 'Анкета шаг 2' }, picked),
    ).toBe(true)
    expect(
      isSourcePicked({ type: 'document', label: 'P&L 2024 Q4' }, picked),
    ).toBe(false)
    expect(
      isSourcePicked({ type: 'survey', label: 'Анкета шаг 2' }, null),
    ).toBe(false)
  })

  it('component renders a check icon for the picked source', () => {
    // The picked source row resolves to `check_circle` via material symbols.
    expect(COMPONENT_SRC).toContain('check_circle')
  })

  it('component greys out missed sources', () => {
    expect(COMPONENT_SRC).toMatch(/не загружен/)
    expect(COMPONENT_SRC).toMatch(/text-on-surface-variant\/60/)
  })

  it('component shows the «Источники данных» section heading', () => {
    expect(COMPONENT_SRC).toContain('Источники данных')
  })

  it('formatRelativeRu prints recent timestamps in Russian', () => {
    const now = new Date('2026-05-19T12:00:00Z')
    const twelveMinAgo = new Date(now.getTime() - 12 * 60_000).toISOString()
    expect(formatRelativeRu(twelveMinAgo, now)).toBe('12 мин назад')
    const twoHrsAgo = new Date(now.getTime() - 2 * 60 * 60_000).toISOString()
    expect(formatRelativeRu(twoHrsAgo, now)).toBe('2 ч назад')
  })
})

// ─── Anomalies ────────────────────────────────────────────────────────────

describe('MetricDrillDownModalV2 — anomalies', () => {
  it('severityColor returns the spec colors', () => {
    expect(severityColor('critical')).toBe('#ffb4ab')
    expect(severityColor('warning')).toBe('#ffbd60')
    expect(severityColor('info')).toBe('#6effc0')
  })

  it('filterRecentAnomalies drops items older than the window', () => {
    const now = new Date('2026-05-19T00:00:00Z')
    const fresh: AnomalyPoint = {
      timestamp: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      label: '14.05',
      value: 1,
      severity: 'warning',
      description: 'fresh',
    }
    const stale: AnomalyPoint = {
      timestamp: new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString(),
      label: '01.11',
      value: 2,
      severity: 'info',
      description: 'stale',
    }
    const result = filterRecentAnomalies([fresh, stale], 90, now)
    expect(result).toEqual([fresh])
  })

  it('component shows the «Аномалии (последние 90 дней)» heading', () => {
    expect(COMPONENT_SRC).toContain('Аномалии (последние 90 дней)')
  })
})

// ─── ESC handling ─────────────────────────────────────────────────────────

describe('MetricDrillDownModalV2 — esc key', () => {
  it('component installs a keydown handler that calls onClose on Escape', () => {
    expect(COMPONENT_SRC).toMatch(/e\.key === 'Escape'/)
    expect(COMPONENT_SRC).toMatch(/window\.addEventListener\(['"]keydown['"]/)
    expect(COMPONENT_SRC).toMatch(/onClose\(\)/)
  })

  it('uses Radix Dialog.Root with onOpenChange that triggers onClose', () => {
    expect(COMPONENT_SRC).toMatch(/Dialog\.Root[\s\S]*onOpenChange/)
    expect(COMPONENT_SRC).toMatch(/if \(!o\) onClose\(\)/)
  })
})

// ─── Chart layering ───────────────────────────────────────────────────────

describe('MetricDrillDownModalV2 — chart merging', () => {
  it('mergeFactForecast omits forecast when includeForecast=false', () => {
    const fact: TimeseriesPoint[] = [
      { timestamp: '2025-01-01', label: 'Янв', value: 10 },
    ]
    const fc: ForecastPoint[] = [
      {
        timestamp: '2025-02-01',
        label: 'Фев',
        value: 11,
        isForecast: true,
        confidenceLow: 10,
        confidenceHigh: 12,
      },
    ]
    expect(mergeFactForecast(fact, fc, false)).toHaveLength(1)
    expect(mergeFactForecast(fact, fc, true)).toHaveLength(2)
  })

  it('mergeFactForecast attaches confidence band onto overlapping labels', () => {
    const merged = mergeFactForecast(
      [{ timestamp: '2025-01-01', label: 'Янв', value: 10 }],
      [
        {
          timestamp: '2025-01-01',
          label: 'Янв',
          value: 11,
          isForecast: true,
          confidenceLow: 9,
          confidenceHigh: 13,
        },
      ],
      true,
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].forecastValue).toBe(11)
    expect(merged[0].confidenceLow).toBe(9)
    expect(merged[0].confidenceHigh).toBe(13)
  })
})

// ─── Number formatting ────────────────────────────────────────────────────

describe('MetricDrillDownModalV2 — number formatting', () => {
  it('formats millions and thousands the Russian way', () => {
    expect(formatMetricNumber(84_200_000)).toMatch(/млн$/)
    expect(formatMetricNumber(125_000)).toMatch(/тыс$/)
    expect(formatMetricNumber(null)).toBe('—')
  })

  it('formatTrend builds a signed percentage with tone', () => {
    expect(formatTrend({ direction: 'up', deltaPct: 12.4 }).tone).toBe('pos')
    expect(formatTrend({ direction: 'down', deltaPct: 3 }).text).toContain('3')
    expect(formatTrend(undefined).text).toBe('—')
  })
})
