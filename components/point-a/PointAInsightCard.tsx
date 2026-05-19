'use client'

import * as React from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

const h = React.createElement

export type InsightKind = 'risk' | 'insight' | 'quick_win' | 'opportunity'
export type RiskLevel = 'critical' | 'important' | 'moderate'

export interface PointAInsightCardProps {
  kind: InsightKind
  level?: RiskLevel
  /** Russian area label: "Финансы" | "Продажи" | ... */
  area: string
  text: string
  impact?: string
  /** For quick_wins: timeline string, e.g. "2 недели". */
  timeline?: string
  cta?: { label: string; onClick: () => void }
  className?: string
}

const KIND_ICON: Record<InsightKind, string> = {
  risk: 'warning',
  insight: 'lightbulb',
  quick_win: 'bolt',
  opportunity: 'auto_awesome',
}

const KIND_LABEL: Record<InsightKind, string> = {
  risk: 'Риск',
  insight: 'Инсайт',
  quick_win: 'Быстрая победа',
  opportunity: 'Возможность',
}

const LEVEL_LABEL: Record<RiskLevel, string> = {
  critical: 'Критично',
  important: 'Важно',
  moderate: 'Умеренно',
}

function containerClassFor(kind: InsightKind, level?: RiskLevel): string {
  if (kind === 'risk') {
    if (level === 'critical') return 'border-error/50 bg-error/[0.06]'
    if (level === 'important') return 'border-error/30 bg-error/[0.04]'
    return 'border-amber-400/30 bg-amber-400/[0.04]'
  }
  if (kind === 'insight') return 'border-white/10 bg-surface-container'
  if (kind === 'quick_win') return 'border-primary/40 bg-primary/[0.06]'
  return 'border-tertiary-container/40 bg-tertiary-container/[0.06]'
}

function iconColorFor(kind: InsightKind, level?: RiskLevel): string {
  if (kind === 'risk') {
    if (level === 'moderate') return 'text-amber-400'
    return 'text-error'
  }
  if (kind === 'quick_win') return 'text-primary'
  if (kind === 'opportunity') return 'text-tertiary-container'
  return 'text-on-surface-variant'
}

function ctaVariantFor(
  kind: InsightKind
): 'primary' | 'secondary' | 'danger' {
  if (kind === 'quick_win' || kind === 'opportunity') return 'primary'
  if (kind === 'risk') return 'danger'
  return 'secondary'
}

/**
 * Card for rendering a single insight / risk / quick-win / opportunity
 * on the Point A page. All copy is Russian.
 */
export default function PointAInsightCard({
  kind,
  level,
  area,
  text,
  impact,
  timeline,
  cta,
  className,
}: PointAInsightCardProps): JSX.Element {
  const containerClass = cn(
    'rounded-2xl border p-4 flex flex-col gap-3',
    containerClassFor(kind, level),
    className
  )

  // Top row: area chip + level label + kind icon
  const topRow = h(
    'div',
    { className: 'flex items-center justify-between gap-3' },
    h(
      'span',
      {
        className:
          'text-xs font-mono text-primary/70 uppercase tracking-[0.2em] truncate',
      },
      area
    ),
    h(
      'span',
      { className: 'inline-flex items-center gap-1.5' },
      kind === 'risk' && level
        ? h(
            'span',
            {
              className:
                'text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.15em]',
            },
            LEVEL_LABEL[level]
          )
        : null,
      h(
        'span',
        {
          className: cn(
            'material-symbols-outlined text-lg leading-none',
            iconColorFor(kind, level)
          ),
          'aria-label': KIND_LABEL[kind],
        },
        KIND_ICON[kind]
      )
    )
  )

  // Body
  const body = h(
    'div',
    null,
    h(
      'p',
      { className: 'text-on-surface text-sm leading-relaxed' },
      text
    ),
    impact
      ? h(
          'p',
          {
            className:
              'text-on-surface-variant text-sm mt-1 leading-relaxed',
          },
          impact
        )
      : null
  )

  // Footer: timeline + CTA
  let footer: React.ReactNode = null
  if (timeline || cta) {
    const left =
      kind === 'quick_win' && timeline
        ? h(
            'span',
            {
              className:
                'text-xs bg-surface-container-high rounded-md px-2 py-0.5 font-mono text-on-surface-variant',
            },
            `Срок: ${timeline}`
          )
        : h('span', { 'aria-hidden': true })

    const ctaButton = cta
      ? h(
          Button,
          {
            variant: ctaVariantFor(kind),
            size: 'sm',
            onClick: cta.onClick,
          },
          cta.label
        )
      : null

    footer = h(
      'div',
      { className: 'flex items-center justify-between gap-3 mt-1' },
      left,
      ctaButton
    )
  }

  return h(
    'div',
    {
      className: containerClass,
      'data-kind': kind,
      'data-level': level ?? '',
    },
    topRow,
    body,
    footer
  )
}
