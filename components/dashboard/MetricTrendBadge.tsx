import * as React from 'react'
import { cn } from '@/lib/utils'

const h = React.createElement

export interface MetricTrendBadgeProps {
  direction: 'up' | 'down' | 'flat'
  deltaPct?: number
  periodLabel?: string
  /** If true, 'down' is good (e.g. CAC, churn) — colors are flipped. */
  inverse?: boolean
  className?: string
}

/**
 * Compact pill showing trend direction + delta percentage.
 * Uses Material Symbols + the brand teal / error colors.
 */
export default function MetricTrendBadge({
  direction,
  deltaPct,
  periodLabel,
  inverse = false,
  className,
}: MetricTrendBadgeProps): JSX.Element {
  const icon =
    direction === 'up'
      ? 'trending_up'
      : direction === 'down'
        ? 'trending_down'
        : 'trending_flat'

  let colorClass: string
  if (direction === 'flat') {
    colorClass = 'text-on-surface-variant'
  } else if (inverse) {
    colorClass = direction === 'up' ? 'text-error' : 'text-primary'
  } else {
    colorClass = direction === 'up' ? 'text-primary' : 'text-error'
  }

  const formatted =
    direction === 'flat'
      ? '0%'
      : deltaPct == null
        ? ''
        : `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`

  return h(
    'span',
    {
      className: cn(
        'inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-md bg-surface-container-high',
        colorClass,
        className
      ),
      'data-direction': direction,
      'data-inverse': inverse ? 'true' : 'false',
    },
    h(
      'span',
      { className: 'material-symbols-outlined text-sm leading-none' },
      icon
    ),
    formatted ? h('span', null, formatted) : null,
    periodLabel
      ? h(
          'span',
          { className: 'text-on-surface-variant ml-1' },
          periodLabel
        )
      : null
  )
}
