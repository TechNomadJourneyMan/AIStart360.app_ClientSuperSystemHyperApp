'use client'

import { formatRuMetricWithUnit, confidenceDotClass } from '@/components/dashboard/_utils'
import { formatUpdatedRu, sourceLabelRu, LOW_CONFIDENCE_THRESHOLD } from './_utils'

export interface MetricCatalogTileProps {
  metricId: string
  label: string
  value: number | string | null
  unit?: string
  confidence: number | null
  source: string | null
  computedAt: string | null
  icon: string
  onOpen: () => void
}

/**
 * One metric in the catalog grid.
 *
 * A real <button>, not a div with role="button": keyboard, focus ring and
 * screen-reader semantics come from the element itself. Shows freshness
 * («обновлено 2 дн назад») so a three-month-old number can't pass for today's.
 */
export function MetricCatalogTile({
  metricId,
  label,
  value,
  unit,
  confidence,
  source,
  computedAt,
  icon,
  onOpen,
}: MetricCatalogTileProps) {
  const isEmpty = value === null || value === undefined || value === ''
  const updated = formatUpdatedRu(computedAt)
  const lowConfidence =
    !isEmpty && confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD

  return (
    <button
      type="button"
      onClick={onOpen}
      data-metric-id={metricId}
      aria-label={
        isEmpty
          ? `${label}: значения нет. Открыть разбор показателя`
          : `${label}: ${formatRuMetricWithUnit(value, unit)}. Открыть разбор показателя`
      }
      className={[
        'group relative w-full rounded-2xl border p-5 text-left transition-all duration-200',
        'bg-surface-container hover:border-primary/40 hover:-translate-y-0.5',
        'focus:outline-none focus:ring-2 focus:ring-primary/40',
        isEmpty ? 'border-white/[0.04] border-dashed' : 'border-white/[0.04]',
      ].join(' ')}
    >
      <span className="mb-3 flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-lg leading-none text-on-surface-variant/70"
          >
            {icon}
          </span>
          <span className="truncate font-mono text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">
            {label}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-base text-on-surface-variant/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
        >
          chevron_right
        </span>
      </span>

      <span className="mb-3 block min-h-[2.25rem]">
        {isEmpty ? (
          <span className="font-mono text-3xl text-on-surface-variant/50">—</span>
        ) : (
          <span className="font-mono text-3xl text-on-surface">
            {formatRuMetricWithUnit(value, unit)}
          </span>
        )}
      </span>

      <span className="flex items-center justify-between gap-2">
        {isEmpty ? (
          <span className="rounded-md border border-dashed border-white/[0.08] px-2 py-0.5 text-xs text-on-surface-variant">
            Нет данных
          </span>
        ) : (
          <span className="font-mono text-[10px] text-on-surface-variant/70">
            {updated ?? 'дата расчёта неизвестна'}
          </span>
        )}
        {!isEmpty && source && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-on-surface-variant">
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${confidenceDotClass(confidence)}`}
            />
            <span className="uppercase tracking-[0.15em]">{sourceLabelRu(source)}</span>
          </span>
        )}
      </span>

      {lowConfidence && (
        <span className="mt-2 block font-mono text-[10px] text-tertiary-container">
          низкая уверенность — стоит проверить
        </span>
      )}
    </button>
  )
}

export default MetricCatalogTile
