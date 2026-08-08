'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'

import MetricSearchBox from './MetricSearchBox'
import DepartmentChips from './DepartmentChips'
import MetricSortToggle from './MetricSortToggle'
import NamespaceTabs from './NamespaceTabs'
import MetricCatalogTile from './MetricCatalogTile'
import { useFullMetricCatalog, type CatalogItem } from './useFullMetricCatalog'
import {
  CATALOG_ANCHOR_ID,
  DATA_FILTERS,
  DEFAULT_CATALOG_FILTERS,
  LOW_CONFIDENCE_THRESHOLD,
  formatUpdatedRu,
  sourceLabelRu,
  namespaceLabelRu,
  pluralRu,
  type CatalogFilters,
  type CatalogView,
  type Namespace,
} from './_utils'
import { formatRuMetricWithUnit, confidenceDotClass } from '@/components/dashboard/_utils'
import { useRealtimeMetrics } from '@/hooks/useRealtimeMetrics'

// recharts lives inside the drill-down modal — load it lazily so it stays out
// of the /metrics first-load JS. Same for the 171 KB descriptions catalog,
// which is imported dynamically once a drill-down opens (see effect below).
const MetricDrillDownModalV2 = dynamic(
  () => import('@/components/dashboard/MetricDrillDownModalV2'),
  { ssr: false },
)

const PAGE_SIZE = 30

const NAMESPACE_ICON: Record<CatalogItem['namespace'], string> = {
  biz: 'analytics',
  kpi: 'leaderboard',
  gri: 'radar',
  goal: 'flag',
}

export interface MetricsLiveCatalogProps {
  /** Realtime rows in `public.metrics` are scoped by company_id, not user_id. */
  companyId?: string | null
  filters: CatalogFilters
  onFiltersChange: (patch: Partial<CatalogFilters>) => void
}

function numericValue(v: number | string | null): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function compareNullsLast(
  a: number | null,
  b: number | null,
  direction: 'asc' | 'desc',
): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return direction === 'asc' ? a - b : b - a
}

function hasValue(item: CatalogItem): boolean {
  return item.value !== null && item.value !== undefined && item.value !== ''
}

export default function MetricsLiveCatalog({
  companyId,
  filters,
  onFiltersChange,
}: MetricsLiveCatalogProps) {
  const qc = useQueryClient()
  const { data, isLoading, isError, error, refetch, isFetching } = useFullMetricCatalog()

  const [drillItem, setDrillItem] = useState<CatalogItem | null>(null)
  const [showEmptyAnyway, setShowEmptyAnyway] = useState(false)

  // Realtime invalidation — needs the company id, the metrics table is keyed by it.
  useRealtimeMetrics(companyId ?? null)

  const all = useMemo(() => data ?? [], [data])

  // ── Auto-materialize when the whole catalog resolves to null ──────────────
  // Single-shot per mount. `no_company` is not a failure — it means the user
  // has no company row yet, which the empty state explains.
  const materializeAttempted = useRef(false)
  const [materializeStatus, setMaterializeStatus] = useState<
    'idle' | 'running' | 'done' | 'error' | 'no_company'
  >('idle')
  const [materializeWritten, setMaterializeWritten] = useState<number | null>(null)

  async function runMaterialize(force = false) {
    if (!force && materializeAttempted.current) return
    materializeAttempted.current = true
    setMaterializeStatus('running')
    setMaterializeWritten(null)
    try {
      const res = await fetch('/api/v1/metrics/materialize', {
        method: 'POST',
        cache: 'no-store',
      })
      const json = (await res.json()) as
        | { ok: true; data: { written: number; total: number; skipped: number } }
        | { ok: false; error: string }
      if (!json.ok) {
        if (json.error === 'no_company') {
          setMaterializeStatus('no_company')
          return
        }
        throw new Error(json.error)
      }
      await qc.invalidateQueries({ queryKey: ['metrics-catalog'] })
      await refetch()
      setMaterializeWritten(json.data.written)
      setMaterializeStatus('done')
    } catch (err) {
      console.error('[metrics] materialize failed', err)
      setMaterializeStatus('error')
    }
  }

  useEffect(() => {
    if (materializeAttempted.current) return
    if (isLoading || isError) return
    if (all.length === 0) return
    if (all.every((it) => !hasValue(it))) void runMaterialize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, isLoading, isError])

  // The "Готово" confirmation is a transient acknowledgement, not a status.
  useEffect(() => {
    if (materializeStatus !== 'done') return
    const timer = setTimeout(() => setMaterializeStatus('idle'), 5_000)
    return () => clearTimeout(timer)
  }, [materializeStatus])

  // ── Facets: real counts over the whole catalog, honouring the text search ──
  const searchMatched = useMemo(() => {
    const needle = filters.search.trim().toLowerCase()
    if (!needle) return all
    return all.filter(
      (it) =>
        it.label.toLowerCase().includes(needle) || it.id.toLowerCase().includes(needle),
    )
  }, [all, filters.search])

  const counts = useMemo<Record<Namespace, number>>(() => {
    const base: Record<Namespace, number> = { all: 0, biz: 0, kpi: 0, gri: 0, goal: 0 }
    for (const it of searchMatched) {
      base.all += 1
      base[it.namespace] += 1
    }
    return base
  }, [searchMatched])

  const departments = useMemo(() => {
    const map = new Map<string, number>()
    for (const it of searchMatched) {
      if (!it.department) continue
      if (filters.namespace !== 'all' && it.namespace !== filters.namespace) continue
      map.set(it.department, (map.get(it.department) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [searchMatched, filters.namespace])

  // Everything the current namespace + department selection allows, before the
  // data-availability filter — so the chip counters describe the set the user
  // is actually looking at.
  const scoped = useMemo(() => {
    let out = searchMatched
    if (filters.namespace !== 'all') out = out.filter((it) => it.namespace === filters.namespace)
    if (filters.department) out = out.filter((it) => it.department === filters.department)
    return out
  }, [searchMatched, filters.namespace, filters.department])

  const dataCounts = useMemo(() => {
    let withValue = 0
    let withoutValue = 0
    let low = 0
    for (const it of scoped) {
      if (hasValue(it)) {
        withValue += 1
        if (it.confidence !== null && it.confidence < LOW_CONFIDENCE_THRESHOLD) low += 1
      } else {
        withoutValue += 1
      }
    }
    return { all: scoped.length, with_value: withValue, without_value: withoutValue, low_confidence: low }
  }, [scoped])

  // ── Filter + sort + paginate, all on the client ───────────────────────────
  const filtered = useMemo(() => {
    if (filters.data === 'with_value') return scoped.filter(hasValue)
    if (filters.data === 'without_value') return scoped.filter((it) => !hasValue(it))
    if (filters.data === 'low_confidence') {
      return scoped.filter(
        (it) => hasValue(it) && it.confidence !== null && it.confidence < LOW_CONFIDENCE_THRESHOLD,
      )
    }
    return scoped
  }, [scoped, filters.data])

  const sorted = useMemo(() => {
    const arr = filtered.slice()
    switch (filters.sort) {
      case 'label_desc':
        arr.sort((a, b) => b.label.localeCompare(a.label, 'ru'))
        break
      case 'value_desc':
        arr.sort((a, b) => compareNullsLast(numericValue(a.value), numericValue(b.value), 'desc'))
        break
      case 'value_asc':
        arr.sort((a, b) => compareNullsLast(numericValue(a.value), numericValue(b.value), 'asc'))
        break
      case 'confidence_desc':
        arr.sort((a, b) => compareNullsLast(a.confidence, b.confidence, 'desc'))
        break
      case 'freshness_desc':
        arr.sort((a, b) =>
          compareNullsLast(
            a.computedAt ? Date.parse(a.computedAt) : null,
            b.computedAt ? Date.parse(b.computedAt) : null,
            'desc',
          ),
        )
        break
      // 'trend_up' / 'trend_down' are disabled in the picker — nothing stores a
      // value history yet, so there is nothing honest to sort by.
      default:
        arr.sort((a, b) => a.label.localeCompare(b.label, 'ru'))
    }
    return arr
  }, [filtered, filters.sort])

  const total = sorted.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = Math.min(filters.page, totalPages)
  const pageItems = useMemo(
    () => sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [sorted, page],
  )

  const catalogAllEmpty = all.length > 0 && all.every((it) => !hasValue(it))
  const filtersActive =
    filters.namespace !== 'all' ||
    filters.department !== null ||
    filters.search !== '' ||
    filters.data !== 'all'

  function resetFilters() {
    onFiltersChange({
      namespace: DEFAULT_CATALOG_FILTERS.namespace,
      department: DEFAULT_CATALOG_FILTERS.department,
      search: DEFAULT_CATALOG_FILTERS.search,
      data: DEFAULT_CATALOG_FILTERS.data,
      sort: DEFAULT_CATALOG_FILTERS.sort,
      page: 1,
    })
  }

  // ── Drill-down payload ────────────────────────────────────────────────────
  const [drillDescription, setDrillDescription] = useState<
    { what: string; why: string; how: string } | undefined
  >(undefined)

  useEffect(() => {
    if (!drillItem) {
      setDrillDescription(undefined)
      return
    }
    let cancelled = false
    void import('@/lib/metrics/descriptions').then(
      ({ getBizDescription, getKpiDescription, getGriDescription }) => {
        if (cancelled) return
        let d: { what: string; why: string; how: string } | undefined
        if (drillItem.namespace === 'biz' && drillItem.department) {
          d = getBizDescription(drillItem.department, drillItem.label)
        } else if (drillItem.namespace === 'kpi') {
          d = getKpiDescription(drillItem.label)
        } else if (drillItem.namespace === 'gri') {
          d = getGriDescription(drillItem.label)
        }
        if (!d) {
          setDrillDescription(undefined)
          return
        }
        // `current_state` from the descriptions catalog is deliberately dropped:
        // it holds demo numbers ("₸84.2М при цели ₸110М"), identical for every
        // user. Showing it as "Текущее состояние" would be a fabricated fact.
        const how = drillItem.formula
          ? `${d.how}\n\nФормула из реестра: ${drillItem.formula}`
          : d.how
        setDrillDescription({ what: d.what, why: d.why, how })
      },
    )
    return () => {
      cancelled = true
    }
  }, [drillItem])

  const drillProvenance = useMemo(() => {
    if (!drillItem) return undefined
    const considered = drillItem.sources.map((s) => ({
      type: s.type,
      label:
        s.type === 'survey'
          ? `Анкета: ${s.key ?? ''}`
          : s.type === 'document'
            ? `Документ (${s.doc_type ?? '—'}) поле ${s.field ?? '—'}`
            : s.type === 'prisma'
              ? 'БД'
              : s.type === 'external'
                ? `Внешний: ${s.system ?? '—'}`
                : s.type,
      status: (drillItem.source === s.type ? 'hit' : 'miss') as 'hit' | 'miss' | 'error',
      confidence: drillItem.source === s.type ? (drillItem.confidence ?? undefined) : undefined,
    }))
    const picked = considered.find((c) => c.status === 'hit')
    return {
      picked: picked ? { type: picked.type, label: picked.label } : null,
      considered,
      computedAt: drillItem.computedAt ?? undefined,
    }
  }, [drillItem])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section
      id={CATALOG_ANCHOR_ID}
      data-tour="metrics-catalog"
      className="space-y-5 scroll-mt-24"
    >
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-outline-variant/10 pb-4">
        <div>
          <p className="mb-1 font-mono text-xs uppercase tracking-[0.2em] text-primary/70">
            Каталог метрик · Real-time
          </p>
          <h2 className="font-headline text-xl font-bold text-on-surface">
            {isLoading ? 'Точка А: загружаем показатели…' : `Точка А: ${all.length} ${pluralRu(all.length, ['показатель', 'показателя', 'показателей'])}`}
          </h2>
          <p className="mt-1 font-mono text-xs text-on-surface-variant" aria-live="polite">
            Найдено: <span className="text-primary">{total}</span>
            {totalPages > 1 && <> · страница {page}/{totalPages}</>}
            {dataCounts.all > 0 && (
              <> · с данными {dataCounts.with_value} из {dataCounts.all}</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isFetching && !isLoading && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.04] bg-surface-container px-2.5 py-1 font-mono text-[10px] text-on-surface-variant">
              <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[12px]">
                progress_activity
              </span>
              Обновляем…
            </span>
          )}
          {materializeStatus === 'done' && (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 font-mono text-[10px] text-primary"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[12px]">check_circle</span>
              Готово{materializeWritten !== null ? `: обновлено ${materializeWritten}` : ''}
            </span>
          )}
          {materializeStatus === 'error' && (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 rounded-full border border-error/20 bg-error/5 px-2.5 py-1 font-mono text-[10px] text-error"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[12px]">error</span>
              Не удалось рассчитать
              <button
                type="button"
                onClick={() => void runMaterialize(true)}
                className="underline underline-offset-2 hover:no-underline focus:outline-none focus:ring-2 focus:ring-error/40"
              >
                Повторить
              </button>
            </span>
          )}

          {/* View switcher */}
          <div role="group" aria-label="Вид каталога" className="inline-flex rounded-xl border border-white/[0.04] bg-surface-container p-0.5">
            {([
              { value: 'grid' as CatalogView, icon: 'grid_view', label: 'Плитки' },
              { value: 'table' as CatalogView, icon: 'table_rows', label: 'Таблица' },
            ]).map((mode) => (
              <button
                key={mode.value}
                type="button"
                aria-pressed={filters.view === mode.value}
                aria-label={`Вид: ${mode.label}`}
                onClick={() => onFiltersChange({ view: mode.value, page })}
                className={
                  filters.view === mode.value
                    ? 'inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-2.5 py-1.5 font-mono text-xs text-primary focus:outline-none focus:ring-2 focus:ring-primary/40'
                    : 'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-mono text-xs text-on-surface-variant hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40'
                }
              >
                <span aria-hidden="true" className="material-symbols-outlined text-base">{mode.icon}</span>
                {mode.label}
              </button>
            ))}
          </div>

          <MetricSortToggle value={filters.sort} onChange={(sort) => onFiltersChange({ sort })} />

          <button
            type="button"
            onClick={() => void runMaterialize(true)}
            disabled={materializeStatus === 'running'}
            aria-label="Пересчитать значения метрик"
            aria-busy={materializeStatus === 'running'}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.04] px-3 py-2 font-mono text-xs text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-white/[0.04] disabled:hover:text-on-surface-variant"
          >
            <span
              aria-hidden="true"
              className={`material-symbols-outlined text-base${materializeStatus === 'running' ? ' animate-spin' : ''}`}
            >
              {materializeStatus === 'running' ? 'progress_activity' : 'refresh'}
            </span>
            {materializeStatus === 'running' ? 'Считаем…' : 'Пересчитать'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <NamespaceTabs
        value={filters.namespace}
        counts={counts}
        onChange={(namespace) => onFiltersChange({ namespace, department: null })}
      />

      <div className="space-y-3">
        <MetricSearchBox
          value={filters.search}
          onChange={(search) => onFiltersChange({ search })}
          resultsCount={total}
        />

        <div role="group" aria-label="Фильтр по наличию данных" className="flex flex-wrap gap-2">
          {DATA_FILTERS.map((option) => {
            const isActive = filters.data === option.value
            const count = dataCounts[option.value]
            return (
              <button
                key={option.value}
                type="button"
                data-chip="data-filter"
                aria-pressed={isActive}
                onClick={() => onFiltersChange({ data: option.value })}
                className={
                  isActive
                    ? 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-primary/40 bg-primary/15 px-3 py-1.5 text-sm text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40'
                    : 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/[0.04] bg-surface-container px-3 py-1.5 text-sm text-on-surface-variant transition-colors hover:border-white/15 focus:outline-none focus:ring-2 focus:ring-primary/40'
                }
              >
                <span>{option.label}</span>
                <span aria-hidden="true" className="font-mono text-xs opacity-70">{count}</span>
              </button>
            )
          })}
        </div>

        {departments.length > 0 && (
          <DepartmentChips
            departments={departments}
            selected={filters.department}
            onSelect={(department) => onFiltersChange({ department })}
          />
        )}

        {filtersActive && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant/60">
              Активные фильтры
            </span>
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-full border border-white/[0.06] px-2.5 py-1 font-mono text-[10px] text-on-surface-variant hover:border-primary/40 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              Сбросить всё
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      {isError ? (
        <div className="rounded-xl border border-error/30 bg-error/[0.04] p-5 text-sm text-on-surface">
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
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-36 animate-pulse rounded-2xl border border-white/[0.04] bg-surface-container"
            />
          ))}
        </div>
      ) : catalogAllEmpty && !showEmptyAnyway ? (
        <div className="rounded-2xl border border-dashed border-white/[0.08] bg-surface-container-low p-10 text-center">
          <span aria-hidden="true" className="mb-3 block text-4xl text-on-surface-variant/30 material-symbols-outlined">
            hourglass_empty
          </span>
          <p className="mb-1 text-sm font-medium text-on-surface">
            Значений пока нет ни у одного из {all.length} показателей
          </p>
          <p className="mx-auto mb-5 max-w-lg text-xs leading-relaxed text-on-surface-variant/80">
            {materializeStatus === 'no_company'
              ? 'В системе ещё нет карточки вашей компании — значения считать не из чего. Заполните анкету Точки А: выручка, расходы, команда, продажи. После этого показатели рассчитаются автоматически.'
              : 'Каталог показателей построен, но подставить в него нечего: не заполнены ответы анкеты Точки А и не загружены документы (P&L, выписки). Как только появятся исходные данные — значения посчитаются сами.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/point-a"
              className="inline-flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/10 px-5 py-2.5 text-sm font-bold text-primary transition-colors hover:bg-primary/15 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-base">play_arrow</span>
              Заполнить Точку А
            </Link>
            <button
              type="button"
              onClick={() => setShowEmptyAnyway(true)}
              className="rounded-xl border border-white/[0.06] px-4 py-2.5 font-mono text-xs text-on-surface-variant hover:border-white/15 hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              Показать список показателей
            </button>
          </div>
        </div>
      ) : pageItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.06] bg-surface-container-low p-12 text-center">
          <span aria-hidden="true" className="mb-3 block text-3xl text-on-surface-variant/40 material-symbols-outlined">
            search_off
          </span>
          <p className="text-sm text-on-surface-variant">Метрик по фильтрам не найдено</p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-3 font-mono text-xs text-primary hover:text-primary/80 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            Сбросить фильтры и сортировку
          </button>
        </div>
      ) : filters.view === 'table' ? (
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_2rem] gap-3 border-b border-white/[0.06] px-4 pb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-on-surface-variant/60">
              <span>Показатель</span>
              <span className="text-right">Значение</span>
              <span>Источник</span>
              <span>Обновлено</span>
              <span aria-hidden="true" />
            </div>
            <ul className="divide-y divide-white/[0.04]">
              {pageItems.map((it) => {
                const empty = !hasValue(it)
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => setDrillItem(it)}
                      aria-label={
                        empty
                          ? `${it.label}: значения нет. Открыть разбор показателя`
                          : `${it.label}: ${formatRuMetricWithUnit(it.value, it.unit)}. Открыть разбор показателя`
                      }
                      className="grid w-full grid-cols-[minmax(0,3fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_2rem] items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-white/[0.03] focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-on-surface">{it.label}</span>
                        <span className="block truncate font-mono text-[10px] text-on-surface-variant/60">
                          {namespaceLabelRu(it.namespace)}
                          {it.department ? ` · ${it.department}` : ''}
                        </span>
                      </span>
                      <span
                        className={`text-right font-mono text-sm ${empty ? 'text-on-surface-variant/50' : 'text-on-surface'}`}
                      >
                        {empty ? '—' : formatRuMetricWithUnit(it.value, it.unit)}
                      </span>
                      <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-on-surface-variant">
                        {!empty && (
                          <span
                            aria-hidden="true"
                            className={`h-2 w-2 flex-shrink-0 rounded-full ${confidenceDotClass(it.confidence)}`}
                          />
                        )}
                        <span className="truncate uppercase tracking-[0.15em]">
                          {empty ? 'нет данных' : sourceLabelRu(it.source)}
                        </span>
                      </span>
                      <span className="truncate font-mono text-[10px] text-on-surface-variant/70">
                        {formatUpdatedRu(it.computedAt)?.replace('обновлено ', '') ?? '—'}
                      </span>
                      <span
                        aria-hidden="true"
                        className="material-symbols-outlined text-base text-on-surface-variant/40"
                      >
                        chevron_right
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {pageItems.map((it) => (
            <MetricCatalogTile
              key={it.id}
              metricId={it.id}
              label={it.label}
              value={it.value}
              unit={it.unit}
              confidence={it.confidence}
              source={it.source}
              computedAt={it.computedAt}
              icon={NAMESPACE_ICON[it.namespace]}
              onOpen={() => setDrillItem(it)}
            />
          ))}
        </div>
      )}

      {/* Pagination — hidden while the "no values at all" state is showing */}
      {totalPages > 1 && !isLoading && !isError && !(catalogAllEmpty && !showEmptyAnyway) && (
        <nav aria-label="Страницы каталога" className="flex items-center justify-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => onFiltersChange({ page: Math.max(1, page - 1) })}
            disabled={page === 1}
            aria-label="Предыдущая страница каталога"
            className="rounded-xl border border-white/[0.04] px-3 py-1.5 font-mono text-xs hover:border-primary/40 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-40 disabled:hover:border-white/[0.04] disabled:hover:text-on-surface-variant"
          >
            ‹ Назад
          </button>
          <span aria-live="polite" className="font-mono text-xs text-on-surface-variant">
            Страница {page} из {totalPages}
          </span>
          <button
            type="button"
            onClick={() => onFiltersChange({ page: Math.min(totalPages, page + 1) })}
            disabled={page === totalPages}
            aria-label="Следующая страница каталога"
            className="rounded-xl border border-white/[0.04] px-3 py-1.5 font-mono text-xs hover:border-primary/40 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-40 disabled:hover:border-white/[0.04] disabled:hover:text-on-surface-variant"
          >
            Вперёд ›
          </button>
        </nav>
      )}

      {/* Drill-down */}
      {drillItem && (
        <MetricDrillDownModalV2
          open
          onClose={() => setDrillItem(null)}
          metricId={drillItem.id}
          metricLabel={drillItem.label}
          unit={drillItem.unit}
          description={drillDescription}
          provenance={drillProvenance}
          liveValue={hasValue(drillItem) ? { value: drillItem.value } : undefined}
        />
      )}
    </section>
  )
}
