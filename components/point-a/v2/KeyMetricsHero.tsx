'use client'

/**
 * KeyMetricsHero — the 6 main KPI tiles on /point-a and /dashboard.
 *
 * Data: GET /api/v1/metrics?keys=… → { source: 'db' | 'empty', data:
 * MetricSummary[] } (real per-company values). A tile without a value says
 * «нет данных» and which document / survey step fills it — never a made-up
 * number. Clicking a tile with a value opens the metric drill-down.
 *
 * Tiles carry no zone colour: a zone needs a target (see MetricZonesGrid);
 * the delta arrow is coloured by direction (for CAC a fall is good).
 */

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useSearchParams } from 'next/navigation'
import { useMetrics } from '@/hooks/useMetrics'
import MetricDrillDownHost from '@/components/metrics/MetricDrillDownHost'
import type { MetricSummary } from '@/types/metrics'

const PERIOD_LABEL: Record<string, string> = {
  day: 'День',
  week: 'Неделя',
  month: 'Месяц',
  quarter: 'Квартал',
  year: 'Год',
}

/**
 * /api/v1/metrics accepts period / product / manager but does not apply them
 * (materialised values are company-wide, each for its own period). So the
 * tiles are never labelled with the URL filters; when a filter is picked the
 * hero says plainly that it does not apply here.
 */
export function unappliedFilterNote(f: { period: string | null; product: string | null; manager: string | null }): string | null {
  const picked = [
    f.period ? `период «${PERIOD_LABEL[f.period] ?? f.period}»` : null,
    f.product ? `продукт «${f.product}»` : null,
    f.manager ? `менеджер «${f.manager}»` : null,
  ].filter(Boolean)
  if (!picked.length) return null
  return `Фильтр (${picked.join(', ')}) к этим показателям пока не применяется: показаны значения по всей компании, каждое за свой период.`
}

export interface HeroSpec {
  /** Registry id (lib/metrics/registry.ts) requested from /api/v1/metrics. */
  id: string
  label: string
  icon: string
  /** What to upload / fill when there is no value. */
  hint: string
  hintHref: string
  /** A fall is an improvement (CAC). */
  lowerIsBetter?: boolean
}

export const HERO_METRICS: ReadonlyArray<HeroSpec> = [
  {
    id: 'biz.finansy.vyruchka_god',
    label: 'Выручка (год)',
    icon: 'payments',
    hint: 'Отчёт P&L или анкета, шаг 9',
    hintHref: '/client/onboarding/documents',
  },
  {
    id: 'biz.finansy.valovaya_marzha',
    label: 'Валовая маржа',
    icon: 'percent',
    hint: 'Отчёт P&L',
    hintHref: '/client/onboarding/documents',
  },
  {
    id: 'biz.prodazhi.sredniy_chek',
    label: 'Средний чек',
    icon: 'receipt_long',
    hint: 'Анкета (шаг 2) или выгрузка продаж',
    hintHref: '/client/onboarding',
  },
  {
    id: 'biz.klienty.aktivnykh_klientov',
    label: 'Активных клиентов',
    icon: 'groups',
    hint: 'Выгрузка клиентской базы из CRM',
    hintHref: '/client/onboarding/documents',
  },
  {
    id: 'biz.marketing.cac',
    label: 'CAC',
    icon: 'shopping_cart_checkout',
    hint: 'Маркетинговый отчёт или расходы на маркетинг (шаг 9)',
    hintHref: '/client/onboarding/documents',
    lowerIsBetter: true,
  },
  {
    id: 'biz.marketing.ltv_cac',
    label: 'LTV / CAC',
    icon: 'savings',
    hint: 'Маркетинговый отчёт',
    hintHref: '/client/onboarding/documents',
  },
]

export const HERO_METRIC_IDS: ReadonlyArray<string> = HERO_METRICS.map((m) => m.id)

/** Tone of the delta: 'good' | 'bad' | 'neutral' (exported for tests). */
export function heroDeltaTone(m: Pick<MetricSummary, 'trendDirection' | 'trend'>, lowerIsBetter = false): 'good' | 'bad' | 'neutral' {
  if (m.trendDirection === 'flat' || !Number.isFinite(m.trend) || m.trend === 0) return 'neutral'
  const up = m.trendDirection === 'up'
  return up !== lowerIsBetter ? 'good' : 'bad'
}

// ─── Tile ────────────────────────────────────────────────────────────────────

function MetricTile({ spec, metric, onOpen }: { spec: HeroSpec; metric: MetricSummary | undefined; onOpen: (m: MetricSummary) => void }) {
  if (!metric) {
    return (
      <div
        className="flex flex-col gap-2 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-4"
        aria-label={`${spec.label}: нет данных`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-[16px] text-on-surface-variant/60 flex-shrink-0" aria-hidden="true">
            {spec.icon}
          </span>
          <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.18em] truncate">{spec.label}</span>
        </div>
        <div className="text-2xl font-mono font-bold leading-none text-on-surface-variant/50">—</div>
        <p className="text-[11px] leading-snug text-on-surface-variant">
          нет данных · <span className="text-on-surface-variant/80">{spec.hint}</span>
        </p>
        <Link
          href={spec.hintHref}
          className="mt-auto inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-primary/80 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
        >
          {spec.hintHref.includes('documents') ? 'Загрузить' : 'Заполнить'}
          <span className="material-symbols-outlined text-[12px]" aria-hidden="true">arrow_forward</span>
        </Link>
      </div>
    )
  }

  const tone = heroDeltaTone(metric, spec.lowerIsBetter)
  const toneClass = tone === 'good' ? 'text-primary' : tone === 'bad' ? 'text-error' : 'text-on-surface-variant'
  const hasTrend = Number.isFinite(metric.trend) && metric.trendDirection !== 'flat' && metric.trend !== 0
  const trendText = hasTrend ? `${metric.trend > 0 ? '+' : ''}${metric.trend.toFixed(1)}%` : null

  return (
    <motion.button
      type="button"
      onClick={() => onOpen(metric)}
      whileHover={{ scale: 1.015, y: -1 }}
      whileTap={{ scale: 0.99 }}
      transition={{ duration: 0.15 }}
      aria-label={`${spec.label}: ${metric.displayValue}${trendText ? `, ${trendText}` : ''}. Открыть подробности`}
      className="group flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-surface-container px-4 py-4 text-left transition-colors hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/40"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="material-symbols-outlined text-[16px] text-primary flex-shrink-0" aria-hidden="true">
          {spec.icon}
        </span>
        <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.18em] truncate">{spec.label}</span>
      </div>
      <div className="text-2xl font-mono font-bold leading-none text-on-surface">{metric.displayValue}</div>
      {trendText ? (
        <div className={`text-[11px] font-mono ${toneClass} flex items-center gap-1`}>
          <span className="material-symbols-outlined text-[12px]" aria-hidden="true">
            {metric.trendDirection === 'up' ? 'trending_up' : 'trending_down'}
          </span>
          <span className="truncate">
            {trendText}
            {metric.trendLabel ? ` ${metric.trendLabel}` : ''}
          </span>
        </div>
      ) : (
        <div className="text-[11px] font-mono text-on-surface-variant">одно значение · динамики пока нет</div>
      )}
    </motion.button>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function KeyMetricsHero() {
  // URL filters from PointAFilterSection (period / product / manager) are not
  // applied by /api/v1/metrics — they are not sent and not shown as chips.
  const params = useSearchParams()
  const filterNote = unappliedFilterNote({ period: params.get('period'), product: params.get('product'), manager: params.get('manager') })
  const filters = useMemo(() => ({ keys: HERO_METRIC_IDS }), [])
  const { data: live = [], isLoading, isError, refetch } = useMetrics(filters)
  const [open, setOpen] = useState<MetricSummary | null>(null)

  const byId = useMemo(() => {
    const map = new Map<string, MetricSummary>()
    for (const m of live) map.set(m.id, m)
    return map
  }, [live])

  const resolved = HERO_METRICS.map((spec) => ({ spec, metric: byId.get(spec.id) }))
  const filled = resolved.filter((r) => r.metric).length

  return (
    <section className="relative bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 sm:p-6 shadow-card">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[20px] text-primary" aria-hidden="true">monitoring</span>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-headline text-xl sm:text-2xl font-semibold text-on-surface leading-tight">Ключевые метрики</h2>
            <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
              6 главных показателей · с данными: <span className="font-mono text-on-surface">{filled} из 6</span>
            </p>
            {filterNote && (
              <p className="mt-2 text-[11px] leading-relaxed text-on-surface-variant" role="note">
                {filterNote}
              </p>
            )}
          </div>
        </div>
        <Link
          href="/metrics"
          className="self-start inline-flex items-center gap-1.5 rounded-xl bg-primary/10 hover:bg-primary/15 border border-primary/30 px-3 py-1.5 text-[11px] font-mono font-bold text-primary uppercase tracking-[0.15em] transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          Все метрики
          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">arrow_forward</span>
        </Link>
      </div>

      {isError && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-error/20 bg-error/5 px-3 py-2 text-xs text-on-surface" role="alert">
          <span>Не удалось загрузить метрики</span>
          <button type="button" onClick={() => void refetch()} className="font-mono text-primary hover:text-primary/80">
            Повторить
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[124px] rounded-2xl border border-white/[0.04] bg-white/[0.02] animate-pulse" />
            ))
          : resolved.map(({ spec, metric }) => (
              <MetricTile key={spec.id} spec={spec} metric={metric} onOpen={setOpen} />
            ))}
      </div>

      {open && (
        <MetricDrillDownHost
          metricId={open.id}
          fallbackLabel={open.label}
          fallbackUnit={open.unit}
          fallbackValue={open.rawValue}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  )
}
