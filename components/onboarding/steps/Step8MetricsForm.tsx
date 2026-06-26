'use client'

import React, { useCallback } from 'react'

/* ─── Types ────────────────────────────────────────────────────────────────── */
interface Step8MetricsFormProps {
  data: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  userId?: string
}

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
  'Количество продаж', 'Сумма продаж', 'Средний чек', 'Кол-во новых продаж',
  'Сумма новых продаж', 'Ср. чек новых', 'Кол-во повторных', 'Сумма повторных',
  'CPL', 'CAC', 'LTV', 'LTV:CAC',
].map((metric_name) => ({ metric_name, y2023: 0, y2024: 0, y2025: 0, plan_2026: 0, fact_2026: 0, completion_pct: 0 }))

const VALUE_COLUMNS = [
  { key: 'y2023', label: '2023' },
  { key: 'y2024', label: '2024' },
  { key: 'y2025', label: '2025' },
  { key: 'plan_2026', label: 'План 2026' },
  { key: 'fact_2026', label: 'Факт 2026' },
  { key: 'completion_pct', label: '% выполнения' },
] as const

const getRows = (v: unknown): MetricRow[] => {
  if (Array.isArray(v) && v.length > 0) return v as MetricRow[]
  return DEFAULT_METRICS.map((m) => ({ ...m }))
}

/** Parse a clipboard/cell value into a number, tolerating spaces, currency
 * symbols, NBSP thousands separators and comma decimals (Excel/RU locale). */
function parseNum(raw: string): number {
  const cleaned = String(raw)
    .replace(/ /g, '')            // NBSP thousands sep
    .replace(/\s/g, '')
    .replace(/[^0-9.,-]/g, '')         // strip currency etc.
    .replace(/(\d),(\d)/g, '$1.$2')    // comma decimal → dot
    .replace(/,/g, '')                 // remaining commas = thousands
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

const emptyRow = (): MetricRow => ({
  metric_name: '', y2023: 0, y2024: 0, y2025: 0, plan_2026: 0, fact_2026: 0, completion_pct: 0,
})

/* ─── Component ────────────────────────────────────────────────────────────── */
export default function Step8MetricsForm({ data, onChange }: Step8MetricsFormProps) {
  const metricsRows = getRows(data.s8n_metrics_table)

  const commit = useCallback((rows: MetricRow[]) => onChange('s8n_metrics_table', rows), [onChange])

  const updateCell = useCallback(
    (rowIdx: number, key: string, value: number) => {
      commit(metricsRows.map((row, i) => (i === rowIdx ? { ...row, [key]: value } : row)))
    },
    [metricsRows, commit],
  )

  const updateName = useCallback(
    (rowIdx: number, name: string) => {
      commit(metricsRows.map((row, i) => (i === rowIdx ? { ...row, metric_name: name } : row)))
    },
    [metricsRows, commit],
  )

  const addRow = useCallback(() => commit([...metricsRows, emptyRow()]), [metricsRows, commit])
  const removeRow = useCallback(
    (rowIdx: number) => commit(metricsRows.filter((_, i) => i !== rowIdx)),
    [metricsRows, commit],
  )

  /**
   * Excel-style paste. If the clipboard holds a multi-cell block (tab/newline
   * separated), fill the grid starting from the focused cell — adding rows as
   * needed. A single value falls through to the input's default paste.
   */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent, startRow: number, startColIdx: number) => {
      const text = e.clipboardData.getData('text')
      if (!text || (!text.includes('\t') && !text.includes('\n'))) return // single value → default
      e.preventDefault()
      const grid = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((r) => r.split('\t'))
      const rows = metricsRows.map((r) => ({ ...r }))
      grid.forEach((cells, dr) => {
        const targetRow = startRow + dr
        while (targetRow >= rows.length) rows.push(emptyRow())
        cells.forEach((cell, dc) => {
          const colIdx = startColIdx + dc
          if (colIdx >= VALUE_COLUMNS.length) return
          ;(rows[targetRow] as unknown as Record<string, number>)[VALUE_COLUMNS[colIdx].key] = parseNum(cell)
        })
      })
      commit(rows)
    },
    [metricsRows, commit],
  )

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface">
            <span className="material-symbols-outlined text-primary text-lg">monitoring</span>
            Ключевые метрики
          </h3>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-on-surface-variant/70 bg-white/[0.03] border border-white/[0.06] rounded-lg px-2.5 py-1">
            <span className="material-symbols-outlined text-sm text-primary/70">content_paste</span>
            Можно вставить таблицу из Excel (Ctrl/⌘+V в любую ячейку)
          </span>
        </div>

        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="text-left text-xs font-mono text-on-surface-variant uppercase tracking-wider py-2 pr-3 min-w-[150px] sticky left-0 bg-[#0c0e14] z-10">
                  Метрика
                </th>
                {VALUE_COLUMNS.map((col) => (
                  <th key={col.key} className="text-left text-xs font-mono text-on-surface-variant uppercase tracking-wider py-2 px-2 min-w-[92px]">
                    {col.label}
                  </th>
                ))}
                <th className="w-8" aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {metricsRows.map((row, rowIdx) => (
                <tr key={rowIdx} className="group">
                  <td className="py-1.5 pr-3 sticky left-0 bg-[#0c0e14] z-10">
                    <input
                      type="text"
                      value={row.metric_name}
                      onChange={(e) => updateName(rowIdx, e.target.value)}
                      placeholder="Название метрики"
                      className="w-full bg-transparent border border-transparent hover:border-white/[0.08] focus:border-primary/40 rounded-lg px-2 py-2 text-sm text-on-surface font-medium placeholder:text-on-surface-variant/30 focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all"
                    />
                  </td>
                  {VALUE_COLUMNS.map((col, colIdx) => (
                    <td key={col.key} className="py-1.5 px-1">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={(row as Record<string, unknown>)[col.key] as number || ''}
                        onChange={(e) => updateCell(rowIdx, col.key, parseNum(e.target.value))}
                        onPaste={(e) => handlePaste(e, rowIdx, colIdx)}
                        className="w-full bg-surface-container border border-white/[0.08] rounded-lg px-2.5 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                      />
                    </td>
                  ))}
                  <td className="px-0.5 align-middle">
                    <button
                      type="button"
                      onClick={() => removeRow(rowIdx)}
                      aria-label="Удалить метрику"
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant/40 hover:text-error hover:bg-error/10 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                    >
                      <span className="material-symbols-outlined text-base">close</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/[0.08] text-on-surface-variant text-xs hover:text-on-surface hover:border-primary/30 hover:bg-primary/[0.04] transition-all"
          >
            <span className="material-symbols-outlined text-base">add</span>
            Добавить метрику
          </button>
          <p className="text-xs text-on-surface-variant/50">
            Введите свои значения по годам, план и факт 2026 — или вставьте таблицу из Excel.
          </p>
        </div>
      </section>
    </div>
  )
}
