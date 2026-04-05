import type { Metadata } from 'next'
<<<<<<< HEAD
import { auth } from '@/lib/auth'
import { getDashboardData } from '@/lib/get-dashboard-data'
=======
>>>>>>> 41f51555aefe4444f42b51d039ecb8f312ab4ace
import { StatusBadge } from '@/components/common/StatusBadge'
import { prisma } from '@/lib/db'

export const metadata: Metadata = { title: 'Team' }

export default async function TeamPage() {
<<<<<<< HEAD
  const session = await auth()
  const data = getDashboardData(session?.user?.email)
=======
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
>>>>>>> 41f51555aefe4444f42b51d039ecb8f312ab4ace

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Team</h1>
          <p className="text-on-surface-variant text-sm mt-1">Аллокация и загрузка команды</p>
        </div>
        <button className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg shadow-primary-sm hover:scale-[0.98] transition-all">
          <span className="material-symbols-outlined text-lg">person_add</span>
          Пригласить
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Members', value: String(members.length), icon: 'group' },
          { label: 'Avg Load', value: `${averageLoad}%`, icon: 'workspaces' },
          { label: 'Overloaded', value: String(overloadedCount), icon: 'warning' },
          { label: 'Available', value: String(availableCount), icon: 'check_circle' },
        ].map((s) => (
          <div key={s.label} className="bg-surface-container-low rounded-xl p-4 flex items-center gap-3">
            <span className="material-symbols-outlined text-on-surface-variant text-2xl">{s.icon}</span>
            <div>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{s.label}</p>
              <p className="text-xl font-mono font-bold text-on-surface">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Team Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
<<<<<<< HEAD
        {data.TEAM.map((member) => (
=======
        {members.map((member) => {
          const load = toLoad(member.managedClients.length)
          const memberRole = member.role.toLowerCase()

          return (
>>>>>>> 41f51555aefe4444f42b51d039ecb8f312ab4ace
          <div key={member.id} className="bg-surface-container rounded-xl p-5">
            {/* Member Info */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
                {(member.name ?? member.email).split(' ').map((n) => n[0]).join('').slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-on-surface text-sm truncate">{member.name ?? member.email}</p>
                <p className="text-xs text-on-surface-variant truncate">{memberRole}</p>
              </div>
              <StatusBadge
                status={load > 90 ? 'critical' : load > 75 ? 'warning' : 'success'}
                label={load > 90 ? 'Overloaded' : load > 75 ? 'High' : 'Available'}
              />
            </div>

            {/* Workload Bar */}
            <div className="mb-4">
              <div className="flex justify-between text-xs mb-1.5">
                <span className="font-mono text-on-surface-variant">Загрузка</span>
                <span className={`font-mono font-bold ${
                  load > 90 ? 'text-error' : load > 75 ? 'text-tertiary-container' : 'text-primary'
                }`}>{load}%</span>
              </div>
              <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    load > 90 ? 'bg-error' : load > 75 ? 'bg-tertiary-container' : 'bg-primary'
                  }`}
                  style={{ width: `${load}%` }}
                />
              </div>
            </div>

            {/* Assigned Clients */}
            <div>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">Клиенты ({member.managedClients.length})</p>
              <div className="flex flex-wrap gap-1.5">
                {member.managedClients.map((client) => (
                  <span key={client.id} className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant border border-outline-variant/20">
                    {client.name}
                  </span>
                ))}
                {member.managedClients.length === 0 && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant border border-outline-variant/20">
                    Нет назначений
                  </span>
                )}
              </div>
            </div>
          </div>
        )})}
      </div>
    </div>
  )
}
