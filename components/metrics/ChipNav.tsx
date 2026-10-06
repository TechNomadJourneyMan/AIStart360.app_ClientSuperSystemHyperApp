'use client'

/**
 * ChipNav — horizontally scrollable single-select chip row («Все» + options)
 * with counts. Used for the 13 metric categories and the growth-goal
 * subcategories. ←/→ move focus between chips, Enter/Space selects.
 */

import { useRef } from 'react'
import { cn } from '@/lib/utils'

export interface ChipOption {
  value: string
  label: string
  count?: number | null
  icon?: string
}

export interface ChipNavProps {
  ariaLabel: string
  options: ReadonlyArray<ChipOption>
  /** null = «Все». */
  value: string | null
  onChange: (next: string | null) => void
  allLabel?: string
  allCount?: number | null
  size?: 'md' | 'sm'
}

export function ChipNav({ ariaLabel, options, value, onChange, allLabel = 'Все', allCount, size = 'md' }: ChipNavProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const chips: Array<ChipOption & { key: string; selectValue: string | null }> = [
    { key: '__all__', value: '__all__', label: allLabel, count: allCount, selectValue: null },
    ...options.map((o) => ({ ...o, key: o.value, selectValue: o.value })),
  ]

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button[data-chip]') ?? [])
    const i = buttons.findIndex((b) => b === document.activeElement)
    if (i === -1) return
    e.preventDefault()
    const next = e.key === 'ArrowRight' ? Math.min(i + 1, buttons.length - 1) : Math.max(i - 1, 0)
    buttons[next]?.focus()
  }

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 no-scrollbar"
    >
      {chips.map((c) => {
        const selected = c.selectValue === value
        const empty = typeof c.count === 'number' && c.count === 0 && !selected
        return (
          <button
            key={c.key}
            type="button"
            data-chip={c.key}
            aria-pressed={selected}
            onClick={() => onChange(c.selectValue)}
            className={cn(
              'inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40',
              size === 'md' ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-xs',
              selected
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-white/[0.04] bg-surface-container text-on-surface-variant hover:border-white/15 hover:text-on-surface',
              empty && 'opacity-50',
            )}
          >
            {c.icon && (
              <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">
                {c.icon}
              </span>
            )}
            <span>{c.label}</span>
            {typeof c.count === 'number' && <span className="font-mono text-xs opacity-70">{c.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export default ChipNav
