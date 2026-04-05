'use client'

import { useEffect, useMemo, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceDot,
} from 'recharts'
import { useMetricsStore } from '@/stores/metrics.store'
import { useMetrics } from '@/hooks/useMetrics'
import { useTimeseries, useForecast, useMetricGoal, useAnomalies } from '@/hooks/useTimeseries'
import { PERIODS, PERIOD_CONFIG } from '@/types/periods'
import type { Period } from '@/types/periods'
import type { DataLayer, ChartPoint, AnomalyPoint } from '@/types/metrics'
import { LayerToggle } from './LayerToggle'

// ─── Tooltip ─────────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, unit, goalValue, anomalies }: {
  active?: boolean
  payload?: any[]
  label?: string
  unit: string
  goalValue?: number
  anomalies: AnomalyPoint[]
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]
  const value: number = point?.value ?? payload.find((p: any) => p.dataKey === 'value')?.value
  const forecast: number | undefined = payload.find((p: any) => p.dataKey === 'forecastValue')?.value
  const displayVal = value ?? forecast
  const anomaly = anomalies.find((a) => a.label === label)

  const fromGoal = goalValue && displayVal
    ? ((displayVal - goalValue) / goalValue) * 100
    : null

  return (
    <div className="bg-surface-container-high border border-white/10 rounded-xl px-4 py-3 shadow-modal text-xs min-w-[160px]">
      <p className="font-mono text-on-surface-variant mb-2">{label}</p>
      {value != null && (
        <div className="flex items-center gap-2 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
          <span className="text-on-surface-variant">Факт:</span>
          <span className="font-mono font-bold text-on-surface ml-auto">{value}{unit}</span>
        </div>
      )}
      {forecast != null && (
        <div className="flex items-center gap-2 mb-1">
          <span className="w-1.5 h-1.5 rounded-full border border-secondary flex-shrink-0" style={{ borderStyle: 'dashed' }} />
          <span className="text-on-surface-variant">Прогноз:</span>
          <span className="font-mono font-bold text-secondary ml-auto">{forecast}{unit}</span>
        </div>
      )}
      {fromGoal != null && (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/[0.06]">
          <span className={`text-[10px] font-mono ${fromGoal >= 0 ? 'text-primary' : 'text-error'}`}>
            {fromGoal >= 0 ? '+' : ''}{fromGoal.toFixed(1)}% от цели
          </span>
        </div>
      )}
      {anomaly && (
        <div className={`mt-2 pt-2 border-t border-white/[0.06] text-[10px] leading-relaxed ${
          anomaly.severity === 'critical' ? 'text-error' : anomaly.severity === 'warning' ? 'text-yellow-400' : 'text-on-surface-variant'
        }`}>
          <span className="material-symbols-outlined text-[11px] mr-1 align-middle">warning</span>
          {anomaly.description}
        </div>
      )}
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ChartSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 w-32 bg-white/[0.06] rounded" />
      <div className="h-44 bg-white/[0.04] rounded-xl" />
    </div>
  )
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export function MetricModal() {
  const { activeMetricId, setActiveMetric, selectedPeriod, setPeriod, activeLayers, toggleLayer } = useMetricsStore()
  const { data: metrics = [] } = useMetrics()

  const metric = metrics.find((m) => m.id === activeMetricId) ?? null

  const { data: tsData, isLoading: tsLoading } = useTimeseries(activeMetricId, selectedPeriod)
  const { data: fData } = useForecast(activeMetricId, selectedPeriod)
  const { data: goal } = useMetricGoal(activeMetricId)
  const { data: anomalies = [] } = useAnomalies(activeMetricId)

  const cfg = PERIOD_CONFIG[selectedPeriod]
  const showForecast = cfg.showForecast && activeLayers.includes('forecast')
  const showGoal = goal && activeLayers.includes('goal')

  // Merge fact + forecast into single series for Recharts
  const chartData: ChartPoint[] = useMemo(() => {
    const factPoints = tsData?.data ?? []
    const forecastPoints = (showForecast ? fData?.data : []) ?? []

    const map = new Map<string, ChartPoint>()
    for (const p of factPoints) {
      map.set(p.label, { label: p.label, timestamp: p.timestamp, value: p.value })
    }
    for (const p of forecastPoints) {
      const existing = map.get(p.label)
      if (existing) {
        existing.forecastValue = p.value
        existing.confidenceLow = p.confidenceLow
        existing.confidenceHigh = p.confidenceHigh
      } else {
        map.set(p.label, {
          label: p.label,
          timestamp: p.timestamp,
          forecastValue: p.value,
          confidenceLow: p.confidenceLow,
          confidenceHigh: p.confidenceHigh,
          isForecast: true,
        })
      }
    }
    return Array.from(map.values())
  }, [tsData, fData, showForecast])

  // Anomaly labels for ReferenceDot lookup
  const anomalyLabels = useMemo(() => new Set(anomalies.map((a) => a.label)), [anomalies])

  // Close handlers
  const close = useCallback(() => setActiveMetric(null), [setActiveMetric])

  useEffect(() => {
    if (!activeMetricId) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeMetricId, close])

  const color = metric?.color ?? '#6effc0'
  const unit = metric?.unit ?? ''
  const trendSign = metric ? (metric.trendDirection === 'up' ? '+' : metric.trendDirection === 'down' ? '' : '') : ''

  // Available layers (hide compare for now)
  const availableLayers: DataLayer[] = cfg.showForecast
    ? ['fact', 'forecast', 'goal']
    : ['fact', 'goal']

  return (
    <AnimatePresence>
      {activeMetricId && metric && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={close}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          <motion.div
            className="relative z-10 w-full sm:max-w-3xl bg-surface-container-low rounded-t-2xl sm:rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between p-5 pb-4 border-b border-white/[0.06]">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-0.5">
                  Динамика
                </p>
                <h3 className="text-base font-bold text-on-surface mb-1">{metric.label}</h3>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xl font-mono font-bold text-on-surface">
                    {metric.displayValue}
                  </span>
                  <div className={`flex items-center gap-1 text-xs font-mono font-bold ${
                    metric.trendDirection === 'up' ? 'text-primary' : metric.trendDirection === 'down' ? 'text-error' : 'text-on-surface-variant'
                  }`}>
                    <span className="material-symbols-outlined text-sm">
                      {metric.trendDirection === 'up' ? 'trending_up' : metric.trendDirection === 'down' ? 'trending_down' : 'trending_flat'}
                    </span>
                    {trendSign}{metric.trend.toFixed(1)}{metric.unit === '%' ? ' пп' : '%'}
                    <span className="font-normal text-on-surface-variant/60 ml-1">{metric.trendLabel}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={close}
                className="ml-4 w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant/40 hover:text-on-surface hover:bg-white/[0.06] transition-all flex-shrink-0"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            {/* Goal progress bar */}
            {goal && (
              <div className="px-5 py-3 bg-surface-container border-b border-white/[0.04]">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-mono text-on-surface-variant/50 uppercase tracking-widest">
                    Прогресс к цели · {goal.targetValue}{goal.targetUnit}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                      goal.trajectory === 'on_track'
                        ? 'text-primary bg-primary/10'
                        : goal.trajectory === 'at_risk'
                          ? 'text-yellow-400 bg-yellow-400/10'
                          : 'text-error bg-error/10'
                    }`}>
                      {goal.trajectory === 'on_track' ? 'В норме' : goal.trajectory === 'at_risk' ? 'Под риском' : 'Отстаём'}
                    </span>
                    <span className="text-xs font-mono font-bold" style={{ color: goal.progress >= 80 ? '#6effc0' : goal.progress >= 50 ? '#ffbd60' : '#ff6b6b' }}>
                      {goal.progress}%
                    </span>
                  </div>
                </div>
                <div className="h-1 bg-surface-container-high rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${goal.progress}%`,
                      background: goal.progress >= 80 ? '#6effc0' : goal.progress >= 50 ? '#ffbd60' : '#ff6b6b',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Controls */}
            <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 flex-wrap">
              {/* Layer toggles */}
              <LayerToggle
                activeLayers={activeLayers}
                onToggle={toggleLayer}
                availableLayers={availableLayers}
              />

              {/* Period selector */}
              <div className="flex gap-1 bg-surface-container rounded-lg p-0.5">
                {PERIODS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`px-3 py-1 rounded-md text-[11px] font-mono transition-all duration-150 ${
                      selectedPeriod === p
                        ? 'bg-surface-container-high text-on-surface'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {PERIOD_CONFIG[p].labelRu}
                  </button>
                ))}
              </div>
            </div>

            {/* Chart */}
            <div className="px-5 pb-5">
              {tsLoading ? (
                <ChartSkeleton />
              ) : (
                <div className="h-52 sm:h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id={`grad-${metric.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={color} stopOpacity={0.2} />
                          <stop offset="95%" stopColor={color} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id={`grad-forecast-${metric.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#bcc7de" stopOpacity={0.1} />
                          <stop offset="95%" stopColor="#bcc7de" stopOpacity={0} />
                        </linearGradient>
                      </defs>

                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: '#84958a', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: '#84958a', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => String(v)}
                      />
                      <Tooltip
                        content={
                          <ChartTooltip
                            unit={unit}
                            goalValue={showGoal ? goal?.targetValue : undefined}
                            anomalies={anomalies}
                          />
                        }
                        cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }}
                      />

                      {/* Fact area */}
                      <Area
                        type="monotone"
                        dataKey="value"
                        name="Факт"
                        stroke={color}
                        strokeWidth={2}
                        fill={`url(#grad-${metric.id})`}
                        dot={false}
                        activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
                        connectNulls={false}
                      />

                      {/* Forecast area (dashed) */}
                      {showForecast && (
                        <Area
                          type="monotone"
                          dataKey="forecastValue"
                          name="Прогноз"
                          stroke="#bcc7de"
                          strokeWidth={1.5}
                          strokeDasharray="5 3"
                          fill={`url(#grad-forecast-${metric.id})`}
                          dot={false}
                          activeDot={{ r: 3, fill: '#bcc7de', strokeWidth: 0 }}
                          connectNulls
                        />
                      )}

                      {/* Goal reference line */}
                      {showGoal && goal && (
                        <ReferenceLine
                          y={goal.targetValue}
                          stroke="#ffd166"
                          strokeDasharray="4 2"
                          strokeWidth={1}
                          label={{ value: `Цель: ${goal.targetValue}${goal.targetUnit}`, position: 'insideTopRight', fill: '#ffd166', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                        />
                      )}

                      {/* Anomaly markers */}
                      {anomalies.map((a) => (
                        <ReferenceDot
                          key={a.timestamp}
                          x={a.label}
                          y={a.value}
                          r={5}
                          fill={a.severity === 'critical' ? '#ff6b6b' : a.severity === 'warning' ? '#ffbd60' : '#bcc7de'}
                          stroke="rgba(0,0,0,0.5)"
                          strokeWidth={1}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Anomaly alerts */}
              {anomalies.length > 0 && (
                <div className="mt-3 space-y-2">
                  {anomalies.map((a) => (
                    <div
                      key={a.timestamp}
                      className={`flex items-start gap-2 p-2.5 rounded-xl text-xs border ${
                        a.severity === 'critical'
                          ? 'bg-error/10 border-error/20 text-error'
                          : a.severity === 'warning'
                            ? 'bg-yellow-400/10 border-yellow-400/20 text-yellow-400'
                            : 'bg-white/[0.04] border-white/[0.08] text-on-surface-variant'
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm flex-shrink-0 mt-0.5">warning</span>
                      <div>
                        <span className="font-mono font-bold mr-1">{a.label}</span>
                        {a.description}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
