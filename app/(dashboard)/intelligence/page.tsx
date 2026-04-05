import type { Metadata } from 'next'
<<<<<<< HEAD
import { auth } from '@/lib/auth'
import { getDashboardData } from '@/lib/get-dashboard-data'
=======
import { prisma } from '@/lib/db'
>>>>>>> 41f51555aefe4444f42b51d039ecb8f312ab4ace

export const metadata: Metadata = { title: 'Intelligence Hub' }

export default async function IntelligencePage() {
  const [auditEvents, clientCount] = await Promise.all([
    prisma.auditLog.count(),
    prisma.client.count(),
  ])

<<<<<<< HEAD
export default async function IntelligencePage() {
  const session = await auth()
  const data = getDashboardData(session?.user?.email)

=======
>>>>>>> 41f51555aefe4444f42b51d039ecb8f312ab4ace
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

<<<<<<< HEAD
      {/* Filter Bar */}
      <div className="flex flex-wrap gap-2">
        {['All', 'Market', 'Financial', 'Regulatory', 'Technology', 'Competitive'].map((f) => (
          <button
            key={f}
            className={`px-4 py-1.5 rounded-full text-xs font-mono font-medium border transition-colors ${
              f === 'All'
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'bg-surface-container text-on-surface-variant border-outline-variant/30 hover:border-outline-variant/60'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Signal Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {data.SIGNALS.map((signal) => {
          const cfg = priorityConfig[signal.priority as keyof typeof priorityConfig] ?? priorityConfig.low
          return (
            <div
              key={signal.id}
              className="bg-surface-container rounded-xl p-5 hover:bg-surface-container-high transition-colors cursor-pointer group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${cfg.dot} ${signal.priority === 'critical' ? 'animate-pulse' : ''}`} />
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border uppercase ${cfg.color}`}>
                    {cfg.label}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-on-surface-variant">{signal.time}</span>
              </div>

              <h3 className="font-medium text-on-surface mb-1.5 group-hover:text-primary transition-colors">
                {signal.title}
              </h3>
              <p className="text-sm text-on-surface-variant leading-relaxed mb-4">{signal.description}</p>

              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-1.5">
                  {signal.tags.map((tag) => (
                    <span key={tag} className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant">
                      {tag}
                    </span>
                  ))}
                </div>
                {signal.relatedClient && (
                  <span className="text-xs text-primary font-mono">→ {signal.relatedClient}</span>
                )}
              </div>
            </div>
          )
        })}
=======
      <div className="bg-surface-container rounded-xl p-8 text-center">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-3 block">radar</span>
        <p className="text-sm text-on-surface mb-1">Лента intelligence пока пуста</p>
        <p className="text-xs text-on-surface-variant">Моки удалены. Добавьте источник рыночных сигналов, чтобы заполнить раздел.</p>
>>>>>>> 41f51555aefe4444f42b51d039ecb8f312ab4ace
      </div>
    </div>
  )
}
