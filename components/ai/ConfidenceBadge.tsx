'use client'

/**
 * Small badge showing extraction confidence + source. Clicking opens a
 * tooltip / modal showing the raw excerpt (evidence) and extractor info.
 *
 * Usage:
 *   <ConfidenceBadge
 *     confidence={0.85}
 *     source="document"
 *     sourceLabel="sales_q3.pdf"
 *     excerpt="Revenue for Q3 2024 totaled 12,500,000 KZT..."
 *   />
 */

import { useState } from 'react'

import { cn } from '@/lib/utils'

export interface ConfidenceBadgeProps {
  confidence: number
  /** 'document' | 'survey' | 'calculated' | 'manual' */
  source?: string
  /** Label shown after percentage — typically a filename or "анкета". */
  sourceLabel?: string
  /** Raw excerpt for evidence popover. */
  excerpt?: string
  /** Extractor name@version for debug display. */
  extractor?: string
  className?: string
}

function classifyConfidence(c: number): 'high' | 'medium' | 'low' {
  if (c >= 0.8) return 'high'
  if (c >= 0.5) return 'medium'
  return 'low'
}

function sourceShort(source?: string): string {
  if (!source) return ''
  if (source === 'document') return 'doc'
  if (source === 'survey') return 'анкета'
  if (source === 'calculated') return 'calc'
  if (source === 'manual') return 'ручной'
  return source
}

export function ConfidenceBadge({
  confidence,
  source,
  sourceLabel,
  excerpt,
  extractor,
  className,
}: ConfidenceBadgeProps) {
  const [open, setOpen] = useState(false)
  const tier = classifyConfidence(confidence)
  const pct = Math.round(confidence * 100)

  const colorClasses = {
    high:   'bg-primary/10 text-primary border-primary/20',
    medium: 'bg-tertiary-container/10 text-tertiary-container border-tertiary-container/20',
    low:    'bg-error/10 text-error border-error/20',
  }[tier]

  return (
    <span className={cn('inline-flex items-center', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5',
          'text-[10px] font-mono uppercase tracking-wider leading-none',
          'transition-opacity hover:opacity-80',
          colorClasses
        )}
        title={`${pct}% confidence${sourceLabel ? ` · ${sourceLabel}` : ''}`}
      >
        <span>{pct}%</span>
        {source && <span className="opacity-70">· {sourceShort(source)}</span>}
      </button>

      {open && (
        <div
          className="
            absolute z-50 mt-6 max-w-sm p-3 rounded-lg
            bg-surface-container border border-outline-variant shadow-lg
            text-xs text-on-surface space-y-2
          "
          onMouseLeave={() => setOpen(false)}
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              Источник
            </span>
            <span className="font-mono">{pct}%</span>
          </div>
          {sourceLabel && (
            <div className="text-on-surface-variant">
              <span className="opacity-70">Из:</span>{' '}
              <span className="font-mono">{sourceLabel}</span>
            </div>
          )}
          {extractor && (
            <div className="text-on-surface-variant">
              <span className="opacity-70">Extractor:</span>{' '}
              <span className="font-mono">{extractor}</span>
            </div>
          )}
          {excerpt && (
            <blockquote className="border-l-2 border-outline-variant pl-2 italic text-on-surface-variant">
              &ldquo;{excerpt}&rdquo;
            </blockquote>
          )}
          <button
            onClick={() => setOpen(false)}
            className="text-[10px] uppercase tracking-wider text-primary hover:opacity-80"
          >
            Закрыть
          </button>
        </div>
      )}
    </span>
  )
}
