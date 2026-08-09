'use client'

// GRI trend. Every bar is one row of `gri_reports`, so the axis labels are the
// real `calculated_at` dates of the first/middle/last point — the previous
// version printed «1 Mar / 15 Mar / 30 Mar» as string literals under live data.

import { useState } from 'react'
import type { TrendPoint } from './analytics-detail'
import { formatDateFull, formatDateShort, formatScore, pluralRu } from './format'

export function GriTrendChart({ points, total }: { points: TrendPoint[]; total: number }) {
  const [selected, setSelected] = useState<number | null>(null)

  if (points.length === 0) return null

  // The query caps the series, so say so instead of implying the chart is complete.
  const isCapped = total > points.length

  const axis = [points[0], points[Math.floor((points.length - 1) / 2)], points[points.length - 1]]
  const active = selected !== null ? points[selected] : null

  return (
    <div>
      <div className="h-48 flex items-end gap-1.5" role="group" aria-label="Столбцы GRI по отчётам">
        {points.map((point, index) => {
          const isActive = index === selected
          return (
            <button
              key={`${point.date}-${index}`}
              type="button"
              onClick={() => setSelected(isActive ? null : index)}
              aria-pressed={isActive}
              aria-label={`${formatDateFull(point.date)}: GRI ${formatScore(point.display)}`}
              title={`${formatDateFull(point.date)} — GRI ${formatScore(point.display)}`}
              className={`flex-1 min-w-[3px] rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                isActive ? 'bg-primary' : 'bg-primary/20 hover:bg-primary/40'
              }`}
              style={{ height: `${Math.max(point.raw, 2)}%` }}
            />
          )
        })}
      </div>

      <div className="flex justify-between text-[10px] font-mono text-on-surface-variant mt-3">
        {axis.map((point, index) => (
          <span key={`${point.date}-axis-${index}`}>{formatDateShort(point.date)}</span>
        ))}
      </div>

      <p className="text-xs text-on-surface-variant mt-3 min-h-[2.5rem]">
        {active ? (
          <>
            <span className="font-mono text-on-surface">GRI {formatScore(active.display)}</span>
            {' · '}
            {formatDateFull(active.date)}
          </>
        ) : (
          <>
            {isCapped ? (
              <>
                Последние {points.length} из {total}{' '}
                {pluralRu(total, 'отчёта', 'отчётов', 'отчётов')} за период, шкала 0–1000.
              </>
            ) : (
              <>
                {points.length} {pluralRu(points.length, 'отчёт', 'отчёта', 'отчётов')} за период, шкала 0–1000.
              </>
            )}{' '}
            Нажмите столбец, чтобы увидеть дату и балл.
          </>
        )}
      </p>

      {/* Text equivalent of the chart for screen readers. */}
      <table className="sr-only">
        <caption>GRI по отчётам за выбранный период</caption>
        <thead>
          <tr>
            <th scope="col">Дата расчёта</th>
            <th scope="col">GRI (0–1000)</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point, index) => (
            <tr key={`${point.date}-sr-${index}`}>
              <td>{formatDateFull(point.date)}</td>
              <td>{formatScore(point.display)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
