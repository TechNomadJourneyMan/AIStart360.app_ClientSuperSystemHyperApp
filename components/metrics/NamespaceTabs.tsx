'use client'

import * as TabsPrimitive from '@radix-ui/react-tabs'
import { NAMESPACE_TABS, type Namespace } from './_utils'

export type { Namespace } from './_utils'
export { NAMESPACE_TABS } from './_utils'

export interface NamespaceTabsProps {
  value: Namespace
  counts: Record<Namespace, number>
  onChange: (next: Namespace) => void
}

/**
 * NamespaceTabs
 * Tab bar for switching between metric namespaces (BIZ / KPI / GRI / Goals + All).
 * Built on @radix-ui/react-tabs for free keyboard nav + roving tabindex + ARIA.
 */
export function NamespaceTabs({ value, counts, onChange }: NamespaceTabsProps) {
  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={(next) => onChange(next as Namespace)}
    >
      <TabsPrimitive.List
        aria-label="Группа метрик"
        className="inline-flex gap-1 bg-surface-container-low p-1 rounded-xl border border-white/[0.04]"
      >
        {NAMESPACE_TABS.map((tab) => {
          const count = counts[tab.value] ?? 0
          const isActive = tab.value === value
          return (
            <TabsPrimitive.Trigger
              key={tab.value}
              value={tab.value}
              data-namespace={tab.value}
              className={
                isActive
                  ? 'px-4 py-1.5 rounded-lg text-sm font-medium transition-colors bg-surface-container text-on-surface shadow-card focus:outline-none focus:ring-2 focus:ring-primary/40'
                  : 'px-4 py-1.5 rounded-lg text-sm font-medium transition-colors text-on-surface-variant hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40'
              }
            >
              <span>{tab.label}</span>
              <span className="text-xs font-mono opacity-60 ml-1">{count}</span>
            </TabsPrimitive.Trigger>
          )
        })}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  )
}

export default NamespaceTabs
