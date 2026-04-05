export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { StatusBadge } from '@/components/common/StatusBadge'
import { prisma } from '@/lib/db'

export const metadata: Metadata = { title: 'Team' }

export default async function TeamPage() {
  const members = await prisma.user.findMany({
    where: {
      role: { in: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST'] },
    },
    include: {
      managedClients: {
        select: { id: true, name: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 24,
  })

  const toLoad = (count: number) => Math.min(100, count * 20)
  const overloadedCount = members.filter((member) => toLoad(member.managedClients.length) > 75).length
  const availableCount = members.filter((member) => toLoad(member.managedClients.length) <= 50).length
  const averageLoad = members.length
    ? Math.round(members.reduce((sum, member) => sum + toLoad(member.managedClients.length), 0) / members.length)
    : 0

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface">Team</h1>
          <p className="text-on-surface-variant text-sm mt-1">Аллокация и загрузка команды в реальном времени</p>
        </div>
        <button className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-xl shadow-primary-sm hover:scale-[0.98] transition-all">
          <span className="material-symbols-outlined text-lg">person_add</span>
          Пригласить
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Всего', value: String(members.length), icon: 'group', note: 'активных профилей' },
          { label: 'Ср. загрузка', value: `${averageLoad}%`, icon: 'workspaces', note: 'по всей команде' },
          { label: 'Перегружены', value: String(overloadedCount), icon: 'warning', note: 'требуют внимания' },
          { label: 'Свободны', value: String(availableCount), icon: 'check_circle', note: 'готовы к задачам' },
        ].map((s) => (
          <div key={s.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
            <div className="flex items-start justify-between mb-3">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{s.label}</p>
              <span className="material-symbols-outlined text-base text-primary/40">{s.icon}</span>
            </div>
            <p className="text-2xl font-mono font-bold text-on-surface mb-1">{s.value}</p>
            <p className="text-xs text-on-surface-variant">{s.note}</p>
          </div>
        ))}
      </div>

      {/* Team Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {members.map((member) => {
          const load = toLoad(member.managedClients.length)
          const memberRole = member.role.toLowerCase()

          return (
            <div key={member.id} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 hover:border-primary/10 transition-colors group">
              {/* Member Info */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center text-sm font-bold text-primary flex-shrink-0 border border-white/[0.04]">
                  {(member.name ?? member.email).split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-headline font-bold text-on-surface text-base truncate">{member.name ?? member.email}</p>
                  <p className="text-xs text-on-surface-variant truncate uppercase tracking-widest font-mono">{memberRole}</p>
                </div>
                <StatusBadge
                  status={load > 90 ? 'critical' : load > 75 ? 'warning' : 'success'}
                  label={load > 90 ? 'Over' : load > 75 ? 'High' : 'Free'}
                />
              </div>

              {/* Workload Bar */}
              <div className="mb-5 bg-surface-container rounded-xl p-3">
                <div className="flex justify-between text-[10px] mb-1.5 uppercase font-mono tracking-widest text-on-surface-variant">
                  <span>Загрузка</span>
                  <span className={`font-bold ${
                    load > 90 ? 'text-error' : load > 75 ? 'text-warning' : 'text-primary'
                  }`}>{load}%</span>
                </div>
                <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      load > 90 ? 'bg-error' : load > 75 ? 'bg-warning' : 'bg-primary'
                    }`}
                    style={{ width: `${load}%` }}
                  />
                </div>
              </div>

              {/* Assigned Clients */}
              <div>
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2 flex justify-between items-center">
                  <span>Клиенты</span>
                  <span className="bg-surface-container-high px-1.5 py-0.5 rounded text-primary">{member.managedClients.length}</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {member.managedClients.slice(0, 3).map((client) => (
                    <span key={client.id} className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-container text-on-surface-variant border border-outline-variant/10">
                      {client.name}
                    </span>
                  ))}
                  {member.managedClients.length > 3 && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-container text-primary font-bold">
                      +{member.managedClients.length - 3}
                    </span>
                  )}
                  {member.managedClients.length === 0 && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-container text-on-surface-variant italic">
                      Нет назначений
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
