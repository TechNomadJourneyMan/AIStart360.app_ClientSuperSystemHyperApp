export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { prisma } from '@/lib/db'

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

async function getAuditNotifications() {
  try {
    const logs = await prisma.auditLog.findMany({
      include: {
        performer: {
          select: { name: true, email: true },
        },
      },
      orderBy: { timestamp: 'desc' },
      take: 40,
    })

    return { logs, unavailable: false }
  } catch (error) {
    console.error('[notifications] audit events unavailable', error)
    return { logs: [], unavailable: true }
  }
}

export default async function NotificationsPage() {
  const { logs, unavailable } = await getAuditNotifications()

  const notifications = logs.map((log) => ({
    id: log.id,
    type: log.action === 'reject' ? 'alert' : log.action === 'approve' ? 'project' : log.action === 'comment' ? 'team' : 'system',
    title: `${log.action} · ${log.entityType}`,
    body: `Изменение ${log.entityType} выполнено: ${log.performer.name ?? log.performer.email}`,
    entityType: log.entityType,
    entityId: log.entityId,
    time: new Date(log.timestamp).toLocaleString('ru-RU'),
  }))

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="font-headline text-3xl font-bold text-on-surface">Notifications</h1>
        <p className="text-on-surface-variant text-sm mt-1">
          {unavailable ? 'Количество событий недоступно' : `${notifications.length} событий`}
        </p>
      </div>

      {unavailable && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-tertiary-container/25 bg-tertiary-container/5 px-4 py-3"
        >
          <span className="material-symbols-outlined mt-0.5 text-lg text-tertiary-container">cloud_off</span>
          <div>
            <p className="text-sm font-medium text-on-surface">Журнал событий временно недоступен</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              Источник данных не отвечает. События и их количество появятся после восстановления подключения.
            </p>
          </div>
        </div>
      )}

      {/* Notification List */}
      <div className="space-y-2">
        {!unavailable && notifications.map((notif) => {
          const icon = typeIcon[notif.type] ?? 'notifications'
          const color = typeColor[notif.type] ?? typeColor.system

          return (
            <div
              key={notif.id}
              className="flex items-start gap-4 p-4 rounded-xl bg-surface-container hover:bg-surface-container-high transition-colors"
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
                <span className="material-symbols-outlined text-lg">{icon}</span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-on-surface">{notif.title}</p>
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
            </div>
          )
        })}

        {!unavailable && notifications.length === 0 && (
          <div className="bg-surface-container rounded-xl p-8 text-center">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-3 block">notifications_off</span>
            <p className="text-sm text-on-surface-variant">События пока отсутствуют</p>
          </div>
        )}

        {unavailable && (
          <div className="bg-surface-container rounded-xl p-8 text-center">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-3 block">database_off</span>
            <p className="text-sm font-medium text-on-surface">Список событий не загружен</p>
            <p className="mt-1 text-xs text-on-surface-variant">Это не означает, что событий нет.</p>
          </div>
        )}
      </div>
    </div>
  )
}
