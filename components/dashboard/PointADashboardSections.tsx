'use client'

import { Suspense, useState } from 'react'
import { PointAFilterBar } from './PointAFilterBar'
import { TopSalesTable } from './TopSalesTable'
import { RetentionCurveWidget } from './RetentionCurveWidget'
import { MetricBlockV3List } from './MetricBlockV3'
import { RFMSegmentsGrid } from './RFMSegmentsGrid'
import { LossMapCard } from './LossMapCard'

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
      {/* Filter bar */}
      <section>
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.2em] text-primary/70">
              Фильтры
            </p>
            <h2 className="font-headline text-lg font-bold text-on-surface mt-1">
              Период и срезы
            </h2>
          </div>
        </div>
        <PointAFilterBar
          products={filterOptions.products}
          managers={filterOptions.managers}
        />
      </section>

      {/* Top Sales Table */}
      <section>
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.2em] text-primary/70">
              Топ-таблица
            </p>
            <h2 className="font-headline text-lg font-bold text-on-surface mt-1">
              Продажи: план vs факт
            </h2>
          </div>
        </div>
        <TopSalesTable onFilterOptions={setFilterOptions} />
      </section>

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

      {/* 6 metric blocks */}
      <section>
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.2em] text-primary/70">
              Метрики
            </p>
            <h2 className="font-headline text-lg font-bold text-on-surface mt-1">
              6 блоков ключевых показателей
            </h2>
          </div>
        </div>
        <MetricBlockV3List />
      </section>

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
