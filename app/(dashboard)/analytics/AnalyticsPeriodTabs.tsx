'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ANALYTICS_PERIODS, type AnalyticsPeriodId } from './analytics-detail'

// Real navigation, not decoration: each tab is a link to `?period=…` on the
// current route, so it works on /analytics and on /owner/analytics alike and
// survives a reload / share of the URL.
export function AnalyticsPeriodTabs({ active }: { active: AnalyticsPeriodId }) {
  const pathname = usePathname()

  return (
    <div role="group" aria-label="Период GRI-аналитики" className="flex gap-1 bg-surface-container rounded-lg p-1">
      {ANALYTICS_PERIODS.map((period) => {
        const isActive = period.id === active
        return (
          <Link
            key={period.id}
            href={`${pathname}?period=${period.id}`}
            scroll={false}
            aria-current={isActive ? 'true' : undefined}
            aria-label={`Показать GRI за ${period.genitive}`}
            className={`px-4 py-1.5 rounded text-xs font-mono font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
              isActive
                ? 'bg-surface-container-high text-on-surface'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/50'
            }`}
          >
            {period.label}
          </Link>
        )
      })}
    </div>
  )
}
