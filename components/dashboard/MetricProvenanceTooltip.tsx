'use client'

import * as React from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'
import { formatRuRelativeTime, sourceTypeLabel } from './_utils'

const h = React.createElement

export interface ProvenanceSource {
  type: 'survey' | 'document' | 'prisma' | 'external' | 'manual' | 'missing'
  label: string
  confidence?: number
  picked: boolean
}

export interface MetricProvenanceTooltipProps {
  sources: ProvenanceSource[]
  /** ISO timestamp — rendered as relative Russian phrase. */
  computedAt?: string
  children: React.ReactNode
  className?: string
  /** Optional override for relative-time `now` (testing/SSR). */
  now?: Date
}

/**
 * Radix-tooltip wrapper that shows where a metric value came from.
 * All copy is Russian. Caller supplies the trigger element via children.
 */
export default function MetricProvenanceTooltip({
  sources,
  computedAt,
  children,
  className,
  now,
}: MetricProvenanceTooltipProps): JSX.Element {
  const title = h(
    'div',
    {
      className:
        'text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-2',
    },
    'Источник данных'
  )

  const items = sources.map((s, i) =>
    h(
      'li',
      {
        key: `${s.type}-${i}`,
        className: cn(
          'flex items-center gap-2 text-sm',
          s.picked ? 'text-on-surface' : 'text-on-surface-variant'
        ),
        'data-picked': s.picked ? 'true' : 'false',
      },
      h(
        'span',
        {
          className: cn(
            'inline-flex items-center text-[10px] font-mono uppercase tracking-[0.15em] px-1.5 py-0.5 rounded-md',
            s.picked
              ? 'bg-primary/15 text-primary'
              : 'bg-surface-container text-on-surface-variant'
          ),
        },
        sourceTypeLabel(s.type)
      ),
      h('span', { className: 'flex-1 truncate' }, s.label),
      typeof s.confidence === 'number'
        ? h(
            'span',
            { className: 'text-xs font-mono text-on-surface-variant' },
            `${Math.round(s.confidence * 100)}%`
          )
        : null,
      s.picked
        ? h(
            'span',
            {
              className:
                'material-symbols-outlined text-primary text-base leading-none',
              'aria-label': 'Выбрано',
            },
            'check'
          )
        : null
    )
  )

  const list = h('ul', { className: 'flex flex-col gap-1.5' }, ...items)

  const footer = computedAt
    ? h(
        'div',
        {
          className:
            'text-xs text-on-surface-variant mt-3 pt-2 border-t border-white/[0.06]',
        },
        `Обновлено ${formatRuRelativeTime(computedAt, now)}`
      )
    : null

  const content = h(
    Tooltip.Content,
    {
      side: 'top',
      sideOffset: 8,
      className: cn(
        'z-50 bg-surface-container-high border border-white/10 rounded-xl shadow-modal p-3 max-w-sm',
        'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
        className
      ),
    },
    title,
    list,
    footer,
    h(Tooltip.Arrow, { className: 'fill-surface-container-high' })
  )

  return h(Tooltip.Provider, {
    delayDuration: 150,
    skipDelayDuration: 300,
    children: h(Tooltip.Root, {
      children: [
        h(Tooltip.Trigger, { asChild: true, children, key: 'trigger' }),
        h(Tooltip.Portal, { children: content, key: 'portal' }),
      ],
    }),
  })
}
