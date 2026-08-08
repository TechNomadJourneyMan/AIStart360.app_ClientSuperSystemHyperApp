'use client'

/**
 * PointAMetricDrillDown — the metric drill-down host for /point-a.
 *
 * `KeyMetricsHero` (6 KPI tiles) and `MetricZonesGrid` (rows of the three zone
 * cards) both open a metric by calling `setActiveMetric(id)` on the metrics
 * store. Nothing on /point-a used to listen to that store — the modal was
 * mounted only inside `components/dashboard/KpiCardsGrid.tsx`, which renders
 * on /dashboard. So every one of those clicks changed the store and opened
 * nothing. This host closes the loop.
 *
 * Resolution order for the active id:
 *   1. metric catalog (`/api/v1/metrics/catalog`) — the real registry, gives
 *      label + unit + sources + materialized value → full drill-down;
 *   2. legacy summary (`/api/v1/metrics`) — the ids the hero tiles use;
 *   3. neither → an honest panel that names the id and points at the places
 *      where the data is filled in. Never a silent no-op.
 *
 * `description.current_state` is deliberately NOT forwarded: the strings in
 * `lib/metrics/descriptions.ts` are demo narrative with someone else's numbers.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import * as Dialog from '@radix-ui/react-dialog'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'

import { useMetrics } from '@/hooks/useMetrics'
import { useMetricsStore } from '@/stores/metrics.store'
import { HERO_METRIC_LABELS } from './KeyMetricsHero'
import {
  POINT_A_CATALOG_KEY,
  fetchPointACatalog,
  buildProvenance,
  type CatalogItem,
} from './_metric-catalog'

// recharts lives inside the drill-down modal — keep it out of the /point-a
// first-load bundle and pull it only when a metric is actually opened.
const MetricDrillDownModalV2 = dynamic(
  () => import('@/components/dashboard/MetricDrillDownModalV2'),
  { ssr: false },
)

type Description = { what: string; why: string; how: string }

/**
 * Honest fallback: the store holds an id that neither the catalog nor the
 * legacy summary endpoint knows about. Say so and offer a way forward.
 */
function UnresolvedMetricDialog({
  metricId,
  onClose,
}: {
  metricId: string
  onClose: () => void
}) {
  const label = HERO_METRIC_LABELS[metricId]
  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-surface-container p-6 shadow-modal focus:outline-none">
          <Dialog.Title className="font-headline text-base text-on-surface">
            {label ? `${label}: значения пока нет` : 'Разбор пока не собирается'}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-xs leading-relaxed text-on-surface-variant">
            Показателя{' '}
            <span className="font-mono text-on-surface">{label ?? metricId}</span> нет ни в
            каталоге метрик, ни в сводке по вашей компании — значит, ни один источник его
            пока не заполнил. Никакого значения здесь не подставляется.
          </Dialog.Description>
          <p className="mt-3 text-xs leading-relaxed text-on-surface-variant">
            Данные берутся из анкеты и загруженных документов. Заполните их — и
            разбор появится здесь автоматически.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link
              href="/client/onboarding"
              className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-primary transition-colors hover:bg-primary/15 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span className="material-symbols-outlined text-[14px]">edit_note</span>
              Заполнить анкету
            </Link>
            <Link
              href="/metrics"
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-on-surface-variant transition-colors hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span className="material-symbols-outlined text-[14px]">list</span>
              Все метрики
            </Link>
            <Dialog.Close asChild>
              <button
                type="button"
                className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant/50 transition-colors hover:bg-white/[0.06] hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label="Закрыть"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default function PointAMetricDrillDown() {
  const activeMetricId = useMetricsStore((s) => s.activeMetricId)
  const setActiveMetric = useMetricsStore((s) => s.setActiveMetric)

  // Same filter triplet KeyMetricsHero uses, so both share one query entry.
  const params = useSearchParams()
  const filters = useMemo(
    () => ({
      period: params.get('period'),
      product: params.get('product'),
      manager: params.get('manager'),
    }),
    [params],
  )

  const { data: catalog = [], isLoading: catalogLoading } = useQuery({
    queryKey: POINT_A_CATALOG_KEY,
    queryFn: fetchPointACatalog,
    staleTime: 60_000,
    enabled: activeMetricId !== null,
  })
  const { data: live = [], isLoading: liveLoading } = useMetrics(filters)

  const catalogItem: CatalogItem | undefined = useMemo(
    () => (activeMetricId ? catalog.find((i) => i.id === activeMetricId) : undefined),
    [catalog, activeMetricId],
  )
  const liveSummary = useMemo(
    () => (activeMetricId ? live.find((m) => m.id === activeMetricId) : undefined),
    [live, activeMetricId],
  )

  // The 171 KB descriptions catalog is loaded only once a metric is opened.
  const [description, setDescription] = useState<Description | undefined>(undefined)
  useEffect(() => {
    if (!catalogItem) {
      setDescription(undefined)
      return
    }
    let cancelled = false
    void import('@/lib/metrics/descriptions').then(
      ({ getBizDescription, getKpiDescription, getGriDescription }) => {
        if (cancelled) return
        let d: { what: string; why: string; how: string } | undefined
        if (catalogItem.namespace === 'biz' && catalogItem.department) {
          d = getBizDescription(catalogItem.department, catalogItem.label)
        } else if (catalogItem.namespace === 'kpi') {
          d = getKpiDescription(catalogItem.label)
        } else if (catalogItem.namespace === 'gri') {
          d = getGriDescription(catalogItem.label)
        }
        // `current_state` is intentionally dropped — see the file header.
        setDescription(d ? { what: d.what, why: d.why, how: d.how } : undefined)
      },
    )
    return () => {
      cancelled = true
    }
  }, [catalogItem])

  const provenance = useMemo(
    () => (catalogItem ? buildProvenance(catalogItem) : undefined),
    [catalogItem],
  )

  if (!activeMetricId) return null

  const close = () => setActiveMetric(null)

  if (catalogItem) {
    return (
      <MetricDrillDownModalV2
        open
        onClose={close}
        metricId={catalogItem.id}
        metricLabel={catalogItem.label}
        unit={catalogItem.unit}
        description={description}
        provenance={provenance}
        liveValue={catalogItem.value !== null ? { value: catalogItem.value } : undefined}
      />
    )
  }

  if (liveSummary) {
    return (
      <MetricDrillDownModalV2
        open
        onClose={close}
        metricId={liveSummary.id}
        metricLabel={liveSummary.label}
        unit={liveSummary.unit}
        liveValue={{
          value: liveSummary.rawValue,
          trend: { direction: liveSummary.trendDirection, deltaPct: liveSummary.trend },
        }}
      />
    )
  }

  // Still resolving — don't flash the "not found" panel.
  if (catalogLoading || liveLoading) return null

  return <UnresolvedMetricDialog metricId={activeMetricId} onClose={close} />
}
