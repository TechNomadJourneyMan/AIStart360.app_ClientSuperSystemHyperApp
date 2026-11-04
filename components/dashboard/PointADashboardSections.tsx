'use client'

import { Suspense, useState } from 'react'
import { PointAFilterBar } from './PointAFilterBar'
import { TopSalesTable } from './TopSalesTable'
import { RetentionCurveWidget } from './RetentionCurveWidget'
import { MetricBlockV3List } from './MetricBlockV3'
import { RFMSegmentsGrid } from './RFMSegmentsGrid'
import { LossMapCard } from './LossMapCard'
import { BlockInfo } from '@/components/assistant/BlockInfo'
// RevenueTargetsCard intentionally not rendered here — the new
// GrowthSnapshotHero (mounted at the top of /dashboard, /point-a,
// /client/dashboard, /client/point-a) now owns targets + period goals
// + planning CTAs. The file is kept in the repo for other consumers.

/**
 * PointADashboardSections — bundles the new spec-driven dashboard
 * widgets (filter bar + top sales table + retention curve + 6 metric
 * blocks + RFM grid + loss map) into one client tree.
 *
 * Designed to be dropped into a server component page wrapped in
 * <Suspense>, because each child relies on useSearchParams().
 */
export function PointADashboardSections() {
  const [filterOptions, setFilterOptions] = useState<{
    products: string[]
    managers: string[]
  }>({ products: [], managers: [] })

  return (
    <div className="space-y-10">
      {/* Filter bar — lifted into <PointAFilterSection /> at the top of
          /point-a and /dashboard so the chips visually drive the new
          KeyMetricsHero report. URL params remain the source of truth. */}
      <div className="sr-only" aria-hidden="true">
        <PointAFilterBar
          products={filterOptions.products}
          managers={filterOptions.managers}
        />
      </div>

      {/* Top Sales Table — kept for the filter-options pipe; visually hidden
          because /point-a now renders the spec-driven Key-Metrics Hero +
          Zones grid in its place (see app/(dashboard)/point-a/page.tsx). */}
      <div className="sr-only" aria-hidden="true">
        <TopSalesTable onFilterOptions={setFilterOptions} />
      </div>

      {/* Retention Curve */}
      <section>
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.2em] text-primary/70">
              Удержание
            </p>
            <div className="flex items-center gap-2 mt-1">
              <h2 className="font-headline text-lg font-bold text-on-surface">
                Кривая удержания клиентов
              </h2>
              <BlockInfo title="Кривая удержания клиентов" align="left">
                <p><b>Что это:</b> график доли клиентов, которые остаются с компанией по месяцам после первой покупки.</p>
                <p><b>Что делает:</b> показывает, как быстро уходит база, и помогает оценить эффект работы над удержанием.</p>
              </BlockInfo>
            </div>
          </div>
        </div>
        <RetentionCurveWidget />
      </section>

      {/* 6 metric blocks — replaced by the new KeyMetricsHero + MetricZonesGrid
          inserted directly on /point-a; intentionally omitted here. */}

      {/* RFM Segments */}
      <section>
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.2em] text-primary/70">
              Сегментация
            </p>
            <div className="flex items-center gap-2 mt-1">
              <h2 className="font-headline text-lg font-bold text-on-surface">
                RFM-сегменты базы
              </h2>
              <BlockInfo title="RFM-сегменты базы" align="left">
                <p><b>Что это:</b> разбивка клиентской базы на группы по давности, частоте и сумме покупок (RFM).</p>
                <p><b>Что делает:</b> показывает ценные, спящие и уходящие сегменты, чтобы точнее планировать работу с базой.</p>
              </BlockInfo>
            </div>
          </div>
        </div>
        <RFMSegmentsGrid />
      </section>

      {/* Loss Map */}
      <section>
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.2em] text-primary/70">
              Потери
            </p>
            <div className="flex items-center gap-2 mt-1">
              <h2 className="font-headline text-lg font-bold text-on-surface">
                Карта потерь выручки
              </h2>
              <BlockInfo title="Карта потерь выручки" align="left">
                <p><b>Что это:</b> разбор, на каких этапах воронки и по каким причинам бизнес теряет выручку.</p>
                <p><b>Что делает:</b> подсвечивает крупнейшие точки утечки денег, чтобы расставить приоритеты в улучшениях.</p>
              </BlockInfo>
            </div>
          </div>
        </div>
        <LossMapCard />
      </section>
    </div>
  )
}

/**
 * Wrapper that adds a Suspense boundary — required by Next 14 for any
 * tree that calls `useSearchParams()`.
 */
export default function PointADashboardSectionsBoundary() {
  return (
    <Suspense
      fallback={
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-32 rounded-2xl border border-white/[0.04] bg-surface-container-low animate-pulse"
            />
          ))}
        </div>
      }
    >
      <PointADashboardSections />
    </Suspense>
  )
}
