'use client'

// ============================================================
// MetricDrillDownModalV2 — Phase 6b
// Next-gen drill-down: fact timeseries + forecast + anomalies +
// goal + provenance + AI narrative slot for a single metric.
// Russian copy only. Self-contained — does not touch the legacy
// MetricModal.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useTimeseries, useForecast, useMetricGoal, useAnomalies } from '@/hooks/useTimeseries'
import type { Period } from '@/types/periods'
import type { AnomalyPoint } from '@/types/metrics'
import { Skeleton } from '@/components/ui/Skeleton'

import {
  V2_PERIOD_OPTIONS,
  DEFAULT_DRILL_PERIOD,
  DEFAULT_DRILL_LAYERS,
  DRILL_LAYER_LABELS,
  toggleDrillLayer,
  severityColor,
  formatMetricNumber,
  mergeFactForecast,
  isSourcePicked,
  formatRelativeRu,
  filterRecentAnomalies,
  isTimeseriesEmpty,
  formatTrend,
  type DrillLayer,
  type DrillProvenance,
} from './_drill-down-utils'

// ────────────────────────────────────────────────────────────────────────────

export interface MetricDrillDownModalV2Props {
  open: boolean
  onClose: () => void
  metricId: string
  metricLabel: string
  unit?: string
  /** Description text from lib/metrics/descriptions.ts (what/why/how). */
  description?: { what: string; why: string; how: string; current_state?: string }
  /** Provenance from resolver. */
  provenance?: DrillProvenance
  /** Optional override — if the value is already known, render it directly. */
  liveValue?: {
    value: number | string | null
    trend?: { direction: 'up' | 'down' | 'flat'; deltaPct: number }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Section heading helper
// ────────────────────────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">
      {children}
    </h4>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Period chip
// ────────────────────────────────────────────────────────────────────────────

function PeriodChip({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'px-3 py-1.5 rounded-xl text-[11px] font-mono border transition-colors',
        active
          ? 'bg-primary/15 text-primary border-primary/40'
          : 'bg-transparent text-on-surface-variant border-white/[0.04] hover:border-white/10',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Layer chip
// ────────────────────────────────────────────────────────────────────────────

function LayerChip({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-active={active}
      className={[
        'inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-[11px] font-mono border transition-colors',
        active
          ? 'bg-primary/10 text-primary border-primary/30'
          : 'bg-transparent text-on-surface-variant border-white/[0.04]',
      ].join(' ')}
    >
      <span aria-hidden className="text-[10px]">{active ? '✓' : ' '}</span>
      {label}
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Provenance row
// ────────────────────────────────────────────────────────────────────────────

function ProvenanceRow({
  source,
  picked,
}: {
  source: NonNullable<DrillProvenance['considered']>[number]
  picked: boolean
}) {
  const grey = !picked && source.status !== 'hit'
  return (
    <li
      className={[
        'flex items-center gap-3 text-xs py-1.5',
        grey ? 'text-on-surface-variant/60' : 'text-on-surface',
      ].join(' ')}
    >
      <span className="text-on-surface-variant/40">•</span>
      <span className="flex-1 truncate">
        {source.label}
        {source.status === 'miss' ? (
          <span className="ml-2 text-on-surface-variant/50">— не загружен</span>
        ) : source.status === 'error' ? (
          <span className="ml-2 text-error/80">— ошибка</span>
        ) : null}
      </span>
      {typeof source.confidence === 'number' && source.status === 'hit' && (
        <span className="font-mono text-[10px] text-on-surface-variant">
          conf {source.confidence.toFixed(2)}
        </span>
      )}
      {picked ? (
        <span
          aria-label="выбранный источник"
          className="material-symbols-outlined text-primary text-[16px]"
        >
          check_circle
        </span>
      ) : (
        <span className="w-4" aria-hidden />
      )}
    </li>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Anomaly list item
// ────────────────────────────────────────────────────────────────────────────

function AnomalyItem({ a }: { a: AnomalyPoint }) {
  return (
    <li
      className="flex items-start gap-2 text-xs py-1.5"
      style={{ color: severityColor(a.severity) }}
    >
      <span className="material-symbols-outlined text-[14px] mt-0.5">warning</span>
      <span className="font-mono text-[10px] text-on-surface-variant min-w-[42px]">
        {a.label}
      </span>
      <span className="flex-1 text-on-surface-variant">{a.description}</span>
      <span className="text-[10px] uppercase tracking-widest opacity-80">
        {a.severity}
      </span>
    </li>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Tooltip
// ────────────────────────────────────────────────────────────────────────────

function ChartTip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean
  payload?: Array<{ dataKey?: string; value?: number }>
  label?: string
  unit?: string
}) {
  if (!active || !payload?.length) return null
  const fact = payload.find((p) => p.dataKey === 'value')?.value
  const forecast = payload.find((p) => p.dataKey === 'forecastValue')?.value
  return (
    <div className="bg-surface-container-high border border-white/10 rounded-xl px-3 py-2 shadow-modal text-xs">
      <p className="font-mono text-on-surface-variant mb-1">{label}</p>
      {fact != null && (
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          <span className="text-on-surface-variant">Факт:</span>
          <span className="font-mono font-bold text-on-surface ml-auto">
            {formatMetricNumber(fact)}
            {unit ?? ''}
          </span>
        </div>
      )}
      {forecast != null && (
        <div className="flex items-center gap-2 mt-1">
          <span className="w-1.5 h-1.5 rounded-full border border-primary" />
          <span className="text-on-surface-variant">Прогноз:</span>
          <span className="font-mono font-bold text-primary ml-auto">
            {formatMetricNumber(forecast)}
            {unit ?? ''}
          </span>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────────────

export function MetricDrillDownModalV2({
  open,
  onClose,
  metricId,
  metricLabel,
  unit,
  description,
  provenance,
  liveValue,
}: MetricDrillDownModalV2Props) {
  const [period, setPeriod] = useState<Period>(DEFAULT_DRILL_PERIOD)
  const [activeLayers, setActiveLayers] = useState<DrillLayer[]>([...DEFAULT_DRILL_LAYERS])

  const handleToggleLayer = useCallback((layer: DrillLayer) => {
    setActiveLayers((prev) => toggleDrillLayer(prev, layer))
  }, [])

  // Hooks — only enabled while modal is open so we don't fetch in the background.
  const idForHooks = open ? metricId : null
  const { data: tsData, isLoading: tsLoading, isError: tsError } = useTimeseries(idForHooks, period)
  const { data: fData, isLoading: fLoading } = useForecast(idForHooks, period)
  const { data: goal } = useMetricGoal(idForHooks)
  const { data: anomalies = [] } = useAnomalies(idForHooks)

  const showForecast = activeLayers.includes('forecast')
  const showGoal = activeLayers.includes('goal') && !!goal
  const showAnomalies = activeLayers.includes('anomalies')
  const showFact = activeLayers.includes('fact')

  const factPoints = tsData?.data ?? []
  const forecastPoints = fData?.data ?? []

  const chartData = useMemo(
    () => mergeFactForecast(factPoints, forecastPoints, showForecast),
    [factPoints, forecastPoints, showForecast],
  )

  const visibleAnomalies = useMemo(
    () => filterRecentAnomalies(anomalies, 90),
    [anomalies],
  )

  const empty = !tsLoading && isTimeseriesEmpty(factPoints)
  const isLoading = tsLoading || fLoading

  // ESC handler is provided by Radix Dialog; we keep this for the legacy keyup
  // path so the modal closes even if focus is outside the Radix tree.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const trend = formatTrend(liveValue?.trend)
  const trendTone =
    trend.tone === 'pos'
      ? 'text-primary'
      : trend.tone === 'neg'
        ? 'text-error'
        : 'text-on-surface-variant'

  // Anomaly scatter dataset (Recharts needs flat {label, value} objects).
  const anomalyScatter = useMemo(
    () =>
      showAnomalies
        ? visibleAnomalies.map((a) => ({
            label: a.label,
            value: a.value,
            severity: a.severity,
          }))
        : [],
    [showAnomalies, visibleAnomalies],
  )

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
            </Dialog.Overlay>

            <Dialog.Content asChild forceMount>
              <motion.div
                className="fixed inset-0 z-[101] flex items-end sm:items-center justify-center p-0 sm:p-6"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                <div
                  className={[
                    'relative bg-surface-container border border-white/10 rounded-2xl shadow-modal',
                    'max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6',
                  ].join(' ')}
                  data-testid="drilldown-v2-content"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="min-w-0">
                      <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.2em] mb-1">
                        Метрика
                      </p>
                      <Dialog.Title asChild>
                        <h2 className="text-lg sm:text-xl font-headline text-on-surface truncate">
                          {metricLabel}
                        </h2>
                      </Dialog.Title>
                      <Dialog.Description className="sr-only">
                        Детальный разбор метрики {metricLabel}
                      </Dialog.Description>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div
                        role="radiogroup"
                        aria-label="Период"
                        className="flex gap-1.5"
                      >
                        {V2_PERIOD_OPTIONS.map((p) => (
                          <PeriodChip
                            key={p.id}
                            active={period === p.id}
                            label={p.label}
                            onClick={() => setPeriod(p.id)}
                          />
                        ))}
                      </div>
                      <Dialog.Close asChild>
                        <button
                          type="button"
                          aria-label="Закрыть"
                          onClick={onClose}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant/50 hover:text-on-surface hover:bg-white/[0.06] transition-colors"
                        >
                          <span className="material-symbols-outlined text-xl">close</span>
                        </button>
                      </Dialog.Close>
                    </div>
                  </div>

                  {/* Value + chart */}
                  <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-5 mb-5">
                    {/* Big value tile */}
                    <div className="flex md:flex-col items-baseline md:items-start gap-3 md:gap-1.5 md:py-4 md:px-4 rounded-2xl md:bg-surface-container-high md:border md:border-white/[0.04]">
                      <p className="font-mono text-4xl md:text-5xl text-on-surface leading-none">
                        {formatMetricNumber(liveValue?.value ?? null)}
                      </p>
                      {unit && (
                        <p className="text-xs font-mono text-on-surface-variant uppercase tracking-widest">
                          {unit}
                        </p>
                      )}
                      <p className={`text-xs font-mono ${trendTone} mt-1`}>
                        {trend.text}
                        {liveValue?.trend ? (
                          <span className="ml-1 text-on-surface-variant/60">
                            к прошлому периоду
                          </span>
                        ) : null}
                      </p>
                    </div>

                    {/* Chart area */}
                    <div className="min-h-[220px]">
                      {isLoading ? (
                        <div className="h-[220px] flex items-center justify-center">
                          <Skeleton variant="block" className="h-44 w-full rounded-xl" />
                        </div>
                      ) : tsError ? (
                        <div className="h-[220px] flex items-center justify-center text-sm text-error">
                          Не удалось загрузить данные
                        </div>
                      ) : empty ? (
                        <div
                          className="h-[220px] flex flex-col items-center justify-center text-center px-4"
                          data-testid="drilldown-empty"
                        >
                          <p className="text-sm text-on-surface-variant mb-2">
                            Недостаточно данных для построения графика
                          </p>
                          <p className="text-xs text-primary/80">
                            Загрузите документы, чтобы заполнить ряд
                          </p>
                        </div>
                      ) : (
                        <div className="h-[240px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                              data={chartData}
                              margin={{ top: 8, right: 8, left: -10, bottom: 0 }}
                            >
                              <defs>
                                <linearGradient
                                  id={`v2-fact-${metricId}`}
                                  x1="0"
                                  y1="0"
                                  x2="0"
                                  y2="1"
                                >
                                  <stop offset="0%" stopColor="#6effc0" stopOpacity={0.15} />
                                  <stop offset="100%" stopColor="#6effc0" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient
                                  id={`v2-forecast-${metricId}`}
                                  x1="0"
                                  y1="0"
                                  x2="0"
                                  y2="1"
                                >
                                  <stop offset="0%" stopColor="#6effc0" stopOpacity={0.06} />
                                  <stop offset="100%" stopColor="#6effc0" stopOpacity={0} />
                                </linearGradient>
                              </defs>

                              <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="rgba(255,255,255,0.04)"
                                vertical={false}
                              />
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
                                tickFormatter={(v) => formatMetricNumber(v as number)}
                              />
                              <Tooltip
                                content={<ChartTip unit={unit} />}
                                cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }}
                              />

                              {showForecast && (
                                <Area
                                  type="monotone"
                                  dataKey="confidenceHigh"
                                  stroke="none"
                                  fill="#6effc0"
                                  fillOpacity={0.05}
                                  isAnimationActive={false}
                                  legendType="none"
                                  connectNulls
                                />
                              )}
                              {showForecast && (
                                <Area
                                  type="monotone"
                                  dataKey="confidenceLow"
                                  stroke="none"
                                  fill="#0A0B0F"
                                  fillOpacity={1}
                                  isAnimationActive={false}
                                  legendType="none"
                                  connectNulls
                                />
                              )}

                              {showFact && (
                                <Area
                                  type="monotone"
                                  dataKey="value"
                                  name="Факт"
                                  stroke="#6effc0"
                                  strokeWidth={2}
                                  fill={`url(#v2-fact-${metricId})`}
                                  dot={false}
                                  activeDot={{ r: 4, fill: '#6effc0', strokeWidth: 0 }}
                                  connectNulls={false}
                                />
                              )}

                              {showForecast && (
                                <Area
                                  type="monotone"
                                  dataKey="forecastValue"
                                  name="Прогноз"
                                  stroke="#6effc0"
                                  strokeWidth={2}
                                  strokeDasharray="6 4"
                                  fill={`url(#v2-forecast-${metricId})`}
                                  dot={false}
                                  activeDot={{ r: 3, fill: '#6effc0', strokeWidth: 0 }}
                                  connectNulls
                                />
                              )}

                              {showGoal && goal && (
                                <ReferenceLine
                                  y={goal.targetValue}
                                  stroke="#ffe1bd"
                                  strokeDasharray="4 4"
                                  strokeWidth={1}
                                  label={{
                                    value: `Цель: ${formatMetricNumber(goal.targetValue)}${goal.targetUnit ?? ''}`,
                                    position: 'insideTopRight',
                                    fill: '#ffe1bd',
                                    fontSize: 10,
                                    fontFamily: 'JetBrains Mono',
                                  }}
                                />
                              )}

                              {showAnomalies && anomalyScatter.length > 0 && (
                                <Scatter
                                  data={anomalyScatter}
                                  dataKey="value"
                                  shape={(props: any) => {
                                    const { cx, cy, payload } = props
                                    if (cx == null || cy == null) return <g />
                                    return (
                                      <circle
                                        cx={cx}
                                        cy={cy}
                                        r={5}
                                        fill={severityColor(payload?.severity ?? 'info')}
                                        stroke="rgba(0,0,0,0.45)"
                                        strokeWidth={1}
                                      />
                                    )
                                  }}
                                />
                              )}
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* Layer toggles */}
                      <div className="flex flex-wrap gap-2 mt-3">
                        {(Object.keys(DRILL_LAYER_LABELS) as DrillLayer[]).map((layer) => (
                          <LayerChip
                            key={layer}
                            active={activeLayers.includes(layer)}
                            label={DRILL_LAYER_LABELS[layer]}
                            onClick={() => handleToggleLayer(layer)}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Description */}
                  {description && (
                    <section className="mb-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <SectionHeading>Что это?</SectionHeading>
                        <p className="text-sm text-on-surface-variant leading-relaxed">
                          {description.what}
                        </p>
                      </div>
                      <div>
                        <SectionHeading>Почему важно?</SectionHeading>
                        <p className="text-sm text-on-surface-variant leading-relaxed">
                          {description.why}
                        </p>
                      </div>
                      <div>
                        <SectionHeading>Как считаем?</SectionHeading>
                        <p className="text-sm text-on-surface-variant leading-relaxed">
                          {description.how}
                        </p>
                      </div>
                      {description.current_state && (
                        <div>
                          <SectionHeading>Текущее состояние</SectionHeading>
                          <p className="text-sm text-on-surface-variant leading-relaxed">
                            {description.current_state}
                          </p>
                        </div>
                      )}
                    </section>
                  )}

                  {/* Provenance */}
                  {provenance && (
                    <section
                      className="mb-5 p-4 rounded-2xl bg-surface-container-high border border-white/[0.04]"
                      data-testid="drilldown-provenance"
                    >
                      <SectionHeading>Источники данных</SectionHeading>
                      {provenance.considered.length === 0 ? (
                        <p className="text-xs text-on-surface-variant">
                          Источники не определены
                        </p>
                      ) : (
                        <ul className="divide-y divide-white/[0.04]">
                          {provenance.considered.map((s, i) => (
                            <ProvenanceRow
                              key={`${s.type}:${s.label}:${i}`}
                              source={s}
                              picked={isSourcePicked(s, provenance.picked)}
                            />
                          ))}
                        </ul>
                      )}
                      {provenance.computedAt && (
                        <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-on-surface-variant/60">
                          Обновлено {formatRelativeRu(provenance.computedAt)}
                        </p>
                      )}
                    </section>
                  )}

                  {/* Anomalies */}
                  <section>
                    <SectionHeading>Аномалии (последние 90 дней)</SectionHeading>
                    {visibleAnomalies.length === 0 ? (
                      <p className="text-xs text-on-surface-variant">
                        Аномалии не обнаружены
                      </p>
                    ) : (
                      <ul className="divide-y divide-white/[0.04]">
                        {visibleAnomalies.map((a) => (
                          <AnomalyItem key={a.timestamp} a={a} />
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}

export default MetricDrillDownModalV2
