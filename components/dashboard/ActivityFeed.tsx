'use client'

import { useTranslations } from 'next-intl'
import { Avatar } from '@/components/ui/Avatar'
import type { ActivityItem } from '@/types'

interface ActivityFeedProps {
  items: ActivityItem[]
}

function GriBadge({ value }: { value: number }) {
  const color =
    value >= 8 ? 'text-primary bg-primary/10 border-primary/20' :
    value >= 7 ? 'text-primary-fixed-dim bg-primary/5 border-primary/10' :
    value >= 5 ? 'text-tertiary-container bg-tertiary-container/10 border-tertiary-container/20' :
    'text-error bg-error/10 border-error/20'
  return (
    <span className={`inline-block font-mono text-xs font-bold px-2 py-0.5 rounded-full border ${color}`}>
      {value}
    </span>
  )
}

function StatusPill({ status }: { status: string }) {
  const isActive = status === 'active'
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-0.5 rounded-full border
      ${isActive ? 'bg-primary/10 text-primary border-primary/20' : 'bg-surface-container-high text-on-surface-variant border-white/10'}`}>
      <span className={`w-1 h-1 rounded-full ${isActive ? 'bg-primary animate-pulse' : 'bg-outline'}`} />
      {status.toUpperCase()}
    </span>
  )
}

export function ActivityFeed({ items }: ActivityFeedProps) {
  const t = useTranslations()

  if (items.length === 0) {
    return (
      <div className="bg-surface-container rounded-2xl p-8 text-center border border-white/[0.04]">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-3 block">history</span>
        <p className="text-sm text-on-surface-variant">{t('dashboard.activity.noActivity')}</p>
      </div>
    )
  }

  return (
    <div className="bg-surface-container rounded-2xl overflow-hidden border border-white/[0.04]">
      {/* Table header */}
      <div className="grid grid-cols-[minmax(140px,2fr)_minmax(120px,3fr)_80px_100px_80px] px-5 py-3 bg-surface-container-high border-b border-white/[0.04]">
        {[t('dashboard.activity.user'), t('dashboard.activity.event'), 'GRI', t('dashboard.activity.status'), t('dashboard.activity.time')].map(h => (
          <span key={h} className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">{h}</span>
        ))}
      </div>

      {/* Rows */}
      {items.map((item, i) => (
        <div
          key={item.id}
          className={`
            grid grid-cols-[minmax(140px,2fr)_minmax(120px,3fr)_80px_100px_80px]
            items-center px-5 py-3.5
            border-b border-white/[0.03] last:border-0
            hover:bg-surface-container-high/50
            transition-colors duration-150 group
            ${i % 2 !== 0 ? 'bg-white/[0.01]' : ''}
          `}
        >
          {/* Actor */}
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar name={item.actor} size="sm" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-on-surface truncate">{item.actor}</p>
              <p className="text-[10px] font-mono text-on-surface-variant/60 truncate">{item.actorRole}</p>
            </div>
          </div>

          {/* Event */}
          <p className="text-xs text-on-surface-variant truncate pr-4">{item.event}</p>

          {/* GRI */}
          <GriBadge value={item.gri} />

          {/* Status */}
          <StatusPill status={item.status} />

          {/* Time */}
          <span className="text-[11px] font-mono text-on-surface-variant/60 whitespace-nowrap">{item.time}</span>
        </div>
      ))}
    </div>
  )
}
