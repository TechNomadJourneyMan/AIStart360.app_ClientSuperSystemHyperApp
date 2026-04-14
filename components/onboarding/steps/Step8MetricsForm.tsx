'use client'

import React, { useCallback } from 'react'
import { FieldLabel } from '@/components/onboarding/shared'

/* ─── Types ────────────────────────────────────────────────────────────────── */
interface Step8MetricsFormProps {
  data: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  userId?: string
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
type MetricRow = {
  metric_name: string
  y2023: number
  y2024: number
  y2025: number
  plan_2026: number
  fact_2026: number
  completion_pct: number
}

const DEFAULT_METRICS: MetricRow[] = [
  { metric_name: 'Number of Sales', y2023: 0, y2024: 0, y2025: 0, plan_2026: 0, fact_2026: 0, completion_pct: 0 },
  { metric_name: 'Sales Amount', y2023: 0, y2024: 0, y2025: 0, plan_2026: 0, fact_2026: 0, completion_pct: 0 },
  { metric_name: 'Avg. Check', y2023: 0, y2024: 0, y2025: 0, plan_2026: 0, fact_2026: 0, completion_pct: 0 },
  { metric_name: 'New Sales Count', y2023: 0, y2024: 0, y2025: 0, plan_2026: 0, fact_2026: 0, completion_pct: 0 },
  { metric_name: 'New Sales Amount', y2023: 0, y2024: 0, y2025: 0, plan_2026: 0, fact_2026: 0, completion_pct: 0 },
  { metric_name: 'Avg. Check New', y2023: 0, y2024: 0, y2025: 0, plan_2026: 0, fact_2026: 0, completion_pct: 0 },
  { metric_name: 'Repeat Count', y2023: 0, y2024: 0, y2025: 0, plan_2026: 0, fact_2026: 0, completion_pct: 0 },
  { metric_name: 'Repeat Amount', y2023: 0, y2024: 0, y2025: 0, plan_2026: 0, fact_2026: 0, completion_pct: 0 },
  { metric_name: 'CPL', y2023: 0, y2024: 0, y2025: 0, plan_2026: 0, fact_2026: 0, completion_pct: 0 },
  { metric_name: 'CAC', y2023: 0, y2024: 0, y2025: 0, plan_2026: 0, fact_2026: 0, completion_pct: 0 },
  { metric_name: 'LTV', y2023: 0, y2024: 0, y2025: 0, plan_2026: 0, fact_2026: 0, completion_pct: 0 },
  { metric_name: 'LTV:CAC', y2023: 0, y2024: 0, y2025: 0, plan_2026: 0, fact_2026: 0, completion_pct: 0 },
]

const VALUE_COLUMNS = [
  { key: 'y2023', label: '2023' },
  { key: 'y2024', label: '2024' },
  { key: 'y2025', label: '2025' },
  { key: 'plan_2026', label: 'Plan 2026' },
  { key: 'fact_2026', label: 'Actual 2026' },
  { key: 'completion_pct', label: '% Completed' },
] as const

const getRows = (v: unknown): MetricRow[] => {
  if (Array.isArray(v) && v.length > 0) return v as MetricRow[]
  return DEFAULT_METRICS.map((m) => ({ ...m }))
}

/* ─── Component ────────────────────────────────────────────────────────────── */
export default function Step8MetricsForm({ data, onChange }: Step8MetricsFormProps) {
  const metricsRows = getRows(data.s8n_metrics_table)

  const updateCell = useCallback(
    (rowIdx: number, key: string, value: number) => {
      const updated = metricsRows.map((row, i) =>
        i === rowIdx ? { ...row, [key]: value } : row,
      )
      onChange('s8n_metrics_table', updated)
    },
    [metricsRows, onChange],
  )

  return (
    <div className="space-y-8">
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">monitoring</span>
          Key Metrics
        </h3>

        {/* Desktop table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.08]">
                <th className="text-left text-xs font-mono text-on-surface-variant uppercase tracking-wider py-2 pr-3 min-w-[160px]">
                  Metric
                </th>
                {VALUE_COLUMNS.map((col) => (
                  <th key={col.key} className="text-left text-xs font-mono text-on-surface-variant uppercase tracking-wider py-2 px-2 min-w-[100px]">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metricsRows.map((row, rowIdx) => (
                <tr key={rowIdx} className="border-b border-white/[0.04]">
                  <td className="py-2 pr-3">
                    <span className="text-sm text-on-surface font-medium">{row.metric_name}</span>
                  </td>
                  {VALUE_COLUMNS.map((col) => (
                    <td key={col.key} className="py-2 px-2">
                      <input
                        type="number"
                        value={(row as Record<string, unknown>)[col.key] as number || ''}
                        onChange={(e) => updateCell(rowIdx, col.key, Number(e.target.value) || 0)}
                        className="w-full bg-surface-container border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-on-surface-variant/50">
          Fill in the data for each metric for past years, plan and actual for 2026.
        </p>
      </section>
    </div>
  )
}
