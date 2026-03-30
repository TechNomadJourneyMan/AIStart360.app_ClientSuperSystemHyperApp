import { Avatar } from '@/components/ui/Avatar'
import { StatusBadge } from '@/components/common/StatusBadge'
import type { ActivityItem } from '@/types'

interface ActivityFeedProps {
  items: ActivityItem[]
}

export function ActivityFeed({ items }: ActivityFeedProps) {
  if (items.length === 0) {
    return (
      <div className="bg-surface-container rounded-xl p-8 text-center">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-3 block">history</span>
        <p className="text-sm text-on-surface-variant">Нет активности</p>
      </div>
    )
  }

  return (
    <div className="bg-surface-container rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-container-high">
              {['Пользователь', 'Событие', 'GRI', 'Статус', 'Время'].map((h) => (
                <th key={h} className="px-5 py-3 text-left text-[10px] font-mono uppercase tracking-widest text-on-surface-variant whitespace-nowrap first:rounded-tl-xl last:rounded-tr-xl">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.id} className={`border-b border-outline-variant/10 last:border-0 table-row-hover ${i % 2 === 0 ? '' : 'bg-surface-container/50'}`}>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <Avatar name={item.actor} size="sm" />
                    <div>
                      <p className="text-sm font-medium text-on-surface">{item.actor}</p>
                      <p className="text-xs text-on-surface-variant">{item.actorRole}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-sm text-on-surface-variant max-w-[200px] truncate">
                  {item.event}
                </td>
                <td className="px-5 py-3.5">
                  <span className={`font-mono text-sm font-bold ${
                    item.gri >= 800 ? 'text-primary' :
                    item.gri >= 700 ? 'text-primary-fixed-dim' :
                    item.gri >= 500 ? 'text-tertiary-container' :
                    'text-error'
                  }`}>
                    {item.gri}
                  </span>
                </td>
                <td className="px-5 py-3.5">
                  <StatusBadge status={item.status as any} label={item.status} />
                </td>
                <td className="px-5 py-3.5 text-[11px] font-mono text-on-surface-variant whitespace-nowrap">
                  {item.time}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
