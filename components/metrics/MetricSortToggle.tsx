'use client'

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { SORT_OPTIONS, type SortMode } from './_utils'

export type { SortMode } from './_utils'
export { SORT_OPTIONS } from './_utils'

export interface MetricSortToggleProps {
  value: SortMode
  onChange: (next: SortMode) => void
}

/**
 * MetricSortToggle
 * Dropdown of 8 sort modes for the /metrics catalog.
 * Built on @radix-ui/react-dropdown-menu so keyboard nav + a11y come for free.
 */
export function MetricSortToggle({ value, onChange }: MetricSortToggleProps) {
  const current = SORT_OPTIONS.find((option) => option.value === value)

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          data-chip="sort"
          aria-label="Сортировка метрик"
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors bg-surface-container text-on-surface-variant border-white/[0.04] hover:border-white/15 focus:outline-none focus:ring-2 focus:ring-primary/40 data-[state=open]:border-primary/40 data-[state=open]:text-on-surface"
        >
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-base"
          >
            sort
          </span>
          <span>{current?.label ?? 'Сортировка'}</span>
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-base opacity-70"
          >
            expand_more
          </span>
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          sideOffset={8}
          className="z-50 bg-surface-container-high border border-white/10 rounded-xl shadow-modal p-1 min-w-[220px] outline-none"
        >
          {SORT_OPTIONS.map((option) => {
            const isActive = option.value === value
            return (
              <DropdownMenuPrimitive.Item
                key={option.value}
                data-sort-option={option.value}
                onSelect={(event) => {
                  event.preventDefault()
                  onChange(option.value)
                }}
                className="px-3 py-2 rounded-lg hover:bg-surface-container cursor-pointer flex items-center justify-between text-sm text-on-surface-variant data-[highlighted]:bg-surface-container data-[highlighted]:text-on-surface outline-none"
              >
                <span>{option.label}</span>
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-base text-primary"
                  >
                    check
                  </span>
                )}
              </DropdownMenuPrimitive.Item>
            )
          })}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  )
}

export default MetricSortToggle
