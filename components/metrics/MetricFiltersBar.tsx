'use client'

/**
 * MetricFiltersBar — status / source / min confidence / period filters for
 * the «Метрики» catalog. Collapsible on mobile («Фильтры · N»), always open
 * from md up. Pure controlled component.
 */

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { MetricStatus } from '@/types/metric-catalog'
import {
  CONFIDENCE_OPTIONS,
  PERIOD_ANY,
  PERIOD_NONE,
  SOURCE_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
  STATUS_META,
  activeFilterCount,
  type CatalogClientFilters,
  type SourceBucket,
} from './catalog-model'

export interface MetricFiltersBarProps {
  filters: CatalogClientFilters
  periods: string[]
  /** Items per status in the current category (before the status filter). */
  statusCounts?: Partial<Record<MetricStatus, number>>
  onChange: (next: CatalogClientFilters) => void
  onReset: () => void
}

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

const CHIP =
  'inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40'
const CHIP_OFF = 'border-white/[0.06] bg-surface-container text-on-surface-variant hover:border-white/15 hover:text-on-surface'
const CHIP_ON = 'border-primary/40 bg-primary/15 text-primary'
const GROUP_LABEL = 'text-[10px] font-mono uppercase tracking-[0.18em] text-on-surface-variant/80'

export function MetricFiltersBar({ filters, periods, statusCounts, onChange, onReset }: MetricFiltersBarProps) {
  const [open, setOpen] = useState(false)
  const active = activeFilterCount(filters)

  return (
    <div className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 md:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="metric-filters-panel"
          className="inline-flex items-center gap-1.5 rounded-xl px-1 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            tune
          </span>
          Фильтры{active > 0 ? ` · ${active}` : ''}
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
            {open ? 'expand_less' : 'expand_more'}
          </span>
        </button>
        {active > 0 && (
          <button type="button" onClick={onReset} className="text-xs font-mono text-primary hover:text-primary/80">
            Сбросить
          </button>
        )}
      </div>

      <div
        id="metric-filters-panel"
        className={cn('mt-3 grid grid-cols-1 gap-x-6 gap-y-3 md:mt-0 md:grid-cols-2', !open && 'hidden md:grid')}
      >
        <fieldset className="min-w-0">
          <legend className={cn(GROUP_LABEL, 'mb-1.5')}>Статус</legend>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTER_OPTIONS.map((o) => {
              const on = filters.statuses.includes(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ ...filters, statuses: toggle<MetricStatus>(filters.statuses, o.value) })}
                  className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_META[o.value].dot)} aria-hidden="true" />
                  {o.label}
                  {typeof statusCounts?.[o.value] === 'number' && (
                    <span className="font-mono opacity-70">{statusCounts[o.value]}</span>
                  )}
                </button>
              )
            })}
          </div>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className={cn(GROUP_LABEL, 'mb-1.5')}>Источник</legend>
          <div className="flex flex-wrap gap-1.5">
            {SOURCE_FILTER_OPTIONS.map((o) => {
              const on = filters.sources.includes(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ ...filters, sources: toggle<SourceBucket>(filters.sources, o.value) })}
                  className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className={cn(GROUP_LABEL, 'mb-1.5')}>Мин. уверенность</legend>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Минимальная уверенность">
            {CONFIDENCE_OPTIONS.map((o) => {
              const on = filters.minConfidence === o.value
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onChange({ ...filters, minConfidence: o.value })}
                  className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </fieldset>

        <div className="flex min-w-0 items-end justify-between gap-3">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={GROUP_LABEL}>Период значения</span>
            <select
              value={filters.period}
              onChange={(e) => onChange({ ...filters, period: e.target.value })}
              className="rounded-xl border border-white/[0.06] bg-surface-container px-2.5 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value={PERIOD_ANY}>Любой</option>
              {periods.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value={PERIOD_NONE}>Без периода</option>
            </select>
          </label>
          {active > 0 && (
            <button
              type="button"
              onClick={onReset}
              className="hidden md:inline-flex items-center gap-1 rounded-xl px-2 py-1 text-xs font-mono text-primary hover:text-primary/80 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                filter_alt_off
              </span>
              Сбросить ({active})
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default MetricFiltersBar
