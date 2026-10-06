'use client'

/**
 * MetricsLiveCatalog — the «Метрики» catalog (level 2 of Point A).
 *
 * Navigation: 13 categories (counts from the API) + subcategory chips for
 * «Цели роста». Filters: status, source, min confidence, period (client-side
 * over the fully-loaded category). Search + sort are server-side (incl. the
 * real «Лучшая / Худшая динамика»). Cards open the drill-down modal.
 *
 * Deep links: /metrics?category=finance&status=off_track,at_risk&source=document
 * (legacy ?zone=red|yellow|green is mapped onto statuses).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import type { MetricCategoryKey, MetricStatus } from '@/types/metric-catalog'
import { useMetricCatalog } from '@/hooks/useMetricCatalog'
import { useRealtimeMetrics } from '@/hooks/useRealtimeMetrics'
import MetricSearchBox from './MetricSearchBox'
import MetricSortToggle from './MetricSortToggle'
import ChipNav from './ChipNav'
import MetricFiltersBar from './MetricFiltersBar'
import MetricCatalogCard from './MetricCatalogCard'
import MetricDrillDownHost from './MetricDrillDownHost'
import type { SortMode } from './_utils'
import {
  CATEGORY_ICONS,
  DEFAULT_CLIENT_FILTERS,
  METRIC_CATEGORY_KEYS,
  SOURCE_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
  applyClientFilters,
  categoryLabel,
  countByCategory,
  isCategoryKey,
  periodOptions,
  subcategoryChips,
  type CatalogClientFilters,
  type CatalogItem,
  type SourceBucket,
} from './catalog-model'

const PAGE = 30

const ZONE_TO_STATUS: Record<string, MetricStatus[]> = {
  red: ['off_track'],
  yellow: ['at_risk'],
  green: ['on_track'],
  neutral: ['no_target', 'no_data'],
}

function filtersFromUrl(params: URLSearchParams | null): {
  category: MetricCategoryKey | 'all'
  filters: CatalogClientFilters
} {
  const category = params?.get('category')
  const statusParam = params?.get('status')
  const zone = params?.get('zone')
  const sourceParam = params?.get('source')
  const validStatus = new Set(STATUS_FILTER_OPTIONS.map((o) => o.value))
  const validSource = new Set(SOURCE_FILTER_OPTIONS.map((o) => o.value))
  const statuses = statusParam
    ? (statusParam.split(',').filter((s) => validStatus.has(s as MetricStatus)) as MetricStatus[])
    : zone && ZONE_TO_STATUS[zone]
      ? ZONE_TO_STATUS[zone]
      : []
  const sources = sourceParam
    ? (sourceParam.split(',').filter((s) => validSource.has(s as SourceBucket)) as SourceBucket[])
    : []
  return {
    category: isCategoryKey(category) ? category : 'all',
    filters: { ...DEFAULT_CLIENT_FILTERS, statuses, sources },
  }
}

interface Props {
  userId?: string | null
  /** Company id — scopes the realtime subscription on `metrics`. */
  companyId?: string | null
}

export default function MetricsLiveCatalog({ companyId = null }: Props) {
  const qc = useQueryClient()
  const searchParams = useSearchParams()
  const initial = useMemo(() => filtersFromUrl(searchParams), [searchParams])

  const [category, setCategory] = useState<MetricCategoryKey | 'all'>(initial.category)
  const [filters, setFilters] = useState<CatalogClientFilters>(initial.filters)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('label_asc')
  const [visible, setVisible] = useState(PAGE)
  const [drillItem, setDrillItem] = useState<CatalogItem | null>(null)

  // Deep links can change while the page is open (e.g. a zone link).
  useEffect(() => {
    setCategory(initial.category)
    setFilters(initial.filters)
  }, [initial])

  useEffect(() => {
    setVisible(PAGE)
  }, [category, filters, search, sort])

  const { data, isLoading, isError, error, refetch, isFetching, isPlaceholderData } = useMetricCatalog({
    category,
    search,
    sort,
  })
  useRealtimeMetrics(companyId)

  const items = useMemo(() => data?.items ?? [], [data])

  // ── Auto-materialize once when every value is empty ──────────────────────
  const materializeAttempted = useRef(false)
  const [materializeStatus, setMaterializeStatus] = useState<'idle' | 'running' | 'error'>('idle')

  const runMaterialize = useCallback(
    async (force = false) => {
      if (!force && materializeAttempted.current) return
      materializeAttempted.current = true
      setMaterializeStatus('running')
      try {
        const res = await fetch('/api/v1/metrics/materialize', { method: 'POST', cache: 'no-store' })
        const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
        if (!json?.ok) {
          // `no_company` is an expected empty state, not a failure.
          if (json?.error === 'no_company') {
            setMaterializeStatus('idle')
            return
          }
          throw new Error(json?.error ?? 'materialize failed')
        }
        await qc.invalidateQueries({ queryKey: ['metrics-catalog'] })
        setMaterializeStatus('idle')
      } catch (err) {
        console.error('[metrics] materialize failed', err)
        setMaterializeStatus('error')
      }
    },
    [qc],
  )

  useEffect(() => {
    if (materializeAttempted.current || isLoading || isError) return
    if (category !== 'all' || search) return
    if (items.length > 0 && items.every((it) => it.value === null)) void runMaterialize()
  }, [items, isLoading, isError, category, search, runMaterialize])

  // ── Category counts (API first; else counted from the full «Все» load) ───
  const lastCounts = useRef<Record<string, number> | null>(null)
  const counts = useMemo<Record<string, number>>(() => {
    if (data?.categoryCounts) {
      lastCounts.current = data.categoryCounts
      return data.categoryCounts
    }
    if (data && category === 'all') {
      const derived = countByCategory(items)
      lastCounts.current = derived
      return derived
    }
    return lastCounts.current ?? {}
  }, [data, category, items])

  const allCount = typeof counts.all === 'number' ? counts.all : category === 'all' ? items.length : null

  const categoryOptions = useMemo(
    () =>
      METRIC_CATEGORY_KEYS.map((key) => ({
        value: key,
        label: categoryLabel(key, data?.categories ?? undefined),
        icon: CATEGORY_ICONS[key],
        count: typeof counts[key] === 'number' ? counts[key] : null,
      })),
    [counts, data?.categories],
  )

  // Items of the selected category (server-filtered; re-checked client-side).
  const categoryItems = useMemo(
    () => (category === 'all' ? items : items.filter((it) => it.category === category)),
    [items, category],
  )

  const apiCategory = category === 'all' ? null : data?.categories?.find((c) => c.key === category) ?? null
  const apiSubcategories = apiCategory?.subcategories
  const subChips = useMemo(
    () =>
      category === 'growth_goals' || (apiSubcategories && apiSubcategories.length > 0)
        ? subcategoryChips(categoryItems, apiSubcategories)
        : [],
    [category, categoryItems, apiSubcategories],
  )

  const effectiveFilters: CatalogClientFilters = useMemo(() => ({ ...filters, category }), [filters, category])
  const filtered = useMemo(() => applyClientFilters(items, effectiveFilters), [items, effectiveFilters])

  const statusCounts = useMemo(() => {
    const base = applyClientFilters(items, { ...effectiveFilters, statuses: [] })
    const rec: Partial<Record<MetricStatus, number>> = {}
    for (const it of base) rec[it.status] = (rec[it.status] ?? 0) + 1
    return rec
  }, [items, effectiveFilters])

  const periods = useMemo(() => periodOptions(categoryItems), [categoryItems])
  const shown = filtered.slice(0, visible)
  const withValue = items.filter((it) => it.value !== null).length

  const resetAll = () => {
    setFilters(DEFAULT_CLIENT_FILTERS)
    setCategory('all')
    setSearch('')
  }

  return (
    <section data-tour="metrics-catalog" id="metrics-catalog" aria-labelledby="metrics-catalog-title" className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-outline-variant/10 pb-4">
        <div>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-1">Метрики · Точка А</p>
          <h2 id="metrics-catalog-title" className="font-headline text-xl font-bold text-on-surface">
            {allCount !== null ? `Каталог: ${allCount} показателей` : 'Каталог показателей'}
          </h2>
          <p className="text-xs text-on-surface-variant mt-1 font-mono" aria-live="polite">
            Показано <span className="text-primary">{filtered.length}</span>
            {category !== 'all' && ` · ${categoryLabel(category, data?.categories ?? undefined)}`}
            {category === 'all' && !search && items.length > 0 && ` · со значением ${withValue}`}
            {isFetching && !isLoading && ' · обновляется…'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {materializeStatus === 'running' && (
            <span className="inline-flex items-center gap-1.5 text-on-surface-variant font-mono text-[10px] px-2.5 py-1 rounded-full bg-surface-container border border-white/[0.04]">
              <span className="material-symbols-outlined text-[12px] animate-spin" aria-hidden="true">progress_activity</span>
              Считаем метрики…
            </span>
          )}
          {materializeStatus === 'error' && (
            <span className="inline-flex items-center gap-1.5 text-error font-mono text-[10px] px-2.5 py-1 rounded-full bg-error/5 border border-error/20" role="alert">
              <span className="material-symbols-outlined text-[12px]" aria-hidden="true">error</span>
              Не удалось рассчитать метрики
            </span>
          )}
          <MetricSortToggle value={sort} onChange={setSort} />
          <button
            type="button"
            onClick={() => void runMaterialize(true)}
            disabled={materializeStatus === 'running'}
            className="inline-flex items-center gap-1.5 text-xs font-mono text-on-surface-variant border border-white/[0.04] hover:border-primary/40 hover:text-primary rounded-xl px-3 py-2 transition-colors disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-primary/40"
            title="Пересчитать значения метрик из анкеты и документов"
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">refresh</span>
            Пересчитать
          </button>
        </div>
      </div>

      {/* Categories */}
      <ChipNav
        ariaLabel="Категории метрик"
        options={categoryOptions}
        value={category === 'all' ? null : category}
        onChange={(next) => {
          setCategory(isCategoryKey(next) ? next : 'all')
          setFilters((f) => ({ ...f, subcategory: null }))
        }}
        allCount={allCount}
      />

      {apiCategory?.description && categoryItems.length > 0 && (
        <p className="text-xs text-on-surface-variant leading-relaxed max-w-3xl">{apiCategory.description}</p>
      )}

      {subChips.length > 0 && (
        <ChipNav
          ariaLabel="Подкатегории"
          size="sm"
          options={subChips.map((s) => ({ value: s.key, label: s.label, count: s.count }))}
          value={filters.subcategory}
          onChange={(next) => setFilters((f) => ({ ...f, subcategory: next }))}
          allLabel="Все цели"
          allCount={categoryItems.length}
        />
      )}

      {/* Search + filters */}
      <MetricSearchBox value={search} onChange={setSearch} resultsCount={filtered.length} />
      <MetricFiltersBar
        filters={filters}
        periods={periods}
        statusCounts={statusCounts}
        onChange={setFilters}
        onReset={() => setFilters((f) => ({ ...DEFAULT_CLIENT_FILTERS, subcategory: f.subcategory }))}
      />

      {isError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-error/30 bg-error/[0.04] p-4 text-sm text-on-surface" role="alert">
          <span>{error instanceof Error ? error.message : 'Ошибка загрузки каталога'}</span>
          <button
            type="button"
            onClick={() => void refetch()}
            className="inline-flex items-center gap-1 rounded-xl border border-white/10 px-3 py-1.5 text-xs hover:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">refresh</span>
            Повторить
          </button>
        </div>
      )}

      {/* Grid — previous results stay visible while the next category loads,
          but never flash an empty state for it. */}
      {isLoading || (isPlaceholderData && filtered.length === 0) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" aria-busy="true" aria-label="Загружаем метрики">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 rounded-2xl border border-white/[0.04] bg-surface-container animate-pulse" />
          ))}
        </div>
      ) : !isError && items.length > 0 && withValue === 0 && category === 'all' && !search && filtered.length === items.length ? (
        <>
          <div className="rounded-2xl border border-dashed border-white/10 bg-surface-container-low p-5 text-sm">
            <p className="font-medium text-on-surface">Значений пока нет</p>
            <p className="mt-1 text-xs text-on-surface-variant leading-relaxed">
              Метрики считаются из ответов анкеты и загруженных документов. Заполните анкету или загрузите P&L,
              выгрузку CRM — значения появятся здесь автоматически.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/client/onboarding" className="inline-flex items-center gap-1.5 rounded-xl bg-primary/10 border border-primary/30 px-3 py-1.5 text-xs text-primary hover:bg-primary/15">
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">edit_note</span>
                Заполнить анкету
              </Link>
              <Link href="/client/onboarding/documents" className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface">
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">upload_file</span>
                Загрузить документы
              </Link>
            </div>
          </div>
          <CardsGrid items={shown} onOpen={setDrillItem} />
        </>
      ) : filtered.length === 0 && !isError && category !== 'all' && categoryItems.length === 0 && !search ? (
        /* The category itself has no metrics yet — say why (taxonomy emptyReason). */
        <div className="bg-surface-container-low border border-dashed border-white/[0.06] rounded-2xl p-10 text-center">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant/40 mb-3 block" aria-hidden="true">
            {CATEGORY_ICONS[category]}
          </span>
          <p className="text-sm text-on-surface">В категории «{categoryLabel(category, data?.categories ?? undefined)}» пока нет метрик</p>
          <p className="mt-1 text-xs text-on-surface-variant max-w-md mx-auto leading-relaxed">
            {apiCategory?.emptyReason ?? apiCategory?.description ?? 'Метрики появятся, когда для категории будут собраны данные.'}
          </p>
        </div>
      ) : filtered.length === 0 && !isError ? (
        <div className="bg-surface-container-low border border-dashed border-white/[0.06] rounded-2xl p-10 text-center">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant/40 mb-3 block" aria-hidden="true">
            search_off
          </span>
          <p className="text-sm text-on-surface-variant">Метрик по выбранным фильтрам не найдено</p>
          <button type="button" onClick={resetAll} className="mt-3 text-xs font-mono text-primary hover:text-primary/80">
            Сбросить фильтры
          </button>
        </div>
      ) : (
        <CardsGrid items={shown} onOpen={setDrillItem} />
      )}

      {filtered.length > shown.length && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={() => setVisible((v) => v + PAGE)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.06] bg-surface-container-low px-4 py-2 text-xs font-mono text-on-surface-variant hover:border-primary/40 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">expand_more</span>
            Показать ещё ({filtered.length - shown.length})
          </button>
        </div>
      )}

      {drillItem && <MetricDrillDownHost item={drillItem} onClose={() => setDrillItem(null)} />}
    </section>
  )
}

function CardsGrid({ items, onOpen }: { items: CatalogItem[]; onOpen: (item: CatalogItem) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {items.map((it) => (
        <MetricCatalogCard key={it.id} item={it} onOpen={onOpen} />
      ))}
    </div>
  )
}
