import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Профиль' }

const RECENT_ACTIVITY = [
  { action: 'Создал отчёт',   target: 'Q4 GRI Full Report',      time: '2 ч назад', icon: 'description' },
  { action: 'Обновил клиента', target: 'Vortex Labs',              time: '4 ч назад', icon: 'edit' },
  { action: 'Добавил сигнал', target: 'FinTech rate decision',    time: '1 д назад', icon: 'add_circle' },
  { action: 'Просмотрел GRI', target: 'Astra Ventures — 910 pts', time: '2 д назад', icon: 'radar' },
]

export default function ProfilePage() {
  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          Личный кабинет
        </p>
        <h1 className="font-headline text-3xl font-extrabold text-on-surface">
          Профиль
        </h1>
      </section>

      {/* Profile Card */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-8 flex flex-col items-center text-center">
          {/* Avatar */}
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 border-2 border-primary/30 flex items-center justify-center mb-4">
            <span className="text-2xl font-headline font-bold text-primary">AS</span>
          </div>
          <h2 className="font-headline text-lg font-bold text-on-surface">Ansari Senoff</h2>
          <p className="text-xs font-mono text-on-surface-variant mt-1 uppercase tracking-wider">Manager</p>
          <div className="flex items-center gap-2 mt-3">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs text-primary font-mono">Активен</span>
          </div>

          <div className="w-full mt-6 pt-6 border-t border-white/[0.04] space-y-3">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-base text-on-surface-variant">mail</span>
              <span className="text-xs text-on-surface-variant">ansari@aistart360.kz</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-base text-on-surface-variant">business</span>
              <span className="text-xs text-on-surface-variant">AIStart360 Ltd.</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-base text-on-surface-variant">location_on</span>
              <span className="text-xs text-on-surface-variant">Алматы, Казахстан</span>
            </div>
          </div>

          <button className="mt-6 w-full text-sm font-mono text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 px-4 py-2.5 rounded-xl transition-colors">
            Редактировать
          </button>
        </div>

        {/* Stats */}
        <div className="lg:col-span-2 space-y-4">
          {/* KPI stats for user */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Клиентов',   value: '6',  icon: 'business_center', sub: 'под управлением' },
              { label: 'Отчётов',    value: '18', icon: 'description',     sub: 'за квартал' },
              { label: 'Avg GRI',    value: '763',icon: 'radar',           sub: 'средний по портфелю' },
            ].map((stat) => (
              <div key={stat.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4 text-center">
                <span className="material-symbols-outlined text-xl text-primary/50 mb-2 block">{stat.icon}</span>
                <p className="text-xl font-mono font-bold text-on-surface">{stat.value}</p>
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mt-1">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Performance */}
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-4">Эффективность Q1 2026</p>
            <div className="space-y-3">
              {[
                { label: 'SLA соблюдение',    pct: 98, value: '98%' },
                { label: 'Загрузка',          pct: 82, value: '82%' },
                { label: 'NPS по клиентам',   pct: 88, value: '4.4/5' },
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-on-surface-variant">{item.label}</span>
                    <span className="font-mono text-on-surface">{item.value}</span>
                  </div>
                  <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${item.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-4">Последние действия</p>
            <div className="space-y-3">
              {RECENT_ACTIVITY.map((act, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center flex-shrink-0">
                    <span className="material-symbols-outlined text-sm text-on-surface-variant">{act.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-on-surface truncate">
                      <span className="text-on-surface-variant">{act.action}:</span> {act.target}
                    </p>
                  </div>
                  <span className="text-[10px] font-mono text-on-surface-variant flex-shrink-0">{act.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
