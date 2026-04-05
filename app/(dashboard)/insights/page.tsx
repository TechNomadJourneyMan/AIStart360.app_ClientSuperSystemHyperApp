import type { Metadata } from 'next'
<<<<<<< HEAD
import { auth } from '@/lib/auth'
import { getDashboardData } from '@/lib/get-dashboard-data'
=======
import { prisma } from '@/lib/db'
>>>>>>> 41f51555aefe4444f42b51d039ecb8f312ab4ace

export const metadata: Metadata = { title: 'Инсайты' }

export default async function InsightsPage() {
  const [reportCount, avgScore] = await Promise.all([
    prisma.griReport.count(),
    prisma.griReport.aggregate({ _avg: { overallScore: true } }),
  ])

<<<<<<< HEAD
const TYPE_ICONS: Record<string, string> = {
  financial:   'payments',
  market:      'show_chart',
  regulatory:  'gavel',
  competitive: 'compare_arrows',
}

const INSIGHT_CARDS = [
  { icon: 'lightbulb', title: 'FinTech-клиенты растут быстрее', desc: 'Средний GRI FinTech-сегмента — 876, что на 18% выше остальных отраслей.', tag: 'Паттерн', color: 'primary' },
  { icon: 'warning', title: 'Риск оттока: 3 клиента', desc: 'Vortex Labs, Calyx Digital, PulseCore показывают признаки снижения вовлечённости.', tag: 'Риск', color: 'error' },
  { icon: 'trending_up', title: 'Q1 2026 — рекорд NPS', desc: 'NPS достиг 74 — максимум за 18 месяцев. Главный драйвер: скорость отчётов.', tag: 'Достижение', color: 'primary' },
  { icon: 'psychology', title: 'AI-инструменты ускоряют рост', desc: 'Клиенты, использующие AI-диагностику, растут на 34% быстрее.', tag: 'Исследование', color: 'secondary' },
]

export default async function InsightsPage() {
  const session = await auth()
  const data = getDashboardData(session?.user?.email)

=======
>>>>>>> 41f51555aefe4444f42b51d039ecb8f312ab4ace
  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          Аналитические инсайты · Q1 2026
        </p>
        <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
          <span className="text-gradient">Инсайты</span>
        </h1>
        <p className="text-on-surface-variant mt-2 text-sm max-w-xl">
          Ключевые наблюдения, паттерны и рекомендации на основе данных.
        </p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">GRI отчёты</p>
          <p className="text-3xl font-mono font-bold text-on-surface">{reportCount}</p>
          <p className="text-xs text-on-surface-variant mt-2">Количество расчётов в базе</p>
        </div>
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">Средний GRI</p>
          <p className="text-3xl font-mono font-bold text-on-surface">{Number(avgScore._avg.overallScore ?? 0).toFixed(1)}</p>
          <p className="text-xs text-on-surface-variant mt-2">Агрегированный показатель по отчётам</p>
        </div>
      </section>

<<<<<<< HEAD
      {/* All Signals */}
      <section>
        <div className="flex justify-between items-end border-b border-outline-variant/10 pb-4 mb-5">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">Все сигналы</h2>
            <p className="text-xs text-on-surface-variant mt-1">{data.SIGNALS.length} активных сигналов</p>
          </div>
          <div className="flex gap-2">
            {['Все', 'Рынок', 'Финансы', 'Регулирование', 'Конкуренты'].map((f, i) => (
              <button key={f} className={`text-xs font-mono px-3 py-1.5 rounded-full border transition-colors ${i === 0 ? 'bg-primary/10 text-primary border-primary/20' : 'text-on-surface-variant border-white/[0.06] hover:border-white/[0.12] hover:text-on-surface'}`}>
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {data.SIGNALS.map((signal) => {
            const colors = PRIORITY_COLORS[signal.priority as keyof typeof PRIORITY_COLORS] ?? PRIORITY_COLORS.low
            return (
              <div
                key={signal.id}
                className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/10 p-5 transition-all hover:translate-x-0.5 cursor-pointer"
              >
                <div className="flex items-start gap-4">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${colors.bg} border ${colors.border}`}>
                    <span className={`material-symbols-outlined text-lg ${colors.text}`}>
                      {TYPE_ICONS[signal.type] ?? 'info'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <h3 className="text-sm font-medium text-on-surface leading-snug">{signal.title}</h3>
                      <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border flex-shrink-0 ${colors.bg} ${colors.text} ${colors.border}`}>
                        {signal.priority}
                      </span>
                    </div>
                    <p className="text-xs text-on-surface-variant leading-relaxed mb-3">{signal.description}</p>
                    <div className="flex items-center gap-4">
                      <span className="text-[10px] font-mono text-on-surface-variant">{signal.time}</span>
                      {signal.relatedClient && (
                        <span className="text-[10px] font-mono bg-primary/10 text-primary px-2 py-0.5 rounded-md border border-primary/20">
                          {signal.relatedClient}
                        </span>
                      )}
                      <div className="flex gap-1.5">
                        {signal.tags?.slice(0, 2).map((tag) => (
                          <span key={tag} className="text-[10px] font-mono bg-surface-container-high text-on-surface-variant px-2 py-0.5 rounded-md">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
=======
      <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
        <h2 className="font-headline text-lg font-bold text-on-surface mb-3">Лента инсайтов</h2>
        <p className="text-sm text-on-surface-variant leading-relaxed">
          Моки удалены. Для автоматических инсайтов нужно подключить источник сигналов и слой аналитики.
          Сейчас раздел отображает только подтверждённые данные из существующей базы.
        </p>
>>>>>>> 41f51555aefe4444f42b51d039ecb8f312ab4ace
      </section>
    </div>
  )
}
