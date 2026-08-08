'use client'

/**
 * MetricZonesGrid — three-column overview ("Красная / Жёлтая / Зелёная зона")
 * that sits under the KeyMetricsHero on /point-a.
 *
 * Data source: GET /api/v1/metrics/catalog?includeValues=true → metric registry
 * merged with the latest materialized value + confidence + freshness. The fetch
 * lives in `./_metric-catalog` because `PointAMetricDrillDown` reads the same
 * react-query entry to resolve whichever row the user opened.
 *
 * Clicking a row calls `setActiveMetric(id)`; the drill-down is rendered by
 * `PointAMetricDrillDown`, mounted once on /point-a.
 *
 * Zone classification (in priority order):
 *  1. If the catalog item exposes a `status` field ("red" | "yellow" |
 *     "green"), trust it.
 *  2. Else, if both `value` and a `target` (catalog item or sibling goal)
 *     are numeric, compute deviation = (value − target) / target.
 *       deviation ≤ −0.20  → red
 *       deviation ≤ −0.05  → yellow
 *       otherwise          → green
 *  3. Else, if value is missing → yellow (data gap), with a hint.
 *  4. Else → green (default healthy).
 */

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useId, useMemo, useState } from 'react'
import { useMetricsStore } from '@/stores/metrics.store'
import {
  POINT_A_CATALOG_KEY,
  fetchPointACatalog,
  type CatalogItem,
} from './_metric-catalog'

type Zone = 'red' | 'yellow' | 'green'

interface ZoneRow {
  id: string
  label: string
  value: number | string | null
  unit: string
  deviation: number | null
  zone: Zone
  /** Why the metric landed in this zone — shown next to the row. */
  reason: string
}

// ─── Zone tokens ────────────────────────────────────────────────────────────

const ZONE_STYLE: Record<
  Zone,
  {
    title: string
    dot: string
    text: string
    border: string
    bg: string
    chipBg: string
    threshold: string
    href: string
  }
> = {
  red: {
    title: 'Красная зона',
    dot: 'bg-error',
    text: 'text-error',
    border: 'border-error/20',
    bg: 'bg-error/5',
    chipBg: 'bg-error/10 text-error',
    threshold:
      'Отставание от плана более чем на 20%. Требуется немедленное вмешательство.',
    href: '/metrics?zone=red',
  },
  yellow: {
    title: 'Жёлтая зона',
    dot: 'bg-amber-400',
    text: 'text-amber-400',
    border: 'border-amber-400/20',
    bg: 'bg-amber-400/5',
    chipBg: 'bg-amber-400/10 text-amber-400',
    threshold:
      'Отставание от плана от 5% до 20% либо данные не подтверждены. Под наблюдением.',
    href: '/metrics?zone=yellow',
  },
  green: {
    title: 'Зелёная зона',
    dot: 'bg-primary',
    text: 'text-primary',
    border: 'border-primary/20',
    bg: 'bg-primary/5',
    chipBg: 'bg-primary/10 text-primary',
    threshold: 'Метрика идёт в плане или опережает его. Поддерживаем темп.',
    href: '/metrics?zone=green',
  },
}

const ROW_LIMIT = 5

// ─── Helpers ────────────────────────────────────────────────────────────────

function asNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function classify(item: CatalogItem): { zone: Zone; deviation: number | null; reason: string } {
  // 1. Trust the API-provided status if present and well-formed.
  if (item.status === 'red' || item.status === 'yellow' || item.status === 'green') {
    return { zone: item.status, deviation: null, reason: 'Статус пришёл из расчёта метрики' }
  }

  const value = asNumber(item.value)
  const target = asNumber(item.target ?? null)

  // 2. Compute deviation if both value and target are numeric.
  if (value !== null && target !== null && target !== 0) {
    const deviation = (value - target) / target
    const pct = `${(deviation * 100).toFixed(0)}% от плана`
    if (deviation <= -0.2) return { zone: 'red', deviation, reason: `Отклонение ${pct}` }
    if (deviation <= -0.05) return { zone: 'yellow', deviation, reason: `Отклонение ${pct}` }
    return { zone: 'green', deviation, reason: `Отклонение ${pct}` }
  }

  // 3. Missing value → yellow (data gap). This is the most common case, and
  // without the hint the owner sees «—» in the yellow zone and no explanation.
  if (value === null) {
    return { zone: 'yellow', deviation: null, reason: 'Значение не заполнено — метрика ждёт данных' }
  }

  // 4. Default healthy.
  return { zone: 'green', deviation: null, reason: 'Плана нет — сравнивать не с чем' }
}

function formatValue(v: number | string | null, unit: string): string {
  if (v === null || v === undefined) return '—'
  const n = typeof v === 'number' ? v : Number(v)
  if (Number.isFinite(n)) {
    // Compact formatting: 1.2М / 348К / 12.4
    const abs = Math.abs(n)
    let core: string
    if (abs >= 1_000_000) core = `${(n / 1_000_000).toFixed(1)}М`
    else if (abs >= 1_000) core = `${(n / 1_000).toFixed(1)}К`
    else if (abs >= 100) core = n.toFixed(0)
    else core = n.toFixed(1)
    return unit ? `${core}${unit === '₸' || unit === '%' ? unit : ' ' + unit}` : core
  }
  return String(v)
}

// ─── Zone Card ──────────────────────────────────────────────────────────────

function ZoneCard({
  zone,
  rows,
  totalCount,
}: {
  zone: Zone
  rows: ZoneRow[]
  totalCount: number
}) {
  const style = ZONE_STYLE[zone]
  const visibleRows = rows.slice(0, ROW_LIMIT)
  const remainder = Math.max(0, totalCount - visibleRows.length)
  const setActiveMetric = useMetricsStore((s) => s.setActiveMetric)
  const [rulesOpen, setRulesOpen] = useState(false)
  const rulesId = useId()

  return (
    <div
      className={`group/card rounded-2xl border ${style.border} ${style.bg} bg-surface-container-low p-5 shadow-card flex flex-col`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full ${style.dot} flex-shrink-0`} aria-hidden />
        <h3 className="font-headline text-base text-on-surface">{style.title}</h3>
        <button
          type="button"
          onClick={() => setRulesOpen((v) => !v)}
          aria-expanded={rulesOpen}
          aria-controls={rulesId}
          aria-label={`Правила зоны «${style.title}»`}
          className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full border border-white/15 text-[10px] text-on-surface-variant hover:text-on-surface hover:border-white/30 transition focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          ?
        </button>
        <span
          className={`ml-auto rounded-xl px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.15em] ${style.chipBg}`}
        >
          {totalCount} {pluralizeMetric(totalCount)}
        </span>
      </div>

      <p
        id={rulesId}
        hidden={!rulesOpen}
        className="text-[11px] leading-relaxed text-on-surface-variant bg-surface-container rounded-xl px-3 py-2 mb-3"
      >
        {style.threshold}
      </p>

      {/* Body */}
      <ul
        className="flex flex-col gap-1 [&:hover>li:not(:hover)]:opacity-40 [&:focus-within>li:not(:focus-within)]:opacity-40"
        role="list"
      >
        {visibleRows.length === 0 && (
          <li className="py-2">
            <p className="text-xs text-on-surface-variant">Нет метрик в этой зоне</p>
            <Link
              href="/client/onboarding"
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-mono text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
            >
              <span className="material-symbols-outlined text-[13px]">edit_note</span>
              Заполнить анкету
            </Link>
          </li>
        )}
        {visibleRows.map((row) => (
          <li key={row.id} className="transition-opacity duration-150">
            <button
              type="button"
              onClick={() => setActiveMetric(row.id)}
              aria-label={`${row.label}: ${formatValue(row.value, row.unit)}. ${row.reason}. Открыть разбор`}
              className="w-full flex items-start justify-between gap-3 px-3 py-2 rounded-xl hover:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-primary/40 text-left transition"
            >
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-on-surface truncate">{row.label}</span>
                <span className="block text-[10px] font-mono text-on-surface-variant/70 truncate">
                  {row.reason}
                </span>
              </span>
              <span
                className={`font-mono font-bold text-sm ${style.text} tabular-nums flex-shrink-0 mt-0.5`}
              >
                {formatValue(row.value, row.unit)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* Remainder + CTA */}
      <div className="mt-auto pt-4 flex items-center justify-between text-xs">
        {remainder > 0 ? (
          <Link
            href={style.href}
            className={`${style.text} hover:underline font-mono`}
          >
            + ещё {remainder}
          </Link>
        ) : (
          <span />
        )}
        <Link
          href={style.href}
          className="inline-flex items-center gap-1 text-on-surface-variant hover:text-on-surface font-mono uppercase tracking-[0.15em] text-[10px]"
        >
          Открыть все
          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
        </Link>
      </div>
    </div>
  )
}

function pluralizeMetric(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'метрика'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'метрики'
  return 'метрик'
}

// ─── Skeleton + Error states ────────────────────────────────────────────────

function ZonesGridSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-5 shadow-card animate-pulse"
        >
          <div className="h-4 w-32 bg-white/[0.06] rounded mb-4" />
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((j) => (
              <div key={j} className="h-8 bg-white/[0.03] rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main export ────────────────────────────────────────────────────────────

export default function MetricZonesGrid() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: POINT_A_CATALOG_KEY,
    queryFn: fetchPointACatalog,
    staleTime: 60_000,
  })

  // Force a "no hooks in conditional" pattern by computing grouped rows in
  // a single useMemo even when data is undefined.
  const grouped = useMemo<Record<Zone, ZoneRow[]>>(() => {
    const buckets: Record<Zone, ZoneRow[]> = { red: [], yellow: [], green: [] }
    if (!data) return buckets
    for (const item of data) {
      const { zone, deviation, reason } = classify(item)
      buckets[zone].push({
        id: item.id,
        label: item.label,
        value: item.value,
        unit: item.unit,
        deviation,
        zone,
        reason,
      })
    }
    // Sort: worst deviation first inside red/yellow, freshest first inside green.
    buckets.red.sort(
      (a, b) => (a.deviation ?? 0) - (b.deviation ?? 0),
    )
    buckets.yellow.sort(
      (a, b) => (a.deviation ?? 0) - (b.deviation ?? 0),
    )
    return buckets
  }, [data])

  if (isLoading) return <ZonesGridSkeleton />

  if (isError) {
    return (
      <div className="rounded-2xl border border-error/20 bg-error/5 p-5 text-sm text-on-surface">
        <div className="flex items-center gap-2 mb-2">
          <span className="material-symbols-outlined text-error">error</span>
          <span className="font-headline">Не удалось загрузить зоны метрик</span>
        </div>
        <p className="text-on-surface-variant text-xs mb-3">
          {error instanceof Error ? error.message : 'Неизвестная ошибка'}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center gap-1 rounded-xl border border-white/10 px-3 py-1.5 text-xs hover:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <span className="material-symbols-outlined text-[14px]">refresh</span>
          Повторить
        </button>
      </div>
    )
  }

  return (
    <section
      aria-label="Зоны состояния метрик"
      className="grid grid-cols-1 lg:grid-cols-3 gap-4"
    >
      <ZoneCard zone="red" rows={grouped.red} totalCount={grouped.red.length} />
      <ZoneCard
        zone="yellow"
        rows={grouped.yellow}
        totalCount={grouped.yellow.length}
      />
      <ZoneCard
        zone="green"
        rows={grouped.green}
        totalCount={grouped.green.length}
      />
    </section>
  )
}
