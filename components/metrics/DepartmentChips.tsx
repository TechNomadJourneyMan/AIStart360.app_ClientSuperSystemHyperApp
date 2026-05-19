'use client'

import { useCallback, useMemo, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DEPARTMENT_ALL_KEY as ALL_KEY } from './_utils'

export interface DepartmentChipsProps {
  departments: Array<{ name: string; count: number }>
  selected: string | null
  onSelect: (dept: string | null) => void
}

interface ChipItem {
  key: string
  label: string
  value: string | null
  count: number | null
}

/**
 * DepartmentChips
 * Horizontally scrollable filter chips for departments.
 * - First chip "Все" represents the unfiltered state (null).
 * - Left/Right arrow keys move focus between chips; Enter selects.
 */
export function DepartmentChips({
  departments,
  selected,
  onSelect,
}: DepartmentChipsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  const chips: ChipItem[] = useMemo(() => {
    const totalCount = departments.reduce((sum, d) => sum + d.count, 0)
    return [
      { key: ALL_KEY, label: 'Все', value: null, count: totalCount },
      ...departments.map((d) => ({
        key: d.name,
        label: d.name,
        value: d.name,
        count: d.count,
      })),
    ]
  }, [departments])

  const focusChipAt = useCallback((index: number) => {
    const container = containerRef.current
    if (!container) return
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      'button[data-chip="department"]',
    )
    const target = buttons[index]
    target?.focus()
  }, [])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container) return
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[data-chip="department"]'),
    )
    const currentIndex = buttons.findIndex(
      (button) => button === document.activeElement,
    )
    if (currentIndex === -1) return

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusChipAt(Math.min(currentIndex + 1, buttons.length - 1))
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusChipAt(Math.max(currentIndex - 1, 0))
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      buttons[currentIndex]?.click()
    }
  }

  return (
    <div
      ref={containerRef}
      role="toolbar"
      aria-label="Фильтр по отделам"
      onKeyDown={handleKeyDown}
      className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin"
    >
      <AnimatePresence initial={false}>
        {chips.map((chip, index) => {
          const isSelected =
            (chip.value === null && selected === null) ||
            (chip.value !== null && chip.value === selected)
          return (
            <motion.button
              key={chip.key}
              type="button"
              data-chip="department"
              data-selected={isSelected ? 'true' : 'false'}
              aria-pressed={isSelected}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.18, delay: index * 0.02 }}
              onClick={() => onSelect(chip.value)}
              className={
                isSelected
                  ? 'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors bg-primary/15 text-primary border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/40'
                  : 'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors bg-surface-container text-on-surface-variant border-white/[0.04] hover:border-white/15 focus:outline-none focus:ring-2 focus:ring-primary/40'
              }
            >
              <span>{chip.label}</span>
              {typeof chip.count === 'number' && (
                <span className="text-xs font-mono opacity-70">{chip.count}</span>
              )}
            </motion.button>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

export default DepartmentChips
