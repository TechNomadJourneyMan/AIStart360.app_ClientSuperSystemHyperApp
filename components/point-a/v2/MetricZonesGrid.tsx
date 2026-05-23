'use client'

/**
 * MetricZonesGrid — three-column overview ("Красная / Жёлтая / Зелёная зона")
 * that sits under the KeyMetricsHero on /point-a.
 *
 * Data sources:
 *  - GET /api/v1/metrics/catalog?includeValues=true → metric registry merged
 *    with the latest materialized value + confidence + freshness.
 *  - useMetricGoal(id) is invoked lazily inside the row when the user opens
 *    a metric via the existing MetricModal (we don't fetch goals per row up
 *    front — it would be 122 queries).
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
import { useMemo, useState } from 'react'
import { useMetricsStore } from '@/stores/metrics.store'

// ─── Types matching /api/v1/metrics/catalog response ────────────────────────

interface CatalogItemSource {
  type: string
  key?: string
  field?: string
  doc_type?: string
  system?: string
}

interface CatalogItem {
  id: string
  label: string
  namespace: string
  department: string | null
  goalNumber: string | null
  unit: string
  formula: string | null
  sources: CatalogItemSource[]
  value: number | string | null
  confidence: number | null
  source: string | null
  computedAt: string | null
  fresh: boolean
  // Optional fields the API may or may not include — read defensively.
  status?: 'red' | 'yellow' | 'green' | string | null
  target?: number | null
}

interface CatalogResponse {
  ok: boolean
  data?: {
    total: number
    page: number
    pageSize: number
    items: CatalogItem[]
  }
  error?: string
}

type Zone = 'red' | 'yellow' | 'green'

interface ZoneRow {
  id: string
  label: string
  value: number | string | null
  unit: string
  deviation: number | null
  zone: Zone
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

function classify(item: CatalogItem): { zone: Zone; deviation: number | null } {
  // 1. Trust the API-provided status if present and well-formed.
  if (item.status === 'red' || item.status === 'yellow' || item.status === 'green') {
    return { zone: item.status, deviation: null }
  }

  const value = asNumber(item.value)
  const target = asNumber(item.target ?? null)

  // 2. Compute deviation if both value and target are numeric.
  if (value !== null && target !== null && target !== 0) {
    const deviation = (value - target) / target
    if (deviation <= -0.2) return { zone: 'red', deviation }
    if (deviation <= -0.05) return { zone: 'yellow', deviation }
    return { zone: 'green', deviation }
  }

  // 3. Missing value → yellow (data gap).
  if (value === null) return { zone: 'yellow', deviation: null }

  // 4. Default healthy.
  return { zone: 'green', deviation: null }
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

async function fetchCatalog(): Promise<CatalogItem[]> {
  const res = await fetch(
    '/api/v1/metrics/catalog?includeValues=true&pageSize=200&sort=label_asc',
    { credentials: 'include' },
  )
  if (!res.ok) {
    throw new Error(`Не удалось загрузить каталог метрик (${res.status})`)
  }
  const json = (await res.json()) as CatalogResponse
  if (!json.ok || !json.data) {
    throw new Error(json.error ?? 'Каталог метрик недоступен')
  }
  return json.data.items
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

  return (
    <div
      className={`group/card rounded-2xl border ${style.border} ${style.bg} bg-surface-container-low p-5 shadow-card flex flex-col`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <span className={`w-2 h-2 rounded-full ${style.dot} flex-shrink-0`} aria-hidden />
        <h3 className="font-headline text-base text-on-surface">{style.title}</h3>
        <button
          type="button"
          title={style.threshold}
          aria-label={`Правила зоны: ${style.threshold}`}
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

      {/* Body */}
      <ul
        className="flex flex-col gap-1 [&:hover>li:not(:hover)]:opacity-40"
        role="list"
      >
        {visibleRows.length === 0 && (
          <li className="text-xs text-on-surface-variant py-2 italic">
            Нет метрик в этой зоне
          </li>
        )}
        {visibleRows.map((row) => (
          <li key={row.id} className="transition-opacity duration-150">
            <button
              type="button"
              onClick={() => setActiveMetric(row.id)}
              className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl hover:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-primary/40 text-left transition"
            >
              <span className="text-sm text-on-surface truncate flex-1 min-w-0">
                {row.label}
              </span>
              <span
                className={`font-mono font-bold text-sm ${style.text} tabular-nums flex-shrink-0`}
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
    queryKey: ['metrics', 'catalog', 'zones'],
    queryFn: fetchCatalog,
    staleTime: 60_000,
  })

  // Force a "no hooks in conditional" pattern by computing grouped rows in
  // a single useMemo even when data is undefined.
  const grouped = useMemo<Record<Zone, ZoneRow[]>>(() => {
    const buckets: Record<Zone, ZoneRow[]> = { red: [], yellow: [], green: [] }
    if (!data) return buckets
    for (const item of data) {
      const { zone, deviation } = classify(item)
      buckets[zone].push({
        id: item.id,
        label: item.label,
        value: item.value,
        unit: item.unit,
        deviation,
        zone,
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

  const [, _force] = useState(0) // keep React lint happy if grouped changes shape
  void _force

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
