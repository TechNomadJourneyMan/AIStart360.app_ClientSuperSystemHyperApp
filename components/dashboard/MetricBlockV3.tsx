'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { V3_BLOCKS } from '@/lib/point-a/v3/blocks'
import type {
  PointAV3,
  V3BlockId,
  V3Metric,
  V3MetricStatus,
} from '@/types/point-a-v3'
import type { ApiResult } from '@/types/onboarding'

// ─── Helpers ───────────────────────────────────────────────────────────────

const BLOCK_ICON: Record<V3BlockId, string> = {
  sales: 'trending_up',
  client: 'groups',
  retention: 'autorenew',
  finance: 'payments',
  funnel: 'filter_alt',
  ai_comms: 'smart_toy',
}

const STATUS_META: Record<
  V3MetricStatus,
  { color: string; bg: string; label_ru: string; dot: string }
> = {
  excellent: { color: 'text-primary', bg: 'bg-primary/10', dot: 'bg-primary', label_ru: 'отлично' },
  good: { color: 'text-primary', bg: 'bg-primary/5', dot: 'bg-primary', label_ru: 'норма' },
  warning: { color: 'text-amber-400', bg: 'bg-amber-400/10', dot: 'bg-amber-400', label_ru: 'внимание' },
  critical: { color: 'text-error', bg: 'bg-error/10', dot: 'bg-error', label_ru: 'критично' },
  no_data: { color: 'text-on-surface-variant', bg: 'bg-surface-container', dot: 'bg-on-surface-variant/40', label_ru: 'нет данных' },
}

function formatMetricValue(metric: V3Metric): string {
  if (metric.value === null || metric.value === undefined) return '—'
  const v = metric.value
  const u = metric.unit
  if (u === '₸') {
    if (Math.abs(v) >= 1_000_000)
      return `${(v / 1_000_000).toFixed(1)} млн ₸`
    if (Math.abs(v) >= 1_000)
      return `${(v / 1_000).toFixed(0)} тыс ₸`
    return `${v.toLocaleString('ru-RU')} ₸`
  }
  if (u === '%') return `${v.toFixed(1)}%`
  if (u === 'days') return `${v.toFixed(0)} дн`
  if (u === 'sec') return `${v.toFixed(0)} сек`
  if (u === 'count') {
    if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)} тыс`
    return v.toLocaleString('ru-RU')
  }
  // dimensionless
  if (Math.abs(v) >= 100) return v.toFixed(0)
  return v.toFixed(2)
}

// ─── Presentational block card ─────────────────────────────────────────────

export interface MetricBlockV3CardProps {
  blockId: V3BlockId
  metrics: V3Metric[]
  defaultOpen?: boolean
}

export function MetricBlockV3Card({
  blockId,
  metrics,
  defaultOpen = false,
}: MetricBlockV3CardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const def = V3_BLOCKS.find((b) => b.id === blockId)!

  const noDataCount = metrics.filter((m) => m.status === 'no_data').length
  const criticalCount = metrics.filter((m) => m.status === 'critical').length
  const goodCount = metrics.filter(
    (m) => m.status === 'good' || m.status === 'excellent',
  ).length
  const filledPct =
    metrics.length === 0
      ? 0
      : Math.round(((metrics.length - noDataCount) / metrics.length) * 100)

  const barColor =
    criticalCount > 0
      ? 'bg-error'
      : filledPct >= 60
      ? 'bg-primary'
      : filledPct >= 20
      ? 'bg-amber-400'
      : 'bg-on-surface-variant/40'

  return (
    <section
      data-testid={`metric-block-${blockId}`}
      className="bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-white/[0.02] transition-colors text-left focus:outline-none focus:ring-2 focus:ring-primary/40"
        aria-expanded={open}
        aria-controls={`metric-block-body-${blockId}`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <span
              className="material-symbols-outlined text-[14px] text-primary"
              aria-hidden="true"
            >
              {BLOCK_ICON[blockId]}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-primary/60">
                Блок {def.order}
              </span>
              {criticalCount > 0 && (
                <span className="text-[9px] font-mono uppercase text-error">· {criticalCount} крит.</span>
              )}
            </div>
            <h3 className="font-headline text-[13px] font-bold text-on-surface truncate leading-snug">
              {def.label_ru}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <div className="h-1 flex-1 bg-surface-container rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                  style={{ width: `${filledPct}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-on-surface-variant tabular-nums flex-shrink-0">
                {filledPct}%
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="hidden md:flex items-center gap-1.5 text-[9px] font-mono uppercase">
            {goodCount > 0 && (
              <span className="text-primary px-1.5 py-0.5 rounded bg-primary/10">
                {goodCount}
              </span>
            )}
            {noDataCount > 0 && (
              <span className="text-on-surface-variant px-1.5 py-0.5 rounded bg-surface-container">
                {noDataCount}
              </span>
            )}
          </div>
          <span
            className={`material-symbols-outlined text-base text-on-surface-variant transition-transform duration-300 ease-out ${
              open ? 'rotate-180 text-primary' : ''
            }`}
            aria-hidden="true"
          >
            expand_more
          </span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`metric-block-body-${blockId}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
              opacity: { duration: 0.25, ease: 'easeOut' },
            }}
            className="overflow-hidden"
          >
            <motion.div
              className="border-t border-white/[0.04] px-3 py-3"
              initial={{ y: -4 }}
              animate={{ y: 0 }}
              exit={{ y: -4 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="text-[11px] text-on-surface-variant mb-2 leading-snug">
                {def.description_ru}
              </p>
              <motion.div
                className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                initial="closed"
                animate="open"
                variants={{
                  open: { transition: { staggerChildren: 0.035, delayChildren: 0.08 } },
                  closed: {},
                }}
              >
                {metrics.map((m) => {
                  const status = STATUS_META[m.status] ?? STATUS_META.no_data
                  return (
                    <motion.div
                      key={m.key}
                      variants={{
                        open: { opacity: 1, y: 0, scale: 1 },
                        closed: { opacity: 0, y: 6, scale: 0.98 },
                      }}
                      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                      className={`rounded-xl border border-white/[0.04] p-3 ${status.bg}`}
                    >
                      <div className="flex items-start justify-between mb-1">
                        <p className="text-[11px] font-medium text-on-surface leading-tight">
                          {m.label_ru}
                        </p>
                        <span
                          className={`inline-block w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${status.dot}`}
                          title={status.label_ru}
                          aria-label={status.label_ru}
                        />
                      </div>
                      <p
                        className={`text-base font-mono font-bold ${
                          m.value === null
                            ? 'text-on-surface-variant'
                            : 'text-on-surface'
                        }`}
                      >
                        {formatMetricValue(m)}
                      </p>
                      <p className="text-[10px] font-mono text-on-surface-variant mt-1 truncate">
                        Цель: {String(m.target)}
                      </p>
                    </motion.div>
                  )
                })}
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

// ─── Fetching container (renders all 6 spec-ordered blocks) ────────────────

export function MetricBlockV3List() {
  const [payload, setPayload] = useState<PointAV3 | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isError, setIsError] = useState<boolean>(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setIsError(false)
    fetch('/api/v1/point-a/v3', { cache: 'no-store' })
      .then((r) => r.json() as Promise<ApiResult<PointAV3>>)
      .then((res) => {
        if (cancelled) return
        if (res.ok && res.data) {
          setPayload(res.data)
        } else {
          setIsError(true)
        }
      })
      .catch(() => {
        if (!cancelled) setIsError(true)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (isLoading) {
    return (
      <div
        className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2"
        data-testid="metric-block-v3-skeleton"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-14 rounded-2xl border border-white/[0.04] bg-surface-container-low animate-pulse"
          />
        ))}
      </div>
    )
  }

  if (isError || !payload) {
    return (
      <div className="rounded-2xl border border-error/20 bg-error/5 p-5 text-sm text-on-surface-variant">
        <div className="flex items-center gap-2">
          <span
            className="material-symbols-outlined text-base text-error"
            aria-hidden="true"
          >
            error
          </span>
          Не удалось загрузить метрики. Попробуйте обновить страницу.
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 auto-rows-min">
      {V3_BLOCKS.map((def) => {
        const block = payload.blocks[def.id]
        const metrics = Object.values(block) as V3Metric[]
        return (
          <MetricBlockV3Card
            key={def.id}
            blockId={def.id}
            metrics={metrics}
            defaultOpen={false}
          />
        )
      })}
    </div>
  )
}

export default MetricBlockV3List
