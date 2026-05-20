'use client'

import * as React from 'react'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { RFMResult, RFMSegmentRow } from '@/types/point-a-v3'
import type { ApiResult } from '@/types/onboarding'

const h = React.createElement

// ─── Helpers ───────────────────────────────────────────────────────────────

const SEGMENT_META: Record<
  RFMSegmentRow['segment'],
  { icon: string; color: string; bg: string }
> = {
  vip_retention: {
    icon: 'workspace_premium',
    color: 'text-primary',
    bg: 'bg-primary/10 border-primary/20',
  },
  vip_reactivation: {
    icon: 'star',
    color: 'text-amber-400',
    bg: 'bg-amber-400/10 border-amber-400/20',
  },
  loyal_active: {
    icon: 'favorite',
    color: 'text-primary',
    bg: 'bg-primary/5 border-primary/10',
  },
  churn_risk: {
    icon: 'warning',
    color: 'text-orange-400',
    bg: 'bg-orange-400/10 border-orange-400/20',
  },
  sleeping: {
    icon: 'bedtime',
    color: 'text-violet-400',
    bg: 'bg-violet-400/10 border-violet-400/20',
  },
  onetime_fresh: {
    icon: 'auto_awesome',
    color: 'text-blue-400',
    bg: 'bg-blue-400/10 border-blue-400/20',
  },
  onetime_old: {
    icon: 'history',
    color: 'text-on-surface-variant',
    bg: 'bg-surface-container border-white/[0.04]',
  },
}

function formatKzt(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000_000)
    return `${(n / 1_000_000_000).toFixed(1)} млрд ₸`
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} млн ₸`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)} тыс ₸`
  return `${n.toLocaleString('ru-RU')} ₸`
}

function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} тыс`
  return n.toLocaleString('ru-RU')
}

// ─── Presentational view ───────────────────────────────────────────────────

export interface RFMSegmentsGridViewProps {
  segments: RFMSegmentRow[]
  totalClients?: number
  isLoading?: boolean
  isError?: boolean
  hasClientBase?: boolean
}

export function RFMSegmentsGridView(props: RFMSegmentsGridViewProps) {
  const { segments, totalClients, isLoading, isError, hasClientBase } = props

  if (isLoading) {
    return h(
      'div',
      {
        'data-testid': 'rfm-skeleton',
        className:
          'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3',
      },
      ...Array.from({ length: 7 }).map((_, i) =>
        h('div', {
          key: i,
          className:
            'h-40 rounded-2xl border border-white/[0.04] bg-surface-container-low animate-pulse',
        }),
      ),
    )
  }

  if (isError) {
    return h(
      'div',
      {
        'data-testid': 'rfm-error',
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
        'Не удалось загрузить сегменты базы.',
      ),
    )
  }

  if (!hasClientBase || segments.length === 0) {
    return h(
      'div',
      {
        'data-testid': 'rfm-empty',
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
        'groups',
      ),
      h(
        'p',
        { className: 'text-sm font-medium text-on-surface' },
        'Сегментация ещё не рассчитана',
      ),
      h(
        'p',
        { className: 'text-xs text-on-surface-variant mt-1 mb-4' },
        'Загрузите базу клиентов с историей покупок — RFM-сегментация построится автоматически',
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

  const banner =
    typeof totalClients === 'number' && totalClients > 0
      ? h(
          'p',
          { className: 'text-xs text-on-surface-variant mb-3 font-mono' },
          'Всего клиентов в базе: ',
          h(
            'span',
            { className: 'text-on-surface font-bold' },
            formatCount(totalClients),
          ),
        )
      : null

  const grid = h(
    'div',
    {
      className:
        'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3',
    },
    ...segments.map((s, i) => {
      const meta = SEGMENT_META[s.segment] ?? SEGMENT_META.onetime_old
      return h(
        motion.div,
        {
          key: s.segment,
          initial: { opacity: 0, y: 6 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.3, delay: i * 0.04 },
          className: `rounded-2xl border p-4 ${meta.bg}`,
          ...({ 'data-testid': `rfm-${s.segment}` } as Record<string, string>),
        },
        h(
          'div',
          { className: 'flex items-start justify-between mb-3' },
          h(
            'div',
            {
              className: `w-9 h-9 rounded-xl flex items-center justify-center bg-white/[0.04] ${meta.color}`,
            },
            h(
              'span',
              {
                className: 'material-symbols-outlined text-base',
                'aria-hidden': 'true',
              },
              meta.icon,
            ),
          ),
          h(
            'span',
            {
              className: `text-[10px] font-mono uppercase tracking-widest ${meta.color}`,
            },
            `${Math.round(s.share_pct)}%`,
          ),
        ),
        h(
          'h3',
          { className: 'text-sm font-bold text-on-surface mb-2' },
          s.label_ru,
        ),
        h(
          'div',
          { className: 'flex items-baseline gap-2 mb-2' },
          h(
            'span',
            {
              className: 'text-2xl font-mono font-bold text-on-surface',
            },
            formatCount(s.count),
          ),
          h(
            'span',
            {
              className:
                'text-[10px] font-mono uppercase tracking-widest text-on-surface-variant',
            },
            'клиентов',
          ),
        ),
        h(
          'p',
          { className: 'text-xs font-mono text-on-surface-variant mb-3' },
          formatKzt(s.total_revenue_kzt),
        ),
        h(
          'p',
          {
            className:
              'text-xs text-on-surface-variant leading-snug border-t border-white/[0.04] pt-2',
          },
          h(
            'span',
            {
              className:
                'material-symbols-outlined text-xs text-primary mr-1 align-middle',
            },
            'arrow_forward',
          ),
          s.suggested_action_ru,
        ),
      )
    }),
  )

  return h('div', null, banner, grid)
}

// ─── Fetching container ────────────────────────────────────────────────────

export function RFMSegmentsGrid() {
  const [segments, setSegments] = useState<RFMSegmentRow[]>([])
  const [totalClients, setTotalClients] = useState<number>(0)
  const [hasClientBase, setHasClientBase] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isError, setIsError] = useState<boolean>(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setIsError(false)
    fetch('/api/v1/point-a/segments', { cache: 'no-store' })
      .then((r) => r.json() as Promise<ApiResult<RFMResult>>)
      .then((res) => {
        if (cancelled) return
        if (res.ok && res.data) {
          setSegments(res.data.segments)
          setTotalClients(res.data.total_clients)
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

  return h(RFMSegmentsGridView, {
    segments,
    totalClients,
    hasClientBase,
    isLoading,
    isError,
  })
}

export default RFMSegmentsGrid
