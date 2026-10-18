'use client'

/**
 * components/point-b/tabs/PointBTabs.tsx — the tab shell of the Point B page (plan Phase 2
 * Task 8): «Обзор» · «Сценарии» · «Подробности». The panels are passed in as nodes; a panel is
 * mounted the first time its tab is opened and then kept (hidden), so the legacy «Подробности»
 * view loads only when it is wanted and keeps its state afterwards.
 *
 * Tabs scroll horizontally on a phone. Keyboard: arrows, Home, End (WAI-ARIA tabs pattern).
 * Project tokens only — the look is to be replaced by the PO's design.
 */
import { createContext, useCallback, useContext, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { POINT_B_TABS, nextTab, type PointBTabKey } from '../overviewModel'

const TabNavContext = createContext<(tab: PointBTabKey) => void>(() => undefined)

/** A tab content can send the owner to another tab (e.g. the verdict → «Сценарии»). */
export function useGoToTab(): (tab: PointBTabKey) => void {
  return useContext(TabNavContext)
}

export default function PointBTabs({ panels, initialTab = 'overview' }: { panels: Record<PointBTabKey, ReactNode>; initialTab?: PointBTabKey }) {
  const uid = useId()
  const [active, setActive] = useState<PointBTabKey>(initialTab)
  const [visited, setVisited] = useState<ReadonlySet<PointBTabKey>>(() => new Set([initialTab]))
  const refs = useRef<Partial<Record<PointBTabKey, HTMLButtonElement | null>>>({})

  const go = useCallback((tab: PointBTabKey) => {
    setActive(tab)
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)))
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, current: PointBTabKey) => {
    const next = nextTab(current, e.key)
    if (!next) return
    e.preventDefault()
    go(next)
    refs.current[next]?.focus()
  }

  return (
    <TabNavContext.Provider value={go}>
      <div className="space-y-4">
        <div
          role="tablist"
          aria-label="Разделы Точки Б"
          className="-mx-4 flex gap-1 overflow-x-auto border-b border-white/[0.08] px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {POINT_B_TABS.map((t) => {
            const selected = t.key === active
            return (
              <button
                key={t.key}
                ref={(el) => { refs.current[t.key] = el }}
                type="button"
                role="tab"
                id={`${uid}-tab-${t.key}`}
                aria-selected={selected}
                aria-controls={`${uid}-panel-${t.key}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => go(t.key)}
                onKeyDown={(e) => onKeyDown(e, t.key)}
                className={cn(
                  '-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  selected ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface',
                )}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {POINT_B_TABS.filter((t) => visited.has(t.key)).map((t) => (
          <div
            key={t.key}
            role="tabpanel"
            id={`${uid}-panel-${t.key}`}
            aria-labelledby={`${uid}-tab-${t.key}`}
            hidden={t.key !== active}
            tabIndex={0}
            className="focus:outline-none"
          >
            {panels[t.key]}
          </div>
        ))}
      </div>
    </TabNavContext.Provider>
  )
}
