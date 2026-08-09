'use client'

/**
 * KeyMetricsHero — hero card for /point-a showing the 6 main KPI tiles.
 *
 * Data source: `useMetrics()` -> `/api/v1/metrics`.
 *
 * The live endpoint (`/api/v1/metrics`) currently returns 4 default metrics
 * (revenue, clients, avg_check, margin). LTV / CAC / no_show_rate are NOT yet
 * exposed by the resolver/catalog, so their tiles render an explicit EMPTY
 * state ("—" + «нет данных») — never a fabricated value. The moment the
 * endpoint starts returning an id matching the tile's `apiId`, the tile
 * hydrates automatically (see `byId.get(spec.apiId)` below).
 *
 * Clicking a tile calls `setActiveMetric(id)` on the metrics Zustand store.
 * The drill-down itself is rendered by `PointAMetricDrillDown`, mounted once
 * on /point-a — without that host the click changes the store and opens
 * nothing.
 */

import Link from 'next/link'
import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useSearchParams } from 'next/navigation'
import { useMetrics } from '@/hooks/useMetrics'
import { useMetricsStore } from '@/stores/metrics.store'
import type { MetricSummary } from '@/types/metrics'

const PERIOD_LABEL: Record<string, string> = {
  day: 'День',
  week: 'Неделя',
  month: 'Месяц',
  quarter: 'Квартал',
  year: 'Год',
}

// ─── Status palette ──────────────────────────────────────────────────────────

type Zone = 'green' | 'yellow' | 'red' | 'unknown'

const ZONE_STYLES: Record<Zone, { text: string; bg: string; border: string; dot: string; label: string }> = {
  green: {
    text: 'text-primary',
    bg: 'bg-primary/5',
    border: 'border-primary/20',
    dot: 'bg-primary',
    label: 'В норме',
  },
  yellow: {
    text: 'text-amber-400',
    bg: 'bg-amber-400/5',
    border: 'border-amber-400/20',
    dot: 'bg-amber-400',
    label: 'Внимание',
  },
  red: {
    text: 'text-error',
    bg: 'bg-error/5',
    border: 'border-error/20',
    dot: 'bg-error',
    label: 'Риск',
  },
  unknown: {
    text: 'text-on-surface-variant',
    bg: 'bg-white/[0.02]',
    border: 'border-white/[0.06]',
    dot: 'bg-on-surface-variant/40',
    label: 'Нет данных',
  },
}

// ─── Hero metric spec ────────────────────────────────────────────────────────

type ZoneRule = (m: MetricSummary | undefined) => { zone: Zone; deltaLabel: string }

interface HeroSpec {
  /** id used to look up the metric in the live API response */
  apiId: string
  label: string
  icon: string
  /** label shown when the live endpoint returns no value */
  placeholderValue?: string
  todo?: boolean
  rule: ZoneRule
}

function pct(n: number, digits = 0): string {
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(digits)}%`
}

/**
 * Period wording for the delta. The API is the only thing that knows which
 * period the trend was computed against (`MetricSummary.trendLabel`), so it
 * wins; the fallback stays neutral instead of claiming "г/г" or "к плану".
 */
function deltaText(m: MetricSummary, digits = 1): string {
  const label = m.trendLabel?.trim()
  return label ? `${pct(m.trend ?? 0, digits)} ${label}` : pct(m.trend ?? 0, digits)
}

const HERO_METRICS: HeroSpec[] = [
  {
    apiId: 'revenue', // matches /api/v1/metrics summary
    label: 'Выручка за период',
    icon: 'payments',
    rule: (m) => {
      if (!m) return { zone: 'unknown', deltaLabel: '—' }
      const trend = m.trend ?? 0
      const zone: Zone = trend < -10 ? 'red' : trend < 0 ? 'yellow' : 'green'
      return { zone, deltaLabel: deltaText(m) }
    },
  },
  {
    apiId: 'clients',
    label: 'Покупатели за период',
    icon: 'groups',
    rule: (m) => {
      if (!m) return { zone: 'unknown', deltaLabel: '—' }
      const trend = m.trend ?? 0
      const zone: Zone = trend > 0 ? 'green' : 'yellow'
      return { zone, deltaLabel: deltaText(m) }
    },
  },
  {
    apiId: 'avg_check',
    label: 'Средний чек',
    icon: 'receipt_long',
    rule: (m) => {
      if (!m) return { zone: 'unknown', deltaLabel: '—' }
      // No target for the average cheque reaches this component, so the zone
      // follows the trend — the same basis as the other tiles. (The previous
      // rule pinned every answer to yellow regardless of the value.)
      const trend = m.trend ?? 0
      const zone: Zone = trend < -10 ? 'red' : trend < 0 ? 'yellow' : 'green'
      return { zone, deltaLabel: deltaText(m) }
    },
  },
  {
    // TODO: replace `no_show_rate` once the resolver exposes a real id
    // (e.g. `biz.sales.protsent_neyavok` or similar).
    apiId: 'no_show_rate',
    label: 'Процент неявок',
    icon: 'event_busy',
    placeholderValue: '—',
    todo: true,
    rule: (m) => {
      if (!m) return { zone: 'unknown', deltaLabel: 'нет данных' }
      const v = m.rawValue ?? 0
      const zone: Zone = v > 15 ? 'red' : v >= 8 ? 'yellow' : 'green'
      return { zone, deltaLabel: deltaText(m) }
    },
  },
  {
    // TODO: replace `ltv` once the resolver exposes a real id and a
    // companion `ltv_cac_ratio` so we can colour-code properly.
    apiId: 'ltv',
    label: 'LTV (доход с клиента)',
    icon: 'savings',
    placeholderValue: '—',
    todo: true,
    rule: (m) => {
      if (!m) return { zone: 'unknown', deltaLabel: 'нет данных' }
      // Without ltv/cac ratio in scope here, fall back to trend heuristic.
      const trend = m.trend ?? 0
      const zone: Zone = trend > 0 ? 'green' : trend < -5 ? 'red' : 'yellow'
      return { zone, deltaLabel: deltaText(m) }
    },
  },
  {
    // TODO: replace `cac` once the resolver exposes a real id and a
    // companion payback-period metric.
    apiId: 'cac',
    label: 'CAC (цена нового)',
    icon: 'shopping_cart_checkout',
    placeholderValue: '—',
    todo: true,
    rule: (m) => {
      if (!m) return { zone: 'unknown', deltaLabel: 'нет данных' }
      const trend = m.trend ?? 0
      // For CAC, falling cost is good — flip the sign meaning.
      const zone: Zone = trend < 0 ? 'green' : trend < 5 ? 'yellow' : 'red'
      return { zone, deltaLabel: deltaText(m) }
    },
  },
]

/**
 * Human labels for the six hero ids. `PointAMetricDrillDown` uses them so the
 * "нет данных" panel can name the metric instead of echoing a raw id.
 */
export const HERO_METRIC_LABELS: Record<string, string> = Object.fromEntries(
  HERO_METRICS.map((s) => [s.apiId, s.label]),
)

// ─── Tile ────────────────────────────────────────────────────────────────────

interface TileProps {
  spec: HeroSpec
  metric: MetricSummary | undefined
  onOpen: (id: string) => void
}

function MetricTile({ spec, metric, onOpen }: TileProps) {
  const { zone, deltaLabel } = spec.rule(metric)
  const styles = ZONE_STYLES[zone]
  const value = metric?.displayValue ?? spec.placeholderValue ?? '—'
  // Empty state: no live value from the endpoint. Render a clean
  // "нет данных" affordance instead of a value/trend that doesn't exist.
  const isEmpty = !metric

  return (
    <motion.button
      type="button"
      onClick={() => onOpen(metric?.id ?? spec.apiId)}
      whileHover={{ scale: 1.015, y: -1 }}
      whileTap={{ scale: 0.99 }}
      transition={{ duration: 0.15 }}
      aria-label={
        isEmpty
          ? `${spec.label}: нет данных. Открыть разбор — каких данных не хватает`
          : `${spec.label}: ${value}, ${styles.label}. Открыть разбор`
      }
      className={`group relative flex flex-col gap-3 rounded-2xl border ${styles.border} ${styles.bg} px-4 py-4 text-left transition-colors cursor-pointer hover:bg-white/[0.02] focus:outline-none focus:ring-2 focus:ring-primary/40`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`material-symbols-outlined text-[16px] ${styles.text} flex-shrink-0`}>
            {spec.icon}
          </span>
          <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.18em] truncate">
            {spec.label}
          </span>
        </div>
        <span className={`w-1.5 h-1.5 rounded-full ${styles.dot} flex-shrink-0 mt-1`} aria-hidden="true" />
      </div>

      <div className={`text-2xl font-mono font-bold leading-none ${isEmpty ? 'text-on-surface-variant/50' : 'text-on-surface'}`}>
        {value}
      </div>

      {isEmpty ? (
        <div className="flex items-center gap-1 text-[11px] font-mono text-on-surface-variant/70">
          <span className="material-symbols-outlined text-[12px]">do_not_disturb_on</span>
          <span className="truncate">нет данных · разбор</span>
        </div>
      ) : (
        <div className={`text-[11px] font-mono ${styles.text} flex items-center gap-1`}>
          <span className="material-symbols-outlined text-[12px]">
            {zone === 'red' ? 'trending_down' : zone === 'green' ? 'trending_up' : 'trending_flat'}
          </span>
          <span className="truncate">{deltaLabel}</span>
        </div>
      )}
    </motion.button>
  )
}

// ─── Header badge ────────────────────────────────────────────────────────────

function ZoneBadge({ count, zone }: { count: number; zone: 'red' | 'yellow' | 'green' }) {
  const styles = ZONE_STYLES[zone]
  const word = zone === 'red' ? 'красных' : zone === 'yellow' ? 'жёлтых' : 'зелёных'
  return (
    <div
      className={`flex items-center gap-1.5 rounded-xl border ${styles.border} ${styles.bg} px-2.5 py-1`}
      // The counter covers the six tiles below, not the whole catalog — the
      // zones grid under this card counts all 122 metrics separately.
      aria-label={`${count} из шести показателей в зоне «${word}»`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${styles.dot}`} aria-hidden="true" />
      <span className={`text-[11px] font-mono font-bold ${styles.text}`}>{count}</span>
      <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.15em]">
        {word}
      </span>
    </div>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function KeyMetricsHero() {
  // URL-driven filters — populated by the PointAFilterSection at the top
  // of /point-a and /dashboard. Changing a chip there reruns this fetch.
  const params = useSearchParams()
  const filters = useMemo(
    () => ({
      period: params.get('period'),
      product: params.get('product'),
      manager: params.get('manager'),
    }),
    [params],
  )
  const periodLabel = PERIOD_LABEL[filters.period ?? 'month'] ?? 'Месяц'
  const { data: live = [], isLoading } = useMetrics(filters)
  const setActiveMetric = useMetricsStore((s) => s.setActiveMetric)

  const byId = useMemo(() => {
    const map = new Map<string, MetricSummary>()
    for (const m of live) map.set(m.id, m)
    return map
  }, [live])

  const resolved = HERO_METRICS.map((spec) => ({ spec, metric: byId.get(spec.apiId) }))

  const zoneCounts = useMemo(() => {
    let red = 0
    let yellow = 0
    let green = 0
    for (const { spec, metric } of resolved) {
      const { zone } = spec.rule(metric)
      if (zone === 'red') red += 1
      else if (zone === 'yellow') yellow += 1
      else if (zone === 'green') green += 1
    }
    return { red, yellow, green }
  }, [resolved])

  const missingCount = resolved.filter(({ metric }) => !metric).length

  return (
    <section className="relative bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 sm:p-6 shadow-card">
      {/* Floating CTA */}
      <Link
        href="/metrics"
        className="absolute top-4 right-4 sm:top-5 sm:right-5 inline-flex items-center gap-1.5 rounded-xl bg-primary/10 hover:bg-primary/15 border border-primary/30 px-3 py-1.5 text-[11px] font-mono font-bold text-primary uppercase tracking-[0.15em] transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        <span className="material-symbols-outlined text-[14px]">add</span>
        Все метрики
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-5 mb-5 pr-32 sm:pr-36">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[20px] text-primary">monitoring</span>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-headline text-xl sm:text-2xl font-semibold text-on-surface leading-tight">
              Ключевые метрики
            </h2>
            <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
              6 главных показателей на дашборде · нажмите «Все метрики» для полного списка
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="text-[10px] font-mono uppercase tracking-widest rounded-full px-2 py-0.5 border border-primary/30 bg-primary/10 text-primary">
                Период: {periodLabel}
              </span>
              {filters.product && (
                <span className="text-[10px] font-mono uppercase tracking-widest rounded-full px-2 py-0.5 border border-white/[0.08] bg-surface-container text-on-surface-variant">
                  Продукт: {filters.product}
                </span>
              )}
              {filters.manager && (
                <span className="text-[10px] font-mono uppercase tracking-widest rounded-full px-2 py-0.5 border border-white/[0.08] bg-surface-container text-on-surface-variant">
                  Менеджер: {filters.manager}
                </span>
              )}
              {isLoading && (
                <span className="text-[10px] font-mono text-on-surface-variant inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
                  обновляется…
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Zone badges */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <ZoneBadge count={zoneCounts.red} zone="red" />
          <ZoneBadge count={zoneCounts.yellow} zone="yellow" />
          <ZoneBadge count={zoneCounts.green} zone="green" />
        </div>
      </div>

      {/* Tiles grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-[112px] rounded-2xl border border-white/[0.04] bg-white/[0.02] animate-pulse"
              />
            ))
          : resolved.map(({ spec, metric }) => (
              <MetricTile key={spec.apiId} spec={spec} metric={metric} onOpen={setActiveMetric} />
            ))}
      </div>

      {/* Honest summary of what is still missing — never a dead end */}
      {!isLoading && missingCount > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-white/[0.06] bg-surface-container px-4 py-3">
          <span className="material-symbols-outlined text-[16px] text-on-surface-variant/70">
            info
          </span>
          <p className="text-xs text-on-surface-variant leading-relaxed flex-1 min-w-[12rem]">
            {missingCount} из {resolved.length} показателей пока без значения — ни анкета,
            ни загруженные документы их не заполнили.
          </p>
          <Link
            href="/client/onboarding"
            className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-primary transition-colors hover:bg-primary/15 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <span className="material-symbols-outlined text-[14px]">edit_note</span>
            Заполнить анкету
          </Link>
        </div>
      )}
    </section>
  )
}
