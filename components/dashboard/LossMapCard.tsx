'use client'

import * as React from 'react'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { LossBucket, LossMap, LossSeverity } from '@/types/point-a-v3'
import type { ApiResult } from '@/types/onboarding'

const h = React.createElement

// ─── Helpers ───────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<
  LossSeverity,
  { ring: string; text: string; bar: string; chip: string }
> = {
  critical: {
    ring: 'ring-error/30 border-error/30',
    text: 'text-error',
    bar: 'bg-error',
    chip: 'bg-error/15 text-error',
  },
  high: {
    ring: 'ring-orange-400/30 border-orange-400/20',
    text: 'text-orange-400',
    bar: 'bg-orange-400',
    chip: 'bg-orange-400/15 text-orange-400',
  },
  medium: {
    ring: 'ring-amber-400/20 border-amber-400/10',
    text: 'text-amber-400',
    bar: 'bg-amber-400',
    chip: 'bg-amber-400/10 text-amber-400',
  },
  low: {
    ring: 'ring-white/[0.04] border-white/[0.04]',
    text: 'text-on-surface-variant',
    bar: 'bg-on-surface-variant/50',
    chip: 'bg-surface-container text-on-surface-variant',
  },
}

const SEVERITY_LABEL: Record<LossSeverity, string> = {
  critical: 'критично',
  high: 'высокий',
  medium: 'средний',
  low: 'низкий',
}

const BUCKET_ICON: Record<LossBucket['bucket'], string> = {
  no_show: 'event_busy',
  missed_incoming: 'phone_missed',
  no_followup: 'forward_to_inbox',
  no_upsell: 'sell',
  no_reactivation: 'replay',
  weak_nps: 'sentiment_dissatisfied',
}

function formatKzt(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000_000)
    return `${(n / 1_000_000_000).toFixed(1)} млрд ₸`
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} млн ₸`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)} тыс ₸`
  return `${n.toLocaleString('ru-RU')} ₸`
}

// ─── Presentational view ───────────────────────────────────────────────────

export interface LossMapCardViewProps {
  buckets: LossBucket[]
  totalKzt?: number
  dominant?: LossBucket['bucket'] | null
  isLoading?: boolean
  isError?: boolean
  hasClientBase?: boolean
}

export function LossMapCardView(props: LossMapCardViewProps) {
  const { buckets, totalKzt, dominant, isLoading, isError, hasClientBase } =
    props

  if (isLoading) {
    return h(
      'div',
      { 'data-testid': 'loss-map-skeleton', className: 'space-y-3' },
      h('div', {
        className:
          'h-20 rounded-2xl border border-white/[0.04] bg-surface-container-low animate-pulse',
      }),
      h(
        'div',
        {
          className:
            'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3',
        },
        ...Array.from({ length: 6 }).map((_, i) =>
          h('div', {
            key: i,
            className:
              'h-36 rounded-2xl border border-white/[0.04] bg-surface-container-low animate-pulse',
          }),
        ),
      ),
    )
  }

  if (isError) {
    return h(
      'div',
      {
        'data-testid': 'loss-map-error',
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
        'Не удалось загрузить карту потерь.',
      ),
    )
  }

  if (!hasClientBase || buckets.length === 0) {
    return h(
      'div',
      {
        'data-testid': 'loss-map-empty',
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
        'map',
      ),
      h(
        'p',
        { className: 'text-sm font-medium text-on-surface' },
        'Карта потерь ещё не рассчитана',
      ),
      h(
        'p',
        { className: 'text-xs text-on-surface-variant mt-1 mb-4' },
        'Загрузите анкету и базу клиентов, чтобы система оценила, где теряется выручка',
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

  const sorted = [...buckets].sort(
    (a, b) => b.loss_kzt_per_year - a.loss_kzt_per_year,
  )
  const maxLoss = sorted[0]?.loss_kzt_per_year ?? 0

  const banner =
    typeof totalKzt === 'number' && totalKzt > 0
      ? h(
          motion.div,
          {
            initial: { opacity: 0, y: 4 },
            animate: { opacity: 1, y: 0 },
            transition: { duration: 0.4 },
            className:
              'rounded-2xl border border-error/20 bg-gradient-to-r from-error/[0.08] to-error/[0.02] p-3 flex items-center justify-between gap-3',
          },
          h(
            'div',
            { className: 'flex items-center gap-3 min-w-0 flex-1' },
            h(
              'div',
              {
                className:
                  'w-8 h-8 rounded-xl bg-error/15 flex items-center justify-center flex-shrink-0',
              },
              h(
                'span',
                {
                  className: 'material-symbols-outlined text-base text-error',
                  'aria-hidden': 'true',
                },
                'trending_down',
              ),
            ),
            h(
              'div',
              { className: 'min-w-0' },
              h(
                'p',
                {
                  className:
                    'text-[9px] font-mono uppercase tracking-widest text-error/80',
                },
                'Общие потери в год',
              ),
              h(
                'p',
                { className: 'text-lg font-mono font-bold text-on-surface leading-tight' },
                formatKzt(totalKzt),
              ),
            ),
          ),
          h(
            'div',
            { className: 'flex items-center gap-1.5 flex-shrink-0' },
            h(
              'a',
              {
                href: '/point-b',
                className:
                  'inline-flex items-center gap-1 text-[11px] font-mono text-error hover:text-error/80 bg-error/10 hover:bg-error/15 border border-error/30 px-2.5 py-1.5 rounded-lg transition-colors',
              },
              h(
                'span',
                { className: 'material-symbols-outlined text-[14px]', 'aria-hidden': 'true' },
                'shield',
              ),
              'Снизить',
            ),
            h(
              'a',
              {
                href: 'https://tidycal.com/istart/gtm',
                target: '_blank',
                rel: 'noopener noreferrer',
                className:
                  'inline-flex items-center gap-1 text-[11px] font-mono text-on-primary bg-primary hover:bg-primary/90 px-2.5 py-1.5 rounded-lg transition-colors',
                title: 'Обсудить план возврата выручки с экспертом',
              },
              h(
                'span',
                { className: 'material-symbols-outlined text-[14px]', 'aria-hidden': 'true' },
                'support_agent',
              ),
              'Вернуть выручку',
              h(
                'span',
                { className: 'material-symbols-outlined text-[12px] opacity-70', 'aria-hidden': 'true' },
                'open_in_new',
              ),
            ),
          ),
        )
      : null

  const grid = h(
    'div',
    { className: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3' },
    ...sorted.map((b, i) => {
      const isTop = b.bucket === dominant || (i === 0 && !dominant)
      const styles = SEVERITY_STYLES[b.severity] ?? SEVERITY_STYLES.low
      const widthPct =
        maxLoss > 0 ? Math.round((b.loss_kzt_per_year / maxLoss) * 100) : 0
      return h(
        motion.div,
        {
          key: b.bucket,
          initial: { opacity: 0, y: 6 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.3, delay: i * 0.04 },
          className: `rounded-2xl border bg-surface-container-low p-4 ring-1 ${styles.ring} ${
            isTop ? 'shadow-card' : ''
          }`,
          ...({ 'data-testid': `loss-${b.bucket}` } as Record<string, string>),
        },
        h(
          'div',
          { className: 'flex items-start justify-between mb-3' },
          h(
            'div',
            {
              className: `w-9 h-9 rounded-xl flex items-center justify-center bg-white/[0.04] ${styles.text}`,
            },
            h(
              'span',
              {
                className: 'material-symbols-outlined text-base',
                'aria-hidden': 'true',
              },
              BUCKET_ICON[b.bucket] ?? 'warning',
            ),
          ),
          h(
            'span',
            {
              className: `text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-md ${styles.chip}`,
            },
            SEVERITY_LABEL[b.severity],
          ),
        ),
        h(
          'h3',
          { className: 'text-sm font-bold text-on-surface mb-2' },
          b.label_ru,
        ),
        h(
          'p',
          { className: `text-2xl font-mono font-bold mb-1 ${styles.text}` },
          formatKzt(b.loss_kzt_per_year),
        ),
        h(
          'p',
          {
            className:
              'text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-3',
          },
          `в год · ${formatKzt(b.loss_kzt_per_month)} / мес`,
        ),
        h(
          'div',
          {
            className:
              'h-1.5 bg-surface-container-high rounded-full overflow-hidden mb-3',
          },
          h(motion.div, {
            className: `h-full rounded-full ${styles.bar}`,
            initial: { width: 0 },
            animate: { width: `${widthPct}%` },
            transition: { duration: 0.7, ease: 'easeOut' },
          }),
        ),
        h(
          'p',
          { className: 'text-xs text-on-surface-variant leading-snug' },
          h(
            'span',
            {
              className:
                'material-symbols-outlined text-xs text-primary mr-1 align-middle',
            },
            'lightbulb',
          ),
          b.recommendation_ru,
        ),
      )
    }),
  )

  return h('div', { className: 'space-y-4' }, banner, grid)
}

// ─── Fetching container ────────────────────────────────────────────────────

export function LossMapCard() {
  const [buckets, setBuckets] = useState<LossBucket[]>([])
  const [total, setTotal] = useState<number>(0)
  const [dominant, setDominant] = useState<LossBucket['bucket'] | null>(null)
  const [hasClientBase, setHasClientBase] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isError, setIsError] = useState<boolean>(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setIsError(false)
    fetch('/api/v1/point-a/loss-map', { cache: 'no-store' })
      .then((r) => r.json() as Promise<ApiResult<LossMap>>)
      .then((res) => {
        if (cancelled) return
        if (res.ok && res.data) {
          setBuckets(res.data.buckets)
          setTotal(res.data.total_loss_kzt_per_year)
          setDominant(res.data.dominant_bucket)
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
  }, [])

  return h(LossMapCardView, {
    buckets,
    totalKzt: total,
    dominant,
    hasClientBase,
    isLoading,
    isError,
  })
}

export default LossMapCard
