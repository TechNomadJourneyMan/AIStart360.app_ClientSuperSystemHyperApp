'use client'

// ============================================================
// KpiCardsGrid — the metric tiles on /dashboard.
//
// Every tile is a <button> that opens the shared drill-down
// (components/dashboard/useMetricDrillDown.tsx), so the number explains
// itself: value, source, freshness, what it is, and what to do next.
//
// Data: GET /api/v1/metrics/catalog?includeValues=true — the same registry the
// /metrics page reads. A tile shows a number only when the resolver produced
// one; otherwise it says which source is missing and links to where it is
// filled in. No placeholder trend, no fabricated percentage.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import dynamic from 'next/dynamic'

import { useMetricsStore } from '@/stores/metrics.store'
import { useUIStore } from '@/stores/ui.store'
import { MAX_METRICS } from '@/types/metrics'
// Shared with the drill-down modal on purpose: the tile and the modal must
// print the same number the same way.
import { formatMetricNumber, formatRelativeRu } from './_drill-down-utils'
import { useMetricDrillDown, type MetricDrillDownTarget } from './useMetricDrillDown'

const AddMetricModal = dynamic(() => import('./AddMetricModal').then((m) => m.AddMetricModal), {
  ssr: false,
})

// ─── Catalog ──────────────────────────────────────────────────────────────────

interface CatalogItem {
  id: string
  label: string
  namespace: 'biz' | 'kpi' | 'gri' | 'goal'
  department: string | null
  goalNumber: string | null
  unit: string
  formula: string | null
  sources: Array<{ type: string; key?: string; field?: string; doc_type?: string; system?: string }>
  value: number | string | null
  confidence: number | null
  source: string | null
  computedAt: string | null
  fresh: boolean
}

async function fetchDashboardCatalog(): Promise<CatalogItem[]> {
  const res = await fetch(
    '/api/v1/metrics/catalog?namespace=all&includeValues=true&page=1&pageSize=200',
    { cache: 'no-store' },
  )
  const json = (await res.json()) as
    | { ok: true; data: { items: CatalogItem[] } }
    | { ok: false; error: string }
  if (!res.ok || !json.ok) {
    throw new Error(!json.ok ? json.error : 'Не удалось загрузить каталог метрик')
  }
  return json.data.items
}

// `stores/metrics.store` ships (and persists to localStorage) four slot ids
// that predate the 126-metric registry — `getMetricById('revenue')` returns
// nothing, so these tiles used to render the raw id as their label with an
// empty value. Map each slot onto the registry metric it actually means.
const LEGACY_METRIC_ALIASES: Record<string, string> = {
  revenue: 'biz.finansy.vyruchka_god',
  margin: 'biz.finansy.valovaya_marzha',
  clients: 'biz.klienty.aktivnykh_klientov',
  avg_check: 'biz.prodazhi.sredniy_chek',
}

const NAMESPACE_ICON: Record<CatalogItem['namespace'], string> = {
  biz: 'analytics',
  kpi: 'leaderboard',
  gri: 'radar',
  goal: 'flag',
}

const SOURCE_LABEL: Record<string, string> = {
  survey: 'анкета',
  document: 'документ',
  prisma: 'база',
  external: 'внешняя система',
  manual: 'ручной ввод',
}

function progressColor(pct: number) {
  if (pct >= 80) return '#6effc0'
  if (pct >= 50) return '#ffbd60'
  return '#ff6b6b'
}

/** One tile's worth of resolved state. `item` is null when the id is unknown. */
interface TileModel {
  slotId: string
  metricId: string
  item: CatalogItem | null
}

// ─── Skeleton card ────────────────────────────────────────────────────────────

function MetricCardSkeleton() {
  return (
    <div className="rounded-2xl p-5 bg-surface-container-low border border-white/[0.04] animate-pulse space-y-3">
      <div className="flex justify-between">
        <div className="h-2 w-16 bg-white/[0.08] rounded" />
        <div className="h-4 w-4 bg-white/[0.06] rounded" />
      </div>
      <div className="h-6 w-24 bg-white/[0.10] rounded" />
      <div className="h-2 w-20 bg-white/[0.06] rounded" />
    </div>
  )
}

// ─── Card menu (Скрыть / Удалить) ─────────────────────────────────────────────

function CardMenu({
  label,
  canRemove,
  onHide,
  onRemove,
}: {
  label: string
  canRemove: boolean
  onHide: () => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // The previous version closed on `onBlur` of a plain <div> with no tabIndex,
  // which never fires — the menu stayed open until the page changed.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="absolute top-3 right-10 z-20">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Действия с метрикой «${label}»`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="opacity-0 group-hover:opacity-40 hover:!opacity-100 focus-visible:opacity-100 transition-opacity p-1 rounded-lg hover:bg-white/[0.08]"
      >
        <span aria-hidden className="material-symbols-outlined text-base text-on-surface-variant">
          more_vert
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={`Действия с метрикой «${label}»`}
          className="absolute top-8 right-0 bg-surface-container-high border border-white/[0.10] rounded-xl shadow-xl py-1 min-w-[140px]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onHide() }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-on-surface-variant hover:bg-white/[0.06] hover:text-on-surface transition-colors"
          >
            <span aria-hidden className="material-symbols-outlined text-sm">visibility_off</span>
            Скрыть
          </button>
          {canRemove && (
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onRemove() }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-error hover:bg-error/[0.08] transition-colors"
            >
              <span aria-hidden className="material-symbols-outlined text-sm">delete</span>
              Удалить
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Single metric card ───────────────────────────────────────────────────────

function MetricCard({
  tile,
  goalProgress,
  onOpen,
  onHide,
  onRemove,
  canRemove,
}: {
  tile: TileModel
  goalProgress: number | null
  onOpen: () => void
  onHide: () => void
  onRemove: () => void
  canRemove: boolean
}) {
  const { item, metricId } = tile
  const label = item?.label ?? metricId
  const hasValue = item != null && item.value !== null && item.value !== ''
  const icon = item ? NAMESPACE_ICON[item.namespace] : 'help'

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Разбор метрики: ${label}`}
        className="
          w-full relative bg-surface-container-low rounded-2xl p-5 overflow-hidden text-left
          border border-white/[0.04] hover:border-primary/20
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
          transition-all duration-200 cursor-pointer
        "
      >
        {/* Hover gradient */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none rounded-2xl bg-gradient-to-br from-primary/[0.05] to-transparent" />

        <div className="flex items-start justify-between mb-3">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest pr-8 line-clamp-2">
            {label}
          </p>
          <span
            aria-hidden
            className="material-symbols-outlined text-base opacity-30 group-hover:opacity-60 transition-opacity text-on-surface-variant"
          >
            {icon}
          </span>
        </div>

        {hasValue ? (
          <h3 className="text-2xl font-mono font-bold leading-none mb-2.5 text-on-surface">
            {formatMetricNumber(item!.value)}
            {item!.unit ? (
              <span className="ml-1 text-sm text-on-surface-variant font-normal">{item!.unit}</span>
            ) : null}
          </h3>
        ) : (
          <h3 className="text-2xl font-mono font-bold leading-none mb-2.5 text-on-surface-variant/50">
            —
          </h3>
        )}

        {/* Honest sub-line: where the number came from, or what is missing. */}
        {item == null ? (
          <p className="text-[10px] text-on-surface-variant/70 leading-snug">
            Метрика не найдена в каталоге — откройте разбор
          </p>
        ) : hasValue ? (
          <p className="text-[10px] text-on-surface-variant/70 leading-snug">
            {item.source ? `Источник: ${SOURCE_LABEL[item.source] ?? item.source}` : 'Источник не указан'}
            {item.computedAt ? ` · ${formatRelativeRu(item.computedAt)}` : ''}
          </p>
        ) : (
          <p className="text-[10px] text-on-surface-variant/70 leading-snug">
            Нет данных — источник не заполнен
          </p>
        )}

        {/* Goal progress — only when the owner pinned a real target. */}
        {goalProgress !== null && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-mono text-on-surface-variant/40 uppercase tracking-widest">план</span>
              <span className="text-[10px] font-mono font-bold" style={{ color: progressColor(goalProgress) }}>
                {Math.round(goalProgress)}%
              </span>
            </div>
            <div className="h-0.5 bg-surface-container rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${goalProgress}%`, background: progressColor(goalProgress) }}
              />
            </div>
          </div>
        )}

        <span
          aria-hidden
          className="material-symbols-outlined text-sm absolute bottom-4 right-4 opacity-0 group-hover:opacity-25 transition-opacity text-on-surface-variant"
        >
          show_chart
        </span>
      </button>

      <CardMenu label={label} canRemove={canRemove} onHide={onHide} onRemove={onRemove} />
    </div>
  )
}

// ─── Empty / error states ─────────────────────────────────────────────────────

function EmptyMetrics({ onShowAll, hasHidden }: { onShowAll: () => void; hasHidden: boolean }) {
  return (
    <div className="col-span-2 flex flex-col items-center justify-center py-12 rounded-2xl border border-dashed border-white/[0.08] text-center">
      <span aria-hidden className="material-symbols-outlined text-4xl text-on-surface-variant/20 mb-3">
        bar_chart
      </span>
      <p className="text-sm text-on-surface-variant mb-1">Нет видимых метрик</p>
      {hasHidden ? (
        <button
          type="button"
          onClick={onShowAll}
          className="mt-3 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
        >
          Показать все скрытые метрики
        </button>
      ) : (
        <Link
          href="/metrics"
          className="mt-3 text-xs text-primary hover:underline"
          aria-label="Открыть каталог метрик"
        >
          Открыть каталог метрик
        </Link>
      )}
    </div>
  )
}

function CatalogError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="col-span-2 flex flex-col items-center justify-center py-10 rounded-2xl border border-error/20 bg-error/[0.03] text-center gap-2">
      <p className="text-sm text-on-surface">Не удалось загрузить метрики</p>
      <p className="text-xs text-on-surface-variant/70">
        Каталог показателей не ответил — значения не рассчитаны
      </p>
      <button
        type="button"
        onClick={onRetry}
        aria-label="Повторить загрузку метрик"
        className="mt-1 inline-flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-xl border border-white/[0.08] text-on-surface-variant hover:text-primary hover:border-primary/40 transition-colors"
      >
        <span aria-hidden className="material-symbols-outlined text-[14px]">refresh</span>
        Повторить
      </button>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function KpiCardsGrid() {
  const [addOpen, setAddOpen] = useState(false)
  const {
    visibleMetricIds,
    hiddenMetricIds,
    hideMetric,
    removeMetric,
    showAllMetrics,
  } = useMetricsStore()
  const pinnedGoals = useUIStore((s) => s.pinnedGoals)

  const { data: catalog, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard-metric-tiles'],
    queryFn: fetchDashboardCatalog,
    staleTime: 60_000,
  })

  const byId = useMemo(() => {
    const map = new Map<string, CatalogItem>()
    for (const it of catalog ?? []) map.set(it.id, it)
    return map
  }, [catalog])

  const tiles = useMemo<TileModel[]>(
    () =>
      visibleMetricIds.map((slotId) => {
        const metricId = LEGACY_METRIC_ALIASES[slotId] ?? slotId
        return { slotId, metricId, item: byId.get(metricId) ?? null }
      }),
    [visibleMetricIds, byId],
  )

  // A tile knows everything the drill-down needs, so the modal never has to
  // re-fetch what is already on screen.
  const resolveTarget = useCallback(
    (metricId: string): MetricDrillDownTarget | undefined => {
      // Accepts both the legacy slot id and the registry id, so a
      // `setActiveMetric('revenue')` somewhere else on the page still lands on
      // the right metric.
      const item = byId.get(LEGACY_METRIC_ALIASES[metricId] ?? metricId)
      if (!item) return undefined
      return {
        metricId: item.id,
        metricLabel: item.label,
        unit: item.unit,
        namespace: item.namespace,
        department: item.department,
        goalNumber: item.goalNumber,
        formula: item.formula,
        confidence: item.confidence,
        computedAt: item.computedAt,
        liveValue: item.value !== null ? { value: item.value } : undefined,
      }
    },
    [byId],
  )

  // `syncWithMetricsStore` keeps the older `setActiveMetric(id)` call sites on
  // this page working — they now open this drill-down instead of nothing.
  const drill = useMetricDrillDown({ syncWithMetricsStore: true, resolveTarget })

  const totalCount = visibleMetricIds.length + hiddenMetricIds.length
  const canAddMore = totalCount < MAX_METRICS

  return (
    <>
      <div className="space-y-3">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-mono text-on-surface-variant/40 uppercase tracking-widest">
              Метрики
            </p>
            {hiddenMetricIds.length > 0 && (
              <button
                type="button"
                onClick={showAllMetrics}
                aria-label={`Показать ${hiddenMetricIds.length} скрытых метрик`}
                className="text-[10px] font-mono text-primary/60 hover:text-primary transition-colors"
              >
                +{hiddenMetricIds.length} скрыто
              </button>
            )}
          </div>
          {canAddMore && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              aria-label="Добавить метрику на дашборд"
              className="flex items-center gap-1.5 text-[11px] font-mono text-on-surface-variant/40 hover:text-primary transition-colors border border-dashed border-white/[0.06] hover:border-primary/30 rounded-lg px-2.5 py-1"
            >
              <span aria-hidden className="material-symbols-outlined text-[14px]">add</span>
              Метрика
            </button>
          )}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 gap-3 content-start">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
          ) : isError ? (
            <CatalogError onRetry={() => void refetch()} />
          ) : tiles.length === 0 ? (
            <EmptyMetrics onShowAll={showAllMetrics} hasHidden={hiddenMetricIds.length > 0} />
          ) : (
            tiles.map((tile) => {
              const goal = pinnedGoals.find(
                (g) => g.category === tile.slotId && g.targetValue != null && g.targetValue > 0,
              )
              const raw = typeof tile.item?.value === 'number' ? tile.item.value : null
              const progress =
                goal && raw !== null && raw > 0
                  ? Math.min(100, (raw / goal.targetValue!) * 100)
                  : null

              return (
                <MetricCard
                  key={tile.slotId}
                  tile={tile}
                  goalProgress={progress}
                  canRemove={!(tile.slotId in LEGACY_METRIC_ALIASES)}
                  onOpen={() =>
                    drill.open(
                      resolveTarget(tile.metricId) ?? {
                        metricId: tile.metricId,
                        missingDataHint:
                          'Этой метрики нет в каталоге показателей — возможно, она была переименована',
                      },
                    )
                  }
                  onHide={() => hideMetric(tile.slotId)}
                  onRemove={() => removeMetric(tile.slotId)}
                />
              )
            })
          )}
        </div>
      </div>

      {addOpen && <AddMetricModal open onClose={() => setAddOpen(false)} />}
      {drill.modal}
    </>
  )
}
