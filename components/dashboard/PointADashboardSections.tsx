'use client'

import { Suspense } from 'react'
import { RetentionCurveWidget } from './RetentionCurveWidget'
import { MetricBlockV3List } from './MetricBlockV3'
import { RFMSegmentsGrid } from './RFMSegmentsGrid'
import { LossMapCard } from './LossMapCard'
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
  return (
    <div className="space-y-10">
      {/* Retention Curve */}
      <section>
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.2em] text-primary/70">
              Удержание
            </p>
            <h2 className="font-headline text-lg font-bold text-on-surface mt-1">
              Кривая удержания клиентов
            </h2>
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
            <h2 className="font-headline text-lg font-bold text-on-surface mt-1">
              RFM-сегменты базы
            </h2>
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
            <h2 className="font-headline text-lg font-bold text-on-surface mt-1">
              Карта потерь выручки
            </h2>
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
