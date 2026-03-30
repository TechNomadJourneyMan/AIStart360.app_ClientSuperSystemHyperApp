import type { Metadata } from 'next'
import { auth } from '@/lib/auth'
import { getDashboardData } from '@/lib/get-dashboard-data'
import { StatusBadge } from '@/components/common/StatusBadge'

export const metadata: Metadata = { title: 'Team' }

export default async function TeamPage() {
  const session = await auth()
  const data = getDashboardData(session?.user?.email)

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
          { label: 'Total Members', value: '12', icon: 'group' },
          { label: 'Avg Load', value: '74%', icon: 'workspaces' },
          { label: 'Overloaded', value: '2', icon: 'warning' },
          { label: 'Available', value: '4', icon: 'check_circle' },
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
        {data.TEAM.map((member) => (
          <div key={member.id} className="bg-surface-container rounded-xl p-5">
            {/* Member Info */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
                {member.name.split(' ').map((n) => n[0]).join('')}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-on-surface text-sm truncate">{member.name}</p>
                <p className="text-xs text-on-surface-variant truncate">{member.role}</p>
              </div>
              <StatusBadge
                status={member.load > 90 ? 'critical' : member.load > 75 ? 'warning' : 'success'}
                label={member.load > 90 ? 'Overloaded' : member.load > 75 ? 'High' : 'Available'}
              />
            </div>

            {/* Workload Bar */}
            <div className="mb-4">
              <div className="flex justify-between text-xs mb-1.5">
                <span className="font-mono text-on-surface-variant">Загрузка</span>
                <span className={`font-mono font-bold ${
                  member.load > 90 ? 'text-error' : member.load > 75 ? 'text-tertiary-container' : 'text-primary'
                }`}>{member.load}%</span>
              </div>
              <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    member.load > 90 ? 'bg-error' : member.load > 75 ? 'bg-tertiary-container' : 'bg-primary'
                  }`}
                  style={{ width: `${member.load}%` }}
                />
              </div>
            </div>

            {/* Assigned Clients */}
            <div>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">Клиенты ({member.clients.length})</p>
              <div className="flex flex-wrap gap-1.5">
                {member.clients.map((c) => (
                  <span key={c} className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant border border-outline-variant/20">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
