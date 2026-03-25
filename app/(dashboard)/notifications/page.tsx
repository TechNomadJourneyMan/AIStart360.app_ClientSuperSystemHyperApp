import type { Metadata } from 'next'
import { MOCK_NOTIFICATIONS } from '@/lib/mock-data'

export const metadata: Metadata = { title: 'Notifications' }

const typeIcon: Record<string, string> = {
  gri_updated:   'radar',
  report:        'description',
  alert:         'warning',
  project:       'task_alt',
  team:          'person',
  system:        'info',
}

const typeColor: Record<string, string> = {
  gri_updated:   'text-primary bg-primary/10',
  report:        'text-secondary bg-secondary/10',
  alert:         'text-error bg-error/10',
  project:       'text-tertiary-container bg-tertiary-container/10',
  team:          'text-on-surface-variant bg-surface-container-high',
  system:        'text-on-surface-variant bg-surface-container-high',
}

export default function NotificationsPage() {
  const unread = MOCK_NOTIFICATIONS.filter((n) => !n.read)

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Notifications</h1>
          <p className="text-on-surface-variant text-sm mt-1">{unread.length} непрочитанных</p>
        </div>
        {unread.length > 0 && (
          <button className="text-xs font-mono text-primary hover:underline uppercase tracking-wider">
            Прочитать все
          </button>
        )}
      </div>

      {/* Notification List */}
      <div className="space-y-2">
        {MOCK_NOTIFICATIONS.map((notif) => {
          const icon = typeIcon[notif.type] ?? 'notifications'
          const color = typeColor[notif.type] ?? typeColor.system

          return (
            <div
              key={notif.id}
              className={`flex items-start gap-4 p-4 rounded-xl transition-colors cursor-pointer ${
                notif.read
                  ? 'bg-surface-container hover:bg-surface-container-high'
                  : 'bg-surface-container-high border-l-2 border-primary'
              }`}
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
                <span className="material-symbols-outlined text-lg">{icon}</span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className={`text-sm font-medium ${notif.read ? 'text-on-surface-variant' : 'text-on-surface'}`}>
                    {notif.title}
                  </p>
                  <span className="text-[10px] font-mono text-on-surface-variant whitespace-nowrap flex-shrink-0">
                    {notif.time}
                  </span>
                </div>
                <p className="text-xs text-on-surface-variant mt-0.5 line-clamp-2">{notif.body}</p>
                {notif.entityType && (
                  <a href="#" className="text-xs text-primary hover:underline mt-1 inline-block">
                    Открыть {notif.entityType} →
                  </a>
                )}
              </div>

              {!notif.read && (
                <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
