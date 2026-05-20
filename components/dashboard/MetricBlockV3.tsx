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

  return (
    <section
      data-testid={`metric-block-${blockId}`}
      className="bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 p-5 hover:bg-white/[0.02] transition-colors text-left focus:outline-none focus:ring-2 focus:ring-primary/40"
        aria-expanded={open}
        aria-controls={`metric-block-body-${blockId}`}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <span
              className="material-symbols-outlined text-base text-primary"
              aria-hidden="true"
            >
              {BLOCK_ICON[blockId]}
            </span>
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/70">
              Блок {def.order}
            </p>
            <h3 className="font-headline text-base font-bold text-on-surface">
              {def.label_ru}
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-3 text-[10px] font-mono uppercase tracking-widest">
            {criticalCount > 0 && (
              <span className="text-error">{criticalCount} крит.</span>
            )}
            {goodCount > 0 && (
              <span className="text-primary">{goodCount} норма</span>
            )}
            {noDataCount > 0 && (
              <span className="text-on-surface-variant">
                {noDataCount} нет данных
              </span>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs font-mono font-bold text-on-surface">
              {filledPct}%
            </p>
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
              заполнено
            </p>
          </div>
          <span
            className={`material-symbols-outlined text-base text-on-surface-variant transition-transform ${
              open ? 'rotate-180' : ''
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
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/[0.04] px-5 py-4">
              <p className="text-xs text-on-surface-variant mb-3 leading-relaxed">
                {def.description_ru}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {metrics.map((m) => {
                  const status = STATUS_META[m.status] ?? STATUS_META.no_data
                  return (
                    <div
                      key={m.key}
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
                    </div>
                  )
                })}
              </div>
            </div>
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
      <div className="space-y-3" data-testid="metric-block-v3-skeleton">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-20 rounded-2xl border border-white/[0.04] bg-surface-container-low animate-pulse"
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
    <div className="space-y-3">
      {V3_BLOCKS.map((def) => {
        const block = payload.blocks[def.id]
        const metrics = Object.values(block) as V3Metric[]
        return (
          <MetricBlockV3Card
            key={def.id}
            blockId={def.id}
            metrics={metrics}
            defaultOpen={def.id === 'sales'}
          />
        )
      })}
    </div>
  )
}

export default MetricBlockV3List
