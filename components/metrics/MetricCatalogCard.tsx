'use client'

/**
 * MetricCatalogCard — one metric in the «Метрики» catalog.
 *
 * value + unit · delta (arrow, colour by direction) · target with progress ·
 * benchmark with its source label · status chip · confidence dot · source ·
 * period · last update · provenance badge. Missing parts are omitted or say
 * «нет данных» — nothing is filled in for display.
 *
 * Stateless (no hooks) → unit-testable by calling it as a function.
 */

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { ProvenanceBadge } from '@/components/common/ProvenanceBadge'
import { confidenceDotClass, formatRuMetricWithUnit, formatRuRelativeTime } from '@/components/dashboard/_utils'
import {
  BENCHMARK_KIND_LABEL,
  CATEGORY_ICONS,
  STATUS_META,
  deltaTone,
  formatItemValue,
  isLowerBetter,
  sourceLabel,
  targetPeriodLabel,
  targetProgress,
  type CatalogItem,
} from './catalog-model'

export interface MetricCatalogCardProps {
  item: CatalogItem
  onOpen?: (item: CatalogItem) => void
  /** Inject «now» for deterministic tests. */
  now?: Date
}

function fmtDeltaAbs(delta: number, unit: string): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : ''
  return `${sign}${formatRuMetricWithUnit(Math.abs(delta), unit)}`
}

export function MetricCatalogCard({ item, onOpen, now }: MetricCatalogCardProps) {
  const hasValue = item.value !== null && item.value !== ''
  const status = STATUS_META[item.status] ?? STATUS_META.no_data
  const icon = item.category ? CATEGORY_ICONS[item.category] : 'bar_chart'
  const tone = deltaTone(item)
  const progress = targetProgress(item)
  const progressPct = progress === null ? null : Math.round(progress * 100)
  const valueText = hasValue ? formatItemValue(item) : '—'
  const hasDelta = hasValue && item.valueKind !== 'flag' && (item.deltaPct !== null || item.delta !== null)
  const arrow = item.trend === 'up' ? 'arrow_upward' : item.trend === 'down' ? 'arrow_downward' : 'arrow_forward'
  const toneClass = tone === 'good' ? 'text-primary' : tone === 'bad' ? 'text-error' : 'text-on-surface-variant'
  const updated = item.lastUpdated ? formatRuRelativeTime(item.lastUpdated, now) : null

  const ariaParts = [
    item.label,
    hasValue ? valueText : 'нет данных',
    status.label,
    item.deltaPct !== null ? `изменение ${item.deltaPct > 0 ? '+' : ''}${item.deltaPct.toFixed(1)}%` : null,
  ].filter(Boolean)

  const interactive = Boolean(onOpen)

  return (
    <motion.div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `${ariaParts.join(', ')}. Открыть подробности` : undefined}
      onClick={interactive ? () => onOpen!(item) : undefined}
      onKeyDown={
        interactive
          ? (e: React.KeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpen!(item)
              }
            }
          : undefined
      }
      whileHover={interactive ? { y: -2 } : undefined}
      data-metric-id={item.id}
      data-status={item.status}
      className={cn(
        'group relative flex flex-col rounded-2xl border border-white/[0.04] bg-surface-container p-4 sm:p-5 shadow-card transition-colors',
        interactive && 'cursor-pointer hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/40',
        item.status === 'off_track' && 'border-error/20',
        item.status === 'at_risk' && 'border-tertiary-container/20',
      )}
    >
      {/* Top: icon + label · status */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="material-symbols-outlined text-lg leading-none text-on-surface-variant/70" aria-hidden="true">
            {icon}
          </span>
          <p className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-on-surface-variant" title={item.label}>
            {item.label}
          </p>
        </div>
        <span
          className={cn(
            'flex-shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em]',
            status.chip,
          )}
        >
          {status.label}
        </span>
      </div>

      {/* Value + delta */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cn('font-mono text-2xl sm:text-3xl leading-none', hasValue ? 'text-on-surface' : 'text-on-surface-variant/60')}>
          {valueText}
        </span>
        {hasDelta && (
          <span className={cn('inline-flex items-center gap-0.5 font-mono text-xs', toneClass)} data-delta-tone={tone}>
            <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">
              {arrow}
            </span>
            {item.deltaPct !== null ? `${item.deltaPct > 0 ? '+' : ''}${item.deltaPct.toFixed(1)}%` : null}
            {item.delta !== null && (
              <span className="ml-1 text-on-surface-variant">({fmtDeltaAbs(item.delta, item.unit)})</span>
            )}
          </span>
        )}
      </div>
      {!hasValue && (
        <p className="mt-1.5 text-[11px] text-on-surface-variant">
          Нет данных — заполните анкету или загрузите документ
        </p>
      )}

      {/* Target + benchmark */}
      {(item.target || item.benchmark) && (
        <div className="mt-3 space-y-2">
          {item.target && (
            <div>
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="text-on-surface-variant">
                  Цель{item.target.periodLabel ? ` · ${targetPeriodLabel(item.target.periodLabel)}` : ''}
                  {isLowerBetter(item) ? ' · ниже — лучше' : ''}
                </span>
                <span className="font-mono text-on-surface">
                  {formatRuMetricWithUnit(item.target.value, item.unit)}
                  {progressPct !== null && <span className="ml-1 text-on-surface-variant">· {progressPct}%</span>}
                </span>
              </div>
              {progressPct !== null && (
                <div
                  className="mt-1 h-1 overflow-hidden rounded-full bg-surface-container-high"
                  role="progressbar"
                  aria-label={`Достижение цели: ${progressPct}%`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPct}
                >
                  <div
                    className={cn(
                      'h-full rounded-full',
                      item.status === 'off_track' ? 'bg-error' : item.status === 'at_risk' ? 'bg-tertiary-container' : 'bg-primary',
                    )}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              )}
            </div>
          )}
          {item.benchmark && (
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="truncate text-on-surface-variant" title={item.benchmark.label}>
                Ориентир · {BENCHMARK_KIND_LABEL[item.benchmark.kind] ?? item.benchmark.label}
              </span>
              <span className="flex-shrink-0 font-mono text-on-surface">
                {formatRuMetricWithUnit(item.benchmark.value, item.benchmark.unit || item.unit)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Footer: provenance */}
      <div className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pt-3 text-[10px] font-mono text-on-surface-variant">
        {hasValue && (
          <span className="inline-flex items-center gap-1.5" title={item.confidence !== null ? `Уверенность ${Math.round(item.confidence * 100)}%` : 'Уверенность неизвестна'}>
            <span className={cn('h-2 w-2 rounded-full', confidenceDotClass(item.confidence))} aria-hidden="true" />
            <span className="uppercase tracking-[0.12em]">{sourceLabel(item.source)}</span>
            {item.confidence !== null && <span className="sr-only">, уверенность {Math.round(item.confidence * 100)}%</span>}
          </span>
        )}
        {item.period && <span>· {item.period}</span>}
        {updated && <span title={item.lastUpdated ?? undefined}>· {updated}</span>}
        {item.provenanceType && (
          <span className="ml-auto">
            <ProvenanceBadge type={item.provenanceType} confidence={item.confidence} focusable={false} />
          </span>
        )}
      </div>
    </motion.div>
  )
}

export default MetricCatalogCard
