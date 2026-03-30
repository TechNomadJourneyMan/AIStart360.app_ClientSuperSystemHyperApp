import type { Metadata } from 'next'
import { prisma } from '@/lib/db'

export const metadata: Metadata = { title: 'Конкуренты' }

export default async function CompetitorsPage() {
  const [clients, organizations] = await Promise.all([
    prisma.client.count(),
    prisma.organization.count(),
  ])

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
