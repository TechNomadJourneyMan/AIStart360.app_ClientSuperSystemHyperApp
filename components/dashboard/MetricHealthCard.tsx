'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/Skeleton'
import MetricTrendBadge from './MetricTrendBadge'
import { confidenceDotClass, formatRuMetricWithUnit } from './_utils'

const h = React.createElement

export type MetricHighlight = 'strength' | 'gap' | 'risk' | 'opportunity' | null
export type MetricSource =
  | 'survey'
  | 'document'
  | 'prisma'
  | 'external'
  | 'manual'
  | 'missing'

export interface MetricHealthCardProps {
  metricId: string
  /** Russian label. */
  label: string
  value: number | string | null
  /** "₸" | "%" | "days" | "count" | "" */
  unit?: string
  trend?: {
    direction: 'up' | 'down' | 'flat'
    deltaPct: number
    periodLabel?: string
  }
  /** 0..1 */
  confidence?: number
  source?: MetricSource | null
  /** Material Symbols name, e.g. 'payments'. */
  icon?: string
  onClick?: () => void
  highlight?: MetricHighlight
  isLoading?: boolean
  className?: string
}

const HIGHLIGHT_CLASSES: Record<NonNullable<MetricHighlight>, string> = {
  strength: 'border-primary/30 bg-primary/[0.04]',
  gap: 'border-error/30 bg-error/[0.04]',
  risk: 'border-error/30 bg-error/[0.04]',
  opportunity: 'border-tertiary-container/30 bg-tertiary-container/[0.04]',
}

const SOURCE_DOT_CLASS: Record<MetricSource, string> = {
  survey: 'bg-primary',
  document: 'bg-tertiary-container',
  prisma: 'bg-amber-400/70',
  external: 'bg-blue-400/70',
  manual: 'bg-on-surface-variant',
  missing: 'bg-on-surface-variant/40',
}

const SOURCE_LABEL: Record<MetricSource, string> = {
  survey: 'Анкета',
  document: 'Документ',
  prisma: 'CRM',
  external: 'Внешний',
  manual: 'Вручную',
  missing: 'Нет данных',
}

/**
 * Premium metric tile for the Point A intelligence dashboard.
 * Shows label, value, trend, provenance hint and an optional highlight tint.
 */
export default function MetricHealthCard({
  metricId,
  label,
  value,
  unit,
  trend,
  confidence,
  source,
  icon,
  onClick,
  highlight,
  isLoading,
  className,
}: MetricHealthCardProps): JSX.Element {
  const isNull = value === null || value === undefined || value === ''
  const interactive = Boolean(onClick)
  const highlightClass = highlight ? HIGHLIGHT_CLASSES[highlight] : ''
  const formattedValue = isNull ? '«—»' : formatRuMetricWithUnit(value, unit)

  const containerClass = cn(
    'group relative rounded-2xl bg-surface-container border border-white/[0.04] p-5 transition-all duration-200',
    interactive && 'cursor-pointer hover:border-primary/40',
    highlightClass,
    className
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick?.()
    }
  }

  // Top row: icon + label + hover chevron
  const topRow = h(
    'div',
    { className: 'flex items-center justify-between gap-3 mb-3' },
    h(
      'div',
      { className: 'flex items-center gap-2 min-w-0' },
      icon
        ? h(
            'span',
            {
              className:
                'material-symbols-outlined text-on-surface-variant/70 text-lg leading-none',
              'aria-hidden': true,
            },
            icon
          )
        : null,
      h(
        'p',
        {
          className:
            'text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.2em] truncate',
        },
        label
      )
    ),
    interactive
      ? h(
          'span',
          {
            className:
              'material-symbols-outlined text-on-surface-variant/40 text-base opacity-0 group-hover:opacity-100 transition-opacity',
            'aria-hidden': true,
          },
          'chevron_right'
        )
      : null
  )

  // Middle row: value (skeleton / null / number)
  let middleContent: React.ReactNode
  if (isLoading) {
    middleContent = h(Skeleton, { variant: 'line', className: 'h-8 w-2/3' })
  } else if (isNull) {
    middleContent = h(
      'span',
      { className: 'font-mono text-3xl text-on-surface-variant' },
      '«—»'
    )
  } else {
    middleContent = h(
      'span',
      { className: 'font-mono text-3xl text-on-surface' },
      formattedValue
    )
  }
  const middleRow = h('div', { className: 'mb-3 min-h-[2.25rem]' }, middleContent)

  // Bottom row: trend / nothing badge + provenance
  let leftBottom: React.ReactNode
  if (isLoading) {
    leftBottom = h(Skeleton, { variant: 'line', className: 'h-4 w-24' })
  } else if (isNull) {
    leftBottom = h(
      'span',
      {
        className:
          'text-xs text-on-surface-variant border border-dashed border-white/[0.06] rounded-md px-2 py-0.5',
      },
      'Нет данных'
    )
  } else if (trend) {
    leftBottom = h(MetricTrendBadge, {
      direction: trend.direction,
      deltaPct: trend.deltaPct,
      periodLabel: trend.periodLabel,
    })
  } else {
    leftBottom = h('span', { 'aria-hidden': true })
  }

  const rightBottom =
    source && !isLoading
      ? h(
          'span',
          {
            className:
              'inline-flex items-center gap-1.5 text-[10px] font-mono text-on-surface-variant',
            title: SOURCE_LABEL[source],
          },
          h('span', {
            className: cn(
              'w-2 h-2 rounded-full',
              confidence != null
                ? confidenceDotClass(confidence)
                : SOURCE_DOT_CLASS[source]
            ),
            'aria-hidden': true,
          }),
          h(
            'span',
            { className: 'uppercase tracking-[0.15em]' },
            SOURCE_LABEL[source]
          )
        )
      : null

  const bottomRow = h(
    'div',
    { className: 'flex items-center justify-between gap-2' },
    leftBottom,
    rightBottom
  )

  const motionProps: Record<string, unknown> = {
    whileHover: interactive ? { y: -2 } : undefined,
    className: containerClass,
    onClick: interactive ? onClick : undefined,
    onKeyDown: handleKeyDown,
    role: interactive ? 'button' : undefined,
    tabIndex: interactive ? 0 : undefined,
    'aria-label': interactive ? `Открыть детали метрики ${label}` : undefined,
    'data-metric-id': metricId,
    'data-highlight': highlight ?? '',
  }
  return h(motion.div, motionProps as never, topRow, middleRow, bottomRow)
}
