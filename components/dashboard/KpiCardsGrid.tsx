'use client'

import { useState } from 'react'
import { useMetricsStore } from '@/stores/metrics.store'
import { useAllVisibleMetrics } from '@/hooks/useMetrics'
import { useUIStore } from '@/stores/ui.store'
import { AddMetricModal } from './AddMetricModal'
import { MetricModal } from './MetricModal'
import { MAX_METRICS } from '@/types/metrics'
import type { MetricSummary } from '@/types/metrics'

function progressColor(pct: number) {
  if (pct >= 80) return '#6effc0'
  if (pct >= 50) return '#ffbd60'
  return '#ff6b6b'
}

// Skeleton card
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

// Single metric card
function MetricCard({
  metric,
  goalProgress,
  onClick,
  onHide,
  onRemove,
}: {
  metric: MetricSummary
  goalProgress: number | null
  onClick: () => void
  onHide: () => void
  onRemove: () => void
}) {
  const [showMenu, setShowMenu] = useState(false)

  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`
          w-full relative bg-surface-container-low rounded-2xl p-5 overflow-hidden text-left
          border border-white/[0.04] hover:border-primary/20
          transition-all duration-200 cursor-pointer
          ${metric.trendDirection === 'down' ? 'hover:border-error/20' : ''}
        `}
      >
        {/* Hover gradient */}
        <div className={`
          absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none rounded-2xl
          ${metric.trendDirection !== 'down'
            ? 'bg-gradient-to-br from-primary/[0.05] to-transparent'
            : 'bg-gradient-to-br from-error/[0.05] to-transparent'}
        `} />

        <div className="flex items-start justify-between mb-3">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
            {metric.label}
          </p>
          <span
            className="material-symbols-outlined text-base opacity-30 group-hover:opacity-60 transition-opacity"
            style={{ color: metric.trendDirection === 'down' ? '#ff6b6b' : metric.color }}
          >
            {metric.icon}
          </span>
        </div>

        <h3 className="text-2xl font-mono font-bold leading-none mb-2.5 text-on-surface">
          {metric.displayValue}
        </h3>

        <div className="flex items-center gap-1.5">
          <span
            className="material-symbols-outlined text-sm"
            style={{ color: metric.trendDirection === 'down' ? '#ff6b6b' : metric.trendDirection === 'up' ? metric.color : '#84958a' }}
          >
            {metric.trendDirection === 'up' ? 'trending_up' : metric.trendDirection === 'down' ? 'trending_down' : 'trending_flat'}
          </span>
          <span
            className="text-xs font-mono font-bold"
            style={{ color: metric.trendDirection === 'down' ? '#ff6b6b' : metric.trendDirection === 'up' ? metric.color : '#84958a' }}
          >
            {metric.trendDirection === 'up' ? '+' : ''}{metric.trend.toFixed(1)}{metric.unit === '%' ? ' пп' : '%'}
          </span>
          <span className="text-[10px] text-on-surface-variant/60 ml-0.5">{metric.trendLabel}</span>
        </div>

        {/* Goal progress bar */}
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

        <span className="material-symbols-outlined text-sm absolute bottom-4 right-4 opacity-0 group-hover:opacity-25 transition-opacity text-on-surface-variant">
          show_chart
        </span>
      </button>

      {/* Context menu button */}
      <button
        onClick={(e) => { e.stopPropagation(); setShowMenu((v) => !v) }}
        className="absolute top-3 right-10 opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity p-1 rounded-lg hover:bg-white/[0.08]"
      >
        <span className="material-symbols-outlined text-base text-on-surface-variant">more_vert</span>
      </button>

      {/* Dropdown menu */}
      {showMenu && (
        <div
          className="absolute top-10 right-10 z-20 bg-surface-container-high border border-white/[0.10] rounded-xl shadow-xl py-1 min-w-[140px]"
          onBlur={() => setShowMenu(false)}
        >
          <button
            onClick={() => { setShowMenu(false); onHide() }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-on-surface-variant hover:bg-white/[0.06] hover:text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-sm">visibility_off</span>
            Скрыть
          </button>
          {!metric.isDefault && (
            <button
              onClick={() => { setShowMenu(false); onRemove() }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-error hover:bg-error/[0.08] transition-colors"
            >
              <span className="material-symbols-outlined text-sm">delete</span>
              Удалить
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Empty state
function EmptyMetrics({ onShowAll, hasHidden }: { onShowAll: () => void; hasHidden: boolean }) {
  return (
    <div className="col-span-2 flex flex-col items-center justify-center py-12 rounded-2xl border border-dashed border-white/[0.08] text-center">
      <span className="material-symbols-outlined text-4xl text-on-surface-variant/20 mb-3">bar_chart</span>
      <p className="text-sm text-on-surface-variant mb-1">Нет видимых метрик</p>
      {hasHidden && (
        <button
          onClick={onShowAll}
          className="mt-3 text-xs text-primary hover:underline"
        >
          Показать все скрытые метрики
        </button>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function KpiCardsGrid() {
  const [addOpen, setAddOpen] = useState(false)
  const { visibleMetricIds, hiddenMetricIds, setActiveMetric, hideMetric, removeMetric, showAllMetrics } = useMetricsStore()
  const pinnedGoals = useUIStore((s) => s.pinnedGoals)
  const { data: visibleMetrics, isLoading } = useAllVisibleMetrics(visibleMetricIds)

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
                onClick={showAllMetrics}
                className="text-[10px] font-mono text-primary/60 hover:text-primary transition-colors"
              >
                +{hiddenMetricIds.length} скрыто
              </button>
            )}
          </div>
          {canAddMore && (
            <button
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 text-[11px] font-mono text-on-surface-variant/40 hover:text-primary transition-colors border border-dashed border-white/[0.06] hover:border-primary/30 rounded-lg px-2.5 py-1"
            >
              <span className="material-symbols-outlined text-[14px]">add</span>
              Метрика
            </button>
          )}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 gap-3 content-start">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
            : visibleMetrics.length === 0
              ? <EmptyMetrics onShowAll={showAllMetrics} hasHidden={hiddenMetricIds.length > 0} />
              : visibleMetrics.map((metric) => {
                  const goal = pinnedGoals.find(
                    (g) => g.category === metric.goalCategory && g.targetValue != null && g.targetValue > 0
                  )
                  const progress =
                    goal && metric.rawValue > 0
                      ? Math.min(100, (metric.rawValue / goal.targetValue!) * 100)
                      : null

                  return (
                    <MetricCard
                      key={metric.id}
                      metric={metric}
                      goalProgress={progress}
                      onClick={() => setActiveMetric(metric.id)}
                      onHide={() => hideMetric(metric.id)}
                      onRemove={() => removeMetric(metric.id)}
                    />
                  )
                })}
        </div>
      </div>

      <AddMetricModal open={addOpen} onClose={() => setAddOpen(false)} />
      <MetricModal />
    </>
  )
}
