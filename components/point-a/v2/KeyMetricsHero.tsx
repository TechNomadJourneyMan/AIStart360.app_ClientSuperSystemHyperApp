'use client'

/**
 * KeyMetricsHero — hero card for /point-a showing the 6 main KPI tiles.
 *
 * Data source: `useMetrics()` -> `/api/v1/metrics`.
 *
 * The live endpoint currently returns 4 default metrics (revenue, margin,
 * clients, avg_check). For LTV / CAC / no_show_rate we use placeholder ids
 * documented with TODO comments — when the resolver wires them, just align
 * the `apiId` field below and the tiles will hydrate automatically.
 *
 * The <MetricModal/> is mounted globally on the page; this component opens
 * it by calling `setActiveMetric(id)` on the metrics Zustand store.
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

const HERO_METRICS: HeroSpec[] = [
  {
    apiId: 'revenue', // matches /api/v1/metrics summary
    label: 'Выручка / мес',
    icon: 'payments',
    rule: (m) => {
      if (!m) return { zone: 'unknown', deltaLabel: '—' }
      const trend = m.trend ?? 0
      // Heuristic: trend == "к плану" approximation
      // red <90% of plan, yellow 90-100%, green >100%
      const zone: Zone = trend < -10 ? 'red' : trend < 0 ? 'yellow' : 'green'
      return { zone, deltaLabel: `${pct(trend, 1)} г/г` }
    },
  },
  {
    apiId: 'clients', // matches /api/v1/metrics summary (clients_base equivalent)
    label: 'Клиентов в базе',
    icon: 'groups',
    rule: (m) => {
      if (!m) return { zone: 'unknown', deltaLabel: '—' }
      const trend = m.trend ?? 0
      const zone: Zone = trend > 0 ? 'green' : 'yellow'
      return { zone, deltaLabel: `${pct(trend, 1)} г/г` }
    },
  },
  {
    apiId: 'avg_check',
    label: 'Средний чек',
    icon: 'receipt_long',
    rule: (m) => {
      if (!m) return { zone: 'unknown', deltaLabel: '—' }
      const trend = m.trend ?? 0
      // Per spec: always yellow heuristic, show ±% к плану
      return { zone: 'yellow', deltaLabel: `${pct(trend, 1)} к плану` }
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
      return { zone, deltaLabel: `${pct(m.trend ?? 0, 1)} к плану` }
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
      return { zone, deltaLabel: `${pct(trend, 1)} г/г` }
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
      return { zone, deltaLabel: `${pct(trend, 1)} к плану` }
    },
  },
]

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
  const dim = !metric

  return (
    <motion.button
      type="button"
      onClick={() => metric && onOpen(metric.id)}
      whileHover={metric ? { scale: 1.015, y: -1 } : undefined}
      whileTap={metric ? { scale: 0.99 } : undefined}
      transition={{ duration: 0.15 }}
      disabled={!metric}
      aria-label={`${spec.label}: ${value}, ${styles.label}`}
      className={`group relative flex flex-col gap-3 rounded-2xl border ${styles.border} ${styles.bg} px-4 py-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${
        metric ? 'hover:bg-white/[0.02] cursor-pointer' : 'cursor-not-allowed opacity-70'
      }`}
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

      <div className={`text-2xl font-mono font-bold leading-none ${dim ? 'text-on-surface-variant/60' : 'text-on-surface'}`}>
        {value}
      </div>

      <div className={`text-[11px] font-mono ${styles.text} flex items-center gap-1`}>
        {metric ? (
          <span className="material-symbols-outlined text-[12px]">
            {zone === 'red' ? 'trending_down' : zone === 'green' ? 'trending_up' : 'trending_flat'}
          </span>
        ) : null}
        <span className="truncate">{deltaLabel}</span>
      </div>
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
      title="Количество метрик в зоне"
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
    </section>
  )
}
