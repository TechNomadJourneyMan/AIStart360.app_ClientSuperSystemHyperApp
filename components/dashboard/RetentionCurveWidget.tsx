'use client'

import * as React from 'react'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useSearchParams } from 'next/navigation'
import type { RetentionCurve, RetentionPoint } from '@/types/point-a-v3'
import type { ApiResult } from '@/types/onboarding'

const h = React.createElement

// ─── Helpers ───────────────────────────────────────────────────────────────

const HORIZON_LABELS: Record<RetentionPoint['horizon_days'], string> = {
  30: '30 дней',
  60: '60 дней',
  90: '90 дней',
  180: 'Полгода',
  365: 'Год',
}

function pctFmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `${Math.round(n)}%`
}

function countFmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} тыс`
  return n.toLocaleString('ru-RU')
}

function targetTint(
  current: number | null | undefined,
  target: number,
): { bar: string; text: string; ring: string } {
  if (current === null || current === undefined || target <= 0) {
    return {
      bar: 'bg-on-surface-variant/30',
      text: 'text-on-surface-variant',
      ring: 'ring-white/[0.04]',
    }
  }
  const ratio = current / target
  if (ratio >= 1)
    return {
      bar: 'bg-primary',
      text: 'text-primary',
      ring: 'ring-primary/30',
    }
  if (ratio >= 0.7)
    return {
      bar: 'bg-amber-400',
      text: 'text-amber-400',
      ring: 'ring-amber-400/30',
    }
  return {
    bar: 'bg-error',
    text: 'text-error',
    ring: 'ring-error/30',
  }
}

// ─── Presentational view ───────────────────────────────────────────────────

export interface RetentionCurveWidgetViewProps {
  points: RetentionPoint[]
  hasClientBase?: boolean
  isLoading?: boolean
  isError?: boolean
}

export function RetentionCurveWidgetView(
  props: RetentionCurveWidgetViewProps,
) {
  const { points, hasClientBase, isLoading, isError } = props

  if (isLoading) {
    return h(
      'div',
      {
        'data-testid': 'retention-curve-skeleton',
        className: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3',
      },
      ...Array.from({ length: 5 }).map((_, i) =>
        h('div', {
          key: i,
          className:
            'h-44 rounded-2xl border border-white/[0.04] bg-surface-container-low animate-pulse',
        }),
      ),
    )
  }

  if (isError) {
    return h(
      'div',
      {
        'data-testid': 'retention-curve-error',
        className:
          'rounded-2xl border border-error/20 bg-error/5 p-5 text-sm text-on-surface-variant',
      },
      h(
        'div',
        { className: 'flex items-center gap-2' },
        h(
          'span',
          {
            className: 'material-symbols-outlined text-base text-error',
            'aria-hidden': 'true',
          },
          'error',
        ),
        'Не удалось загрузить кривую удержания.',
      ),
    )
  }

  if (!hasClientBase || points.length === 0) {
    return h(
      'div',
      {
        'data-testid': 'retention-curve-empty',
        className:
          'rounded-2xl border border-dashed border-white/10 bg-surface-container-low p-8 text-center',
      },
      h(
        'span',
        {
          className:
            'material-symbols-outlined text-3xl text-on-surface-variant/40 mb-3 block',
          'aria-hidden': 'true',
        },
        'show_chart',
      ),
      h(
        'p',
        { className: 'text-sm font-medium text-on-surface' },
        'Нет данных по удержанию',
      ),
      h(
        'p',
        { className: 'text-xs text-on-surface-variant mt-1 mb-4' },
        'Загрузите базу клиентов с датами покупок',
      ),
      h(
        'a',
        {
          href: '/client/onboarding',
          className:
            'inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary/10 text-primary text-xs font-mono hover:bg-primary/20 transition-colors',
        },
        h(
          'span',
          {
            className: 'material-symbols-outlined text-sm',
            'aria-hidden': 'true',
          },
          'upload_file',
        ),
        'Загрузить базу клиентов',
      ),
    )
  }

  return h(
    'div',
    { className: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3' },
    ...points.map((p, i) => {
      const tint = targetTint(p.current, p.target_pct)
      const widthPct =
        p.current === null || p.current === undefined
          ? 0
          : Math.min(100, Math.round((p.current / p.target_pct) * 100))
      return h(
        motion.div,
        {
          key: p.horizon_days,
          initial: { opacity: 0, y: 6 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.3, delay: i * 0.05 },
          className: `bg-surface-container-low rounded-2xl border border-white/[0.04] p-4 ring-1 ${tint.ring}`,
          ...({ 'data-testid': `retention-${p.horizon_days}` } as Record<string, string>),
        },
        h(
          'p',
          {
            className:
              'text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-3',
          },
          HORIZON_LABELS[p.horizon_days],
        ),
        h(
          'div',
          { className: 'space-y-2 mb-3 text-xs' },
          h(
            'div',
            { className: 'flex items-center justify-between' },
            h('span', { className: 'text-on-surface-variant' }, 'т. А'),
            h(
              'span',
              { className: 'font-mono text-on-surface' },
              pctFmt(p.current),
            ),
          ),
          h(
            'div',
            { className: 'flex items-center justify-between' },
            h('span', { className: 'text-on-surface-variant' }, 'План'),
            h(
              'span',
              { className: 'font-mono text-on-surface-variant' },
              countFmt(p.plan_slice),
            ),
          ),
          h(
            'div',
            { className: 'flex items-center justify-between' },
            h('span', { className: 'text-on-surface-variant' }, 'Факт'),
            h(
              'span',
              { className: `font-mono font-bold ${tint.text}` },
              countFmt(p.fact),
            ),
          ),
        ),
        h(
          'div',
          {
            className:
              'h-1.5 bg-surface-container-high rounded-full overflow-hidden mb-2',
          },
          h(motion.div, {
            className: `h-full rounded-full ${tint.bar}`,
            initial: { width: 0 },
            animate: { width: `${widthPct}%` },
            transition: { duration: 0.8, ease: 'easeOut' },
          }),
        ),
        h(
          'div',
          {
            className: 'flex items-center justify-between text-[10px] font-mono',
          },
          h('span', { className: 'text-on-surface-variant' }, 'Цель'),
          h('span', { className: tint.text }, `${p.target_pct}%`),
        ),
      )
    }),
  )
}

// ─── Fetching container ────────────────────────────────────────────────────

export function RetentionCurveWidget() {
  const params = useSearchParams()
  const qs = params.toString()
  const [points, setPoints] = useState<RetentionPoint[]>([])
  const [hasClientBase, setHasClientBase] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isError, setIsError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setIsError(false)
    fetch(`/api/v1/point-a/retention-curve${qs ? `?${qs}` : ''}`, {
      cache: 'no-store',
    })
      .then((r) => r.json() as Promise<ApiResult<RetentionCurve>>)
      .then((res) => {
        if (cancelled) return
        if (res.ok && res.data) {
          setPoints(res.data.points)
          setHasClientBase(Boolean(res.data.has_client_base))
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
  }, [qs])

  return h(RetentionCurveWidgetView, {
    points,
    hasClientBase,
    isLoading,
    isError,
  })
}

export default RetentionCurveWidget
