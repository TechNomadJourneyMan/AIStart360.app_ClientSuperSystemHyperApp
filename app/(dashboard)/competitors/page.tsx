import type { Metadata } from 'next'
import { auth } from '@/lib/auth'
import { getDashboardData } from '@/lib/get-dashboard-data'

export const metadata: Metadata = { title: 'Конкуренты' }

const THREAT_COLORS = {
  high:   { text: 'text-error', bg: 'bg-error/10', border: 'border-error/20', label: 'Высокий' },
  medium: { text: 'text-tertiary-container', bg: 'bg-tertiary-container/10', border: 'border-tertiary-container/20', label: 'Средний' },
  low:    { text: 'text-on-surface-variant', bg: 'bg-surface-container', border: 'border-white/[0.04]', label: 'Низкий' },
}

export default async function CompetitorsPage() {
  const session = await auth()
  const data = getDashboardData(session?.user?.email)

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
          { label: 'Всего игроков', value: '12', icon: 'groups', note: 'отслеживается' },
          { label: 'Высокий риск', value: '2', icon: 'warning', note: 'прямая угроза' },
          { label: 'Новых за квартал', value: '1', icon: 'new_releases', note: 'RevIQ Series B' },
          { label: 'Наш рейтинг', value: '#2', icon: 'leaderboard', note: 'в B2B-сегменте RU' },
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

      {/* Competitors Grid */}
      <section>
        <div className="flex justify-between items-end border-b border-outline-variant/10 pb-4 mb-5">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">Основные конкуренты</h2>
            <p className="text-xs text-on-surface-variant mt-1">Детальный профиль по каждому игроку</p>
          </div>
        </div>
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
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <div className="relative h-64 border border-white/[0.06] rounded-xl overflow-hidden">
            {/* Axes */}
            <div className="absolute inset-x-0 top-1/2 h-px bg-white/[0.06]" />
            <div className="absolute inset-y-0 left-1/2 w-px bg-white/[0.06]" />
            {/* Labels */}
            <span className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">Высокий ARR</span>
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">Низкий ARR</span>
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-on-surface-variant uppercase tracking-wider" style={{ writingMode: 'vertical-rl' }}>Нишевый</span>
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-on-surface-variant uppercase tracking-wider" style={{ writingMode: 'vertical-rl' }}>Масштабный</span>

            {/* Dots */}
            <div className="absolute" style={{ top: '22%', right: '20%' }}>
              <div className="w-3 h-3 rounded-full bg-error ring-4 ring-error/20" />
              <span className="text-[10px] font-mono text-error absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap">GrowthOS</span>
            </div>
            <div className="absolute" style={{ top: '38%', right: '38%' }}>
              <div className="w-3 h-3 rounded-full bg-tertiary-container ring-4 ring-tertiary-container/20" />
              <span className="text-[10px] font-mono text-tertiary-container absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap">RevIQ</span>
            </div>
            <div className="absolute" style={{ top: '55%', left: '40%' }}>
              <div className="w-3 h-3 rounded-full bg-on-surface-variant ring-4 ring-on-surface-variant/20" />
              <span className="text-[10px] font-mono text-on-surface-variant absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap">ScaleMetrics</span>
            </div>
            {/* Us */}
            <div className="absolute" style={{ top: '30%', right: '30%' }}>
              <div className="w-4 h-4 rounded-full bg-primary ring-4 ring-primary/30" />
              <span className="text-[10px] font-mono text-primary absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap font-bold">AIStart360</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
