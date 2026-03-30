'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  clients: 'Clients',
  reports: 'Reports',
  analytics: 'Analytics',
  intelligence: 'Intelligence',
  team: 'Team',
  notifications: 'Notifications',
  settings: 'Settings',
  gri: 'GRI Report',
  growth: 'Growth Plan',
}

export function Breadcrumbs() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)

  if (segments.length <= 1) return null

  return (
    <nav className="flex items-center gap-1.5 text-sm text-on-surface-variant mb-4" aria-label="Breadcrumb">
      <Link href="/dashboard" className="hover:text-on-surface transition-colors">Home</Link>
      {segments.map((seg, i) => {
        const href = '/' + segments.slice(0, i + 1).join('/')
        const isLast = i === segments.length - 1
        const label = LABELS[seg] ?? seg

        return (
          <span key={href} className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-sm text-outline">chevron_right</span>
            {isLast ? (
              <span className="text-on-surface font-medium">{label}</span>
            ) : (
              <Link href={href} className="hover:text-on-surface transition-colors">{label}</Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
