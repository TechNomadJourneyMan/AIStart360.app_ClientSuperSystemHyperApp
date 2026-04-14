export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { getTranslations } from 'next-intl/server'

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

export default async function NotificationsPage() {
  const t = await getTranslations('notificationsPage')
  const logs = await prisma.auditLog.findMany({
    include: {
      performer: {
        select: { name: true, email: true },
      },
    },
    orderBy: { timestamp: 'desc' },
    take: 40,
  })

  const notifications = logs.map((log) => ({
    id: log.id,
    type: log.action === 'reject' ? 'alert' : log.action === 'approve' ? 'project' : log.action === 'comment' ? 'team' : 'system',
    title: `${log.action} · ${log.entityType}`,
    body: t('changePerformed', { entityType: log.entityType, performer: log.performer.name ?? log.performer.email }),
    read: false,
    entityType: log.entityType,
    entityId: log.entityId,
    time: new Date(log.timestamp).toLocaleString('ru-RU'),
  }))

  const unread = notifications.filter((n) => !n.read)

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Notifications</h1>
          <p className="text-on-surface-variant text-sm mt-1">{unread.length} {t('unread')}</p>
        </div>
        {unread.length > 0 && (
          <button className="text-xs font-mono text-primary hover:underline uppercase tracking-wider">
            {t('markAllRead')}
          </button>
        )}
      </div>

      {/* Notification List */}
      <div className="space-y-2">
        {notifications.map((notif) => {
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
                  <span className="text-xs text-primary mt-1 inline-block">
                    {notif.entityType} #{notif.entityId}
                  </span>
                )}
              </div>

              {!notif.read && (
                <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />
              )}
            </div>
          )
        })}

        {notifications.length === 0 && (
          <div className="bg-surface-container rounded-xl p-8 text-center">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-3 block">notifications_off</span>
            <p className="text-sm text-on-surface-variant">{t('noEvents')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
