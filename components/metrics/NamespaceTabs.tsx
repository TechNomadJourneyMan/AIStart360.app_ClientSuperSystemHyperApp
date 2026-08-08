'use client'

import { useCallback, useRef } from 'react'
import { NAMESPACE_TABS, pluralRu, type Namespace } from './_utils'

export type { Namespace } from './_utils'
export { NAMESPACE_TABS } from './_utils'

export interface NamespaceTabsProps {
  value: Namespace
  counts: Record<Namespace, number>
  onChange: (next: Namespace) => void
}

/**
 * NamespaceTabs
 * Filter bar for switching between metric namespaces (BIZ / KPI / GRI / Goals + All).
 *
 * Deliberately NOT @radix-ui/react-tabs: this control filters a list that lives
 * outside it, so there are no tab panels to own. Radix stamped every trigger
 * with `aria-controls` pointing at panels that never existed. A toolbar of
 * `aria-pressed` buttons with arrow-key roving is the honest role here, and it
 * matches DepartmentChips right below it.
 */
export function NamespaceTabs({ value, counts, onChange }: NamespaceTabsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  const focusAt = useCallback((index: number) => {
    const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>(
      'button[data-namespace]',
    )
    buttons?.[index]?.focus()
  }, [])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container) return
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[data-namespace]'),
    )
    const currentIndex = buttons.findIndex((b) => b === document.activeElement)
    if (currentIndex === -1) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusAt(Math.min(currentIndex + 1, buttons.length - 1))
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusAt(Math.max(currentIndex - 1, 0))
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusAt(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusAt(buttons.length - 1)
    }
  }

  return (
    <div
      ref={containerRef}
      role="toolbar"
      aria-label="Группа метрик"
      onKeyDown={handleKeyDown}
      className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-white/[0.04] bg-surface-container-low p-1 no-scrollbar"
    >
      {NAMESPACE_TABS.map((tab) => {
        const count = counts[tab.value] ?? 0
        const isActive = tab.value === value
        return (
          <button
            key={tab.value}
            type="button"
            data-namespace={tab.value}
            aria-pressed={isActive}
            aria-label={`${tab.label}: ${count} ${pluralRu(count, ['показатель', 'показателя', 'показателей'])}`}
            onClick={() => onChange(tab.value)}
            className={
              isActive
                ? 'shrink-0 whitespace-nowrap rounded-lg bg-surface-container px-4 py-1.5 text-sm font-medium text-on-surface shadow-card transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40'
                : 'shrink-0 whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-medium text-on-surface-variant transition-colors hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40'
            }
          >
            <span>{tab.label}</span>
            <span aria-hidden="true" className="ml-1 font-mono text-xs opacity-60">
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default NamespaceTabs
