'use client'

// ============================================================
// MetricDrillDownModalV2 — the single "explain this number" modal.
//
// Contract for callers (see components/dashboard/useMetricDrillDown.tsx for
// the one-liner mount helper):
//   what   → metricId + metricLabel + unit
//   value  → liveValue (or the modal fetches /api/v1/metrics/:id/value itself)
//   where  → provenance (or self-fetched with the value)
//   how    → description {what, why, how} + formula
//   next   → actions[] (defaults are derived from the real state)
//
// Everything except `open/onClose/metricId/metricLabel` is optional: the modal
// is self-servicing so a new screen never has to copy the ~50 lines of
// description/provenance plumbing that MetricsLiveCatalog used to own.
//
// Accessibility: Radix Dialog gives us role="dialog" + aria-modal, the focus
// trap, focus restore to the trigger, and outside-click dismissal. The panel
// itself is the Dialog.Content so a click on the backdrop really lands
// *outside* it (the previous full-viewport Content swallowed those clicks).
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import { AnimatePresence, motion } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
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
import type { AnomalyPoint, AnomalySeverity, ChartPoint } from '@/types/metrics'
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
// Period vocabulary bridge
//
// The UI `Period` union is '1W' | '1M' | '3M' | '1Y' | '3Y' (types/periods.ts)
// while the endpoints accept '1M' | '3M' | '6M' | '1Y' | 'ALL'
// (app/api/v1/metrics/[id]/timeseries/route.ts:19 and siblings). Sending '3Y'
// or '1W' returns 400, which the modal used to render as
// «Не удалось загрузить данные» — two of five chips were guaranteed dead.
// Chips with no API equivalent are not rendered at all.
// ────────────────────────────────────────────────────────────────────────────

type ApiPeriod = '1M' | '3M' | '6M' | '1Y' | 'ALL'

const API_PERIOD: Record<Period, ApiPeriod | null> = {
  '1W': null, // the narrowest window the API serves is 1M
  '1M': '1M',
  '3M': '3M',
  '1Y': '1Y',
  '3Y': 'ALL', // no 3-year window exists; 'ALL' is the honest superset
}

const PERIOD_CHIP_LABEL: Partial<Record<Period, string>> = {
  '3Y': 'Всё',
}

const PERIOD_CHIPS = V2_PERIOD_OPTIONS.map((p) => ({
  id: p.id,
  label: PERIOD_CHIP_LABEL[p.id] ?? p.label,
  api: API_PERIOD[p.id],
})).filter((p): p is { id: Period; label: string; api: ApiPeriod } => p.api !== null)

// ────────────────────────────────────────────────────────────────────────────
// Public props
// ────────────────────────────────────────────────────────────────────────────

/** One concrete next step. Either a route (`href`) or a handler (`onClick`). */
export interface MetricDrillDownAction {
  label: string
  href?: string
  onClick?: () => void
  /** Short reason shown under the button — why this step is offered. */
  hint?: string
  icon?: string
  disabled?: boolean
}

export interface MetricDrillDownDescription {
  what: string
  why: string
  how: string
  current_state?: string
}

export interface MetricDrillDownModalV2Props {
  open: boolean
  onClose: () => void
  metricId: string
  metricLabel: string
  unit?: string
  /** Description text from lib/metrics/descriptions.ts (what/why/how). */
  description?: MetricDrillDownDescription
  /** Provenance from resolver. */
  provenance?: DrillProvenance
  /** Optional override — if the value is already known, render it directly. */
  liveValue?: {
    value: number | string | null
    trend?: { direction: 'up' | 'down' | 'flat'; deltaPct: number }
  }

  // ── Optional. Everything below has a safe default. ────────────────────────

  /** Registry namespace — lets the modal look the description up on its own. */
  namespace?: 'biz' | 'kpi' | 'gri' | 'goal'
  /** Department, required to resolve a `biz` description. */
  department?: string | null
  /** Goal number ("01".."11"), required to resolve a `goal` description. */
  goalNumber?: string | null
  /** Human formula, e.g. "(Выручка − Себестоимость) ÷ Выручка × 100%". */
  formula?: string | null
  /** Resolver confidence 0..1 for the current value. */
  confidence?: number | null
  /** ISO timestamp of the last calculation. */
  computedAt?: string | null
  /** Extra next steps appended to the state-derived ones. */
  actions?: MetricDrillDownAction[]
  /** Overrides the generic "what is missing" copy of the empty state. */
  missingDataHint?: string
  initialPeriod?: Period
  initialLayers?: DrillLayer[]
  /** Mirrors Radix — fires with `false` when the dialog dismisses itself. */
  onOpenChange?: (open: boolean) => void
}

// ────────────────────────────────────────────────────────────────────────────
// Routes where the missing data is actually entered
// ────────────────────────────────────────────────────────────────────────────

const ROUTE_DOCUMENTS = '/client/onboarding/documents'
const ROUTE_SURVEY = '/client/onboarding'

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
// Layer chip — `disabledReason` keeps a layer that has nothing to draw from
// pretending to be interactive.
// ────────────────────────────────────────────────────────────────────────────

function LayerChip({
  active,
  label,
  onClick,
  disabledReason,
}: {
  active: boolean
  label: string
  onClick: () => void
  disabledReason?: string
}) {
  const disabled = !!disabledReason
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={disabled ? undefined : active}
      aria-label={disabled ? `${label} — ${disabledReason}` : `Слой «${label}»`}
      title={disabledReason}
      data-active={active && !disabled}
      className={[
        'inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-[11px] font-mono border transition-colors',
        disabled
          ? 'bg-transparent text-on-surface-variant/40 border-white/[0.03] cursor-not-allowed'
          : active
            ? 'bg-primary/10 text-primary border-primary/30'
            : 'bg-transparent text-on-surface-variant border-white/[0.04] hover:border-white/10',
      ].join(' ')}
    >
      <span aria-hidden className="inline-block w-3 text-[10px]">
        {disabled ? '·' : active ? '✓' : ''}
      </span>
      {label}
      {disabled && (
        <span className="text-[10px] opacity-70">— {disabledReason}</span>
      )}
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Next-step button
// ────────────────────────────────────────────────────────────────────────────

function ActionButton({ action }: { action: MetricDrillDownAction }) {
  const cls = [
    'inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-mono border transition-colors',
    action.disabled
      ? 'border-white/[0.06] text-on-surface-variant/50 cursor-not-allowed'
      : 'border-primary/30 text-primary bg-primary/[0.06] hover:bg-primary/[0.12]',
  ].join(' ')

  const body = (
    <>
      {action.icon && (
        <span aria-hidden className="material-symbols-outlined text-[16px]">
          {action.icon}
        </span>
      )}
      {action.label}
    </>
  )

  return (
    <div className="flex flex-col gap-1">
      {action.href && !action.disabled ? (
        <Link href={action.href} className={cls} aria-label={action.label}>
          {body}
        </Link>
      ) : (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className={cls}
          aria-label={action.label}
        >
          {body}
        </button>
      )}
      {action.hint && (
        <span className="text-[10px] text-on-surface-variant/70 px-1">
          {action.hint}
        </span>
      )}
    </div>
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
      <span className="flex-1 min-w-0">
        <span className="block truncate">
          {source.label}
          {source.status === 'miss' ? (
            <span className="ml-2 text-on-surface-variant/50">— не загружен</span>
          ) : source.status === 'error' ? (
            <span className="ml-2 text-error/80">— ошибка</span>
          ) : null}
        </span>
        {source.reason && (
          <span className="block text-[10px] text-on-surface-variant/50 truncate">
            {source.reason}
          </span>
        )}
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
      <span aria-hidden className="material-symbols-outlined text-[14px] mt-0.5">warning</span>
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
  const suffix = unit ? ` ${unit}` : ''
  return (
    <div className="bg-surface-container-high border border-white/10 rounded-xl px-3 py-2 shadow-modal text-xs">
      <p className="font-mono text-on-surface-variant mb-1">{label}</p>
      {fact != null && (
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          <span className="text-on-surface-variant">Факт:</span>
          <span className="font-mono font-bold text-on-surface ml-auto">
            {formatMetricNumber(fact)}
            {suffix}
          </span>
        </div>
      )}
      {forecast != null && (
        <div className="flex items-center gap-2 mt-1">
          <span className="w-1.5 h-1.5 rounded-full border border-primary" />
          <span className="text-on-surface-variant">Прогноз:</span>
          <span className="font-mono font-bold text-primary ml-auto">
            {formatMetricNumber(forecast)}
            {suffix}
          </span>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Self-service value + provenance (GET /api/v1/metrics/:id/value)
// ────────────────────────────────────────────────────────────────────────────

interface SelfValue {
  label: string
  value: number | null
  unit: string
  confidence: number | null
  computedAt: string | null
  provenance: DrillProvenance | null
}

function normalizeProvenance(raw: unknown): DrillProvenance | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const considered = Array.isArray(obj.considered) ? obj.considered : null
  if (!considered) return null
  return {
    picked:
      obj.picked && typeof obj.picked === 'object'
        ? (obj.picked as DrillProvenance['picked'])
        : null,
    considered: considered as DrillProvenance['considered'],
    computedAt: typeof obj.computedAt === 'string' ? obj.computedAt : undefined,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Chart point enriched with the anomaly of the same bucket. Keeping the
// anomaly inside `chartData` is what makes the red dot land on its own date —
// a separate <Scatter data={...}> array is positioned by index, so a shorter
// anomaly array used to paint the markers onto unrelated buckets.
// ────────────────────────────────────────────────────────────────────────────

interface DrillChartPoint extends ChartPoint {
  anomalyValue?: number
  anomalySeverity?: AnomalySeverity
}

// ────────────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────────────

export function MetricDrillDownModalV2({
  open,
  onClose,
  metricId,
  metricLabel: metricLabelProp,
  unit,
  description: descriptionProp,
  provenance,
  liveValue,
  namespace,
  department,
  goalNumber,
  formula,
  confidence,
  computedAt,
  actions,
  missingDataHint,
  initialPeriod,
  initialLayers,
  onOpenChange,
}: MetricDrillDownModalV2Props) {
  const queryClient = useQueryClient()
  const [period, setPeriod] = useState<Period>(initialPeriod ?? DEFAULT_DRILL_PERIOD)
  const [activeLayers, setActiveLayers] = useState<DrillLayer[]>(
    initialLayers ? [...initialLayers] : [...DEFAULT_DRILL_LAYERS],
  )
  const [recalcState, setRecalcState] = useState<'idle' | 'running' | 'error'>('idle')

  const handleToggleLayer = useCallback((layer: DrillLayer) => {
    setActiveLayers((prev) => toggleDrillLayer(prev, layer))
  }, [])

  // Hooks — only enabled while modal is open so we don't fetch in the background.
  const idForHooks = open ? metricId : null
  // hooks/useTimeseries.ts types the argument with the UI `Period` union while
  // the endpoint speaks the API vocabulary — cast at this single call site
  // rather than reaching into the shared hook.
  const fetchPeriod = (API_PERIOD[period] ?? '3M') as unknown as Period
  const {
    data: tsData,
    isLoading: tsLoading,
    isError: tsError,
    refetch: refetchTimeseries,
  } = useTimeseries(idForHooks, fetchPeriod)
  const { data: fData, isLoading: fLoading, isError: fError } = useForecast(idForHooks, fetchPeriod)
  const { data: goal } = useMetricGoal(idForHooks)
  const { data: anomalies = [], isLoading: aLoading } = useAnomalies(idForHooks)

  // ── Self-service: value + provenance ──────────────────────────────────────
  const [selfValue, setSelfValue] = useState<SelfValue | null>(null)
  const [selfValueState, setSelfValueState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const needsSelfValue =
    open && (liveValue?.value == null || provenance === undefined || !metricLabelProp)
  const selfValueSeq = useRef(0)

  const loadSelfValue = useCallback(async () => {
    const seq = ++selfValueSeq.current
    setSelfValueState('loading')
    try {
      const res = await fetch(`/api/v1/metrics/${encodeURIComponent(metricId)}/value`, {
        cache: 'no-store',
      })
      const json = (await res.json()) as
        | { ok: true; data: { label: string; value: number | null; unit: string; confidence: number | null; computed_at: string | null; provenance: unknown } }
        | { ok: false; error: string }
      if (seq !== selfValueSeq.current) return
      if (!res.ok || !json.ok) {
        setSelfValue(null)
        setSelfValueState('error')
        return
      }
      setSelfValue({
        label: json.data.label,
        value: json.data.value,
        unit: json.data.unit,
        confidence: json.data.confidence,
        computedAt: json.data.computed_at,
        provenance: normalizeProvenance(json.data.provenance),
      })
      setSelfValueState('done')
    } catch {
      if (seq !== selfValueSeq.current) return
      setSelfValue(null)
      setSelfValueState('error')
    }
  }, [metricId])

  useEffect(() => {
    if (!needsSelfValue) return
    void loadSelfValue()
  }, [needsSelfValue, loadSelfValue])

  useEffect(() => {
    if (!open) {
      setSelfValue(null)
      setSelfValueState('idle')
      setRecalcState('idle')
    }
  }, [open])

  // Callers that only know the metric id (e.g. a tile wired through the
  // metrics store) may pass an empty label — the value endpoint knows it.
  const metricLabel = metricLabelProp || selfValue?.label || metricId

  // ── Self-service: description ─────────────────────────────────────────────
  // Callers may pass `description` directly (MetricsLiveCatalog does). When
  // they don't, resolve it here from the 171 KB catalog, loaded lazily so it
  // never lands in any page's first-load bundle.
  const [ownDescription, setOwnDescription] = useState<MetricDrillDownDescription | undefined>()
  const [ownFormula, setOwnFormula] = useState<string | null>(null)
  useEffect(() => {
    if (!open || descriptionProp || !namespace) {
      setOwnDescription(undefined)
      setOwnFormula(null)
      return
    }
    let cancelled = false
    void import('@/lib/metrics/descriptions').then((mod) => {
      if (cancelled) return
      if (namespace === 'biz' && department) {
        const d = mod.getBizDescription(department, metricLabel)
        if (d) setOwnDescription({ what: d.what, why: d.why, how: d.how })
      } else if (namespace === 'kpi') {
        const d = mod.getKpiDescription(metricLabel)
        if (d) setOwnDescription({ what: d.what, why: d.why, how: d.how })
      } else if (namespace === 'gri') {
        const d = mod.getGriDescription(metricLabel)
        if (d) setOwnDescription({ what: d.what, why: d.why, how: d.how })
      } else if (namespace === 'goal' && goalNumber) {
        // `goal` descriptions are grouped by goal number; the item carries the
        // formula too. Nobody used to call this getter, so all 55 growth-goal
        // metrics opened a drill-down with no explanation at all.
        const g = mod.getGoalDescription(goalNumber)
        const item = g?.items.find((i) => i.label === metricLabel)
        if (item) {
          setOwnDescription({ what: item.what, why: item.why, how: item.how })
          setOwnFormula(item.formula ?? null)
        }
      }
    })
    return () => {
      cancelled = true
    }
  }, [open, descriptionProp, namespace, department, goalNumber, metricLabel])

  // ── Derived data ──────────────────────────────────────────────────────────

  const showForecast = activeLayers.includes('forecast')
  const showGoal = activeLayers.includes('goal') && !!goal
  const showAnomalies = activeLayers.includes('anomalies')
  const showFact = activeLayers.includes('fact')

  const factPoints = useMemo(() => tsData?.data ?? [], [tsData])
  const forecastPoints = useMemo(() => fData?.data ?? [], [fData])

  const visibleAnomalies = useMemo(
    () => filterRecentAnomalies(anomalies, 90),
    [anomalies],
  )

  const chartData = useMemo<DrillChartPoint[]>(() => {
    const base: DrillChartPoint[] = mergeFactForecast(factPoints, forecastPoints, showForecast)
    if (!showAnomalies || visibleAnomalies.length === 0) return base
    const byLabel = new Map(visibleAnomalies.map((a) => [a.label, a]))
    return base.map((p) => {
      const hit = byLabel.get(p.label)
      return hit
        ? { ...p, anomalyValue: hit.value, anomalySeverity: hit.severity }
        : p
    })
  }, [factPoints, forecastPoints, showForecast, showAnomalies, visibleAnomalies])

  const hasAnomalyMarkers = useMemo(
    () => chartData.some((p) => p.anomalyValue != null),
    [chartData],
  )

  const empty = !tsLoading && isTimeseriesEmpty(factPoints)
  const chartLoading = tsLoading

  const resolvedValue = liveValue?.value ?? selfValue?.value ?? null
  const resolvedUnit = unit ?? selfValue?.unit ?? ''
  const resolvedConfidence = confidence ?? selfValue?.confidence ?? null
  const resolvedProvenance = provenance ?? selfValue?.provenance ?? undefined
  const resolvedComputedAt =
    computedAt ?? resolvedProvenance?.computedAt ?? selfValue?.computedAt ?? null
  // `description` from here on is the resolved one: caller-supplied when
  // present, self-loaded from the catalog otherwise.
  const description = descriptionProp ?? ownDescription
  const resolvedFormula = formula ?? ownFormula

  // Trend: prefer the caller's, otherwise derive it from the fact series we
  // already loaded. Never invent one — with fewer than two real points there
  // is simply no trend to show.
  const derivedTrend = useMemo(() => {
    if (liveValue?.trend) return { trend: liveValue.trend, basis: 'к прошлому периоду' }
    const nums = factPoints.filter(
      (p) => typeof p.value === 'number' && Number.isFinite(p.value),
    )
    if (nums.length < 2) return null
    const prev = nums[nums.length - 2].value
    const last = nums[nums.length - 1].value
    if (prev === 0) return null
    const deltaPct = ((last - prev) / Math.abs(prev)) * 100
    const direction = deltaPct > 0.05 ? 'up' : deltaPct < -0.05 ? 'down' : 'flat'
    return {
      trend: { direction: direction as 'up' | 'down' | 'flat', deltaPct },
      basis: 'к предыдущей точке ряда',
    }
  }, [liveValue?.trend, factPoints])

  const trend = formatTrend(derivedTrend?.trend)
  const trendTone =
    trend.tone === 'pos'
      ? 'text-primary'
      : trend.tone === 'neg'
        ? 'text-error'
        : 'text-on-surface-variant'

  // ── Layer availability (a chip with nothing to draw must say so) ──────────
  const layerDisabledReason = useCallback(
    (layer: DrillLayer): string | undefined => {
      if (layer === 'fact') return undefined
      if (layer === 'forecast') {
        if (fLoading) return undefined
        if (fError) return 'не рассчитан'
        if (forecastPoints.length === 0) return 'нет прогноза'
        return undefined
      }
      if (layer === 'goal') return goal ? undefined : 'цель не задана'
      if (layer === 'anomalies') {
        if (aLoading) return undefined
        return visibleAnomalies.length > 0 ? undefined : 'не найдены'
      }
      return undefined
    },
    [fLoading, fError, forecastPoints.length, goal, aLoading, visibleAnomalies.length],
  )

  const noLayerVisible = !showFact && !showForecast && !showGoal && !hasAnomalyMarkers

  // ── Next steps ────────────────────────────────────────────────────────────

  const runRecalc = useCallback(async () => {
    setRecalcState('running')
    try {
      const res = await fetch('/api/v1/metrics/materialize', {
        method: 'POST',
        cache: 'no-store',
      })
      const json = (await res.json()) as { ok: boolean }
      if (!json.ok) throw new Error('materialize failed')
      await queryClient.invalidateQueries({ queryKey: ['metrics-catalog'] })
      await queryClient.invalidateQueries({ queryKey: ['timeseries', metricId] })
      await refetchTimeseries()
      await loadSelfValue()
      setRecalcState('idle')
    } catch {
      setRecalcState('error')
    }
  }, [queryClient, metricId, refetchTimeseries, loadSelfValue])

  const missingSources = useMemo(
    () => (resolvedProvenance?.considered ?? []).filter((s) => s.status !== 'hit'),
    [resolvedProvenance],
  )

  const nextSteps = useMemo<MetricDrillDownAction[]>(() => {
    const steps: MetricDrillDownAction[] = []
    const noValue = resolvedValue === null || resolvedValue === ''
    const wantsDocuments =
      missingSources.some((s) => s.type === 'document') || ((noValue || empty) && missingSources.length === 0)
    const wantsSurvey = missingSources.some((s) => s.type === 'survey')

    if (wantsDocuments) {
      steps.push({
        label: 'Загрузить документы',
        href: ROUTE_DOCUMENTS,
        icon: 'upload_file',
        hint: 'P&L, выгрузки и отчёты — из них считается ряд по этой метрике',
      })
    }
    if (wantsSurvey) {
      steps.push({
        label: 'Заполнить анкету',
        href: ROUTE_SURVEY,
        icon: 'edit_note',
        hint: 'Часть источников этой метрики — ответы в анкете диагностики',
      })
    }
    steps.push({
      label: recalcState === 'running' ? 'Считаем…' : 'Пересчитать метрику',
      onClick: () => void runRecalc(),
      disabled: recalcState === 'running',
      icon: 'refresh',
      hint:
        recalcState === 'error'
          ? 'Не удалось пересчитать — попробуйте ещё раз'
          : resolvedComputedAt
            ? `Последний расчёт: ${formatRelativeRu(resolvedComputedAt)}`
            : 'Значение ещё ни разу не рассчитывалось',
    })
    return [...steps, ...(actions ?? [])]
  }, [
    resolvedValue,
    empty,
    missingSources,
    recalcState,
    runRecalc,
    resolvedComputedAt,
    actions,
  ])

  // Radix owns Escape for the dialog itself. This window-level listener is the
  // legacy path for triggers that keep focus outside the Radix tree; it bails
  // out when something else already handled the key so nested dialogs do not
  // close together.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const emptyCopy =
    missingDataHint ??
    (missingSources.length > 0
      ? `Не хватает источников: ${missingSources.map((s) => s.label).slice(0, 3).join(', ')}`
      : 'Для этой метрики ещё нет ни одной точки истории')

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { onOpenChange?.(o); if (!o) onClose() }}>
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

            {/* Positioning shell is pointer-transparent so a click on the
                backdrop reaches the Overlay and Radix dismisses the dialog. */}
            <div className="fixed inset-0 z-[101] flex items-end sm:items-center justify-center p-0 sm:p-6 pointer-events-none">
              <Dialog.Content asChild forceMount>
                <motion.div
                  className={[
                    'pointer-events-auto relative bg-surface-container border border-white/10',
                    'rounded-2xl shadow-modal max-w-4xl w-full max-h-[90vh] overflow-y-auto',
                  ].join(' ')}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  data-testid="drilldown-v2-content"
                >
                  {/* Header */}
                  <div className="sticky top-0 z-10 bg-surface-container/95 backdrop-blur-sm border-b border-white/[0.04] px-6 pt-6 pb-4">
                    <div className="flex items-start justify-between gap-4">
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
                        <div role="group" aria-label="Период" className="hidden sm:flex gap-1.5">
                          {PERIOD_CHIPS.map((p) => (
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
                            aria-label="Закрыть разбор метрики"
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant/50 hover:text-on-surface hover:bg-white/[0.06] transition-colors"
                          >
                            <span aria-hidden className="material-symbols-outlined text-xl">close</span>
                          </button>
                        </Dialog.Close>
                      </div>
                    </div>

                    <div role="group" aria-label="Период" className="flex sm:hidden gap-1.5 mt-3">
                      {PERIOD_CHIPS.map((p) => (
                        <PeriodChip
                          key={p.id}
                          active={period === p.id}
                          label={p.label}
                          onClick={() => setPeriod(p.id)}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="p-6 pt-5">
                    {/* Value + chart */}
                    <div className="grid grid-cols-1 md:grid-cols-[190px_1fr] gap-5 mb-5">
                      {/* Big value tile */}
                      <div className="flex md:flex-col items-baseline md:items-start gap-3 md:gap-1.5 md:py-4 md:px-4 rounded-2xl md:bg-surface-container-high md:border md:border-white/[0.04]">
                        <p className="font-mono text-4xl md:text-5xl text-on-surface leading-none">
                          {formatMetricNumber(resolvedValue)}
                        </p>
                        {resolvedUnit && (
                          <p className="text-xs font-mono text-on-surface-variant uppercase tracking-widest">
                            {resolvedUnit}
                          </p>
                        )}
                        {derivedTrend ? (
                          <p className={`text-xs font-mono ${trendTone} mt-1`}>
                            {trend.text}
                            <span className="ml-1 text-on-surface-variant/60">
                              {derivedTrend.basis}
                            </span>
                          </p>
                        ) : (
                          <p className="text-xs font-mono text-on-surface-variant/60 mt-1">
                            тренд не рассчитан — нужно минимум 2 точки
                          </p>
                        )}
                        {resolvedValue === null && (
                          <p className="text-[11px] text-on-surface-variant/70 mt-2 leading-snug">
                            {selfValueState === 'loading'
                              ? 'Считаем значение…'
                              : 'Значение не рассчитано — источник не заполнен'}
                          </p>
                        )}
                        {typeof resolvedConfidence === 'number' && resolvedValue !== null && (
                          <p className="text-[10px] font-mono text-on-surface-variant/60 mt-1">
                            уверенность {resolvedConfidence.toFixed(2)}
                          </p>
                        )}
                      </div>

                      {/* Chart area */}
                      <div className="min-h-[220px]">
                        {chartLoading ? (
                          <div className="h-[220px] flex items-center justify-center">
                            <Skeleton variant="block" className="h-44 w-full rounded-xl" />
                          </div>
                        ) : tsError ? (
                          <div className="h-[220px] flex flex-col items-center justify-center gap-3 text-center">
                            <p className="text-sm text-error">Не удалось загрузить данные</p>
                            <button
                              type="button"
                              onClick={() => void refetchTimeseries()}
                              aria-label="Повторить загрузку графика"
                              className="inline-flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-xl border border-white/[0.08] text-on-surface-variant hover:text-primary hover:border-primary/40 transition-colors"
                            >
                              <span aria-hidden className="material-symbols-outlined text-[14px]">refresh</span>
                              Повторить
                            </button>
                          </div>
                        ) : empty ? (
                          <div
                            className="h-[220px] flex flex-col items-center justify-center text-center px-4 gap-2"
                            data-testid="drilldown-empty"
                          >
                            <p className="text-sm text-on-surface-variant">
                              Недостаточно данных для построения графика
                            </p>
                            <p className="text-xs text-on-surface-variant/70 max-w-sm">
                              {emptyCopy}
                            </p>
                            <Link
                              href={ROUTE_DOCUMENTS}
                              aria-label="Загрузить документы, чтобы заполнить ряд метрики"
                              className="mt-1 inline-flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-xl border border-primary/30 text-primary bg-primary/[0.06] hover:bg-primary/[0.12] transition-colors"
                            >
                              <span aria-hidden className="material-symbols-outlined text-[14px]">upload_file</span>
                              Загрузить документы
                            </Link>
                          </div>
                        ) : noLayerVisible ? (
                          <div className="h-[220px] flex items-center justify-center text-center px-4">
                            <p className="text-sm text-on-surface-variant">
                              Все слои выключены — включите хотя бы один, чтобы увидеть график
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
                                  content={<ChartTip unit={resolvedUnit} />}
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
                                      value: `Цель: ${formatMetricNumber(goal.targetValue)}${goal.targetUnit ? ` ${goal.targetUnit}` : ''}`,
                                      position: 'insideTopRight',
                                      fill: '#ffe1bd',
                                      fontSize: 10,
                                      fontFamily: 'JetBrains Mono',
                                    }}
                                  />
                                )}

                                {showAnomalies && hasAnomalyMarkers && (
                                  <Scatter
                                    data={chartData}
                                    dataKey="anomalyValue"
                                    name="Аномалия"
                                    isAnimationActive={false}
                                    shape={(props: { cx?: number; cy?: number; payload?: DrillChartPoint }) => {
                                      const { cx, cy, payload } = props
                                      if (cx == null || cy == null || payload?.anomalyValue == null) {
                                        return <g />
                                      }
                                      return (
                                        <circle
                                          cx={cx}
                                          cy={cy}
                                          r={5}
                                          fill={severityColor(payload.anomalySeverity ?? 'info')}
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
                        <div
                          role="group"
                          aria-label="Слои графика"
                          className="flex flex-wrap gap-2 mt-3"
                        >
                          {(Object.keys(DRILL_LAYER_LABELS) as DrillLayer[]).map((layer) => (
                            <LayerChip
                              key={layer}
                              active={activeLayers.includes(layer)}
                              label={DRILL_LAYER_LABELS[layer]}
                              disabledReason={layerDisabledReason(layer)}
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
                          {resolvedFormula && (
                            <p className="mt-2 text-xs font-mono text-on-surface/80 bg-surface-container-high border border-white/[0.04] rounded-xl px-3 py-2">
                              {resolvedFormula}
                            </p>
                          )}
                        </div>
                        {/*
                          `description.current_state` is deliberately NOT rendered.
                          lib/metrics/descriptions.ts ships it as a static demo
                          narrative with hardcoded numbers ("₸84.2М при цели ₸110М",
                          descriptions.ts:78), so a «Текущее состояние» section built
                          from it would show another company's figures next to the
                          user's own value. Real state lives in the value tile,
                          the chart and «Источники данных» above.
                        */}
                      </section>
                    )}
                    {!description && (
                      <section className="mb-5">
                        <SectionHeading>Что это?</SectionHeading>
                        <p className="text-sm text-on-surface-variant/70">
                          Описание метрики не найдено в каталоге.
                        </p>
                      </section>
                    )}

                    {/* Next steps */}
                    {nextSteps.length > 0 && (
                      <section className="mb-5" data-testid="drilldown-actions">
                        <SectionHeading>Что делать</SectionHeading>
                        <div className="flex flex-wrap gap-3">
                          {nextSteps.map((a, i) => (
                            <ActionButton key={`${a.label}:${i}`} action={a} />
                          ))}
                        </div>
                      </section>
                    )}

                    {/* Provenance */}
                    <section
                      className="mb-5 p-4 rounded-2xl bg-surface-container-high border border-white/[0.04]"
                      data-testid="drilldown-provenance"
                    >
                      <SectionHeading>Источники данных</SectionHeading>
                      {!resolvedProvenance || (resolvedProvenance.considered ?? []).length === 0 ? (
                        <div className="space-y-2">
                          <p className="text-xs text-on-surface-variant">
                            Источники не определены
                          </p>
                          <Link
                            href={ROUTE_SURVEY}
                            aria-label="Заполнить анкету, чтобы у метрики появился источник"
                            className="inline-flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-xl border border-primary/30 text-primary bg-primary/[0.06] hover:bg-primary/[0.12] transition-colors"
                          >
                            <span aria-hidden className="material-symbols-outlined text-[14px]">edit_note</span>
                            Заполнить анкету
                          </Link>
                        </div>
                      ) : (
                        <ul className="divide-y divide-white/[0.04]">
                          {(resolvedProvenance.considered ?? []).map((s, i) => (
                            <ProvenanceRow
                              key={`${s.type}:${s.label}:${i}`}
                              source={s}
                              picked={isSourcePicked(s, resolvedProvenance.picked)}
                            />
                          ))}
                        </ul>
                      )}
                      {resolvedComputedAt && (
                        <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-on-surface-variant/60">
                          Обновлено {formatRelativeRu(resolvedComputedAt)}
                        </p>
                      )}
                    </section>

                    {/* Anomalies */}
                    <section>
                      <SectionHeading>Аномалии (последние 90 дней)</SectionHeading>
                      {visibleAnomalies.length === 0 ? (
                        <p className="text-xs text-on-surface-variant">
                          {empty
                            ? 'Анализ не проводился — нет ряда для поиска отклонений'
                            : 'Аномалии не обнаружены'}
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
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}

export default MetricDrillDownModalV2
