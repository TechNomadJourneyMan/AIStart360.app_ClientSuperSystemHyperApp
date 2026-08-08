'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useFullMetricCatalog, type CatalogItem } from './useFullMetricCatalog'
import {
  CATALOG_ANCHOR_ID,
  NAMESPACE_TABS,
  type CatalogFilters,
  type Namespace,
} from './_utils'

// ============================================================
// MetricsCoveragePanel — the «Все метрики» tab.
//
// The tab used to hold a single info card saying "смотрите каталог выше",
// which is neither new information nor a way anywhere. It now answers the
// one question the tile grid can't: сколько показателей вообще заполнено и
// где именно дыры — with buttons that drive the catalog filter above.
// ============================================================

export interface MetricsCoveragePanelProps {
  filters: CatalogFilters
  onFiltersChange: (patch: Partial<CatalogFilters>) => void
}

interface CoverageRow {
  key: string
  label: string
  total: number
  filled: number
  apply: Partial<CatalogFilters>
  applyGaps: Partial<CatalogFilters>
}

function hasValue(item: CatalogItem): boolean {
  return item.value !== null && item.value !== undefined && item.value !== ''
}

function scrollToCatalog() {
  if (typeof document === 'undefined') return
  document.getElementById(CATALOG_ANCHOR_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function CoverageBar({ filled, total }: { filled: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((filled / total) * 100)
  const tone = pct >= 70 ? 'bg-primary' : pct >= 30 ? 'bg-tertiary-container' : 'bg-error'
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
      <span className={`block h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </span>
  )
}

export function MetricsCoveragePanel({ filters, onFiltersChange }: MetricsCoveragePanelProps) {
  const { data, isLoading, isError, error, refetch } = useFullMetricCatalog()
  const items = useMemo(() => data ?? [], [data])

  const namespaceRows = useMemo<CoverageRow[]>(() => {
    return NAMESPACE_TABS.filter((tab) => tab.value !== 'all').map((tab) => {
      const subset = items.filter((it) => it.namespace === (tab.value as Exclude<Namespace, 'all'>))
      return {
        key: tab.value,
        label: tab.label,
        total: subset.length,
        filled: subset.filter(hasValue).length,
        apply: { namespace: tab.value, department: null, data: 'all' as const },
        applyGaps: { namespace: tab.value, department: null, data: 'without_value' as const },
      }
    })
  }, [items])

  const departmentRows = useMemo<CoverageRow[]>(() => {
    const map = new Map<string, CatalogItem[]>()
    for (const it of items) {
      if (it.namespace !== 'biz' || !it.department) continue
      const list = map.get(it.department) ?? []
      list.push(it)
      map.set(it.department, list)
    }
    return Array.from(map.entries())
      .map(([name, subset]) => ({
        key: name,
        label: name,
        total: subset.length,
        filled: subset.filter(hasValue).length,
        apply: { namespace: 'biz' as const, department: name, data: 'all' as const },
        applyGaps: { namespace: 'biz' as const, department: name, data: 'without_value' as const },
      }))
      .sort((a, b) => a.filled / Math.max(1, a.total) - b.filled / Math.max(1, b.total))
  }, [items])

  const totalFilled = items.filter(hasValue).length

  function applyAndScroll(patch: Partial<CatalogFilters>) {
    onFiltersChange({ ...patch, page: 1 })
    scrollToCatalog()
  }

  function renderRows(rows: CoverageRow[]) {
    return (
      <ul className="space-y-2">
        {rows.map((row) => {
          const gaps = row.total - row.filled
          return (
            <li
              key={row.key}
              className="rounded-xl border border-white/[0.04] bg-surface-container p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-on-surface">{row.label}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-on-surface-variant">
                    заполнено {row.filled} из {row.total}
                  </p>
                </div>
                <div className="flex flex-shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => applyAndScroll(row.apply)}
                    aria-label={`Показать в каталоге: ${row.label}`}
                    className="rounded-xl border border-white/[0.06] px-3 py-1.5 font-mono text-[11px] text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    Показать
                  </button>
                  <button
                    type="button"
                    disabled={gaps === 0}
                    onClick={() => applyAndScroll(row.applyGaps)}
                    aria-label={`Показать незаполненные показатели: ${row.label}`}
                    className="rounded-xl border border-error/20 px-3 py-1.5 font-mono text-[11px] text-error transition-colors hover:bg-error/10 focus:outline-none focus:ring-2 focus:ring-error/40 disabled:cursor-not-allowed disabled:border-white/[0.04] disabled:text-on-surface-variant/40 disabled:hover:bg-transparent"
                  >
                    Пробелы: {gaps}
                  </button>
                </div>
              </div>
              <div className="mt-3">
                <CoverageBar filled={row.filled} total={row.total} />
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-error/30 bg-error/[0.04] p-5 text-sm text-on-surface">
        <p className="mb-3">
          {error instanceof Error ? error.message : 'Не удалось загрузить каталог метрик'}
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-error/30 px-3 py-1.5 font-mono text-xs text-error hover:bg-error/10 focus:outline-none focus:ring-2 focus:ring-error/40"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-base">refresh</span>
          Повторить
        </button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl border border-white/[0.04] bg-surface-container" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-5">
        <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-on-surface-variant/60">
          Покрытие данными
        </p>
        <p className="font-mono text-2xl font-bold text-on-surface">
          {totalFilled} <span className="text-base text-on-surface-variant">из {items.length}</span>
        </p>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-on-surface-variant">
          Показатель считается заполненным, если резолвер нашёл значение в анкете Точки А, в
          загруженных документах или во внешней системе. Пустые — это не ошибка, а список того,
          каких исходных данных пока не хватает.
        </p>
        {totalFilled < items.length && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => applyAndScroll({ namespace: 'all', department: null, data: 'without_value' })}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.06] px-4 py-2 font-mono text-xs text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-base">filter_alt</span>
              Показать все пробелы ({items.length - totalFilled})
            </button>
            <Link
              href="/point-a"
              className="inline-flex items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-bold text-primary transition-colors hover:bg-primary/15 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-base">edit_note</span>
              Дозаполнить Точку А
            </Link>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-3 font-headline text-base font-bold text-on-surface">По группам</h3>
        {renderRows(namespaceRows)}
      </div>

      {departmentRows.length > 0 && (
        <div>
          <h3 className="mb-1 font-headline text-base font-bold text-on-surface">
            По отделам · бизнес-метрики
          </h3>
          <p className="mb-3 text-xs text-on-surface-variant">
            Отделы отсортированы от самых пустых к самым заполненным.
          </p>
          {renderRows(departmentRows)}
        </div>
      )}

      <p className="font-mono text-[10px] text-on-surface-variant/60">
        Активный фильтр каталога: {filters.namespace === 'all' ? 'все группы' : filters.namespace}
        {filters.department ? ` · ${filters.department}` : ''}
      </p>
    </div>
  )
}

export default MetricsCoveragePanel
