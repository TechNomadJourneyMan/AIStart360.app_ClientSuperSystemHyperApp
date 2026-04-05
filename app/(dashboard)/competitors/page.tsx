import type { Metadata } from 'next'
<<<<<<< HEAD
import { auth } from '@/lib/auth'
import { getDashboardData } from '@/lib/get-dashboard-data'
=======
import { prisma } from '@/lib/db'
>>>>>>> 41f51555aefe4444f42b51d039ecb8f312ab4ace

export const metadata: Metadata = { title: 'Конкуренты' }

export default async function CompetitorsPage() {
  const [clients, organizations] = await Promise.all([
    prisma.client.count(),
    prisma.organization.count(),
  ])

<<<<<<< HEAD
export default async function CompetitorsPage() {
  const session = await auth()
  const data = getDashboardData(session?.user?.email)

=======
>>>>>>> 41f51555aefe4444f42b51d039ecb8f312ab4ace
  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          Конкурентная разведка · Q1 2026
        </p>
        <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
          Анализ{' '}
          <span className="text-gradient">Конкурентов</span>
        </h1>
        <p className="text-on-surface-variant mt-2 text-sm max-w-xl">
          Мониторинг и сравнительный анализ основных игроков рынка.
        </p>
      </section>

      {/* Summary stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Клиенты', value: String(clients), icon: 'groups', note: 'в текущем портфеле' },
          { label: 'Организации', value: String(organizations), icon: 'apartment', note: 'активно в системе' },
          { label: 'Конкуренты', value: '0', icon: 'new_releases', note: 'источник не настроен' },
          { label: 'Профиль', value: 'N/A', icon: 'leaderboard', note: 'нет данных для ранжирования' },
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
      </section>

      <section>
        <div className="flex justify-between items-end border-b border-outline-variant/10 pb-4 mb-5">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">Основные конкуренты</h2>
            <p className="text-xs text-on-surface-variant mt-1">Раздел ожидает подключение внешнего источника</p>
          </div>
        </div>
<<<<<<< HEAD
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.COMPETITORS.map((comp) => {
            const threat = THREAT_COLORS[comp.threat as keyof typeof THREAT_COLORS] ?? THREAT_COLORS.low
            return (
              <div key={comp.id} className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/10 p-6 transition-colors">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-base font-headline font-bold text-on-surface">{comp.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-on-surface-variant">{comp.funding}</span>
                      <span className="text-on-surface-variant/20">·</span>
                      <span className="text-xs text-on-surface-variant">{comp.market}</span>
                    </div>
                  </div>
                  <span className={`text-[10px] font-mono uppercase px-2.5 py-1 rounded-full border ${threat.bg} ${threat.text} ${threat.border}`}>
                    {threat.label} риск
                  </span>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-surface-container rounded-xl p-3">
                    <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">ARR</p>
                    <p className="text-sm font-mono font-bold text-on-surface mt-1">{comp.arr}</p>
                  </div>
                  <div className="bg-surface-container rounded-xl p-3">
                    <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Клиенты</p>
                    <p className="text-sm font-mono font-bold text-on-surface mt-1">{comp.clients}</p>
                  </div>
                </div>

                {/* Strengths & Weaknesses */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-mono text-primary uppercase tracking-widest mb-2">Сильные стороны</p>
                    <div className="space-y-1">
                      {comp.strengths.map((s) => (
                        <div key={s} className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-xs text-primary">add_circle</span>
                          <span className="text-xs text-on-surface-variant">{s}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-mono text-error uppercase tracking-widest mb-2">Слабые стороны</p>
                    <div className="space-y-1">
                      {comp.weaknesses.map((w) => (
                        <div key={w} className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-xs text-error">remove_circle</span>
                          <span className="text-xs text-on-surface-variant">{w}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Positioning Map */}
      <section>
        <h2 className="font-headline text-lg font-bold text-on-surface mb-5">Позиционирование</h2>
=======
>>>>>>> 41f51555aefe4444f42b51d039ecb8f312ab4ace
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Моки удалены. Для наполнения раздела необходимо подключить таблицу конкурентов или внешний feed.
            До этого момента отображается только факт отсутствия подтверждённых данных.
          </p>
        </div>
      </section>
    </div>
  )
}
