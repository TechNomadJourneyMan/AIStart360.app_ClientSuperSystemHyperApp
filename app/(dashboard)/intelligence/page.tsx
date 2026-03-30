import type { Metadata } from 'next'
import { prisma } from '@/lib/db'

export const metadata: Metadata = { title: 'Intelligence Hub' }

export default async function IntelligencePage() {
  const [auditEvents, clientCount] = await Promise.all([
    prisma.auditLog.count(),
    prisma.client.count(),
  ])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Intelligence Hub</h1>
          <p className="text-on-surface-variant text-sm mt-1">Рыночные сигналы и возможности</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="status-dot-online" />
          <span className="text-xs font-mono text-primary">Live · Обновлено 2 мин. назад</span>
        </div>
      </div>

      {/* Signal Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Audit Events', value: String(auditEvents), icon: 'hub', color: 'text-on-surface' },
          { label: 'Клиенты', value: String(clientCount), icon: 'groups', color: 'text-primary' },
          { label: 'Сигналы', value: '0', icon: 'lightbulb', color: 'text-on-surface-variant' },
          { label: 'Источник', value: 'offline', icon: 'cloud_off', color: 'text-on-surface-variant' },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-container-low rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`material-symbols-outlined text-xl ${stat.color}`}>{stat.icon}</span>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{stat.label}</p>
            </div>
            <p className={`text-2xl font-mono font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-surface-container rounded-xl p-8 text-center">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-3 block">radar</span>
        <p className="text-sm text-on-surface mb-1">Лента intelligence пока пуста</p>
        <p className="text-xs text-on-surface-variant">Моки удалены. Добавьте источник рыночных сигналов, чтобы заполнить раздел.</p>
      </div>
    </div>
  )
}
