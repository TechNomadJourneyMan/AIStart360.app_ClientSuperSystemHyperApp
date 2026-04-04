'use client'

import { useState } from 'react'
import { ChartModal } from './ChartModal'
import { useUIStore } from '@/stores/ui.store'

export interface KpiItem {
  label: string
  value: string
  trend: string
  trendUp: boolean
  sublabel: string
  icon: string
  href: string
  numericValue?: number  // raw number for progress bar
  goalCategory?: string  // matches Goal.category
}

const CHART_METRIC_MAP: Record<string, string> = {
  'Доход':        'revenue',
  'Маржа':        'margin',
  'Клиенты':      'clients',
  'Средний чек':  'revenue',
}

function progressColor(pct: number) {
  if (pct >= 80) return '#6effc0'
  if (pct >= 50) return '#ffbd60'
  return '#ff6b6b'
}

export function KpiCardsGrid({ kpiData }: { kpiData: KpiItem[] }) {
  const [activeChart, setActiveChart] = useState<string | null>(null)
  const pinnedGoals = useUIStore((s) => s.pinnedGoals)

  return (
    <>
      <div className="grid grid-cols-2 gap-3 content-start">
        {kpiData.map((kpi) => {
          // Find matching goal for this metric
          const goal = pinnedGoals.find(
            (g) => g.category === kpi.goalCategory && g.targetValue != null && g.targetValue > 0
          )
          const progress =
            goal && kpi.numericValue != null && kpi.numericValue > 0
              ? Math.min(100, (kpi.numericValue / goal.targetValue!) * 100)
              : null

          return (
            <button
              key={kpi.label}
              onClick={() => setActiveChart(CHART_METRIC_MAP[kpi.label] ?? 'revenue')}
              className={`
                relative bg-surface-container-low rounded-2xl p-5 overflow-hidden text-left
                border border-white/[0.04] hover:border-primary/20
                transition-all duration-200 group cursor-pointer
                ${!kpi.trendUp ? 'hover:border-error/20' : ''}
              `}
            >
              {/* Hover gradient */}
              <div className={`
                absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none rounded-2xl
                ${kpi.trendUp
                  ? 'bg-gradient-to-br from-primary/[0.05] to-transparent'
                  : 'bg-gradient-to-br from-error/[0.05] to-transparent'}
              `} />

              <div className="flex items-start justify-between mb-3">
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
                  {kpi.label}
                </p>
                <span className={`material-symbols-outlined text-base opacity-30 group-hover:opacity-60 transition-opacity ${kpi.trendUp ? 'text-primary' : 'text-error'}`}>
                  {kpi.icon}
                </span>
              </div>

              <h3 className="text-2xl font-mono font-bold leading-none mb-2.5 text-on-surface">
                {kpi.value}
              </h3>

              <div className="flex items-center gap-1.5">
                <span className={`material-symbols-outlined text-sm ${kpi.trendUp ? 'text-primary' : 'text-error'}`}>
                  {kpi.trendUp ? 'trending_up' : 'trending_down'}
                </span>
                <span className={`text-xs font-mono font-bold ${kpi.trendUp ? 'text-primary' : 'text-error'}`}>
                  {kpi.trend}
                </span>
                <span className="text-[10px] text-on-surface-variant/60 ml-0.5">
                  {kpi.sublabel}
                </span>
              </div>

              {/* Progress bar from linked goal */}
              {progress !== null && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-mono text-on-surface-variant/40 uppercase tracking-widest">
                      план
                    </span>
                    <span
                      className="text-[10px] font-mono font-bold"
                      style={{ color: progressColor(progress) }}
                    >
                      {Math.round(progress)}%
                    </span>
                  </div>
                  <div className="h-0.5 bg-surface-container rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${progress}%`, background: progressColor(progress) }}
                    />
                  </div>
                </div>
              )}

              {/* Chart hint */}
              <span className="material-symbols-outlined text-sm absolute bottom-4 right-4 opacity-0 group-hover:opacity-25 transition-opacity text-on-surface-variant">
                show_chart
              </span>
            </button>
          )
        })}
      </div>

      <ChartModal metric={activeChart} onClose={() => setActiveChart(null)} />
    </>
  )
}
