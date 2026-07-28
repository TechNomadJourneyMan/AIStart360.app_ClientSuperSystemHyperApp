export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { StatusBadge } from '@/components/common/StatusBadge'
import { prisma } from '@/lib/db'

export const metadata: Metadata = { title: 'Team' }

async function getTeamMembers() {
  try {
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

    return { members, unavailable: false }
  } catch (error) {
    console.error('[team] members unavailable', error)
    return { members: [], unavailable: true }
  }
}

export default async function TeamPage() {
  const { members, unavailable } = await getTeamMembers()

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
        <div className="sm:text-right">
          <button
            type="button"
            disabled
            aria-describedby="team-invite-unavailable"
            className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-outline-variant/20 bg-surface-container-high px-5 py-2.5 text-sm font-semibold text-on-surface-variant opacity-60"
          >
            <span className="material-symbols-outlined text-lg">person_add</span>
            Пригласить
          </button>
          <p id="team-invite-unavailable" className="mt-1.5 text-[10px] text-on-surface-variant">
            Приглашения пока не подключены
          </p>
        </div>
      </div>

      {unavailable && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-tertiary-container/25 bg-tertiary-container/5 px-4 py-3"
        >
          <span className="material-symbols-outlined mt-0.5 text-lg text-tertiary-container">cloud_off</span>
          <div>
            <p className="text-sm font-medium text-on-surface">Данные команды временно недоступны</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              Источник данных не отвечает. Состав, назначения и загрузка не показаны как нулевые значения.
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Всего', value: unavailable ? '—' : String(members.length), icon: 'group', note: unavailable ? 'данные недоступны' : 'активных профилей' },
          { label: 'Ср. загрузка', value: unavailable ? '—' : `${averageLoad}%`, icon: 'workspaces', note: unavailable ? 'данные недоступны' : 'по всей команде' },
          { label: 'Перегружены', value: unavailable ? '—' : String(overloadedCount), icon: 'warning', note: unavailable ? 'данные недоступны' : 'требуют внимания' },
          { label: 'Свободны', value: unavailable ? '—' : String(availableCount), icon: 'check_circle', note: unavailable ? 'данные недоступны' : 'готовы к задачам' },
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
      {!unavailable && members.length > 0 && (
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
      )}

      {!unavailable && members.length === 0 && (
        <div className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-8 text-center">
          <span className="material-symbols-outlined mb-3 block text-4xl text-on-surface-variant/30">group_off</span>
          <p className="text-sm text-on-surface-variant">Активные профили команды пока отсутствуют</p>
        </div>
      )}

      {unavailable && (
        <div className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-8 text-center">
          <span className="material-symbols-outlined mb-3 block text-4xl text-on-surface-variant/30">database_off</span>
          <p className="text-sm font-medium text-on-surface">Список команды не загружен</p>
          <p className="mt-1 text-xs text-on-surface-variant">Это не означает, что участников нет.</p>
        </div>
      )}
    </div>
  )
}
